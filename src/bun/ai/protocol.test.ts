import { describe, expect, test } from "bun:test";
import type { GenerationEvent } from "../../shared/ai/contract";
import { createTextProtocolParser, parseAttributes, TRUNCATED_STATUS } from "./protocol";

const WELCOME = `import { Button } from "@/components/ui/button";

export default function Welcome() {
	const a = 1 < 2 && "<rabisco" !== "x";
	return <div className="h-full">{a ? <Button>Go</Button> : null}</div>;
}
`;

const STAT = `export function StatCard({ label }: { label: string }) {
	return <p>{label}</p>;
}
`;

const SAMPLE = `Here is your welcome screen < 3 screens.

<rabisco-file path="screens/welcome.tsx" kind="screen" name="Welcome &amp; hi" device="mobile">
${WELCOME}</rabisco-file>
<rabisco-file path="components/stat-card.tsx">
\`\`\`tsx
${STAT}\`\`\`
</rabisco-file>
<rabisco-delete path="screens/old.tsx" />
Done. <b>bold</b> </rabisco-file> stays out.`;

/** Feeds `chunks` and merges adjacent deltas so different splits compare equal. */
function run(chunks: string[]) {
	const parser = createTextProtocolParser();
	const events: GenerationEvent[] = [];
	for (const chunk of chunks) events.push(...parser.push(chunk));
	events.push(...parser.end());
	return { events: merge(events), parser };
}

function merge(events: GenerationEvent[]) {
	const out: GenerationEvent[] = [];
	for (const event of events) {
		const last = out[out.length - 1];
		if (event.type === "message.delta" && last?.type === "message.delta") last.text += event.text;
		else if (event.type === "file.delta" && last?.type === "file.delta" && last.path === event.path) last.text += event.text;
		else out.push({ ...event });
	}
	return out;
}

function randomSplits(text: string, seed: number) {
	let s = seed;
	const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	const chunks: string[] = [];
	for (let i = 0; i < text.length; ) {
		const size = 1 + Math.floor(rand() * 24);
		chunks.push(text.slice(i, i + size));
		i += size;
	}
	return chunks;
}

