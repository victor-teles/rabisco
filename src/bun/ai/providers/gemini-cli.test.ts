import { describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, writeFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { GenerationEvent, GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { tempDir } from "../../test-utils";
import { fakeSpawn } from "./fake-cli";
import { createGeminiCliProvider } from "./gemini-cli";

const BUTTON = "export function PrimaryButton() { return <button>Go</button>; }\n";

const request: GenerationRequest = {
	id: "gen-1",
	task: "create",
	model: "gemini-2.5-pro",
	prompt: "A primary button",
	device: "mobile",
	context: {},
	files: [],
};

function binary() {
	const path = join(tempDir(), "gemini");
	writeFileSync(path, "#!/bin/sh\n");
	chmodSync(path, 0o755);

	return path;
}

const config = (binPath: string): ProviderConfig => ({
	id: "gemini-cli",
	type: "gemini-cli",
	label: "Gemini CLI",
	enabled: true,
	binPath,
});

async function collect(events: AsyncIterable<GenerationEvent>) {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
}

/** Shaped after the headless-mode docs, not a real recording. */
const recording = (dir: string) => [
	{ type: "init", timestamp: "2026-10-04T10:00:00.000Z", session_id: "s1", model: "gemini-2.5-pro" },
	{ type: "message", timestamp: "2026-10-04T10:00:00.100Z", role: "user", content: "A primary button" },
	{ type: "message", timestamp: "2026-10-04T10:00:01.000Z", role: "assistant", content: "Creating ", delta: true },
	{ type: "message", timestamp: "2026-10-04T10:00:01.100Z", role: "assistant", content: "the button.", delta: true },
	{
		type: "tool_use",
		timestamp: "2026-10-04T10:00:02.000Z",
		tool_name: "write_file",
		tool_id: "w1",
		parameters: { file_path: `${dir}/components/primary-button.tsx`, content: BUTTON },
	},
	{ type: "tool_result", timestamp: "2026-10-04T10:00:02.100Z", tool_id: "w1", status: "success" },
	{
		type: "tool_use",
		timestamp: "2026-10-04T10:00:02.200Z",
		tool_name: "write_file",
		tool_id: "w2",
		parameters: { file_path: `${dir}/src/extra.ts`, content: "x" },
	},
	{ type: "tool_result", timestamp: "2026-10-04T10:00:02.300Z", tool_id: "w2", status: "success" },
	{ type: "message", timestamp: "2026-10-04T10:00:03.000Z", role: "assistant", content: "Done.", delta: true },
	{
		type: "result",
		timestamp: "2026-10-04T10:00:03.100Z",
		status: "success",
		stats: { total_tokens: 1300, input_tokens: 1200, output_tokens: 100, duration_ms: 3100, tool_calls: 2 },
	},
];

describe("Gemini CLI provider", () => {
	test("runs gemini headless in the staging dir and maps stream-json", async () => {
		const root = tempDir();
		const calls: string[][] = [];

		const provider = createGeminiCliProvider({
			config: config(binary()),
			stagingRoot: root,
			spawn: (cmd, options) => {
				calls.push(cmd);

				return fakeSpawn({
					act: async (dir) => {
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
		expect(events).toContainEqual({ type: "status", label: "Writing components/primary-button.tsx" });
		expect(events).toContainEqual({ type: "file.start", path: "components/primary-button.tsx", kind: "component" });
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
		expect(args.slice(0, 4)).toEqual(["--output-format", "stream-json", "--approval-mode", "auto_edit"]);
		expect(args).toContain("gemini-2.5-pro");
		expect(args.at(-2)).toBe("--prompt");
		expect(args.at(-1)).toContain("A primary button");
	});

	test("an error result maps to an error event", async () => {
		const { spawn } = fakeSpawn({
			stdout: [
				{
					type: "result",
					status: "error",
					error: { type: "FatalAuthenticationError", message: "Please set an Auth method in your settings.json" },
				},
			],
			exitCode: 41,
		});

		const events = await collect(
			createGeminiCliProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events).toEqual([
			expect.objectContaining({
				type: "error",
				code: "not_authenticated",
				fix: expect.stringContaining("Run `gemini` in a terminal and sign in."),
			}),
		]);
	});

	test("quota errors on stderr are rate_limited", async () => {
		const { spawn } = fakeSpawn({
			stderr: "Error: Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
			exitCode: 1,
		});

		const events = await collect(
			createGeminiCliProvider({ config: config(binary()), spawn, stagingRoot: tempDir() }).generate(
				request,
				new AbortController().signal,
			),
		);

		expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
	});

	test("a missing binary is not_installed with an install hint", async () => {
		const provider = createGeminiCliProvider({ config: config("/nope/gemini"), spawn: fakeSpawn({}).spawn });
		const health = await provider.health();
		expect(health).toMatchObject({
			ok: false,
			code: "not_installed",
			fix: expect.stringContaining("https://github.com/google-gemini/gemini-cli"),
		});
		expect(await collect(provider.generate(request, new AbortController().signal))).toEqual([
			expect.objectContaining({ type: "error", code: "not_installed" }),
		]);
	});

	test("abort ends with aborted", async () => {
		const { spawn, calls } = fakeSpawn({
			stdout: [{ type: "message", role: "assistant", content: "Hi", delta: true }],
			hang: true,
		});

		const controller = new AbortController();
		const events: GenerationEvent[] = [];

		for await (const event of createGeminiCliProvider({
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
