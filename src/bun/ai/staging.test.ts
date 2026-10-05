import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { mkdir, rm, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../shared/ai/contract";
import { tempDir } from "../test-utils";
import { runInStaging, type AgentRunner } from "./staging";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
	id: "gen-1",
	task: "edit",
	model: "test",
	prompt: "Make it blue",
	device: "mobile",
	context: { product: "# Product\n\nHabits", design: "# Design\n\nWarm" },
	files: [
		{ path: "screens/home.tsx", content: "export default function Home() { return null; }\n" },
		{ path: "screens/old.tsx", content: "export default function Old() { return null; }\n" },
		{ path: "components/card.tsx", content: "export function Card() { return null; }\n" },
	],
	...overrides,
});

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
}

/** What an agent found in the staging dir's context files. */
type SeenContext = { product: string | null; design: string | null };

const stagingDirs = (root: string) => readdirSync(root).filter((name) => name.startsWith("rabisco-staging-"));

const terminal = (events: GenerationEvent[]) => events.filter((e) => e.type === "done" || e.type === "error");

const lastEnd = (events: GenerationEvent[], path: string) =>
	events
		.filter((e): e is Extract<GenerationEvent, { type: "file.end" }> => e.type === "file.end" && e.path === path)
		.at(-1)?.content;

