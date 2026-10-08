import { describe, expect, test } from "bun:test";
import type { GenerationEvent, GenerationRequest, Provider } from "../../shared/ai/contract";
import { elementFocus } from "../../shared/ai/focus";
import {
	DEFAULT_REQUEST_CHARS,
	GenerationError,
	buildGenerationRequest,
	buildThemeRequest,
	type BuildRequestParams,
	contextFilesOf,
	contextTargetOf,
	runGeneration,
	runThemeReading,
} from "./run";
import { designSourceOf } from "../../shared/context/theme";

const GOOD_SCREEN = `import { Row } from "../components/row";\nexport default function A() { return <Row /> }\n`;

const GOOD_ROW = `export function Row() { return <div /> }\n`;

const BAD = `export default function A() { return <div> }\n`;

type Script = GenerationEvent[] | ((signal: AbortSignal) => AsyncIterable<GenerationEvent>);

function fakeProvider(scripts: Script[]) {
	const requests: GenerationRequest[] = [];

	const provider: Provider = {
		id: "fake",
		kind: "api",
		label: "Fake",
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
		health: async () => ({ ok: true }),
		listModels: async () => [],
		async *generate(request, signal) {
			const script = scripts[requests.length];
			requests.push(request);

			if (!script) throw new Error("unexpected call");

			if (Array.isArray(script)) yield* script;
			else yield* script(signal);
		},
	};

	return { provider, requests };
}

const file = (path: string, content: string): GenerationEvent[] => [
	{ type: "file.start", path, kind: path.startsWith("screens/") ? "screen" : "component" },
	{ type: "file.delta", path, text: content },
	{ type: "file.end", path, content },
];

const request: GenerationRequest = {
	id: "g1",
	task: "create",
	model: "m",
	prompt: "a screen",
	device: "mobile",
	context: {},
	files: [],
};

async function run(
	provider: Provider,
	projectFiles: Record<string, string> = {},
	signal = new AbortController().signal,
	req = request,
) {
	const events: [string, number][] = [];

	const result = await runGeneration({
		provider,
		request: req,
		projectFiles,
		signal,
		onEvent: (e, attempt) => events.push([e.type, attempt]),
	});

	return { result, events };
}

