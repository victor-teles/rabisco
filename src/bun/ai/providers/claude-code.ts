/**
 * Claude Code CLI provider: runs `claude -p` in a staging dir with file tools
 * only, and maps its `stream-json` output to generation events. Uses the
 * user's own Claude Code login.
 */

import type { GenerationEvent, Provider, ProviderModel } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
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
	type SpawnFn,
} from "../cli";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";

export type CliProviderOptions = { config: ProviderConfig; spawn?: SpawnFn; stagingRoot?: string };

/** The only tools the agent gets: it reads and writes files, nothing else. */
export const CLAUDE_FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
export const CLAUDE_DENIED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export const CLAUDE_MODELS: ProviderModel[] = [
	{ id: "opus", label: "Claude Opus (latest)" },
	{ id: "sonnet", label: "Claude Sonnet (latest)" },
	{ id: "haiku", label: "Claude Haiku (latest)" },
	{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
	{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
];

type ContentBlock = { type: string; text?: string; name?: string; input?: Record<string, unknown> };
type ClaudeUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type ClaudeLine = {
	type?: string;
	subtype?: string;
	message?: { content?: ContentBlock[] | string };
	parent_tool_use_id?: string | null;
	is_error?: boolean;
	result?: string;
	errors?: string[];
	usage?: ClaudeUsage;
	total_cost_usd?: number;
};

function toolEvent(dir: string, block: ContentBlock): GenerationEvent {
	const input = block.input ?? {};
	const path = stagingRelative(dir, (input.file_path ?? input.path ?? input.notebook_path) as string | undefined);
	switch (block.name) {
		case "Write":
			return toolStatus("write", path);
		case "Edit":
		case "MultiEdit":
			return toolStatus("edit", path);
		case "Read":
			return toolStatus("read", path);
		case "Glob":
		case "Grep":
			return toolStatus("search", (input.pattern as string | undefined) ?? path);
		case "LS":
			return toolStatus("list", path);
		case "Bash":
			return toolStatus("run");
		default:
			return toolStatus("other", undefined, block.name);
	}
}

/**
 * Maps Claude Code `stream-json` lines (and Agent SDK messages, which share the
 * shape) to events. Stateful: create one per run.
 */
export function createClaudeMapper(dir: string, type: "claude-code" | "claude-agent-sdk" = "claude-code"): LineMapper {
	const text = new MessageText();
	return (raw) => {
		const line = raw as ClaudeLine;
		if (line.type === "assistant" && line.message && !line.parent_tool_use_id) {
			const content = typeof line.message.content === "string" ? [{ type: "text", text: line.message.content }] : (line.message.content ?? []);
			const events: GenerationEvent[] = [];
			for (const block of content) {
				if (block.type === "text" && block.text) {
					text.break();
					events.push(...text.delta(block.text));
				} else if (block.type === "tool_use") {
					text.break();
					events.push(toolEvent(dir, block));
				}
			}
			return events;
		}
		if (line.type === "result") {
			if (line.is_error || line.subtype !== "success") {
				const detail = line.result || line.errors?.join("\n") || `Claude stopped early (${line.subtype ?? "error"}).`;
				return [failureEvent(classifyFailure(type, detail))];
			}
			const usage = line.usage ?? {};
			const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
			return [
				{
					type: "done",
					usage: {
						...(line.usage ? { inputTokens: input, outputTokens: usage.output_tokens ?? 0 } : {}),
						...(typeof line.total_cost_usd === "number" ? { costUsd: line.total_cost_usd } : {}),
					},
				},
			];
		}
		return [];
	};
}

/** The `claude` arguments for one generation; the prompt goes on stdin. */
export function claudeArgs(model: string) {
	return [
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		...(model ? ["--model", model] : []),
		"--permission-mode",
		"acceptEdits",
		"--tools",
		CLAUDE_FILE_TOOLS.join(","),
		"--allowedTools",
		CLAUDE_FILE_TOOLS.join(","),
		"--disallowedTools",
		CLAUDE_DENIED_TOOLS.join(","),
		"--strict-mcp-config",
		"--no-session-persistence",
	];
}

export function createClaudeCodeProvider(options: CliProviderOptions): Provider {
	const spawn = options.spawn ?? bunSpawn;
	const binary = () => resolveBinary("claude", options.config.binPath);

	return {
		id: options.config.id,
		kind: "cli",
		label: options.config.label || "Claude Code",
		capabilities: { streaming: true, images: false, agentic: true, maxContextTokens: 200_000 },

		async health() {
			const bin = binary();
			const version = await versionHealth("claude-code", spawn, bin);
			if (!version.ok || !bin) return version;
			try {
				const auth = await runCommand(spawn, [bin, "auth", "status"], { env: cliEnv(bin), timeoutMs: 10_000 });
				const status = JSON.parse(auth.stdout) as { loggedIn?: boolean };
				if (status.loggedIn === false) return failureHealth(notAuthenticated("claude-code"));
			} catch {
				// Older versions have no `auth status`; a generation will report a missing login
			}
			return { ok: true, version: version.version };
		},

		async listModels() {
			return CLAUDE_MODELS;
		},

		async *generate(request, signal) {
			const bin = binary();
			if (!bin) {
				yield failureEvent(notInstalled("claude-code"));
				return;
			}
			const model = request.model || options.config.defaultModel || "";
			yield* runInStaging(
				request,
				signal,
				(dir, agentSignal) =>
					runCliAgent(
						{
							type: "claude-code",
							spawn,
							cmd: [bin, ...claudeArgs(model)],
							cwd: dir,
							env: cliEnv(bin),
							stdin: userPrompt(request, "agent"),
							map: createClaudeMapper(dir),
						},
						agentSignal,
					),
				{ root: options.stagingRoot },
			);
		},
	};
}
