/**
 * Gemini CLI provider: runs `gemini -p` headless in a staging dir with edits
 * auto-approved, and maps its `stream-json` output to generation events.
 * Uses the user's own Gemini CLI login.
 *
 * Written from the Gemini CLI docs (headless mode, stream-json); not yet run
 * against a real install.
 */

import type { GenerationEvent, Provider, ProviderModel } from "../../../shared/ai/contract";
import {
	bunSpawn,
	classifyFailure,
	cliEnv,
	failureEvent,
	MessageText,
	notInstalled,
	resolveBinary,
	runCliAgent,
	stagingRelative,
	toolStatus,
	versionHealth,
	type LineMapper,
} from "../cli";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";
import type { CliProviderOptions } from "./claude-code";

export const GEMINI_MODELS: ProviderModel[] = [
	{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
	{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

type GeminiLine = {
	type?: string;
	role?: string;
	content?: string;
	delta?: boolean;
	tool_name?: string;
	parameters?: Record<string, unknown>;
	status?: string;
	severity?: string;
	message?: string;
	error?: { type?: string; message?: string };
	stats?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

function toolEvent(dir: string, name: string | undefined, params: Record<string, unknown>): GenerationEvent {
	const path = stagingRelative(dir, (params.file_path ?? params.absolute_path ?? params.path ?? params.dir_path) as string | undefined);
	switch (name) {
		case "write_file":
			return toolStatus("write", path);
		case "replace":
		case "edit":
			return toolStatus("edit", path);
		case "read_file":
		case "read_many_files":
			return toolStatus("read", path);
		case "glob":
		case "search_file_content":
		case "grep":
			return toolStatus("search", (params.pattern as string | undefined) ?? path);
		case "list_directory":
			return toolStatus("list", path);
		case "run_shell_command":
			return toolStatus("run", params.command as string | undefined);
		default:
			return toolStatus("other", undefined, name);
	}
}

/** Maps Gemini CLI `stream-json` lines to events. Stateful: create one per run. */
export function createGeminiMapper(dir: string): LineMapper {
	const text = new MessageText();
	return (raw) => {
		const line = raw as GeminiLine;
		switch (line.type) {
			case "message":
				if (line.role !== "assistant" || !line.content) return [];
				if (!line.delta) text.break();
				return text.delta(line.content);
			case "tool_use":
				text.break();
				return [toolEvent(dir, line.tool_name, line.parameters ?? {})];
			case "tool_result":
				return line.status === "error" ? [{ type: "status", label: "A tool call failed", detail: line.error?.message }] : [];
			case "error":
				return [{ type: "status", label: line.severity === "warning" ? "Warning" : "Error", detail: line.message }];
			case "result": {
				if (line.status && line.status !== "success") return [failureEvent(classifyFailure("gemini-cli", line.error?.message ?? "Gemini CLI failed."))];
				const stats = line.stats;
				return [{ type: "done", ...(stats ? { usage: { inputTokens: stats.input_tokens ?? 0, outputTokens: stats.output_tokens ?? 0 } } : {}) }];
			}
			default:
				return [];
		}
	};
}

/** The `gemini` arguments for one generation. */
export function geminiArgs(model: string, prompt: string) {
	return ["--output-format", "stream-json", "--approval-mode", "auto_edit", ...(model ? ["--model", model] : []), "--prompt", prompt];
}

export function createGeminiCliProvider(options: CliProviderOptions): Provider {
	const spawn = options.spawn ?? bunSpawn;
	const binary = () => resolveBinary("gemini", options.config.binPath);

	return {
		id: options.config.id,
		kind: "cli",
		label: options.config.label || "Gemini CLI",
		capabilities: { streaming: true, images: false, agentic: true, maxContextTokens: 1_000_000 },

		async health() {
			const result = await versionHealth("gemini-cli", spawn, binary());
			return result.ok ? { ok: true, version: result.version } : result;
		},

		async listModels() {
			return GEMINI_MODELS;
		},

		async *generate(request, signal) {
			const bin = binary();
			if (!bin) {
				yield failureEvent(notInstalled("gemini-cli"));
				return;
			}
			const model = request.model || options.config.defaultModel || "";
			yield* runInStaging(
				request,
				signal,
				(dir, agentSignal) =>
					runCliAgent(
						{
							type: "gemini-cli",
							spawn,
							cmd: [bin, ...geminiArgs(model, userPrompt(request, "agent"))],
							cwd: dir,
							env: cliEnv(bin),
							map: createGeminiMapper(dir),
						},
						agentSignal,
					),
				{ root: options.stagingRoot },
			);
		},
	};
}