describe("runGeneration", () => {
	test("success: collects files, reply and usage; last write wins", async () => {
		const { provider, requests } = fakeProvider([
			[
				{ type: "status", label: "Thinking" },
				{ type: "message.delta", text: "Here " },
				...file("screens/a.tsx", "old"),
				...file("components/row.tsx", GOOD_ROW),
				{ type: "message.delta", text: "you go." },
				...file("screens/a.tsx", GOOD_SCREEN),
				{ type: "file.delete", path: "screens/old.tsx" },
				{ type: "done", usage: { inputTokens: 10, outputTokens: 5 } },
			],
		]);

		const { result, events } = await run(provider, { "screens/old.tsx": "x" });
		expect(requests).toHaveLength(1);
		expect(result).toEqual({
			changes: [
				{ path: "screens/a.tsx", content: GOOD_SCREEN },
				{ path: "components/row.tsx", content: GOOD_ROW },
				{ path: "screens/old.tsx", content: null },
			],
			reply: "Here you go.",
			problems: [],
			notes: [],
			usage: { inputTokens: 10, outputTokens: 5 },
			attempts: 1,
		});
		expect(events[0]).toEqual(["status", 1]);
		expect(events.at(-1)).toEqual(["done", 1]);
	});

	test("invalid then repaired", async () => {
		const { provider, requests } = fakeProvider([
			[
				{ type: "message.delta", text: "Done." },
				...file("screens/a.tsx", BAD),
				...file("components/row.tsx", GOOD_ROW),
				{ type: "done", usage: { outputTokens: 5 } },
			],
			[
				{ type: "message.delta", text: "Fixed." },
				...file("screens/a.tsx", GOOD_SCREEN),
				{ type: "done", usage: { outputTokens: 3 } },
			],
		]);

		const { result, events } = await run(provider, { "components/card.tsx": "export function Card() {}" });
		expect(result.attempts).toBe(2);
		expect(result.problems).toEqual([]);
		expect(result.reply).toBe("Done.");
		expect(result.usage).toEqual({ inputTokens: undefined, outputTokens: 8, costUsd: undefined });
		expect(result.changes).toEqual([
			{ path: "screens/a.tsx", content: GOOD_SCREEN },
			{ path: "components/row.tsx", content: GOOD_ROW },
		]);
		const repair = requests[1]!;
		expect(repair.task).toBe("repair");
		expect(repair.id).toBe("g1-repair-1");
		expect(repair.targets).toEqual(["screens/a.tsx"]);
		expect(repair.problems).toEqual([
			{ path: "screens/a.tsx", message: expect.stringContaining("Syntax error"), line: expect.any(Number) },
		]);
		expect(repair.files.map((f) => f.path).sort()).toEqual([
			"components/card.tsx",
			"components/row.tsx",
			"screens/a.tsx",
		]);
		expect(repair.files.find((f) => f.path === "screens/a.tsx")!.content).toBe(BAD);
		expect(events.some(([type, attempt]) => type === "file.end" && attempt === 2)).toBe(true);
	});

	test("still invalid after the repairs: problems reported and the file left out, with its dependents", async () => {
		const badRow = `export default function Row() { return <div /> }\n`;
		const stillBad: GenerationEvent[] = [...file("components/row.tsx", badRow), { type: "done" }];

		const { provider, requests } = fakeProvider([
			[
				...file("screens/a.tsx", GOOD_SCREEN),
				...file("components/row.tsx", badRow),
				...file("screens/b.tsx", `export default function B() { return <p /> }`),
				{ type: "done" },
			],
			stillBad,
			stillBad,
		]);

		const { result } = await run(provider);
		expect(requests).toHaveLength(3);
		expect(result.attempts).toBe(3);
		expect(result.changes).toEqual([
			{ path: "screens/b.tsx", content: `export default function B() { return <p /> }` },
		]);
		expect([...new Set(result.problems.map((p) => p.path))]).toEqual(["components/row.tsx", "screens/a.tsx"]);
	});

	test("repairs keep the original request's context", async () => {
		const { provider, requests } = fakeProvider([
			[...file("screens/a.tsx", BAD), { type: "done" }],
			[...file("screens/a.tsx", `export default function A() { return <p /> }`), { type: "done" }],
		]);

		const withContext = { ...request, context: { product: "Habits", design: "## Tokens\n\n- primary: #f00" } };
		await run(provider, {}, undefined, withContext);
		expect(requests[1]!.task).toBe("repair");
		expect(requests[1]!.context).toEqual(withContext.context);
	});

	test("a new component that duplicates an existing one is repaired into an import", async () => {
		const project = { "components/row.tsx": GOOD_ROW };
		const copy = `export function Row() { return <div className="p-2" /> }\n`;

		const { provider, requests } = fakeProvider([
			[
				...file("components/list-row.tsx", copy),
				...file(
					"screens/a.tsx",
					`import { Row } from "../components/list-row";\nexport default function A() { return <Row /> }\n`,
				),
				{ type: "done" },
			],
			[
				{ type: "file.delete", path: "components/list-row.tsx" },
				...file("screens/a.tsx", GOOD_SCREEN),
				{ type: "done" },
			],
		]);

		const { result } = await run(provider, project, undefined, {
			...request,
			components: [{ path: "components/row.tsx", signature: ["Row()"] }],
		});

		expect(requests[1]!.task).toBe("repair");
		expect(requests[1]!.targets).toEqual(["components/list-row.tsx"]);
		expect(requests[1]!.problems![0]!.message).toContain("Row is already exported by components/row.tsx");
		expect(requests[1]!.components).toEqual([{ path: "components/row.tsx", signature: ["Row()"] }]);
		expect(result.problems).toEqual([]);
		expect(result.changes.filter((c) => c.content !== null).map((c) => c.path)).toEqual(["screens/a.tsx"]);
	});

	test("context task: writes only its target; other writes are dropped without a repair", async () => {
		const { provider, requests } = fakeProvider([
			[
				{ type: "file.start", path: "DESIGN.md", kind: "context" },
				{ type: "file.end", path: "DESIGN.md", content: "# Design\n\nWarm\n" },
				...file("screens/a.tsx", GOOD_SCREEN),
				{ type: "file.delete", path: "screens/old.tsx" },
				{ type: "done" },
			],
		]);

		const contextRequest: GenerationRequest = { ...request, task: "context", targets: ["DESIGN.md"] };
		const { result } = await run(provider, { "screens/old.tsx": "x" }, undefined, contextRequest);
		expect(requests).toHaveLength(1);
		expect(result.changes).toEqual([{ path: "DESIGN.md", content: "# Design\n\nWarm\n" }]);
		expect(result.problems.map((p) => p.path).sort()).toEqual(["screens/a.tsx", "screens/old.tsx"]);
	});

	test("context task: an empty target is repaired as a context file", async () => {
		const { provider, requests } = fakeProvider([
			[{ type: "file.end", path: "PRODUCT.md", content: "\n" }, { type: "done" }],
			[{ type: "file.end", path: "PRODUCT.md", content: "# Product\n\nHabits\n" }, { type: "done" }],
		]);

		const { result } = await run(provider, {}, undefined, { ...request, task: "context", targets: ["PRODUCT.md"] });
		expect(requests[1]).toMatchObject({
			task: "repair",
			targets: ["PRODUCT.md"],
			problems: [{ path: "PRODUCT.md", message: expect.stringContaining("empty") }],
		});
		expect(result.changes).toEqual([{ path: "PRODUCT.md", content: "# Product\n\nHabits\n" }]);
		expect(result.problems).toEqual([]);
	});

	test("a provider error on the first attempt throws GenerationError", async () => {
		const { provider } = fakeProvider([
			[
				{ type: "status", label: "x" },
				{ type: "error", code: "not_authenticated", message: "Bad key", retryable: false },
			],
		]);

		const error = await run(provider).catch((e) => e);
		expect(error).toBeInstanceOf(GenerationError);
		expect(error).toMatchObject({
			code: "not_authenticated",
			message: "Bad key",
			retryable: false,
			fix: expect.any(String),
		});
	});

	test("a thrown exception becomes an unknown GenerationError", async () => {
		const { provider } = fakeProvider([]);
		await expect(run(provider)).rejects.toMatchObject({ code: "unknown", message: "unexpected call" });
	});

	test("a provider error during repair keeps the valid files", async () => {
		const { provider } = fakeProvider([
			[
				...file("screens/a.tsx", BAD),
				...file("screens/b.tsx", GOOD_SCREEN),
				...file("components/row.tsx", GOOD_ROW),
				{ type: "done" },
			],
			[{ type: "error", code: "rate_limited", message: "Slow down", retryable: true }],
		]);

		const { result } = await run(provider);
		expect(result.attempts).toBe(2);
		expect(result.changes.map((c) => c.path)).toEqual(["screens/b.tsx", "components/row.tsx"]);
		expect(result.problems).toHaveLength(1);
	});

	test("abort throws an aborted GenerationError", async () => {
		const controller = new AbortController();

		const { provider } = fakeProvider([
			async function* (signal) {
				yield { type: "status", label: "Working" };
				controller.abort();
				await Promise.resolve();

				if (signal.aborted) yield { type: "error", code: "aborted", message: "stopped", retryable: true };
			},
		]);

		await expect(run(provider, {}, controller.signal)).rejects.toMatchObject({ code: "aborted" });
	});

	test("abort during a repair throws too", async () => {
		const controller = new AbortController();

		const { provider } = fakeProvider([
			[...file("screens/a.tsx", BAD), { type: "done" }],
			async function* () {
				controller.abort();
				yield { type: "error", code: "aborted", message: "stopped", retryable: true };
			},
		]);

		await expect(run(provider, {}, controller.signal)).rejects.toMatchObject({ code: "aborted" });
	});
});

