import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { GenerationEvent, GenerationRequest, Provider } from "../../shared/ai/contract";
import { elementFocus, focusNote } from "../../shared/ai/focus";
import type { GenerationEventMessage } from "../../shared/types";
import { createProjectFolder } from "../project-folder";
import { tempDir } from "../test-utils";
import { createMemorySecretStore } from "./keychain";
import { createAiService } from "./service";

function setup() {
	const root = tempDir();
	const sent: GenerationEventMessage[] = [];
	const ai = createAiService({
		userDataDir: join(root, "userData"),
		secrets: createMemorySecretStore(),
		includeMock: true,
		send: (message) => sent.push(message),
		detect: async () => ({}),
	});
	const projectPath = createProjectFolder(root, "Demo", "mobile");
	return { ai, sent, projectPath };
}

const params = (projectPath: string, generationId = "g1") => ({
	generationId,
	projectPath,
	prompt: "A habit tracker",
	device: "mobile" as const,
	model: "mock:mock",
});

describe("ai service", () => {
	test("lists the mock provider in development", async () => {
		const { ai } = setup();
		const { statuses } = await ai.listProviders();
		expect(statuses.map((s) => s.id)).toEqual(["mock"]);
		expect(statuses[0]!.health?.ok).toBe(true);
	});

	test("generates validated files and frames for new screens, streaming events", async () => {
		const { ai, sent, projectPath } = setup();
		const result = await ai.generate(params(projectPath));
		if (!result.ok) throw new Error(result.error.message);
		expect(result.problems).toEqual([]);
		expect(result.changes.some((c) => c.path === "screens/welcome.tsx")).toBe(true);
		expect(result.frames.map((f) => f.file)).toEqual(result.changes.filter((c) => c.path.startsWith("screens/")).map((c) => c.path));
		expect(result.frames[1]!.x).toBeGreaterThan(result.frames[0]!.x);
		expect(sent.every((m) => m.generationId === "g1")).toBe(true);
		expect(sent.some((m) => m.event.type === "file.delta")).toBe(true);
		expect(sent.at(-1)!.event.type).toBe("done");
	});

	test("stopping resolves with aborted", async () => {
		const { ai, projectPath } = setup();
		const running = ai.generate(params(projectPath, "g2"));
		setTimeout(() => ai.stopGeneration("g2"), 20);
		const result = await running;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("aborted");
	});

	test("an unknown model fails with a fix", async () => {
		const { ai, projectPath } = setup();
		const result = await ai.generate({ ...params(projectPath), model: "gone:model" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.fix).toBeString();
	});

	test("reports the context files that went into the request", async () => {
		const { ai, projectPath } = setup();
		writeFileSync(join(projectPath, "PRODUCT.md"), "# Product\n\nA habit tracker for parents.\n");
		writeFileSync(join(projectPath, "DESIGN.md"), "# Design\n\n<!-- template guidance -->\n");
		const result = await ai.generate(params(projectPath));
		if (!result.ok) throw new Error(result.error.message);
		expect(result.context).toEqual(["PRODUCT.md"]);
	});

	test("context task writes its one target", async () => {
		const { ai, projectPath } = setup();
		const result = await ai.generate({ ...params(projectPath, "g3"), task: "context", targets: ["DESIGN.md"], prompt: "" });
		if (!result.ok) throw new Error(result.error.message);
		expect(result.changes.map((c) => c.path)).toEqual(["DESIGN.md"]);
		expect(result.changes[0]!.content).toContain("## Tokens");
		expect(result.frames).toEqual([]);
		expect(result.problems).toEqual([]);
	});

	test("context task needs exactly one context target", async () => {
		const { ai, projectPath } = setup();
		for (const targets of [undefined, [], ["screens/a.tsx"], ["PRODUCT.md", "DESIGN.md"]]) {
			const result = await ai.generate({ ...params(projectPath), task: "context", targets });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).toContain("PRODUCT.md or DESIGN.md");
		}
	});
});

// ---------------------------------------------------------------- variations

function put(projectPath: string, path: string, content: string) {
	mkdirSync(dirname(join(projectPath, path)), { recursive: true });
	writeFileSync(join(projectPath, path), content);
}

