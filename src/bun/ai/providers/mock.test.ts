import { describe, expect, test } from "bun:test";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import { validateFiles } from "../validate";
import { elementFocus } from "../../../shared/ai/focus";
import { parsePlanReply } from "../../../shared/ai/plan";
import {
	createMockProvider,
	mockProductMd,
	primaryFamilyOf,
	restyleElement,
	restyleForVariation,
	withoutMissingComponents,
} from "./mock";

const request: GenerationRequest = {
	id: "g",
	task: "create",
	model: "mock",
	prompt: "A habit tracker",
	device: "mobile",
	context: {},
	files: [],
};

async function collect(events: AsyncIterable<GenerationEvent>) {
	const all: GenerationEvent[] = [];

	for await (const event of events) all.push(event);

	return all;
}

describe("mock provider", () => {
	test("streams status, reply, then start/delta/end per file, then done", async () => {
		const events = await collect(createMockProvider({ delayMs: 0 }).generate(request, new AbortController().signal));
		const types = events.map((e) => e.type);
		expect(types.slice(0, 4)).toEqual(["status", "status", "status", "status"]);
		expect(types[4]).toBe("message.delta");
		expect(types.at(-1)).toBe("done");
		expect(types.filter((t) => t === "done" || t === "error")).toHaveLength(1);

		const ends = events.filter((e) => e.type === "file.end");
		expect(ends.length).toBeGreaterThan(0);

		for (const end of ends) {
			const own = events.filter((e) => "path" in e && e.path === end.path);
			expect(own[0]!.type).toBe("file.start");
			expect(own.at(-1)).toBe(end);

			const streamed = own.flatMap((e) => (e.type === "file.delta" ? [e.text] : [])).join("");

			expect(streamed).toBe(end.content);
		}

		const start = events.find((e) => e.type === "file.start" && e.kind === "screen");
		expect(start).toMatchObject({ screen: { name: expect.any(String), device: "mobile" } });
		expect(
			validateFiles(
				ends.map((e) => ({ path: e.path, content: e.content })),
				{},
			),
		).toEqual([]);
	});

	test("a tablet request streams tablet screens", async () => {
		const events = await collect(
			createMockProvider({ delayMs: 0 }).generate({ ...request, device: "tablet" }, new AbortController().signal),
		);

		const starts = events.filter((e) => e.type === "file.start" && e.kind === "screen");
		expect(starts.length).toBeGreaterThan(0);

		for (const start of starts) expect(start).toMatchObject({ screen: { device: "tablet" } });
	});

	test("respects existing files", async () => {
		const files = [
			{ path: "screens/welcome.tsx", content: "" },
			{ path: "components/stat-card.tsx", content: "" },
		];

		const events = await collect(
			createMockProvider({ delayMs: 0 }).generate({ ...request, files }, new AbortController().signal),
		);

		const paths = events.filter((e) => e.type === "file.end").map((e) => e.path);
		expect(paths).toContain("screens/welcome-2.tsx");
		expect(paths).not.toContain("screens/welcome.tsx");
		expect(paths).not.toContain("components/stat-card.tsx");
	});

	test("stops with an aborted error", async () => {
		const controller = new AbortController();
		const events: GenerationEvent[] = [];

		for await (const event of createMockProvider({ delayMs: 50 }).generate(request, controller.signal)) {
			events.push(event);

			if (events.length === 1) controller.abort();
		}

		expect(events.map((e) => e.type)).toEqual(["status", "error"]);
		expect(events[1]).toMatchObject({ code: "aborted" });
	});

	test("looks at attached images and says so in the reply", async () => {
		const withImage: GenerationRequest = {
			...request,
			attachments: [{ name: "sketch.png", mediaType: "image/png", data: "AAAA" }],
		};

		const events = await collect(createMockProvider({ delayMs: 0 }).generate(withImage, new AbortController().signal));
		expect(events[0]).toEqual({ type: "status", label: "Looking at the image" });
		const reply = events.find((e) => e.type === "message.delta");
		expect(reply?.type === "message.delta" && reply.text).toStartWith("I used the attached image as a reference.");
		expect(createMockProvider().capabilities.images).toBe(true);
	});

	test("metadata", async () => {
		const provider = createMockProvider();
		expect(provider.kind).toBe("api");
		expect(await provider.listModels()).toEqual([{ id: "mock", label: "Mock (dev)" }]);
		expect(await provider.health()).toEqual({ ok: true, version: "dev" });
	});

	test("context task: DESIGN.md maps primary to the first palette family the screens use", async () => {
		const files = [
			{ path: "screens/b.tsx", content: `<div className="bg-emerald-500" />` },
			{ path: "screens/a.tsx", content: `<div className="text-muted-foreground bg-violet-600 text-zinc-500" />` },
		];

		const events = await collect(
			createMockProvider({ delayMs: 0 }).generate(
				{ ...request, task: "context", targets: ["DESIGN.md"], files },
				new AbortController().signal,
			),
		);

		expect(events.find((e) => e.type === "file.start")).toEqual({
			type: "file.start",
			path: "DESIGN.md",
			kind: "context",
		});
		const end = events.find((e) => e.type === "file.end");

		if (end?.type !== "file.end") throw new Error("no file.end event");
		expect(end.path).toBe("DESIGN.md");
		expect(end.content).toContain("## Tokens\n\n- primary: oklch(0.541 0.281 293.009)\n");
		expect(end.content).toContain("## Do / Don't");
		expect(events.at(-1)!.type).toBe("done");
		expect(validateFiles([{ path: end.path, content: end.content }], {}, [], { contextTarget: "DESIGN.md" })).toEqual(
			[],
		);
	});

	test("primaryFamilyOf ignores neutrals and non-TSX files", () => {
		expect(primaryFamilyOf([{ path: "screens/a.tsx", content: "bg-slate-900 text-gray-500" }])).toBeUndefined();
		expect(primaryFamilyOf([{ path: "DESIGN.md", content: "bg-rose-500" }])).toBeUndefined();
		expect(primaryFamilyOf([{ path: "components/x.tsx", content: "from-sky-400 to-blue-600" }])).toBe("sky");
	});

	test("context task: PRODUCT.md sorts the interview answers into sections", async () => {
		const prompt =
			"What is the product?\nA habit tracker.\nWho is it for?\nBusy parents.\nHow should it sound?\nWarm and brief.\nAny constraints?\niOS first.";

		const md = mockProductMd(prompt);
		expect(md).toBe(
			"# Product\n\n## Product\n\nA habit tracker.\n\n## Audience\n\nBusy parents.\n\n## Voice\n\nWarm and brief.\n\n## Constraints\n\niOS first.\n",
		);
		expect(mockProductMd("Just a todo app")).toContain(
			"## Product\n\nJust a todo app\n\n## Audience\n\nTo be decided.",
		);

		const events = await collect(
			createMockProvider({ delayMs: 0 }).generate(
				{ ...request, task: "context", targets: ["PRODUCT.md"], prompt },
				new AbortController().signal,
			),
		);

		expect(events.find((e) => e.type === "file.end")).toEqual({ type: "file.end", path: "PRODUCT.md", content: md });
	});

	test("variations restyle screens: another accent and other classes", async () => {
		const source = `<div className="rounded-xl bg-blue-500 font-semibold text-blue-600">x</div>`;
		expect(restyleForVariation(source, 0)).toBe(source);
		const shifted = [1, 2, 3].map((shift) => restyleForVariation(source, shift));
		expect(new Set([source, ...shifted]).size).toBe(4);
		expect(shifted[0]).not.toContain("blue");

		const ends = async (variation?: { index: number; count: number }) =>
			(
				await collect(
					createMockProvider({ delayMs: 0 }).generate({ ...request, variation }, new AbortController().signal),
				)
			).flatMap((e) => (e.type === "file.end" ? [{ path: e.path, content: e.content }] : []));

		const [first, second] = await Promise.all([ends({ index: 0, count: 2 }), ends({ index: 1, count: 2 })]);
		expect(first!.map((f) => f.path)).toEqual(second!.map((f) => f.path));
		expect(first![0]!.content).not.toBe(second![0]!.content);
		expect(validateFiles(second!, {})).toEqual([]);
	});

	test("edit restyles its target screens in place", async () => {
		const files = [
			{
				path: "screens/home.alt-1.tsx",
				content: `export default function H() { return <p className="text-rose-600 rounded-lg">h</p> }`,
			},
		];

		const events = await collect(
			createMockProvider({ delayMs: 0 }).generate(
				{ ...request, task: "edit", targets: [files[0]!.path], files },
				new AbortController().signal,
			),
		);

		const ends = events.flatMap((e) => (e.type === "file.end" ? [e] : []));
		expect(ends.map((e) => e.path)).toEqual(["screens/home.alt-1.tsx"]);
		expect(ends[0]!.content).not.toBe(files[0]!.content);
	});
});

