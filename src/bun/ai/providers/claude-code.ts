import type { GenerationEvent, Provider, ProviderModel, Usage } from "../../../shared/ai/contract";
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
import { isString } from "../../../shared/guards";
import type { JsonObject, Json } from "../../../shared/json";
import { arrayOr, objectOr, optionalNumber, optionalObject, optionalString, parseJson } from "../../json";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";

export type CliProviderOptions = { config: ProviderConfig; spawn?: SpawnFn; stagingRoot?: string };

/** File tools only: the agent can't run commands. */
export const CLAUDE_FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

export const CLAUDE_DENIED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export const CLAUDE_MODELS: ProviderModel[] = [
	{ id: "opus", label: "Claude Opus (latest)" },
	{ id: "sonnet", label: "Claude Sonnet (latest)" },
	{ id: "haiku", label: "Claude Haiku (latest)" },
	{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
	{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
];

function toolEvent(dir: string, name: string | undefined, input: JsonObject): GenerationEvent {
	const path = stagingRelative(dir, optionalString(input.file_path ?? input.path ?? input.notebook_path));

	switch (name) {
		case "Write":
			return toolStatus("write", path);
		case "Edit":
		case "MultiEdit":
			return toolStatus("edit", path);
		case "Read":
			return toolStatus("read", path);
		case "Glob":
		case "Grep":
			return toolStatus("search", optionalString(input.pattern) ?? path);
		case "LS":
			return toolStatus("list", path);
		case "Bash":
			return toolStatus("run");
		default:
			return toolStatus("other", undefined, name);
	}
}

function resultUsage(line: JsonObject): Usage {
	const usage: Usage = {};
	const tokens = optionalObject(line.usage);
	const cost = optionalNumber(line.total_cost_usd);

	if (tokens) {
		const count = (key: string) => optionalNumber(tokens[key]) ?? 0;
		usage.inputTokens = count("input_tokens") + count("cache_read_input_tokens") + count("cache_creation_input_tokens");
		usage.outputTokens = count("output_tokens");
	}

	if (cost !== undefined) usage.costUsd = cost;

	return usage;
}

/** Also maps Agent SDK messages, which share the format. Stateful: create one per run. */
export function createClaudeMapper(dir: string, type: "claude-code" | "claude-agent-sdk" = "claude-code"): LineMapper {
	const text = new MessageText();

	return (raw) => {
		const line = objectOr(raw);
		const message = optionalObject(line.message);

		if (line.type === "assistant" && message && !line.parent_tool_use_id) {
			const content: readonly Json[] = isString(message.content)
				? [{ type: "text", text: message.content }]
				: arrayOr(message.content);

			const events: GenerationEvent[] = [];

			for (const entry of content) {
				const block = objectOr(entry);
				const blockText = optionalString(block.text);

				if (block.type === "text" && blockText) {
					text.break();
					events.push(...text.delta(blockText));
				} else if (block.type === "tool_use") {
					text.break();
					events.push(toolEvent(dir, optionalString(block.name), objectOr(block.input)));
				}
			}

			return events;
		}

		if (line.type === "result") {
			const subtype = optionalString(line.subtype);

			if (line.is_error === true || subtype !== "success") {
				const detail =
					optionalString(line.result) ||
					arrayOr(line.errors).filter(isString).join("\n") ||
					`Claude stopped early (${subtype ?? "error"}).`;

				return [failureEvent(classifyFailure(type, detail))];
			}

			return [{ type: "done", usage: resultUsage(line) }];
		}

		return [];
	};
}

/** The prompt goes on stdin. */
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

				if (objectOr(parseJson(auth.stdout)).loggedIn === false) return failureHealth(notAuthenticated("claude-code"));
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
