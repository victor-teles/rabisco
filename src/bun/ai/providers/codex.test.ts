import { describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, writeFileSync } from "fs";
import { unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { tempDir } from "../../test-utils";
import { codexArgs, createCodexProvider } from "./codex";
import { fakeSpawn } from "./fake-cli";

const HOME = "export default function Home() { return <main>Blue</main>; }\n";

const request: GenerationRequest = {
	id: "gen-1",
	task: "edit",
	model: "gpt-5.5",
	prompt: "Make home blue",
	device: "desktop",
	context: { design: "# Design" },
	files: [
		{ path: "screens/home.tsx", content: "export default function Home() { return <main />; }\n" },
		{ path: "screens/unused.tsx", content: "export default function Unused() { return null; }\n" },
	],
	targets: ["screens/home.tsx"],
};

function binary() {
	const path = join(tempDir(), "codex");
	writeFileSync(path, "#!/bin/sh\n");
	chmodSync(path, 0o755);

	return path;
}

const config = (binPath: string): ProviderConfig => ({
	id: "codex",
	type: "codex",
	label: "Codex CLI",
	enabled: true,
	binPath,
});

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
}

const recording = (dir: string) => [
	{ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" },
	{ type: "turn.started" },
	{ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "**Reading the screen**" } },
	{
		type: "item.started",
		item: {
			id: "item_1",
			type: "command_execution",
			command: "bash -lc 'cat screens/home.tsx'",
			aggregated_output: "",
			exit_code: null,
			status: "in_progress",
		},
	},
	{
		type: "item.completed",
		item: {
			id: "item_1",
			type: "command_execution",
			command: "bash -lc 'cat screens/home.tsx'",
			aggregated_output: "...",
			exit_code: 0,
			status: "completed",
		},
	},
	{
		type: "item.completed",
		item: {
			id: "item_2",
			type: "file_change",
			changes: [
				{ path: `${dir}/screens/home.tsx`, kind: "update" },
				{ path: `${dir}/screens/unused.tsx`, kind: "delete" },
			],
			status: "completed",
		},
	},
	{ type: "item.completed", item: { id: "item_3", type: "agent_message", text: "Home is blue now." } },
	{ type: "turn.completed", usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300 } },
];

describe("Codex provider", () => {
	test("runs codex exec in the staging dir and maps its JSONL", async () => {
		const root = tempDir();
		const calls: { cmd: string[]; stdin?: string }[] = [];

		const provider = createCodexProvider({
			config: config(binary()),
			stagingRoot: root,
			spawn: (cmd, options) => {
				calls.push({ cmd, stdin: options.stdin });

				return fakeSpawn({
					act: async (dir) => {
						await writeFile(join(dir, "screens/home.tsx"), HOME);
						await unlink(join(dir, "screens/unused.tsx"));
					},
					stdout: recording(options.cwd!),
				}).spawn(cmd, options);
			},
		});

		const events = await collect(provider.generate(request, new AbortController().signal));

		expect(events).toContainEqual({ type: "status", label: "Thinking" });
		expect(events).toContainEqual({
			type: "status",
			label: "Running a command",
			detail: "bash -lc 'cat screens/home.tsx'",
		});
		expect(events).toContainEqual({ type: "status", label: "Editing screens/home.tsx" });
		expect(events).toContainEqual({ type: "status", label: "Deleting screens/unused.tsx" });
		expect(events).toContainEqual({ type: "message.delta", text: "Home is blue now." });
		expect(events).toContainEqual({ type: "file.end", path: "screens/home.tsx", content: HOME });
		expect(events).toContainEqual({ type: "file.delete", path: "screens/unused.tsx" });
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 5000, outputTokens: 300 } });
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
		expect(readdirSync(root)).toEqual([]);

		const args = calls[0]!.cmd.slice(1);
		expect(args.slice(0, 7)).toEqual([
			"exec",
			"--json",
			"--skip-git-repo-check",
			"--ephemeral",
			"--sandbox",
			"workspace-write",
			"-c",
		]);
		expect(args).toContain('approval_policy="never"');
		expect(args.slice(-3)).toEqual(["--model", "gpt-5.5", "-"]);
		expect(calls[0]!.stdin).toContain("Make home blue");
	});

	test("passes attached images with --image, one flag each", () => {
		expect(codexArgs("", "/stage", [".rabisco/attachments/1-a.png"]).slice(-2)).toEqual([
			"--image=/stage/.rabisco/attachments/1-a.png",
			"-",
		]);
	});

	test("turn.failed maps to an error", async () => {
		const { spawn } = fakeSpawn({
			stdout: [
				{ type: "turn.started" },
				{ type: "error", message: "Reconnecting... 1/5" },
				{ type: "turn.failed", error: { message: "You've hit your usage limit. Try again later." } },
			],
			exitCode: 1,
		});

		const events = await collect(
			createCodexProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events).toContainEqual({ type: "status", label: "Reconnecting", detail: "Reconnecting... 1/5" });
		expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited", retryable: true });
	});

	test("a logged-out codex is not_authenticated (stderr) ", async () => {
		const { spawn } = fakeSpawn({ stderr: "Error: Not logged in. Run codex login.", exitCode: 1 });

		const events = await collect(
			createCodexProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events).toEqual([
			expect.objectContaining({
				type: "error",
				code: "not_authenticated",
				message: expect.stringContaining("codex login"),
			}),
		]);
	});

	test("a missing binary is not_installed", async () => {
		const provider = createCodexProvider({ config: config("/nope/codex"), spawn: fakeSpawn({}).spawn });
		expect(await collect(provider.generate(request, new AbortController().signal))).toEqual([
			expect.objectContaining({ type: "error", code: "not_installed" }),
		]);
		expect(await provider.health()).toMatchObject({ ok: false, code: "not_installed" });
	});

	test("health checks the version and login", async () => {
		const bin = binary();

		const ok = fakeSpawn((cmd) => ({
			stdout: [cmd.includes("login") ? "Logged in using ChatGPT" : "codex-cli 0.155.1"],
		}));

		expect(await createCodexProvider({ config: config(bin), spawn: ok.spawn }).health()).toEqual({
			ok: true,
			version: "0.155.1",
		});

		const out = fakeSpawn((cmd) =>
			cmd.includes("login") ? { stdout: ["Not logged in"], exitCode: 1 } : { stdout: ["codex-cli 0.155.1"] },
		);

		expect(await createCodexProvider({ config: config(bin), spawn: out.spawn }).health()).toMatchObject({
			ok: false,
			code: "not_authenticated",
		});
	});

	test("lists models from codex's catalog, falling back to a static list", async () => {
		const bin = binary();

		const catalog = {
			models: [
				{ slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
				{ slug: "internal", display_name: "Internal", visibility: "hide" },
			],
		};

		const listed = fakeSpawn({ stdout: [catalog] });
		expect(await createCodexProvider({ config: config(bin), spawn: listed.spawn }).listModels()).toEqual([
			{ id: "gpt-5.5", label: "GPT-5.5" },
		]);
		const broken = fakeSpawn({ stdout: ["error: unknown command"], exitCode: 2 });
		expect(
			(await createCodexProvider({ config: config(bin), spawn: broken.spawn }).listModels()).length,
		).toBeGreaterThan(0);
	});
});
