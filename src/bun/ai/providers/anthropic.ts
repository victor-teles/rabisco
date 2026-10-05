/**
 * Anthropic Messages API provider: plain fetch + SSE, text protocol output.
 * https://docs.anthropic.com/en/api/messages-streaming
 */

import type { GenerationRequest, Provider, ProviderModel } from "../../../shared/ai/contract";
import { systemPrompt, userPrompt } from "../prompt";
import {
	type ApiProviderOptions,
	baseUrlFor,
	errorFromResponse,
	healthError,
	ProviderError,
	readSse,
	runTextGeneration,
	type StreamPart,
	toProviderError,
} from "./api-common";

const API_VERSION = "2023-06-01";
const MAX_TOKENS = 32_000;
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Shown when `/v1/models` can't be reached */
export const ANTHROPIC_FALLBACK_MODELS: ProviderModel[] = [
	{ id: "claude-opus-5-5", label: "Opus 5.5" },
	{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
	{ id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const KEY_FIX = "Add your Anthropic API key in Settings. Create one at console.anthropic.com/settings/keys.";

type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } };

type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

/** History as alternating messages starting with a user turn, then the request as the last user turn. */
export function anthropicMessages(request: GenerationRequest): Message[] {
	const history = (request.history ?? []).filter((turn) => turn.content.trim());
	while (history[0]?.role === "assistant") history.shift();
	const messages: Message[] = history.map((turn) => ({ role: turn.role, content: turn.content }));
	const content: ContentBlock[] = (request.attachments ?? []).map((image) => ({
		type: "image",
		source: { type: "base64", media_type: image.mediaType, data: image.data },
	}));
	content.push({ type: "text", text: userPrompt(request, "text") });
	messages.push({ role: "user", content });
	return messages;
}

type AnthropicEvent = {
	type: string;
	message?: { usage?: Usage };
	content_block?: { type: string };
	delta?: { type?: string; text?: string; stop_reason?: string | null };
	usage?: Usage;
	error?: { type?: string; message?: string };
};
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

const inputTokens = (usage: Usage) => (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

function streamError(error: AnthropicEvent["error"]): ProviderError {
	const message = error?.message || "The Anthropic stream failed";
	switch (error?.type) {
		case "overloaded_error":
		case "rate_limit_error":
			return new ProviderError("rate_limited", message, true);
		case "authentication_error":
		case "permission_error":
			return new ProviderError("not_authenticated", message);
		case "request_too_large":
			return new ProviderError("context_too_large", message);
		case "api_error":
			return new ProviderError("unknown", message, true);
		default:
			return new ProviderError(/context|too long/i.test(message) ? "context_too_large" : "unknown", message);
	}
}

export function createAnthropicProvider(options: ApiProviderOptions): Provider {
	const { config, getApiKey } = options;
	const fetcher = options.fetch ?? fetch;
	const base = baseUrlFor(config) ?? "https://api.anthropic.com";

	const headers = (key: string) => ({
		"content-type": "application/json",
		"x-api-key": key,
		"anthropic-version": API_VERSION,
	});

	async function requireKey() {
		const key = await getApiKey();
		if (!key) throw new ProviderError("not_authenticated", "No Anthropic API key");
		return key;
	}

	async function fetchModels(key: string, signal?: AbortSignal): Promise<ProviderModel[]> {
		const response = await fetcher(`${base}/v1/models?limit=100`, { headers: headers(key), signal });
		if (!response.ok) throw await errorFromResponse(response);
		const json = (await response.json()) as { data?: { id: string; display_name?: string }[] };
		return (json.data ?? []).map((model) => ({ id: model.id, label: model.display_name || model.id }));
	}

	async function* stream(request: GenerationRequest, signal: AbortSignal): AsyncGenerator<StreamPart> {
		const key = await requireKey();
		const response = await fetcher(`${base}/v1/messages`, {
			method: "POST",
			headers: headers(key),
			signal,
			body: JSON.stringify({
				model: request.model || config.defaultModel || DEFAULT_ANTHROPIC_MODEL,
				max_tokens: MAX_TOKENS,
				stream: true,
				// The system prompt is the stable prefix of every request in a project
				system: [{ type: "text", text: systemPrompt(request, "text"), cache_control: { type: "ephemeral" } }],
				messages: anthropicMessages(request),
			}),
		});
		if (!response.ok) throw await errorFromResponse(response);
		if (!response.body) throw new ProviderError("network", "Empty response from Anthropic", true);

		for await (const sse of readSse(response.body)) {
			let event: AnthropicEvent;
			try {
				event = JSON.parse(sse.data) as AnthropicEvent;
			} catch {
				continue;
			}
			switch (event.type) {
				case "message_start":
					if (event.message?.usage) yield { type: "usage", usage: { inputTokens: inputTokens(event.message.usage) } };
					break;
				case "content_block_start":
					if (event.content_block?.type === "thinking" || event.content_block?.type === "redacted_thinking") yield { type: "status", label: "Thinking" };
					break;
				case "content_block_delta":
					if (event.delta?.type === "text_delta" && event.delta.text) yield { type: "text", text: event.delta.text };
					break;
				case "message_delta":
					if (event.usage?.output_tokens !== undefined) yield { type: "usage", usage: { outputTokens: event.usage.output_tokens } };
					if (event.delta?.stop_reason) yield { type: "stop", reason: event.delta.stop_reason === "end_turn" ? "end" : event.delta.stop_reason };
					break;
				case "error":
					throw streamError(event.error);
			}
		}
	}

	return {
		id: config.id,
		kind: "api",
		label: config.label,
		capabilities: { streaming: true, images: true, agentic: false, maxContextTokens: 200_000 },

		async health() {
			const key = await getApiKey();
			if (!key) return { ok: false, code: "not_authenticated", message: "No Anthropic API key", fix: KEY_FIX };
			try {
				await fetchModels(key);
				return { ok: true };
			} catch (error) {
				const failure = toProviderError(error);
				return healthError(failure, failure.code === "not_authenticated" ? KEY_FIX : undefined);
			}
		},

		async listModels() {
			try {
				const key = await getApiKey();
				if (!key) return ANTHROPIC_FALLBACK_MODELS;
				const models = await fetchModels(key);
				return models.length ? models : ANTHROPIC_FALLBACK_MODELS;
			} catch {
				return ANTHROPIC_FALLBACK_MODELS;
			}
		},

		generate(request, signal) {
			return runTextGeneration(request, signal, () => stream(request, signal));
		},
	};
}
