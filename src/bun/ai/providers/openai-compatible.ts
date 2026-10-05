/**
 * OpenAI chat-completions provider for `openai`, `openrouter`, `ollama` and
 * any `openai-compatible` endpoint: plain fetch + SSE, text protocol output.
 */

import type { GenerationRequest, Provider, ProviderCapabilities, ProviderModel } from "../../../shared/ai/contract";
import { PROVIDER_TYPES } from "../../../shared/ai/settings";
import { systemPrompt, userPrompt } from "../prompt";
import {
	type ApiProviderOptions,
	baseUrlFor,
	errorFromResponse,
	errorFromStatus,
	errorMessage,
	healthError,
	ProviderError,
	readSse,
	runTextGeneration,
	type StreamPart,
	toProviderError,
} from "./api-common";

const OLLAMA_DOWN = { message: "Ollama isn't running", fix: "Start Ollama (ollama serve) or install it from ollama.com" };

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

/** System prompt, history, then the request with its images as data URLs. */
export function openAIMessages(request: GenerationRequest): ChatMessage[] {
	const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(request, "text") }];
	for (const turn of request.history ?? []) if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
	const text = userPrompt(request, "text");
	if (request.attachments?.length) {
		messages.push({
			role: "user",
			content: [
				{ type: "text", text },
				...request.attachments.map((image): ContentPart => ({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } })),
			],
		});
	} else {
		messages.push({ role: "user", content: text });
	}
	return messages;
}

type Chunk = {
	choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
	error?: { message?: string; code?: number | string } | string;
};

export function createOpenAICompatibleProvider(options: ApiProviderOptions): Provider {
	const { config, getApiKey } = options;
	const fetcher = options.fetch ?? fetch;
	const info = PROVIDER_TYPES.find((type) => type.type === config.type);
	const needsKey = config.type === "openai" || config.type === "openrouter";
	const isOllama = config.type === "ollama";
	const vision = config.type === "openai" || config.type === "openrouter";

	const capabilities: ProviderCapabilities = {
		streaming: true,
		images: vision,
		agentic: false,
		maxContextTokens: vision ? 128_000 : 32_000,
	};

	function requireBase(): string {
		const base = baseUrlFor(config);
		if (!base) throw new ProviderError("unknown", "No base URL set for this endpoint");
		return base;
	}

	async function headers(): Promise<Record<string, string>> {
		const key = await getApiKey();
		if (!key && needsKey) throw new ProviderError("not_authenticated", `No ${info?.label ?? "API"} key`);
		const result: Record<string, string> = { "content-type": "application/json" };
		if (key) result.authorization = `Bearer ${key}`;
		if (config.type === "openrouter") {
			result["HTTP-Referer"] = "https://rabisco.app";
			result["X-Title"] = "Rabisco";
		}
		return result;
	}

	/** Connection failures to Ollama mean it isn't running. */
	function connectionError(error: unknown, signal?: AbortSignal): ProviderError {
		const failure = toProviderError(error, signal);
		if (isOllama && failure.code === "network") return new ProviderError("network", OLLAMA_DOWN.message, true);
		return failure;
	}

	async function fetchModels(): Promise<ProviderModel[]> {
		const base = requireBase();
		let response: Response;
		try {
			response = await fetcher(`${base}/models`, { headers: await headers() });
		} catch (error) {
			throw connectionError(error);
		}
		if (!response.ok) throw await errorFromResponse(response);
		const json = (await response.json()) as { data?: { id: string; name?: string }[] };
		return (json.data ?? []).map((model) => ({ id: model.id, label: model.name || model.id })).sort((a, b) => a.label.localeCompare(b.label));
	}

	async function* stream(request: GenerationRequest, signal: AbortSignal): AsyncGenerator<StreamPart> {
		const base = requireBase();
		const model = request.model || config.defaultModel;
		if (!model) throw new ProviderError("unknown", "No model selected");
		const body = { model, stream: true, stream_options: { include_usage: true }, messages: openAIMessages(request) };
		const post = async (withUsage: boolean) => {
			const { stream_options: _, ...rest } = body;
			try {
				return await fetcher(`${base}/chat/completions`, {
					method: "POST",
					headers: await headers(),
					signal,
					body: JSON.stringify(withUsage ? body : rest),
				});
			} catch (error) {
				throw connectionError(error, signal);
			}
		};

		let response = await post(true);
		// Some servers reject `stream_options`; retry once without it
		if (response.status === 400 || response.status === 422) {
			const text = await response.text().catch(() => "");
			if (/stream_options|include_usage/i.test(text)) response = await post(false);
			else throw errorFromStatus(response.status, errorMessage(text));
		}
		if (!response.ok) throw await errorFromResponse(response);
		if (!response.body) throw new ProviderError("network", "Empty response", true);

		let thinking = false;
		for await (const sse of readSse(response.body)) {
			if (sse.data === "[DONE]") break;
			let chunk: Chunk;
			try {
				chunk = JSON.parse(sse.data) as Chunk;
			} catch {
				continue;
			}
			if (chunk.error) {
				const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message || "The stream failed";
				const status = typeof chunk.error === "object" && typeof chunk.error.code === "number" ? chunk.error.code : 500;
				throw errorFromStatus(status, message);
			}
			const choice = chunk.choices?.[0];
			const delta = choice?.delta;
			if (!thinking && (delta?.reasoning || delta?.reasoning_content)) {
				thinking = true;
				yield { type: "status", label: "Thinking" };
			}
			if (delta?.content) yield { type: "text", text: delta.content };
			if (choice?.finish_reason) {
				const reason = choice.finish_reason;
				yield { type: "stop", reason: reason === "stop" ? "end" : reason === "length" ? "max_tokens" : reason === "content_filter" ? "refusal" : reason };
			}
			if (chunk.usage) {
				yield {
					type: "usage",
					usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens, costUsd: chunk.usage.cost },
				};
			}
		}
	}

	return {
		id: config.id,
		kind: "api",
		label: config.label,
		capabilities,

		async health() {
			if (!baseUrlFor(config)) return { ok: false, code: "unknown", message: "No base URL set", fix: "Set the endpoint's base URL in Settings." };
			if (needsKey && !(await getApiKey())) {
				return { ok: false, code: "not_authenticated", message: `No ${info?.label ?? "API"} key`, fix: keyFix() };
			}
			try {
				await fetchModels();
				return { ok: true };
			} catch (error) {
				const failure = toProviderError(error);
				if (isOllama && failure.message === OLLAMA_DOWN.message) return { ok: false, code: "network", ...OLLAMA_DOWN };
				return healthError(failure, failure.code === "not_authenticated" ? keyFix() : undefined);
			}
		},

		async listModels() {
			try {
				return await fetchModels();
			} catch {
				return [];
			}
		},

		generate(request, signal) {
			return runTextGeneration(request, signal, () => stream(request, signal));
		},
	};

	function keyFix() {
		return `Add your ${info?.label ?? "API"} key in Settings${info?.helpUrl ? `. Create one at ${info.helpUrl.replace(/^https:\/\//, "")}` : ""}.`;
	}
}
