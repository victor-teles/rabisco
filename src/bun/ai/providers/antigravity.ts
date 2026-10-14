import { mkdir, realpath, writeFile } from "fs/promises";
import { join } from "path";
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
	runCommand,
	stagingRelative,
	toolStatus,
	versionHealth,
	type LineMapper,
} from "../cli";
import type { JsonObject } from "../../../shared/json";
import { arrayOr, objectOr, optionalNumber, optionalObject, optionalString } from "../../json";
import { userPrompt } from "../prompt";
import { DENIED_STATUS } from "../protocol";
import { runInStaging } from "../staging";
import type { CliProviderOptions } from "./claude-code";
import { commandMethods } from "../command-template";
import { antigravityCommands } from "../commands";

export const ANTIGRAVITY_MODELS: ProviderModel[] = [
	{ id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
	{ id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
];

function toolEvent(dir: string, name: string | undefined, params: JsonObject): GenerationEvent {
	const path = stagingRelative(
		dir,
		optionalString(params.TargetFile ?? params.AbsolutePath ?? params.DirectoryPath ?? params.SearchPath),
	);

	switch (name) {
		case "write_to_file":
			return toolStatus("write", path);
		case "replace_file_content":
		case "multi_replace_file_content":
		case "sed_file":
			return toolStatus("edit", path);
		case "view_file":
			return toolStatus("read", path);
		case "grep_search":
		case "find_by_name":
			return toolStatus("search", optionalString(params.Query ?? params.Pattern) ?? path);
		case "list_dir":
			return toolStatus("list", path);
		case "run_command":
			return toolStatus("run", optionalString(params.CommandLine));
		default:
			return toolStatus("other", undefined, name);
	}
}

/** Stateful: create one per run. */
export function createAntigravityMapper(dir: string): LineMapper {
	const text = new MessageText();
	let step: number | undefined;

	return (raw) => {
		const line = objectOr(raw);

		if (line.event === "step_update") {
			const update = objectOr(line.step_update);
			const index = optionalNumber(update.step_index);
			const tool = objectOr(update.tool_info);

			if (index !== step) text.break();
			step = index;

			if (update.step_type === "agent_response") return text.delta(optionalString(update.text_delta) ?? "");

			if (update.step_type !== "tool") return [];

			if (update.state === "ACTIVE")
				return [toolEvent(dir, optionalString(update.tool_name), objectOr(tool.parameters))];

			if (update.state === "ERROR")
				return [{ type: "status", label: "A tool call failed", detail: optionalString(objectOr(tool.error).message) }];

			return [];
		}

		if (line.event !== "result") return [];
		const result = objectOr(line.result);

		if (result.status !== "SUCCESS")
			return [
				failureEvent(
					classifyFailure(
						"antigravity",
						optionalString(result.error) ??
							optionalString(objectOr(result.error).message) ??
							(optionalString(result.response) || "Antigravity CLI failed."),
					),
				),
			];

		const denied = arrayOr(result.denied_actions).flatMap((entry) => {
			const action = objectOr(entry);
			const label = optionalString(action.display_name) ?? optionalString(action.action);

			return label ? [label] : [];
		});

		const usage = optionalObject(result.usage);

		const done: GenerationEvent = usage
			? {
					type: "done",
					usage: {
						inputTokens: optionalNumber(usage.input_tokens) ?? 0,
						outputTokens: optionalNumber(usage.output_tokens) ?? 0,
					},
				}
			: { type: "done" };

		return denied.length ? [{ type: "status", label: DENIED_STATUS, detail: denied.join(", ") }, done] : [done];
	};
}

const AGENT_NAME = "rabisco";

const AGENT_TOOLS = [
	"view_file",
	"list_dir",
	"find_by_name",
	"grep_search",
	"write_to_file",
	"replace_file_content",
	"multi_replace_file_content",
];

export const AGENT_FILE = `.agents/agents/${AGENT_NAME}.md`;

const agentDefinition = () =>
	[
		"---",
		`name: ${AGENT_NAME}`,
		"description: Designs Rabisco screens and components",
		"mainAgent: true",
		"inheritMcp: false",
		"tools:",
		...AGENT_TOOLS.map((tool) => `  - ${tool}`),
		"---",
		"",
		"# Rabisco",
		"",
		"Follow the instructions in AGENTS.md.",
		"",
	].join("\n");

export function parseAntigravityModels(stdout: string): ProviderModel[] {
	return stdout.split("\n").flatMap((row) => {
		const [id, label] = row.split("\t");

		return id && label && /^[\w.-]+$/.test(id) ? [{ id, label: label.trim() }] : [];
	});
}

export function antigravityArgs(model: string, prompt: string) {
	return [
		"--output-format",
		"stream-json",
		"--mode",
		"accept-edits",
		"--disable-slash-commands",
		"--agent",
		AGENT_NAME,
		...(model ? ["--model", model] : []),
		"--print",
		prompt,
	];
}

export function createAntigravityProvider(options: CliProviderOptions): Provider {
	const spawn = options.spawn ?? bunSpawn;
	const binary = () => resolveBinary("agy", options.config.binPath);
	let models: ProviderModel[] | null = null;

	return {
		id: options.config.id,
		kind: "cli",
		label: options.config.label || "Antigravity CLI",
		capabilities: { streaming: true, images: true, agentic: true, maxContextTokens: 1_000_000 },
		...commandMethods(antigravityCommands),

		async health() {
			const result = await versionHealth("antigravity", spawn, binary());

			return result.ok ? { ok: true, version: result.version } : result;
		},

		async listModels() {
			if (models) return models;
			const bin = binary();

			if (!bin) return ANTIGRAVITY_MODELS;

			try {
				const result = await runCommand(spawn, [bin, "models"], { env: cliEnv(bin), timeoutMs: 10_000 });
				const listed = parseAntigravityModels(result.stdout);
				models = listed.length ? listed : ANTIGRAVITY_MODELS;
			} catch {
				models = ANTIGRAVITY_MODELS;
			}

			return models;
		},

		async *generate(request, signal) {
			const bin = binary();

			if (!bin) {
				yield failureEvent(notInstalled("antigravity"));

				return;
			}

			const model = request.model || options.config.defaultModel || "";
			yield* runInStaging(
				request,
				signal,
				async function* (dir, agentSignal) {
					const cwd = await realpath(dir);
					await mkdir(join(cwd, ".agents/agents"), { recursive: true });
					await writeFile(join(cwd, AGENT_FILE), agentDefinition());

					yield* runCliAgent(
						{
							type: "antigravity",
							spawn,
							cmd: [bin, ...antigravityArgs(model, userPrompt(request, "agent"))],
							cwd,
							env: cliEnv(bin),
							map: createAntigravityMapper(cwd),
						},
						agentSignal,
					);
				},
				{ root: options.stagingRoot },
			);
		},
	};
}
