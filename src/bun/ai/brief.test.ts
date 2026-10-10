import { describe, expect, test } from "bun:test";
import type { GenerationEvent, GenerationRequest, Provider } from "../../shared/ai/contract";
import { buildBriefRequest, cleanBrief, runBrief } from "./brief";
import { systemPrompt, userPrompt } from "./prompt";

function scripted(events: GenerationEvent[]): Provider {
	return {
		id: "fake",
		kind: "api",
		label: "Fake",
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
		health: async () => ({ ok: true }),
		listModels: async () => [],
		async *generate() {
			yield* events;
		},
	};
}

const request = buildBriefRequest({ id: "b1", model: "m", prompt: "a budget app", device: "mobile" });

describe("brief request", () => {
	test("carries the prompt and the context files with content, and nothing else", () => {
		expect(request).toEqual({
			id: "b1",
			task: "brief",
			model: "m",
			prompt: "a budget app",
			device: "mobile",
			context: {},
			files: [],
		});

		const withContext = buildBriefRequest({
			id: "b2",
			model: "m",
			prompt: "a budget app",
			device: "desktop",
			product: "# Product\n\nFor students.\n",
			design: "# Design\n\n<!-- template -->\n",
		});

		expect(withContext.context).toEqual({ product: "# Product\n\nFor students.\n" });
	});

	test("its own system prompt, and a task line per mode", () => {
		const system = systemPrompt(request, "text");
		expect(system).toContain("Reply with only the brief");
		expect(system).not.toContain("<rabisco-file");
		expect(userPrompt(request, "text")).toContain("Task: brief. Expand the request below into a brief");
		expect(userPrompt(request, "agent")).toContain("Don't write any file");
		expect(userPrompt(request, "text")).toContain("<request>\na budget app\n</request>");
	});
});

describe("cleanBrief", () => {
	test("drops a code fence and a leading label", () => {
		expect(cleanBrief("```\nDesign a budget app.\n- Home\n```")).toBe("Design a budget app.\n- Home");
		expect(cleanBrief("## Brief:\n\nDesign a budget app.")).toBe("Design a budget app.");
		expect(cleanBrief("  Design a budget app.  ")).toBe("Design a budget app.");
	});
});

describe("runBrief", () => {
	const run = (events: GenerationEvent[]) => {
		const seen: GenerationEvent[] = [];

		const result = runBrief({
			provider: scripted(events),
			request,
			signal: new AbortController().signal,
			onEvent: (event) => seen.push(event),
		});

		return { result, seen };
	};

	test("the reply is the brief; file events are ignored", async () => {
		const { result, seen } = run([
			{ type: "status", label: "Reading" },
			{ type: "message.delta", text: "Design a budget app.\n" },
			{ type: "file.start", path: "screens/a.tsx", kind: "screen" },
			{ type: "file.end", path: "screens/a.tsx", content: "x" },
			{ type: "message.delta", text: "- Home" },
			{ type: "done", usage: { outputTokens: 12 } },
		]);

		expect(await result).toEqual({ brief: "Design a budget app.\n- Home", usage: { outputTokens: 12 } });
		expect(seen.map((event) => event.type)).toEqual(["status", "message.delta", "message.delta"]);
	});

	test("an empty reply or a provider error fails", async () => {
		await expect(run([{ type: "done" }]).result).rejects.toThrow("didn't return a brief");
		await expect(
			run([{ type: "error", code: "rate_limited", message: "Slow down.", retryable: true }]).result,
		).rejects.toThrow("Slow down.");
	});
});

describe("Auto style: DESIGN.md for a new project", () => {
	const context = (files: GenerationRequest["files"]) =>
		userPrompt(
			{ ...request, task: "context", targets: ["DESIGN.md"], prompt: "A soft, editorial journal", files },
			"text",
		);

	test("with no screens, it comes from the prompt's look", () => {
		const text = context([]);
		expect(text).toContain("Write DESIGN.md for a new project from the request below");
		expect(text).toContain("<request>\nA soft, editorial journal\n</request>");
		expect(systemPrompt({ ...request, task: "context", targets: ["DESIGN.md"] }, "text")).toContain("## Tokens");
	});

	test("with screens, it still infers from them", () => {
		const text = context([{ path: "screens/home.tsx", content: "export default function Home() {}\n" }]);
		expect(text).toContain("infer the design language from the project's existing screens");
	});
});