const screenSource = (name: string) => `export default function ${name}() { return <p>${name}</p> }\n`;

type Play = (request: GenerationRequest, signal: AbortSignal) => AsyncIterable<GenerationEvent>;

/** A service whose model `mock:mock` plays `play` for every request, recording them. */
function setupFake(play: Play) {
	const root = tempDir();
	const sent: GenerationEventMessage[] = [];
	const requests: GenerationRequest[] = [];
	const provider: Provider = {
		id: "mock",
		kind: "api",
		label: "Fake",
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
		health: async () => ({ ok: true }),
		listModels: async () => [{ id: "mock", label: "Fake" }],
		generate(request, signal) {
			requests.push(request);
			return play(request, signal);
		},
	};
	const ai = createAiService({
		userDataDir: join(root, "userData"),
		secrets: createMemorySecretStore(),
		includeMock: true,
		send: (message) => sent.push(message),
		detect: async () => ({}),
		createProvider: () => provider,
	});
	const projectPath = createProjectFolder(root, "Demo", "mobile");
	return { ai, sent, requests, projectPath };
}

async function* events(...list: GenerationEvent[]): AsyncGenerator<GenerationEvent> {
	yield* list;
}

const write = (path: string, content: string): GenerationEvent[] => [
	{ type: "file.start", path, kind: path.startsWith("screens/") ? "screen" : "component", screen: { name: "Screen" } },
	{ type: "file.end", path, content },
];

