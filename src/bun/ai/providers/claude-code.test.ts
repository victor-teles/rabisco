import { describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { tempDir } from "../../test-utils";
import { createClaudeCodeProvider } from "./claude-code";
import { fakeSpawn } from "./fake-cli";

const SETTINGS = "export default function Settings() { return <div>Settings</div>; }\n";

const request: GenerationRequest = {
	id: "gen-1",
	task: "create",
	model: "sonnet",
	prompt: "A settings screen",
	device: "mobile",
	context: {},
	files: [],
};

function binary() {
	const path = join(tempDir(), "claude");
	writeFileSync(path, "#!/bin/sh\n");
	chmodSync(path, 0o755);
	return path;
}

const config = (binPath: string): ProviderConfig => ({ id: "claude-code", type: "claude-code", label: "Claude Code", enabled: true, binPath });

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];
	for await (const event of events) out.push(event);
	return out;
}

/** A recorded `claude -p --output-format stream-json --verbose` run, with the staging dir filled in. */
const recording = (dir: string) => [
	{ type: "system", subtype: "init", cwd: dir, session_id: "s1", tools: ["Read", "Write", "Edit", "Glob", "Grep"], model: "claude-sonnet-5-5", permissionMode: "acceptEdits" },
	{ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "I'll add a settings screen." }] }, parent_tool_use_id: null, session_id: "s1" },
	{ type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: `${dir}/screens/settings.tsx`, content: SETTINGS } }] }, parent_tool_use_id: null, session_id: "s1" },
	{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "File created successfully" }] }, session_id: "s1" },
	{ type: "assistant", message: { id: "m3", role: "assistant", content: [{ type: "text", text: "Done." }] }, parent_tool_use_id: null, session_id: "s1" },
	{
		type: "result",
		subtype: "success",
		is_error: false,
		duration_ms: 1200,
		num_turns: 3,
		result: "Done.",
		session_id: "s1",
		total_cost_usd: 0.0123,
		usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 200 },
	},
];

describe("Claude Code provider", () => {
	test("runs claude in the staging dir and maps stream-json", async () => {
		const root = tempDir();
		const bin = binary();
		// The recording needs the staging dir, so the fake is built per call
		const provider = createClaudeCodeProvider({
			config: config(bin),
			stagingRoot: root,
			spawn: (cmd, options) =>
				fakeSpawn({ act: (dir) => writeFile(join(dir, "screens/settings.tsx"), SETTINGS), stdout: recording(options.cwd!) }).spawn(cmd, options),
		});
		const events = await collect(provider.generate(request, new AbortController().signal));

		expect(events).toContainEqual({ type: "message.delta", text: "I'll add a settings screen." });
		expect(events).toContainEqual({ type: "status", label: "Writing screens/settings.tsx" });
		expect(events).toContainEqual({ type: "message.delta", text: "\n\nDone." });
		expect(events).toContainEqual({ type: "file.start", path: "screens/settings.tsx", kind: "screen", screen: { name: "Settings", device: "mobile" } });
		expect(events).toContainEqual({ type: "file.end", path: "screens/settings.tsx", content: SETTINGS });
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 1110, outputTokens: 200, costUsd: 0.0123 } });
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
		expect(readdirSync(root)).toEqual([]);
	});

	test("passes file-only tools, the model and the prompt on stdin", async () => {
		const { spawn, calls } = fakeSpawn({ stdout: [{ type: "result", subtype: "success", is_error: false, result: "" }] });
		const provider = createClaudeCodeProvider({ config: config(binary()), spawn, stagingRoot: tempDir() });
		await collect(provider.generate(request, new AbortController().signal));
		const { cmd, options } = calls[0]!;
		expect(cmd.slice(1)).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--model",
			"sonnet",
			"--permission-mode",
			"acceptEdits",
			"--tools",
			"Read,Write,Edit,Glob,Grep",
			"--allowedTools",
			"Read,Write,Edit,Glob,Grep",
			"--disallowedTools",
			"Bash,WebFetch,WebSearch,Task,NotebookEdit",
			"--strict-mcp-config",
			"--no-session-persistence",
		]);
		expect(options.cwd).toContain("rabisco-staging-");
		expect(options.stdin).toContain("A settings screen");
	});

	test("an error result is not_authenticated with a fix", async () => {
		const { spawn } = fakeSpawn({
			stdout: [{ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", total_cost_usd: 0, usage: {} }],
			exitCode: 1,
		});
		const provider = createClaudeCodeProvider({ config: config(binary()), spawn, stagingRoot: tempDir() });
		const events = await collect(provider.generate(request, new AbortController().signal));
		expect(events).toEqual([expect.objectContaining({ type: "error", code: "not_authenticated" })]);
		expect((events[0] as { fix?: string }).fix).toContain("Run `claude` in a terminal and log in.");
	});

	test("a missing binary is not_installed", async () => {
		const provider = createClaudeCodeProvider({ config: config("/nope/claude"), spawn: fakeSpawn({}).spawn });
		const events = await collect(provider.generate(request, new AbortController().signal));
		expect(events).toEqual([expect.objectContaining({ type: "error", code: "not_installed" })]);
		expect(await provider.health()).toMatchObject({ ok: false, code: "not_installed" });
	});

	test("abort kills claude and ends with aborted", async () => {
		const { spawn, calls } = fakeSpawn({ stdout: [{ type: "assistant", message: { content: [{ type: "text", text: "Working" }] }, parent_tool_use_id: null }], hang: true });
		const provider = createClaudeCodeProvider({ config: config(binary()), spawn, stagingRoot: tempDir() });
		const controller = new AbortController();
		const events: GenerationEvent[] = [];
		for await (const event of provider.generate(request, controller.signal)) {
			events.push(event);
			controller.abort();
		}
		expect(events.at(-1)).toMatchObject({ type: "error", code: "aborted" });
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
		expect(calls[0]!.killed).toContain("SIGTERM");
	});

	test("health reports the version, and a logged-out CLI", async () => {
		const bin = binary();
		const loggedIn = fakeSpawn((cmd) => ({ stdout: [cmd.includes("auth") ? JSON.stringify({ loggedIn: true }) : "2.1.289 (Claude Code)"] }));
		expect(await createClaudeCodeProvider({ config: config(bin), spawn: loggedIn.spawn }).health()).toEqual({ ok: true, version: "2.1.289" });
		const loggedOut = fakeSpawn((cmd) => ({ stdout: [cmd.includes("auth") ? JSON.stringify({ loggedIn: false }) : "2.1.289 (Claude Code)"] }));
		expect(await createClaudeCodeProvider({ config: config(bin), spawn: loggedOut.spawn }).health()).toMatchObject({ ok: false, code: "not_authenticated", fix: "Run `claude` in a terminal and log in." });
	});

	test("lists static models", async () => {
		const models = await createClaudeCodeProvider({ config: config(binary()) }).listModels();
		expect(models.map((m) => m.id)).toContain("sonnet");
	});
});
