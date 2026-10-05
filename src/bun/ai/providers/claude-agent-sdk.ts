// The SDK is imported lazily, so a missing or broken package only disables this provider.
// `binPath` overrides its bundled Claude Code binary (needed when the SDK itself is bundled).

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { GenerationEvent, Provider } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { abortedEvent, classifyFailure, failureEvent, failureHealth, notAuthenticated, whenAborted } from "../cli";
import { parseJson } from "../../json";
import { systemPrompt, userPrompt } from "../prompt";
import { runInStaging } from "../staging";
import { CLAUDE_DENIED_TOOLS, CLAUDE_FILE_TOOLS, CLAUDE_MODELS, createClaudeMapper } from "./claude-code";

export type SdkProviderOptions = {
	config: ProviderConfig;
	getApiKey: () => Promise<string | null>;
	stagingRoot?: string;
};

export type AgentSdk = {
	query(params: { prompt: string; options?: Options }): AsyncIterable<object> & { close?(): void };
};

const loadSdk = (): Promise<AgentSdk> => import("@anthropic-ai/claude-agent-sdk");

const loadFailure = (cause: unknown) =>
	`The Claude Agent SDK couldn't be loaded: ${cause instanceof Error ? cause.message : String(cause)}`;

export function createClaudeAgentSdkProvider(
	options: SdkProviderOptions & { sdk?: () => Promise<AgentSdk> },
): Provider {
	const load = options.sdk ?? loadSdk;

	return {
		id: options.config.id,
		kind: "sdk",
		label: options.config.label || "Claude Agent SDK",
		capabilities: { streaming: true, images: false, agentic: true, maxContextTokens: 200_000 },

		async health() {
			if (!(await options.getApiKey()))
				return failureHealth(notAuthenticated("claude-agent-sdk", "No Anthropic API key."));

			try {
				await load();

				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					code: "not_installed",
					message: loadFailure(error),
				};
			}
		},

		async listModels() {
			return CLAUDE_MODELS;
		},

		async *generate(request, signal) {
			const apiKey = await options.getApiKey();

			if (!apiKey) {
				yield failureEvent(notAuthenticated("claude-agent-sdk", "No Anthropic API key."));

				return;
			}

			let sdk: AgentSdk;

			try {
				sdk = await load();
			} catch (error) {
				yield {
					type: "error",
					code: "not_installed",
					message: loadFailure(error),
					retryable: false,
				};

				return;
			}

			const model = request.model || options.config.defaultModel;
			const binPath = options.config.binPath;
			yield* runInStaging(
				request,
				signal,
				(dir, agentSignal) => {
					const agentOptions: Options = {
						cwd: dir,
						systemPrompt: systemPrompt(request, "agent"),
						tools: CLAUDE_FILE_TOOLS,
						allowedTools: CLAUDE_FILE_TOOLS,
						disallowedTools: CLAUDE_DENIED_TOOLS,
						permissionMode: "acceptEdits",
						// Isolation: no user/project settings, CLAUDE.md or MCP servers
						settingSources: [],
						mcpServers: {},
						persistSession: false,
						env: { ...process.env, ANTHROPIC_API_KEY: apiKey, CLAUDE_AGENT_SDK_CLIENT_APP: "rabisco" },
					};

					if (model) agentOptions.model = model;

					if (binPath) agentOptions.pathToClaudeCodeExecutable = binPath;

					return runSdkAgent(sdk, dir, agentSignal, { prompt: userPrompt(request, "agent"), options: agentOptions });
				},
				{ root: options.stagingRoot },
			);
		},
	};
}

async function* runSdkAgent(
	sdk: AgentSdk,
	dir: string,
	signal: AbortSignal,
	params: { prompt: string; options: Options },
): AsyncGenerator<GenerationEvent> {
	const abortController = new AbortController();
	const onAbort = () => abortController.abort();
	signal.addEventListener("abort", onAbort, { once: true });
	const stderr: string[] = [];
	const map = createClaudeMapper(dir, "claude-agent-sdk");
	const aborted = whenAborted(signal);
	let query: ReturnType<AgentSdk["query"]> | null = null;

	try {
		query = sdk.query({
			prompt: params.prompt,
			options: { ...params.options, abortController, stderr: (data: string) => stderr.push(data) },
		});
		const iterator = query[Symbol.asyncIterator]();

		while (true) {
			const next = await Promise.race([iterator.next(), aborted]);

			if (next === "aborted") {
				yield abortedEvent();

				return;
			}

			if (next.done) break;

			// SDK messages are decoded stream-json lines; round-trip them for the shared mapper
			for (const event of map(parseJson(JSON.stringify(next.value)))) {
				yield event;

				if (event.type === "done" || event.type === "error") return;
			}
		}

		yield signal.aborted ? abortedEvent() : { type: "done" };
	} catch (error) {
		if (signal.aborted) yield abortedEvent();
		else
			yield failureEvent(
				classifyFailure(
					"claude-agent-sdk",
					[error instanceof Error ? error.message : String(error), ...stderr].join("\n"),
				),
			);
	} finally {
		signal.removeEventListener("abort", onAbort);
		abortController.abort();

		try {
			query?.close?.();
		} catch {}
	}
}
