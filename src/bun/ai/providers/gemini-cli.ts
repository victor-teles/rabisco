// Written from the Gemini CLI docs (headless mode, stream-json); not yet run against a real install.

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
import type { JsonObject } from "../../../shared/json";
import { objectOr, optionalNumber, optionalObject, optionalString } from "../../json";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";
import type { CliProviderOptions } from "./claude-code";
import { commandMethods } from "../command-template";
import { geminiCommands } from "../commands";

export const GEMINI_MODELS: ProviderModel[] = [
	{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
	{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

function toolEvent(dir: string, name: string | undefined, params: JsonObject): GenerationEvent {
	const path = stagingRelative(
		dir,
		optionalString(params.file_path ?? params.absolute_path ?? params.path ?? params.dir_path),
	);

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
			return toolStatus("search", optionalString(params.pattern) ?? path);
		case "list_directory":
			return toolStatus("list", path);
		case "run_shell_command":
			return toolStatus("run", optionalString(params.command));
		default:
			return toolStatus("other", undefined, name);
	}
}

/** Stateful: create one per run. */
export function createGeminiMapper(dir: string): LineMapper {
	const text = new MessageText();

	return (raw) => {
		const line = objectOr(raw);
		const errorMessage = optionalString(objectOr(line.error).message);

		switch (line.type) {
			case "message": {
				const content = optionalString(line.content);

				if (line.role !== "assistant" || !content) return [];

				if (!line.delta) text.break();

				return text.delta(content);
			}

			case "tool_use":
				text.break();

				return [toolEvent(dir, optionalString(line.tool_name), objectOr(line.parameters))];
			case "tool_result":
				return line.status === "error" ? [{ type: "status", label: "A tool call failed", detail: errorMessage }] : [];
			case "error":
				return [
					{
						type: "status",
						label: line.severity === "warning" ? "Warning" : "Error",
						detail: optionalString(line.message),
					},
				];
			case "result": {
				if (line.status && line.status !== "success")
					return [failureEvent(classifyFailure("gemini-cli", errorMessage ?? "Gemini CLI failed."))];
				const stats = optionalObject(line.stats);

				if (!stats) return [{ type: "done" }];

				return [
					{
						type: "done",
						usage: {
							inputTokens: optionalNumber(stats.input_tokens) ?? 0,
							outputTokens: optionalNumber(stats.output_tokens) ?? 0,
						},
					},
				];
			}

			default:
				return [];
		}
	};
}

export function geminiArgs(model: string, prompt: string) {
	return [
		"--output-format",
		"stream-json",
		"--approval-mode",
		"auto_edit",
		...(model ? ["--model", model] : []),
		"--prompt",
		prompt,
	];
}

export function createGeminiCliProvider(options: CliProviderOptions): Provider {
	const spawn = options.spawn ?? bunSpawn;
	const binary = () => resolveBinary("gemini", options.config.binPath);

	return {
		id: options.config.id,
		kind: "cli",
		label: options.config.label || "Gemini CLI",
		capabilities: { streaming: true, images: true, agentic: true, maxContextTokens: 1_000_000 },
		...commandMethods(geminiCommands),

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