describe("buildGenerationRequest", () => {
	const files = {
		"PRODUCT.md": "A habit app",
		"DESIGN.md": "  ",
		"screens/home.tsx": "home".repeat(10),
		"screens/settings.tsx": "s",
		"screens/profile.tsx": "pp",
		"screens/home.alt-1.tsx": "alt",
		"components/tab-bar.tsx": "tabs",
		"components/card.tsx": "card",
	};

	test("context, targets, components and style screens", () => {
		const req = buildGenerationRequest({
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: files,
			targets: ["screens/home.tsx"],
		});

		expect(req.context).toEqual({ product: "A habit app" });
		expect(req.targets).toEqual(["screens/home.tsx"]);
		expect(req.files.map((f) => f.path)).toEqual([
			"screens/home.tsx",
			"components/card.tsx",
			"components/tab-bar.tsx",
			"screens/settings.tsx",
			"screens/profile.tsx",
		]);
		expect(req.attachments).toBeUndefined();
	});

	test("references are always included and listed; never as targets or style screens", () => {
		const req = buildGenerationRequest({
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: files,
			targets: ["screens/home.tsx"],
			references: ["screens/home.alt-1.tsx", "screens/home.tsx", "screens/gone.tsx", "PRODUCT.md"],
			maxChars: 1,
		});

		expect(req.references).toEqual(["screens/home.alt-1.tsx"]);
		expect(req.files.map((f) => f.path)).toEqual(["screens/home.tsx", "screens/home.alt-1.tsx"]);
		expect(
			buildGenerationRequest({
				id: "r",
				task: "create",
				prompt: "p",
				device: "mobile",
				model: "m",
				projectFiles: files,
			}).references,
		).toBeUndefined();
	});

	test("drops style screens first, then components, never targets", () => {
		const big = { ...files, "screens/home.tsx": "x".repeat(DEFAULT_REQUEST_CHARS) };

		const req = buildGenerationRequest({
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: big,
			targets: ["screens/home.tsx"],
		});

		expect(req.files.map((f) => f.path)).toEqual(["screens/home.tsx"]);

		const small = buildGenerationRequest({
			id: "r",
			task: "create",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: files,
			maxChars: 20,
		});

		expect(small.files.map((f) => f.path)).toEqual([
			"components/card.tsx",
			"components/tab-bar.tsx",
			"screens/settings.tsx",
		]);
		expect(small.targets).toBeUndefined();
	});

	test("context files count only when they say something; the prompt-side body is stripped, the request keeps the file", () => {
		const template = "# Design\n\n<!-- Describe the tokens -->\n\n## Tokens\n";
		const product = "# Product\n<!-- What is it? -->\nA habit app\n";

		const req = buildGenerationRequest({
			id: "r",
			task: "create",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: { "PRODUCT.md": product, "DESIGN.md": template },
		});

		expect(req.context).toEqual({ product });
		expect(contextFilesOf(req)).toEqual(["PRODUCT.md"]);
		expect(contextFilesOf({ ...req, context: { product, design: "- primary: #fff" } })).toEqual([
			"PRODUCT.md",
			"DESIGN.md",
		]);
		expect(contextFilesOf({ ...req, context: {} })).toEqual([]);
	});

	test("context files are never edit targets", () => {
		const req = buildGenerationRequest({
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: files,
			targets: ["PRODUCT.md", "screens/home.tsx"],
		});

		expect(req.targets).toEqual(["screens/home.tsx"]);
	});

	test("context task for DESIGN.md: target in files, every screen that fits, the other file as context", () => {
		const projectFiles = { ...files, "DESIGN.md": "# Design\n<!-- template -->\n", "screens/extra.tsx": "e" };

		const req = buildGenerationRequest({
			id: "r",
			task: "context",
			prompt: "",
			device: "mobile",
			model: "m",
			projectFiles,
			targets: ["DESIGN.md"],
		});

		expect(req.task).toBe("context");
		expect(req.targets).toEqual(["DESIGN.md"]);
		expect(contextTargetOf(req)).toBe("DESIGN.md");
		expect(req.context).toEqual({ product: "A habit app" });
		expect(req.files.map((f) => f.path)).toEqual([
			"DESIGN.md",
			"components/card.tsx",
			"components/tab-bar.tsx",
			"screens/extra.tsx",
			"screens/settings.tsx",
			"screens/profile.tsx",
			"screens/home.tsx",
		]);
	});

	test("context task for a missing PRODUCT.md: the target without a file, default style screens", () => {
		const { "PRODUCT.md": _, ...projectFiles } = files;

		const req = buildGenerationRequest({
			id: "r",
			task: "context",
			prompt: "Q? A",
			device: "mobile",
			model: "m",
			projectFiles,
			targets: ["PRODUCT.md"],
		});

		expect(req.targets).toEqual(["PRODUCT.md"]);
		expect(contextTargetOf(req)).toBe("PRODUCT.md");
		expect(req.files.filter((f) => f.path.startsWith("screens/"))).toHaveLength(2);
		expect(req.files.some((f) => f.path.endsWith(".md"))).toBe(false);
	});

	test("the component catalog covers every component, even when their sources don't fit", () => {
		const projectFiles = {
			"components/stat-card.tsx": `export function StatCard({ label }: { label: string }) { return <div>{label}</div>; }\n`,
			"components/tab-bar.tsx": `export function TabBar({ active = 0 }: { active?: number }) { return <nav />; }\n`,
			"screens/home.tsx": `import { StatCard } from "../components/stat-card";\nexport default function Home() { return <StatCard label="x" />; }\n`,
		};

		const params: BuildRequestParams = {
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles,
			targets: ["screens/home.tsx"],
		};

		const catalog = [
			{ path: "components/stat-card.tsx", signature: ["StatCard({ label: string })"], usedBy: ["screens/home.tsx"] },
			{ path: "components/tab-bar.tsx", signature: ["TabBar({ active?: number = 0 })"] },
		];

		expect(buildGenerationRequest(params).components).toEqual(catalog);
		const tight = buildGenerationRequest({ ...params, maxChars: 1 });
		expect(tight.files.map((f) => f.path)).toEqual(["screens/home.tsx"]);
		expect(tight.components).toEqual(catalog);
		expect(buildGenerationRequest({ ...params, task: "context", targets: ["DESIGN.md"] }).components).toBeUndefined();
		expect(buildGenerationRequest({ ...params, projectFiles: { "screens/home.tsx": "x" } }).components).toBeUndefined();
	});

	test("contextTargetOf is only set for the context task", () => {
		expect(contextTargetOf({ ...request, targets: ["DESIGN.md"] })).toBeUndefined();
		expect(contextTargetOf({ ...request, task: "context", targets: ["screens/a.tsx"] })).toBeUndefined();
	});
});

