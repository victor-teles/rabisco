/**
 * Codex CLI provider: runs `codex exec --json` in a staging dir with a
 * workspace-write sandbox, and maps its JSONL events to generation events.
 * Uses the user's own Codex login.
 */

import type { GenerationEvent, Provider, ProviderModel } from "../../../shared/ai/contract";
import {
	bunSpawn,
	classifyFailure,
	cliEnv,
	failureEvent,
	failureHealth,
	MessageText,
	notAuthenticated,
	notInstalled,
	resolveBinary,
	runCliAgent,
	runCommand,
	stagingRelative,
	toolStatus,
	versionHealth,
	type LineMapper,
} from "../cli";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";
import type { CliProviderOptions } from "./claude-code";

/** Used when `codex debug models` isn't available. */
export const CODEX_MODELS: ProviderModel[] = [{ id: "gpt-5.5", label: "GPT-5.5" }];

type CodexItem = {
	type?: string;
	text?: string;
	command?: string;
	changes?: { path?: string; kind?: string }[];
	server?: string;
	tool?: string;
	query?: string;
	message?: string;
};
type CodexLine = {
	type?: string;
	item?: CodexItem;
	usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
	error?: { message?: string };
	message?: string;
};

/** Maps `codex exec --json` lines to events. Stateful: create one per run. */
export function createCodexMapper(dir: string): LineMapper {
	const text = new MessageText();
	return (raw) => {
		const line = raw as CodexLine;
		const item = line.item;
		switch (line.type) {
			case "item.started":
				if (item?.type === "command_execution") return [toolStatus("run", item.command)];
				if (item?.type === "mcp_tool_call") return [toolStatus("other", undefined, item.tool)];
				if (item?.type === "web_search") return [toolStatus("other", undefined, "web search")];
				return [];
			case "item.completed": {
				if (item?.type === "agent_message" && item.text) {
					text.break();
					return text.delta(item.text);
				}
				if (item?.type === "reasoning") return [{ type: "status", label: "Thinking" }];
				if (item?.type === "file_change") {
					text.break();
					return (item.changes ?? []).map((change): GenerationEvent => {
						const path = stagingRelative(dir, change.path);
						return change.kind === "delete" ? { type: "status", label: `Deleting ${path}` } : toolStatus(change.kind === "add" ? "write" : "edit", path);
					});
				}
				if (item?.type === "error" && item.message) return [{ type: "status", label: "Warning", detail: item.message }];
				return [];
			}
			case "turn.completed": {
				const usage = line.usage;
				return [{ type: "done", ...(usage ? { usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } } : {}) }];
			}
			case "turn.failed":
				return [failureEvent(classifyFailure("codex", line.error?.message ?? "Codex failed."))];
			case "error":
				// Codex reports retries as errors too; only the others end the run
				if (/reconnecting|retrying/i.test(line.message ?? "")) return [{ type: "status", label: "Reconnecting", detail: line.message }];
				return [failureEvent(classifyFailure("codex", line.message ?? "Codex failed."))];
			default:
				return [];
		}
	};
}

/** The `codex` arguments for one generation; the prompt goes on stdin (`-`). */
export function codexArgs(model: string, dir: string) {
	return [
		"exec",
		"--json",
		"--skip-git-repo-check",
		"--ephemeral",
		"--sandbox",
		"workspace-write",
		"-c",
		'approval_policy="never"',
		"--cd",
		dir,
		...(model ? ["--model", model] : []),
		"-",
	];
}

export function createCodexProvider(options: CliProviderOptions): Provider {
	const spawn = options.spawn ?? bunSpawn;
	const binary = () => resolveBinary("codex", options.config.binPath);
	let models: ProviderModel[] | null = null;

	return {
		id: options.config.id,
		kind: "cli",
		label: options.config.label || "Codex CLI",
		capabilities: { streaming: true, images: false, agentic: true, maxContextTokens: 200_000 },

		async health() {
			const bin = binary();
			const version = await versionHealth("codex", spawn, bin);
			if (!version.ok || !bin) return version;
			try {
				const login = await runCommand(spawn, [bin, "login", "status"], { env: cliEnv(bin), timeoutMs: 10_000 });
				if (login.code !== 0) return failureHealth(notAuthenticated("codex", (login.stderr || login.stdout).trim() || undefined));
			} catch {
				// A generation will report a missing login
			}
			return { ok: true, version: version.version };
		},

		/** Codex's own catalog (`codex debug models`), falling back to a static list. */
		async listModels() {
			if (models) return models;
			const bin = binary();
			if (!bin) return CODEX_MODELS;
			try {
				const result = await runCommand(spawn, [bin, "debug", "models"], { env: cliEnv(bin), timeoutMs: 10_000 });
				const catalog = JSON.parse(result.stdout) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
				const listed = (catalog.models ?? []).filter((m) => m.slug && m.visibility === "list").map((m) => ({ id: m.slug!, label: m.display_name || m.slug! }));
				models = listed.length ? listed : CODEX_MODELS;
			} catch {
				models = CODEX_MODELS;
			}
			return models;
		},

		async *generate(request, signal) {
			const bin = binary();
			if (!bin) {
				yield failureEvent(notInstalled("codex"));
				return;
			}
			const model = request.model || options.config.defaultModel || "";
			yield* runInStaging(
				request,
				signal,
				(dir, agentSignal) =>
					runCliAgent(
						{
							type: "codex",
							spawn,
							cmd: [bin, ...codexArgs(model, dir)],
							cwd: dir,
							env: cliEnv(bin),
							stdin: userPrompt(request, "agent"),
							map: createCodexMapper(dir),
						},
						agentSignal,
					),
				{ root: options.stagingRoot },
			);
		},
	};
}