describe("text protocol parser", () => {
	const whole = run([SAMPLE]);

	test("parses files, deletes and text", () => {
		expect(whole.events).toEqual([
			{ type: "message.delta", text: "Here is your welcome screen < 3 screens.\n\n" },
			{ type: "file.start", path: "screens/welcome.tsx", kind: "screen", screen: { name: "Welcome & hi", device: "mobile" } },
			{ type: "file.delta", path: "screens/welcome.tsx", text: WELCOME },
			{ type: "file.end", path: "screens/welcome.tsx", content: WELCOME },
			{ type: "message.delta", text: "\n" },
			{ type: "file.start", path: "components/stat-card.tsx", kind: "component" },
			{ type: "file.delta", path: "components/stat-card.tsx", text: STAT },
			{ type: "file.end", path: "components/stat-card.tsx", content: STAT },
			{ type: "message.delta", text: "\n" },
			{ type: "file.delete", path: "screens/old.tsx" },
			{ type: "message.delta", text: "\nDone. <b>bold</b>  stays out." },
		]);
		expect(whole.parser.written).toEqual(["screens/welcome.tsx", "components/stat-card.tsx"]);
		expect(whole.parser.deleted).toEqual(["screens/old.tsx"]);
		expect(whole.parser.truncated).toEqual([]);
		expect(whole.parser.hasMessage).toBe(true);
	});

	test("one character at a time gives the same events", () => {
		expect(run([...SAMPLE]).events).toEqual(whole.events);
	});

	test("every two-way split gives the same events", () => {
		for (let i = 1; i < SAMPLE.length; i++) {
			expect(run([SAMPLE.slice(0, i), SAMPLE.slice(i)]).events).toEqual(whole.events);
		}
	});

	test("random splits give the same events", () => {
		for (let seed = 1; seed <= 300; seed++) expect(run(randomSplits(SAMPLE, seed)).events).toEqual(whole.events);
	});

	test("streamed deltas are always a prefix of the final content", () => {
		for (const chunks of [[...SAMPLE], randomSplits(SAMPLE, 7)]) {
			const parser = createTextProtocolParser();
			const sent = new Map<string, string>();
			for (const chunk of chunks) {
				for (const event of parser.push(chunk)) {
					if (event.type === "file.delta") sent.set(event.path, (sent.get(event.path) ?? "") + event.text);
					if (event.type === "file.end") expect(sent.get(event.path)).toBe(event.content);
					// The fence never leaks into a delta
					if (event.type === "file.delta") expect(event.text).not.toContain("```");
				}
			}
		}
	});

	test("never emits text that could start a tag", () => {
		const parser = createTextProtocolParser();
		expect(parser.push("Hi <rabis")).toEqual([{ type: "message.delta", text: "Hi " }]);
		expect(parser.push("co-fi")).toEqual([]);
		expect(parser.push("le path=\"screens/a.tsx\"")).toEqual([]);
		expect(parser.push(">x")[0]).toEqual({ type: "file.start", path: "screens/a.tsx", kind: "screen", screen: { name: "A" } });
	});

	test("close tag split mid-name is held back from the delta", () => {
		const parser = createTextProtocolParser();
		const events = [...parser.push('<rabisco-file path="screens/a.tsx">\nabc</rabisco-fi')];
		expect(events.filter((e) => e.type === "file.delta")).toEqual([{ type: "file.delta", path: "screens/a.tsx", text: "abc" }]);
		expect(parser.push("le>")).toEqual([
			{ type: "file.delta", path: "screens/a.tsx", text: "\n" },
			{ type: "file.end", path: "screens/a.tsx", content: "abc\n" },
		]);
	});

	test("infers kind from the path and the path from the name", () => {
		const { events } = run(['<rabisco-file path="./components/tab-bar.tsx">x</rabisco-file><rabisco-file kind="screen" name="Order History">y</rabisco-file>']);
		expect(events.filter((e) => e.type === "file.start")).toEqual([
			{ type: "file.start", path: "components/tab-bar.tsx", kind: "component" },
			{ type: "file.start", path: "screens/order-history.tsx", kind: "screen", screen: { name: "Order History" } },
		]);
	});

	test("a file still open at the end is truncated", () => {
		const parser = createTextProtocolParser();
		const events = [...parser.push('<rabisco-file path="screens/a.tsx">\nconst a = 1;\nconst b'), ...parser.end()];
		expect(events.some((e) => e.type === "file.end")).toBe(false);
		expect(events[events.length - 1]).toEqual({ type: "status", label: TRUNCATED_STATUS, detail: "screens/a.tsx" });
		expect(parser.truncated).toEqual(["screens/a.tsx"]);
		expect(parser.written).toEqual([]);
	});

	test("an unfinished tag at the end is dropped, other text is flushed", () => {
		expect(run(["Hello <rabisco-file path="]).events).toEqual([{ type: "message.delta", text: "Hello " }]);
		expect(run(["a <rab"]).events).toEqual([{ type: "message.delta", text: "a <rab" }]);
		expect(run(["x <"]).events).toEqual([{ type: "message.delta", text: "x <" }]);
	});

	test("similar tags are plain text", () => {
		expect(run(["<rabisco-files> <rabisco-fileX>"]).events).toEqual([{ type: "message.delta", text: "<rabisco-files> <rabisco-fileX>" }]);
	});

	test("a file without a path is swallowed", () => {
		const { events, parser } = run(["<rabisco-file kind=\"component\">x</rabisco-file>ok"]);
		expect(events).toEqual([
			{ type: "status", label: "Ignored a file without a path" },
			{ type: "message.delta", text: "ok" },
		]);
		expect(parser.written).toEqual([]);
	});

	test("fence without a language and CRLF", () => {
		const { events } = run(['<rabisco-file path="screens/a.tsx">\r\n```\r\nline\r\n```\r\n</rabisco-file>']);
		expect(events.find((e) => e.type === "file.end")).toEqual({ type: "file.end", path: "screens/a.tsx", content: "line\n" });
	});

	test("parses single-quoted and unquoted attributes", () => {
		expect(parseAttributes(` path='screens/a.tsx' kind=screen NAME="A &quot;b&quot;"`)).toEqual({ path: "screens/a.tsx", kind: "screen", name: 'A "b"' });
	});

	test("context files: kind from the attribute or the .md path", () => {
		const parser = createTextProtocolParser();
		const events = [
			...parser.push('<rabisco-file path="DESIGN.md" kind="context">\n# Design\n\n- primary: #fff\n</rabisco-file>'),
			...parser.push('<rabisco-file path="PRODUCT.md">\n# Product\n</rabisco-file>'),
			...parser.end(),
		];
		expect(events.filter((e) => e.type === "file.start")).toEqual([
			{ type: "file.start", path: "DESIGN.md", kind: "context" },
			{ type: "file.start", path: "PRODUCT.md", kind: "context" },
		]);
		expect(events.find((e) => e.type === "file.end")).toEqual({ type: "file.end", path: "DESIGN.md", content: "# Design\n\n- primary: #fff\n" });
	});
});