describe("point and prompt", () => {
	const path = "screens/a.tsx";
	const source = `export default function A() {\n\treturn (\n\t\t<main>\n\t\t\t<h1>Hello</h1>\n\t\t\t<p>Body</p>\n\t\t</main>\n\t);\n}\n`;
	const focus = elementFocus(source, path, source.indexOf("<h1>"))!;
	const project = { [path]: source };

	const build = (overrides: Partial<BuildRequestParams> = {}) =>
		buildGenerationRequest({
			id: "r",
			task: "edit",
			prompt: "p",
			device: "mobile",
			model: "m",
			projectFiles: project,
			targets: [path],
			focus,
			...overrides,
		});

	test("buildGenerationRequest keeps the focus of an edit of its file, re-checked against the file", () => {
		expect(build().focus).toEqual(focus);
		const moved = `// header\n${source}`;
		expect(build({ projectFiles: { [path]: moved } }).focus?.startLine).toBe(5);
		expect(build({ projectFiles: { [path]: source.replace("Hello", "Hi") } }).focus).toBeUndefined();
		expect(
			build({ targets: ["screens/b.tsx"], projectFiles: { ...project, "screens/b.tsx": "x" } }).focus,
		).toBeUndefined();
		expect(build({ task: "create", targets: [] }).focus).toBeUndefined();
	});

	test("a change outside the element is kept, with a note; a repair keeps the focus", async () => {
		const outside = source.replace("<h1>Hello</h1>", "<h1>Hi</h1").replace("Body", "Text");
		const fixed = source.replace("<h1>Hello</h1>", "<h1>Hi</h1>").replace("Body", "Text");

		const { provider, requests } = fakeProvider([
			[...file(path, outside), { type: "done" }],
			[...file(path, fixed), { type: "done" }],
		]);

		const { result } = await run(provider, project, undefined, build());
		expect(requests[1]!.task).toBe("repair");
		expect(requests[1]!.focus).toEqual(focus);
		expect(result.changes).toEqual([{ path, content: fixed }]);
		expect(result.notes).toEqual([
			`Note: this also changed ${path} outside <h1> “Hello” (line 5). Undo reverts the whole edit.`,
		]);
	});

	test("no note when only the element changed", async () => {
		const { provider } = fakeProvider([[...file(path, source.replace("Hello", "Welcome back")), { type: "done" }]]);
		const { result } = await run(provider, project, undefined, build());
		expect(result.notes).toEqual([]);
	});
});