describe("runInStaging", () => {
	test("writes files, context and instructions into the staging dir", async () => {
		const root = tempDir();
		let seen: Record<string, string | null> = {};

		const agent: AgentRunner = async function* (dir) {
			const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : null);
			seen = Object.fromEntries(
				[
					"screens/home.tsx",
					"components/card.tsx",
					"PRODUCT.md",
					"DESIGN.md",
					"CLAUDE.md",
					"AGENTS.md",
					"GEMINI.md",
				].map((p) => [p, read(p)]),
			);
			yield { type: "done" };
		};

		const events = await collect(runInStaging(request(), new AbortController().signal, agent, { root }));
		expect(events).toEqual([{ type: "done" }]);
		expect(seen["screens/home.tsx"]).toContain("Home");
		expect(seen["components/card.tsx"]).toContain("Card");
		expect(seen["PRODUCT.md"]).toBe("# Product\n\nHabits");
		expect(seen["DESIGN.md"]).toBe("# Design\n\nWarm");
		expect(seen["CLAUDE.md"]?.length).toBeGreaterThan(100);
		expect(seen["AGENTS.md"]).toBe(seen["CLAUDE.md"]!);
		expect(seen["GEMINI.md"]).toBe(seen["CLAUDE.md"]!);
		expect(stagingDirs(root)).toEqual([]);
		await rm(root, { recursive: true, force: true });
	});

	test("reports writes, edits and deletes; ignores other paths", async () => {
		const root = tempDir();

		const agent: AgentRunner = async function* (dir) {
			yield { type: "status", label: "Writing screens/profile.tsx" };
			await writeFile(join(dir, "screens/profile.tsx"), "export default function Profile() { return 1; }\n");
			await wait(500);
			yield { type: "message.delta", text: "Added a profile." };
			// Edited twice: only the final content matters
			await writeFile(join(dir, "screens/home.tsx"), "export default function Home() { return 1; }\n");
			await writeFile(join(dir, "screens/home.tsx"), "export default function Home() { return 2; }\n");
			await unlink(join(dir, "screens/old.tsx"));
			await writeFile(join(dir, "notes.txt"), "scratch");
			await mkdir(join(dir, "lib"), { recursive: true });
			await writeFile(join(dir, "lib/utils.ts"), "export {}");
			await writeFile(join(dir, "CLAUDE.md"), "changed instructions");
			await writeFile(join(dir, "DESIGN.md"), "changed design");
			yield { type: "done", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } };
		};

		const events = await collect(
			runInStaging(request(), new AbortController().signal, agent, { root, debounceMs: 20, pollMs: 100 }),
		);

		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } });
		expect(terminal(events)).toHaveLength(1);
		expect(events).toContainEqual({ type: "status", label: "Writing screens/profile.tsx" });
		expect(events).toContainEqual({ type: "message.delta", text: "Added a profile." });

		expect(events).toContainEqual({
			type: "file.start",
			path: "screens/profile.tsx",
			kind: "screen",
			screen: { name: "Profile", device: "mobile" },
		});
		expect(lastEnd(events, "screens/profile.tsx")).toContain("return 1");
		// Profile settled during the run, so the final diff doesn't repeat it
		expect(events.filter((e) => e.type === "file.end" && e.path === "screens/profile.tsx")).toHaveLength(1);

		expect(events).toContainEqual({ type: "file.start", path: "screens/home.tsx", kind: "screen" });
		expect(lastEnd(events, "screens/home.tsx")).toContain("return 2");
		expect(events).toContainEqual({ type: "file.delete", path: "screens/old.tsx" });
		expect(events.some((e) => "path" in e && e.path === "components/card.tsx")).toBe(false);

		const ignored = events.flatMap((e) => (e.type === "status" && e.label.startsWith("Ignored") ? [e.detail] : []));

		expect(ignored.sort()).toEqual(["lib/utils.ts", "notes.txt"]);
		expect(events.some((e) => "path" in e && e.path.endsWith(".md"))).toBe(false);

		expect(stagingDirs(root)).toEqual([]);
		await rm(root, { recursive: true, force: true });
	});

	test("a file reverted after it was reported is sent again; a reported file that disappears is deleted", async () => {
		const root = tempDir();
		const events: GenerationEvent[] = [];

		const reported = async (path: string) => {
			for (let i = 0; i < 100 && !events.some((e) => e.type === "file.end" && e.path === path); i++) await wait(20);
		};

		const agent: AgentRunner = async function* (dir) {
			await writeFile(join(dir, "screens/home.tsx"), "draft");
			await writeFile(join(dir, "components/temp.tsx"), "export function Temp() {}");
			yield { type: "status", label: "Drafting" };
			await reported("screens/home.tsx");
			await reported("components/temp.tsx");
			await writeFile(join(dir, "screens/home.tsx"), request().files[0]!.content);
			await unlink(join(dir, "components/temp.tsx"));
			yield { type: "done" };
		};

		for await (const event of runInStaging(request(), new AbortController().signal, agent, {
			root,
			debounceMs: 20,
			pollMs: 100,
		}))
			events.push(event);
		expect(events.flatMap((e) => (e.type === "file.end" && e.path === "screens/home.tsx" ? [e.content] : []))).toEqual([
			"draft",
			request().files[0]!.content,
		]);
		expect(events).toContainEqual({ type: "file.delete", path: "components/temp.tsx" });
		expect(events.at(-1)).toEqual({ type: "done" });
		await rm(root, { recursive: true, force: true });
	});

	test("an agent error ends the stream without the final diff", async () => {
		const root = tempDir();

		const agent: AgentRunner = async function* (dir) {
			await writeFile(join(dir, "screens/new.tsx"), "x");
			yield { type: "error", code: "rate_limited", message: "slow down", retryable: true };
		};

		const events = await collect(
			runInStaging(request(), new AbortController().signal, agent, { root, debounceMs: 1000 }),
		);

		expect(events).toEqual([{ type: "error", code: "rate_limited", message: "slow down", retryable: true }]);
		expect(stagingDirs(root)).toEqual([]);
		await rm(root, { recursive: true, force: true });
	});

	test("an agent that throws becomes an error event", async () => {
		const root = tempDir();

		const agent: AgentRunner = async function* () {
			yield { type: "status", label: "Starting" };
			throw new Error("boom");
		};

		const events = await collect(runInStaging(request(), new AbortController().signal, agent, { root }));
		expect(events.at(-1)).toMatchObject({ type: "error", code: "unknown", message: "boom" });
		expect(terminal(events)).toHaveLength(1);
		await rm(root, { recursive: true, force: true });
	});

	test("abort stops promptly with one aborted error and cleans up", async () => {
		const root = tempDir();
		const controller = new AbortController();
		let agentSignal: AbortSignal | null = null;

		const agent: AgentRunner = async function* (_dir, signal) {
			agentSignal = signal;
			yield { type: "status", label: "Thinking" };
			await new Promise(() => {}); // Hangs forever
		};

		const started = Date.now();
		const events: GenerationEvent[] = [];

		for await (const event of runInStaging(request(), controller.signal, agent, { root })) {
			events.push(event);

			if (event.type === "status") controller.abort();
		}

		expect(Date.now() - started).toBeLessThan(1000);
		expect(events).toEqual([
			{ type: "status", label: "Thinking" },
			{ type: "error", code: "aborted", message: "Generation stopped.", retryable: false },
		]);
		expect(agentSignal!.aborted).toBe(true);
		expect(stagingDirs(root)).toEqual([]);
		await rm(root, { recursive: true, force: true });
	});

	test("an already aborted signal never starts the agent", async () => {
		const controller = new AbortController();
		controller.abort();
		let ran = false;

		const events = await collect(
			runInStaging(request(), controller.signal, async function* () {
				ran = true;
				yield { type: "done" };
			}),
		);

		expect(ran).toBe(false);
		expect(events).toEqual([{ type: "error", code: "aborted", message: "Generation stopped.", retryable: false }]);
	});

	test("skips request paths that escape the staging dir", async () => {
		const root = tempDir();

		const events = await collect(
			runInStaging(
				request({ files: [{ path: "../escape.tsx", content: "x" }] }),
				new AbortController().signal,
				async function* () {
					yield { type: "done" };
				},
				{ root },
			),
		);

		expect(events).toEqual([{ type: "done" }]);
		expect(existsSync(join(root, "escape.tsx"))).toBe(false);
		await rm(root, { recursive: true, force: true });
	});

	test("context files are written as they are, and only when they say something", async () => {
		const root = tempDir();
		let seen: SeenContext | undefined;

		const agent: AgentRunner = async function* (dir) {
			const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : null);
			seen = { product: read("PRODUCT.md"), design: read("DESIGN.md") };
			yield { type: "done" };
		};

		const product = "# Product\n<!-- guidance -->\nHabits";
		await collect(
			runInStaging(
				request({ context: { product, design: "# Design\n<!-- fill me -->\n" } }),
				new AbortController().signal,
				agent,
				{ root },
			),
		);
		expect(seen).toEqual({ product, design: null });
		await rm(root, { recursive: true, force: true });
	});

	test("a context task reports writes to its target only", async () => {
		const root = tempDir();
		let before: string | null = null;

		const agent: AgentRunner = async function* (dir) {
			before = readFileSync(join(dir, "DESIGN.md"), "utf8");
			await writeFile(join(dir, "DESIGN.md"), "# Design\n\n## Tokens\n\n- primary: #ff0000\n");
			await writeFile(join(dir, "PRODUCT.md"), "changed product");
			yield { type: "done" };
		};

		const contextRequest = request({
			task: "context",
			targets: ["DESIGN.md"],
			context: { product: "# Product\n\nHabits" },
			files: [{ path: "DESIGN.md", content: "# Design\n<!-- template -->\n" }, ...request().files],
		});

		const events = await collect(
			runInStaging(contextRequest, new AbortController().signal, agent, { root, debounceMs: 20, pollMs: 100 }),
		);

		expect(before!).toBe("# Design\n<!-- template -->\n");
		expect(events).toContainEqual({ type: "file.start", path: "DESIGN.md", kind: "context" });
		expect(lastEnd(events, "DESIGN.md")).toContain("primary: #ff0000");
		expect(events.some((e) => "path" in e && e.path === "PRODUCT.md")).toBe(false);
		expect(events.some((e) => e.type === "status" && e.label.startsWith("Ignored"))).toBe(false);
		expect(events.at(-1)).toEqual({ type: "done" });
		await rm(root, { recursive: true, force: true });
	});

	test("a context task can create its target", async () => {
		const root = tempDir();

		const agent: AgentRunner = async function* (dir) {
			await writeFile(join(dir, "PRODUCT.md"), "# Product\n\nHabits\n");
			yield { type: "done" };
		};

		const events = await collect(
			runInStaging(
				request({ task: "context", targets: ["PRODUCT.md"], context: {} }),
				new AbortController().signal,
				agent,
				{ root, debounceMs: 20, pollMs: 100 },
			),
		);

		expect(lastEnd(events, "PRODUCT.md")).toBe("# Product\n\nHabits\n");
		await rm(root, { recursive: true, force: true });
	});
});