describe("mock theme task", () => {
	test("replies with a tokens block read from DESIGN.md, and writes no file", async () => {
		const design = "## Colors\n\n- **Primary** (#0052ff): every CTA.\n- **Canvas** (#ffffff): the page.\n";
		const theme: GenerationRequest = { ...request, task: "theme", prompt: "", context: { design } };
		const events = await collect(createMockProvider({ delayMs: 0 }).generate(theme, new AbortController().signal));
		expect(events.some((e) => e.type.startsWith("file."))).toBe(false);
		expect(events.at(-1)?.type).toBe("done");
		const reply = events.flatMap((e) => (e.type === "message.delta" ? [e.text] : [])).join("");
		expect(reply).toBe("## Tokens\n\n- background: #ffffff\n- primary: #0052ff\n");
	});
});

describe("mock plan task", () => {
	test("replies with a plan of its own drafts, and writes no file", async () => {
		const plan: GenerationRequest = { ...request, task: "plan", projectScreens: ["screens/home.tsx"] };
		const events = await collect(createMockProvider({ delayMs: 0 }).generate(plan, new AbortController().signal));
		expect(events.some((e) => e.type.startsWith("file."))).toBe(false);
		const reply = events.flatMap((e) => (e.type === "message.delta" ? [e.text] : [])).join("");
		const parsed = parsePlanReply(reply, {})!;
		expect(parsed.screens.map((s) => s.path)).toEqual([
			"screens/welcome.tsx",
			"screens/home-2.tsx",
			"screens/details.tsx",
		]);
		expect(parsed.components.map((c) => c.name)).toEqual(["StatCard", "TabBar"]);
		expect(parsed.links[0]).toEqual({ from: "screens/welcome.tsx", to: "screens/home-2.tsx", label: "Continue" });
	});

	test("a planned screen drops the components that weren't written", () => {
		const source = `import { Flame } from "lucide-react";\nimport { StatCard } from "../components/stat-card";\nimport { TabBar } from "../components/tab-bar";\n\nexport default function A() {\n\treturn (\n\t\t<div>\n\t\t\t<StatCard label="A" icon={Flame} />\n\t\t\t<TabBar active={0} />\n\t\t</div>\n\t);\n}\n`;
		const out = withoutMissingComponents(source, new Set(["components/stat-card.tsx"]));
		expect(out).toContain("StatCard");
		expect(out).not.toContain("TabBar");
		expect(
			validateFiles([{ path: "screens/a.tsx", content: out }], {
				"components/stat-card.tsx": "export function StatCard() { return null }",
			}),
		).toEqual([]);
	});
});

describe("restyleElement", () => {
	const source = `export default function A() {\n\treturn (\n\t\t<main className="p-6">\n\t\t\t<h1 className="text-2xl font-semibold">Hi</h1>\n\t\t\t<Badge>New</Badge>\n\t\t</main>\n\t);\n}\n`;

	test("changes the focused element only", () => {
		const focus = elementFocus(source, "screens/a.tsx", source.indexOf("<h1"))!;
		const out = restyleElement(source, focus, 1)!;
		expect(out).toContain(`<h1 className="text-2xl font-bold">Hi</h1>`);
		expect(out.replace(`<h1 className="text-2xl font-bold">Hi</h1>`, focus.snippet)).toBe(source);
	});

	test("marks an element nothing restyles, and refuses a stale focus", () => {
		const focus = elementFocus(source, "screens/a.tsx", source.indexOf("<Badge"))!;
		expect(restyleElement(source, focus, 1)).toContain(
			`<Badge className="ring-2 ring-primary ring-offset-2">New</Badge>`,
		);
		expect(restyleElement(source.replace("New", "Old"), focus, 1)).toBeNull();
	});
});
