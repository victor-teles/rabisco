import { describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { tempDir } from "../../test-utils";
import { AGENT_FILE, createAntigravityProvider, parseAntigravityModels } from "./antigravity";
import { fakeSpawn } from "./fake-cli";

const BUTTON = "export function PrimaryButton() { return <button>Go</button>; }\n";

const request: GenerationRequest = {
	id: "gen-1",
	task: "create",
	model: "gemini-3.8-flash-low",
	prompt: "A primary button",
	device: "mobile",
	context: {},
	files: [],
};

function binary() {
	const path = join(tempDir(), "agy");
	writeFileSync(path, "#!/bin/sh\n");
	chmodSync(path, 0o755);

	return path;
}

const config = (binPath: string): ProviderConfig => ({
	id: "antigravity",
	type: "antigravity",
	label: "Antigravity CLI",
	enabled: true,
	binPath,
});

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
}

const step = (index: number, fields: Record<string, string | number | boolean | Record<string, never>>) => ({
	event: "step_update",
	step_update: { conversation_id: "c1", step_index: index, ...fields },
});

const tool = (index: number, state: string, name: string, parameters: Record<string, string>) => ({
	event: "step_update",
	step_update: {
		conversation_id: "c1",
		step_index: index,
		state,
		step_type: "tool",
		tool_name: name,
		tool_info: { name, parameters },
	},
});

/** Shaped after `agy --print --output-format stream-json` 1.3.3 */
const recording = (dir: string) => [
	{ event: "init", conversation_id: "c1", init: { model: "gemini-3.8-flash-low", cwd: dir, tools: [] } },
	step(0, { state: "DONE", step_type: "user_input" }),
	step(1, { state: "ACTIVE", step_type: "agent_response", text_delta: "Creating " }),
	step(1, { state: "ACTIVE", step_type: "agent_response", text_delta: "the button." }),
	tool(2, "ACTIVE", "write_to_file", { TargetFile: `${dir}/components/primary-button.tsx` }),
	tool(2, "DONE", "write_to_file", { TargetFile: `${dir}/components/primary-button.tsx` }),
	tool(3, "ACTIVE", "write_to_file", { TargetFile: `${dir}/src/extra.ts` }),
	tool(3, "DONE", "write_to_file", { TargetFile: `${dir}/src/extra.ts` }),
	tool(4, "ACTIVE", "run_command", { CommandLine: "ls components" }),
	{
		event: "step_update",
		step_update: {
			conversation_id: "c1",
			step_index: 4,
			state: "ERROR",
			step_type: "tool",
			tool_name: "run_command",
			tool_info: {
				name: "run_command",
				parameters: { CommandLine: "ls components" },
				error: { type: "TOOL_ERROR", message: "permission check failed" },
			},
		},
	},
	step(5, { state: "ACTIVE", step_type: "agent_response", text_delta: "Done." }),
	{
		event: "result",
		result: {
			conversation_id: "c1",
			status: "SUCCESS",
			response: "Creating the button.\nDone.",
			usage: { input_tokens: 1200, output_tokens: 100, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 1300 },
			denied_actions: [{ action: "command", display_name: "RunCommand" }],
		},
	},
];

