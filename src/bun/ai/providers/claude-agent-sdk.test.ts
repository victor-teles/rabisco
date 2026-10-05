import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { tempDir } from "../../test-utils";
import { createClaudeAgentSdkProvider, type AgentSdk } from "./claude-agent-sdk";

const CARD = "export function StatCard() { return <div />; }\n";

const request: GenerationRequest = {
	id: "gen-1",
	task: "create",
	model: "sonnet",
	prompt: "A stat card",
	device: "desktop",
	context: { product: "# Product" },
	files: [],
};

const config: ProviderConfig = {
	id: "claude-agent-sdk",
	type: "claude-agent-sdk",
	label: "Claude Agent SDK",
	enabled: true,
};

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
}

/** A fake SDK whose `query` writes a file in `cwd` and yields recorded SDK messages. */
function fakeSdk(messages: (cwd: string) => object[], options: { hang?: boolean; throws?: string } = {}) {
	const calls: { prompt: string; options: Options }[] = [];

	const sdk: AgentSdk = {
		query({ prompt, options: queryOptions = {} }) {
			calls.push({ prompt, options: queryOptions });
			const cwd = queryOptions.cwd;

			if (!cwd) throw new Error("The provider must run the agent in a staging dir");

			return (async function* () {
				await writeFile(join(cwd, "components/stat-card.tsx"), CARD);

				for (const message of messages(cwd)) yield message;

				if (options.throws) throw new Error(options.throws);

				if (options.hang) await new Promise(() => {});
			})();
		},
	};

	return { sdk: async () => sdk, calls };
}

const recording = (cwd: string) => [
	{ type: "system", subtype: "init", cwd, model: "claude-sonnet-5-5", tools: ["Read", "Write"] },
	{
		type: "assistant",
		message: {
			content: [
				{ type: "text", text: "Adding a stat card." },
				{
					type: "tool_use",
					id: "t1",
					name: "Write",
					input: { file_path: `${cwd}/components/stat-card.tsx`, content: CARD },
				},
			],
		},
		parent_tool_use_id: null,
	},
	{
		type: "result",
		subtype: "success",
		is_error: false,
		result: "",
		total_cost_usd: 0.02,
		usage: { input_tokens: 50, output_tokens: 70, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
	},
];

describe("Claude Agent SDK provider", () => {
	test("runs query() in the staging dir with file tools and the API key", async () => {
		const root = tempDir();
		const { sdk, calls } = fakeSdk(recording);
		const provider = createClaudeAgentSdkProvider({ config, getApiKey: async () => "sk-test", stagingRoot: root, sdk });
		const events = await collect(provider.generate(request, new AbortController().signal));

		expect(events).toContainEqual({ type: "message.delta", text: "Adding a stat card." });
		expect(events).toContainEqual({ type: "status", label: "Writing components/stat-card.tsx" });
		expect(events).toContainEqual({ type: "file.end", path: "components/stat-card.tsx", content: CARD });
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 50, outputTokens: 70, costUsd: 0.02 } });
		expect(readdirSync(root)).toEqual([]);

		const { prompt, options } = calls[0]!;
		expect(prompt).toContain("A stat card");
		expect(options).toMatchObject({
			model: "sonnet",
			permissionMode: "acceptEdits",
			settingSources: [],
			persistSession: false,
		});
		expect(options.allowedTools).toEqual(["Read", "Write", "Edit", "Glob", "Grep"]);
		expect(options.disallowedTools).toContain("Bash");
		expect(options.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-test" });
		expect(options.systemPrompt).toEqual(expect.any(String));
		expect(options.abortController).toBeInstanceOf(AbortController);
	});

	test("without an API key it fails with not_authenticated", async () => {
		const provider = createClaudeAgentSdkProvider({ config, getApiKey: async () => null, sdk: fakeSdk(recording).sdk });
		expect(await provider.health()).toMatchObject({ ok: false, code: "not_authenticated" });
		expect(await collect(provider.generate(request, new AbortController().signal))).toEqual([
			expect.objectContaining({ type: "error", code: "not_authenticated" }),
		]);
	});

	test("a package that fails to load only fails this provider", async () => {
		const provider = createClaudeAgentSdkProvider({
			config,
			getApiKey: async () => "sk-test",
			sdk: () => Promise.reject(new Error("Cannot find package")),
		});

		expect(await provider.health()).toMatchObject({ ok: false, code: "not_installed" });
		expect(await collect(provider.generate(request, new AbortController().signal))).toEqual([
			expect.objectContaining({ type: "error", code: "not_installed" }),
		]);
	});

	test("an error result and a thrown error map to error events", async () => {
		const failing = fakeSdk(() => [
			{ type: "result", subtype: "success", is_error: true, result: "Invalid API key", total_cost_usd: 0, usage: {} },
		]);

		const events = await collect(
			createClaudeAgentSdkProvider({
				config,
				getApiKey: async () => "bad",
				sdk: failing.sdk,
				stagingRoot: tempDir(),
			}).generate(request, new AbortController().signal),
		);

		expect(events).toEqual([expect.objectContaining({ type: "error", code: "not_authenticated" })]);

		const throwing = fakeSdk(() => [], { throws: "Claude Code process exited with code 1" });

		const thrown = await collect(
			createClaudeAgentSdkProvider({
				config,
				getApiKey: async () => "sk",
				sdk: throwing.sdk,
				stagingRoot: tempDir(),
			}).generate(request, new AbortController().signal),
		);

		expect(thrown).toEqual([expect.objectContaining({ type: "error", code: "unknown" })]);
	});

	test("abort aborts the SDK and ends with aborted", async () => {
		const { sdk, calls } = fakeSdk(
			() => [
				{ type: "assistant", message: { content: [{ type: "text", text: "Working" }] }, parent_tool_use_id: null },
			],
			{ hang: true },
		);

		const controller = new AbortController();
		const events: GenerationEvent[] = [];

		for await (const event of createClaudeAgentSdkProvider({
			config,
			getApiKey: async () => "sk",
			sdk,
			stagingRoot: tempDir(),
		}).generate(request, controller.signal)) {
			events.push(event);
			controller.abort();
		}

		expect(events.at(-1)).toMatchObject({ type: "error", code: "aborted" });
		expect(calls[0]!.options.abortController?.signal.aborted).toBe(true);
	});

	test("the real SDK package loads lazily", async () => {
		const provider = createClaudeAgentSdkProvider({ config, getApiKey: async () => "sk-test" });
		expect(await provider.health()).toEqual({ ok: true });
	});
});