describe("theme reading", () => {
	const DESIGN = "## Colors\n\nBrand blue #0052ff on white.\n";
	const themeRequest = buildThemeRequest({ id: "t1", model: "m", device: "mobile", design: DESIGN })!;

	const read = (events: GenerationEvent[]) => {
		const { provider } = fakeProvider([events]);
		const seen: GenerationEvent[] = [];

		const result = runThemeReading({
			provider,
			request: themeRequest,
			signal: new AbortController().signal,
			onEvent: (event) => seen.push(event),
		});

		return { result, seen };
	};

	test("the request carries only DESIGN.md", () => {
		expect(themeRequest).toEqual({
			id: "t1",
			task: "theme",
			model: "m",
			prompt: "",
			device: "mobile",
			context: { design: DESIGN },
			files: [],
		});
		expect(buildThemeRequest({ id: "t", model: "m", device: "mobile", design: "# Design\n\n<!-- todo -->" })).toBe(
			undefined,
		);
	});

	test("valid tokens from the reply become the theme, with DESIGN.md's source", async () => {
		const { result, seen } = read([
			{ type: "status", label: "Reading" },
			{ type: "message.delta", text: "## Tokens\n- primary: #0052ff\n- background: #fff\n" },
			{ type: "message.delta", text: "- ring: url(x)\n### Dark\n- primary: #4d8bff\n" },
			{ type: "done", usage: { outputTokens: 20 } },
		]);

		expect(await result).toEqual({
			theme: {
				light: { primary: "#0052ff", background: "#fff" },
				dark: { primary: "#4d8bff" },
				source: designSourceOf(DESIGN),
			},
			reply: "## Tokens\n- primary: #0052ff\n- background: #fff\n- ring: url(x)\n### Dark\n- primary: #4d8bff",
			usage: { outputTokens: 20 },
		});
		expect(seen[0]).toEqual({ type: "status", label: "Reading" });
	});

	test("files the provider writes are never applied", async () => {
		const { result } = read([
			...file("screens/home.tsx", GOOD_SCREEN),
			{ type: "message.delta", text: "- primary: #0052ff" },
			{ type: "done" },
		]);

		expect(Object.keys(await result)).toEqual(["theme", "reply", "usage"]);
		expect((await result).theme.light).toEqual({ primary: "#0052ff" });
	});

	test("a reply without usable tokens is invalid output", async () => {
		const { result } = read([{ type: "message.delta", text: "This document has no colors." }, { type: "done" }]);
		await expect(result).rejects.toBeInstanceOf(GenerationError);
		await expect(result).rejects.toMatchObject({ code: "invalid_output" });
	});

	test("provider errors pass through", async () => {
		const { result } = read([{ type: "error", code: "rate_limited", message: "slow down", retryable: true }]);
		await expect(result).rejects.toMatchObject({ code: "rate_limited" });
	});
});