describe("Antigravity CLI provider", () => {
	test("runs agy headless in the real staging path and maps stream-json", async () => {
		const root = tempDir();
		const calls: string[][] = [];
		const cwds: string[] = [];
		const agents: string[] = [];

		const provider = createAntigravityProvider({
			config: config(binary()),
			stagingRoot: root,
			spawn: (cmd, options) => {
				calls.push(cmd);
				cwds.push(options.cwd!);

				return fakeSpawn({
					act: async (dir) => {
						agents.push(readFileSync(join(dir, AGENT_FILE), "utf8"));
						await writeFile(join(dir, "components/primary-button.tsx"), BUTTON);
						await mkdir(join(dir, "src"));
						await writeFile(join(dir, "src/extra.ts"), "x");
					},
					stdout: recording(options.cwd!),
				}).spawn(cmd, options);
			},
		});

		const events = await collect(provider.generate(request, new AbortController().signal));

		const text = events.flatMap((e) => (e.type === "message.delta" ? [e.text] : [])).join("");

		expect(text).toBe("Creating the button.\n\nDone.");
		expect(cwds[0]!.startsWith(realpathSync(root))).toBe(true);
		expect(events).toContainEqual({ type: "status", label: "Writing components/primary-button.tsx" });
		expect(events).toContainEqual({ type: "status", label: "A tool call failed", detail: "permission check failed" });
		expect(events).toContainEqual({
			type: "status",
			label: "Skipped actions Rabisco doesn't allow",
			detail: "RunCommand",
		});
		expect(events).toContainEqual({ type: "file.end", path: "components/primary-button.tsx", content: BUTTON });
		expect(events).toContainEqual({
			type: "status",
			label: "Ignored a file outside screens/ and components/",
			detail: "src/extra.ts",
		});
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 1200, outputTokens: 100 } });
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
		expect(readdirSync(root)).toEqual([]);

		const args = calls[0]!.slice(1);
		expect(args.slice(0, 4)).toEqual(["--output-format", "stream-json", "--mode", "accept-edits"]);
		expect(args).not.toContain("--dangerously-skip-permissions");
		expect(args.slice(args.indexOf("--agent"), args.indexOf("--agent") + 2)).toEqual(["--agent", "rabisco"]);
		expect(agents[0]).toContain("  - write_to_file\n");
		expect(agents[0]).not.toContain("run_command");
		expect(JSON.stringify(events)).not.toContain(".agents");
		expect(args).toContain("gemini-3.8-flash-low");
		expect(args.at(-2)).toBe("--print");
		expect(args.at(-1)).toContain("A primary button");
	});

	test("a failed result maps to an error event", async () => {
		const { spawn } = fakeSpawn({
			stdout: [{ event: "result", result: { status: "ERROR", error: { message: "You are not logged in." } } }],
			exitCode: 3,
		});

		const events = await collect(
			createAntigravityProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events).toEqual([
			expect.objectContaining({
				type: "error",
				code: "not_authenticated",
				fix: expect.stringContaining("Run `agy` in a terminal and sign in."),
			}),
		]);
	});

	test("a quota result is rate_limited and keeps its message", async () => {
		const quota =
			"Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 167h15m50s.";

		const { spawn } = fakeSpawn({
			stdout: [{ event: "result", result: { status: "ERROR", response: "", error: quota } }],
			stderr: `error: ${quota}`,
			exitCode: 3,
		});

		const events = await collect(
			createAntigravityProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited", message: quota, retryable: true });
	});

	test("quota errors on stderr are rate_limited", async () => {
		const { spawn } = fakeSpawn({
			stderr: 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}',
			exitCode: 3,
		});

		const events = await collect(
			createAntigravityProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
	});

	test("models come from `agy models`, with a fallback", async () => {
		const { spawn } = fakeSpawn({
			stdout: ["gemini-3.8-flash-high\tGemini 3.8 Flash (High)", "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)"],
		});

		expect(await createAntigravityProvider({ config: config(binary()), spawn }).listModels()).toEqual([
			{ id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
			{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
		]);
		expect(parseAntigravityModels("Fetching available models...\n")).toEqual([]);
	});

	test("a missing binary is not_installed with an install hint", async () => {
		const provider = createAntigravityProvider({ config: config("/nope/agy"), spawn: fakeSpawn({}).spawn });
		const health = await provider.health();
		expect(health).toMatchObject({
			ok: false,
			code: "not_installed",
			fix: expect.stringContaining("https://antigravity.google"),
		});
		expect(await collect(provider.generate(request, new AbortController().signal))).toEqual([
			expect.objectContaining({ type: "error", code: "not_installed" }),
		]);
	});

	test("abort ends with aborted", async () => {
		const { spawn, calls } = fakeSpawn({
			stdout: [step(1, { state: "ACTIVE", step_type: "agent_response", text_delta: "Hi" })],
			hang: true,
		});

		const controller = new AbortController();
		const events: GenerationEvent[] = [];

		for await (const event of createAntigravityProvider({
			config: config(binary()),
			spawn,
			stagingRoot: tempDir(),
		}).generate(request, controller.signal)) {
			events.push(event);
			controller.abort();
		}

		expect(events.at(-1)).toMatchObject({ type: "error", code: "aborted" });
		expect(calls[0]!.killed.length).toBeGreaterThan(0);
	});
});