describe("variations", () => {
	test("create with N variations: parallel runs, alternates per screen, rows of frames", async () => {
		const { ai, sent, requests, projectPath } = setupFake((request) => {
			const k = request.variation!.index;
			const row = `export function Row() { return <div /> }\n`;
			const screen = `import { Row } from "../components/row";\nexport default function Home() { return <Row key="${k}" /> }\n`;
			return events(
				{ type: "message.delta", text: `Variant ${k}.` },
				...write("screens/home.tsx", screen),
				...write("components/row.tsx", row),
				...(k === 2 ? write("screens/other.tsx", screenSource("Other")) : []),
				...(k === 1 ? [] : write("screens/second.tsx", screenSource("Second"))),
				{ type: "done", usage: { inputTokens: 10 } },
			);
		});
		const result = await ai.generate({ ...params(projectPath), variations: 3 });
		if (!result.ok) throw new Error(result.error.message);
		expect(requests.map((r) => [r.id, r.variation])).toEqual([
			["g1-v0", { index: 0, count: 3 }],
			["g1-v1", { index: 1, count: 3 }],
			["g1-v2", { index: 2, count: 3 }],
		]);
		expect(result.changes.map((c) => c.path)).toEqual([
			"screens/home.tsx",
			"components/row.tsx",
			"screens/second.tsx",
			"screens/home.alt-1.tsx",
			"screens/home.alt-2.tsx",
			"screens/second.alt-2.tsx",
		]);
		// The same component collapses back to the primary's
		expect(result.changes.find((c) => c.path === "screens/home.alt-2.tsx")!.content).toContain(`"../components/row"`);
		expect(result.frames.map(({ file, x, y }) => [file, x, y])).toEqual([
			["screens/home.tsx", 0, 0],
			["screens/second.tsx", 510, 0],
			["screens/home.alt-1.tsx", 0, 964],
			["screens/home.alt-2.tsx", 0, 1928],
			["screens/second.alt-2.tsx", 510, 1928],
		]);
		expect(result.reply).toBe("Variant 0.\n\nMade 3 variations. Left out 1 extra screen that matched none of the first variation's.");
		expect(result.usage?.inputTokens).toBe(30);
		expect(new Set(sent.map((m) => m.variant))).toEqual(new Set([0, 1, 2]));
		expect(sent.some((m) => m.variant === 1 && m.event.type === "file.end" && m.event.path === "components/row-v2.tsx")).toBe(true);
	});

	test("the mock provider makes visibly different variations", async () => {
		const { ai, projectPath } = setup();
		const result = await ai.generate({ ...params(projectPath), variations: 2 });
		if (!result.ok) throw new Error(result.error.message);
		const primary = result.changes.find((c) => c.path === "screens/welcome.tsx")!.content;
		const alt = result.changes.find((c) => c.path === "screens/welcome.alt-1.tsx")!.content;
		expect(alt).not.toBe(primary);
		expect(result.changes.some((c) => /-v\d\.tsx$/.test(c.path))).toBe(false);
		expect(result.problems).toEqual([]);
	});

	test("vary: edits of the target land as new alternates; the original stays", async () => {
		const { ai, requests, projectPath } = setupFake((request) =>
			events(...write(request.targets![0]!, screenSource(`V${request.variation?.index ?? 0}`)), { type: "done" }),
		);
		put(projectPath, "screens/home.tsx", screenSource("Home"));
		put(projectPath, "screens/home.alt-1.tsx", screenSource("Alt"));
		const result = await ai.generate({ ...params(projectPath), task: "vary", targets: ["screens/home.alt-1.tsx"], prompt: "bolder", variations: 2 });
		if (!result.ok) throw new Error(result.error.message);
		expect(requests.map((r) => [r.task, r.targets, r.id])).toEqual([
			["edit", ["screens/home.alt-1.tsx"], "g1-v1"],
			["edit", ["screens/home.alt-1.tsx"], "g1-v2"],
		]);
		expect(requests[0]!.prompt).toContain("Make a new variation");
		expect(requests[0]!.prompt).toContain("Direction: bolder");
		expect(result.changes).toEqual([
			{ path: "screens/home.alt-2.tsx", content: screenSource("V0") },
			{ path: "screens/home.alt-3.tsx", content: screenSource("V1") },
		]);
		expect(result.frames.map(({ file, x, y }) => [file, x, y])).toEqual([
			["screens/home.alt-2.tsx", 0, 0],
			["screens/home.alt-3.tsx", 0, 964],
		]);
	});

	test("vary needs one existing screen", async () => {
		const { ai, projectPath } = setupFake(() => events({ type: "done" }));
		const result = await ai.generate({ ...params(projectPath), task: "vary", targets: ["screens/missing.tsx"] });
		expect(result.ok).toBe(false);
	});

	test("references are read but never written", async () => {
		const { ai, requests, projectPath } = setupFake(() =>
			events(...write("screens/home.tsx", screenSource("Mixed")), ...write("screens/home.alt-1.tsx", screenSource("Changed")), { type: "done" }),
		);
		put(projectPath, "screens/home.tsx", screenSource("Home"));
		put(projectPath, "screens/home.alt-1.tsx", screenSource("Alt"));
		const result = await ai.generate({ ...params(projectPath), task: "edit", targets: ["screens/home.tsx"], references: ["screens/home.alt-1.tsx"] });
		if (!result.ok) throw new Error(result.error.message);
		expect(requests[0]!.references).toEqual(["screens/home.alt-1.tsx"]);
		expect(requests[0]!.files.map((f) => f.path)).toContain("screens/home.alt-1.tsx");
		expect(result.changes).toEqual([{ path: "screens/home.tsx", content: screenSource("Mixed") }]);
	});

	test("an edit of an alternate keeps its path", async () => {
		const { ai, projectPath } = setupFake(() => events(...write("screens/home.alt-1.tsx", screenSource("Fixed")), { type: "done" }));
		put(projectPath, "screens/home.tsx", screenSource("Home"));
		put(projectPath, "screens/home.alt-1.tsx", screenSource("Alt"));
		const result = await ai.generate({ ...params(projectPath), task: "edit", targets: ["screens/home.alt-1.tsx"] });
		if (!result.ok) throw new Error(result.error.message);
		expect(result.changes).toEqual([{ path: "screens/home.alt-1.tsx", content: screenSource("Fixed") }]);
		expect(result.problems).toEqual([]);
	});

	test("variant 0 fails: the lowest successful variant takes the base names", async () => {
		const { ai, projectPath } = setupFake((request) =>
			request.variation!.index === 0
				? events({ type: "error", code: "rate_limited", message: "Slow down", retryable: true })
				: events({ type: "message.delta", text: `V${request.variation!.index}` }, ...write("screens/home.tsx", screenSource(`V${request.variation!.index}`)), { type: "done" }),
		);
		const result = await ai.generate({ ...params(projectPath), variations: 3 });
		if (!result.ok) throw new Error(result.error.message);
		expect(result.changes).toEqual([
			{ path: "screens/home.tsx", content: screenSource("V1") },
			{ path: "screens/home.alt-2.tsx", content: screenSource("V2") },
		]);
		expect(result.reply).toBe("V1\n\nMade 2 variations. 1 variation failed.");
		expect(result.frames.map((f) => f.file)).toEqual(["screens/home.tsx", "screens/home.alt-2.tsx"]);
	});

	test("every variant fails: the first error", async () => {
		const { ai, projectPath } = setupFake((request) =>
			events({ type: "error", code: request.variation!.index ? "network" : "rate_limited", message: "No", retryable: true }),
		);
		const result = await ai.generate({ ...params(projectPath), variations: 2 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("rate_limited");
	});

	test("stopping aborts every variant", async () => {
		const { ai, projectPath } = setupFake(async function* (_request, signal) {
			yield { type: "status", label: "Thinking" };
			await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
			yield { type: "error", code: "aborted", message: "Stopped", retryable: true };
		});
		const running = ai.generate({ ...params(projectPath, "g9"), variations: 3 });
		setTimeout(() => ai.stopGeneration("g9"), 20);
		const result = await running;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("aborted");
	});
});

describe("point and prompt", () => {
	const path = "screens/welcome.tsx";
	const source = `export default function Welcome() {\n\treturn (\n\t\t<main className="p-6">\n\t\t\t<h1 className="text-2xl">Welcome</h1>\n\t\t\t<p>Body</p>\n\t\t</main>\n\t);\n}\n`;
	const focus = elementFocus(source, path, source.indexOf("<h1"))!;
	const chatLine = (role: "user" | "assistant", content: string) =>
		JSON.stringify({ id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() });

	test("the mock provider changes the focused element only", async () => {
		const { ai, projectPath } = setup();
		put(projectPath, path, source);
		const result = await ai.generate({ ...params(projectPath), task: "edit", targets: [path], focus, prompt: "Bigger" });
		if (!result.ok) throw new Error(result.error.message);
		const content = result.changes.find((c) => c.path === path)!.content!;
		expect(content).not.toBe(source);
		expect(content.slice(0, focus.start)).toBe(source.slice(0, focus.start));
		expect(content.endsWith(source.slice(focus.end))).toBe(true);
		expect(result.reply).toBe("Restyled <h1> “Welcome” in Welcome.");
	});

	test("a change outside the element is applied with a note; the focus note isn't history", async () => {
		const outside = source.replace("Welcome</h1>", "Hello</h1>").replace("Body", "Text");
		const { ai, requests, projectPath } = setupFake(() => events({ type: "message.delta", text: "Done." }, ...write(path, outside), { type: "done" }));
		put(projectPath, path, source);
		put(projectPath, "chat.jsonl", [chatLine("user", "A welcome screen"), chatLine("assistant", "Made it."), chatLine("user", focusNote(focus.label, "Welcome", "Say hello"))].join("\n"));
		const result = await ai.generate({ ...params(projectPath), task: "edit", targets: [path], focus, prompt: "Say hello" });
		if (!result.ok) throw new Error(result.error.message);
		expect(requests[0]!.focus).toEqual(focus);
		expect(requests[0]!.history?.map((turn) => turn.content)).toEqual(["A welcome screen", "Made it."]);
		expect(result.changes).toEqual([{ path, content: outside }]);
		expect(result.reply).toBe(`Done.\n\nNote: this also changed ${path} outside <h1> “Welcome” (line 5). Undo reverts the whole edit.`);
	});

	test("a stale focus is dropped: the request is a plain edit of the file", async () => {
		const { ai, requests, projectPath } = setupFake(() => events(...write(path, source), { type: "done" }));
		put(projectPath, path, source.replace("Welcome</h1>", "Hi</h1>"));
		const result = await ai.generate({ ...params(projectPath), task: "edit", targets: [path], focus });
		expect(result.ok).toBe(true);
		expect(requests[0]!.focus).toBeUndefined();
		expect(requests[0]!.targets).toEqual([path]);
	});
});
