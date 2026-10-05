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
import { arrayOr, objectOr, optionalNumber, optionalObject, optionalString, parseJson } from "../../json";
import { userPrompt } from "../prompt";
import { runInStaging } from "../staging";
import type { CliProviderOptions } from "./claude-code";

/** Used when `codex debug models` isn't available. */
export const CODEX_MODELS: ProviderModel[] = [{ id: "gpt-5.5", label: "GPT-5.5" }];

/** Maps `codex exec --json` lines to events. Stateful: create one per run. */
export function createCodexMapper(dir: string): LineMapper {
	const text = new MessageText();

	return (raw) => {
		const line = objectOr(raw);
		const item = objectOr(line.item);
		const message = optionalString(line.message);

		switch (line.type) {
			case "item.started":
				if (item.type === "command_execution") return [toolStatus("run", optionalString(item.command))];

				if (item.type === "mcp_tool_call") return [toolStatus("other", undefined, optionalString(item.tool))];

				if (item.type === "web_search") return [toolStatus("other", undefined, "web search")];

				return [];
			case "item.completed": {
				const itemText = optionalString(item.text);

				if (item.type === "agent_message" && itemText) {
					text.break();

					return text.delta(itemText);
				}

				if (item.type === "reasoning") return [{ type: "status", label: "Thinking" }];

				if (item.type === "file_change") {
					text.break();

					return arrayOr(item.changes).map((entry): GenerationEvent => {
						const change = objectOr(entry);
						const path = stagingRelative(dir, optionalString(change.path));

						return change.kind === "delete"
							? { type: "status", label: `Deleting ${path}` }
							: toolStatus(change.kind === "add" ? "write" : "edit", path);
					});
				}

				const itemMessage = optionalString(item.message);

				if (item.type === "error" && itemMessage) return [{ type: "status", label: "Warning", detail: itemMessage }];

				return [];
			}

			case "turn.completed": {
				const usage = optionalObject(line.usage);

				if (!usage) return [{ type: "done" }];

				return [
					{
						type: "done",
						usage: {
							inputTokens: optionalNumber(usage.input_tokens) ?? 0,
							outputTokens: optionalNumber(usage.output_tokens) ?? 0,
						},
					},
				];
			}

			case "turn.failed":
				return [
					failureEvent(classifyFailure("codex", optionalString(objectOr(line.error).message) ?? "Codex failed.")),
				];
			case "error":
				// Codex reports retries as errors too; only the others end the run
				if (/reconnecting|retrying/i.test(message ?? ""))
					return [{ type: "status", label: "Reconnecting", detail: message }];

				return [failureEvent(classifyFailure("codex", message ?? "Codex failed."))];
			default:
				return [];
		}
	};
}

/** The models `codex debug models` lists for users, or none when its output isn't a catalog. */
function parseCodexCatalog(stdout: string): ProviderModel[] {
	return arrayOr(objectOr(parseJson(stdout)).models).flatMap((entry) => {
		const model = objectOr(entry);
		const slug = optionalString(model.slug);

		if (!slug || model.visibility !== "list") return [];

		return [{ id: slug, label: optionalString(model.display_name) || slug }];
	});
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

				if (login.code !== 0)
					return failureHealth(notAuthenticated("codex", (login.stderr || login.stdout).trim() || undefined));
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

				const listed = parseCodexCatalog(result.stdout);

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
