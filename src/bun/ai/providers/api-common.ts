import type {
	GenerationEvent,
	GenerationRequest,
	ProviderErrorCode,
	ProviderHealth,
	Usage,
} from "../../../shared/ai/contract";
import { PROVIDER_TYPES, type ProviderConfig } from "../../../shared/ai/settings";
import { isString } from "../../../shared/guards";
import { objectOr, optionalString, parseJson } from "../../json";
import { createTextProtocolParser } from "../protocol";

export type ApiProviderOptions = {
	config: ProviderConfig;
	/** null when none is stored */
	getApiKey: () => Promise<string | null>;
	fetch?: typeof fetch;
};

export class ProviderError extends Error {
	code: ProviderErrorCode;
	retryable: boolean;
	constructor(code: ProviderErrorCode, message: string, retryable = false) {
		super(message);
		this.name = "ProviderError";
		this.code = code;
		this.retryable = retryable;
	}
}

export function baseUrlFor(config: ProviderConfig): string | null {
	const url = config.baseUrl?.trim() || PROVIDER_TYPES.find((info) => info.type === config.type)?.defaultBaseUrl;

	return url ? url.replace(/\/+$/, "") : null;
}

const CONTEXT_PATTERN = /context|too long|too many tokens|maximum.*tokens|token limit/i;

/** Handles `{error: {message}}`, `{error}`, `{message}` or plain text. */
export function errorMessage(body: string): string {
	try {
		const json = objectOr(parseJson(body));

		if (isString(json.error)) return json.error;

		return optionalString(objectOr(json.error).message) || optionalString(json.message) || body;
	} catch {
		return body;
	}
}

export function errorFromStatus(status: number, message: string): ProviderError {
	const text = message.trim().slice(0, 500) || `HTTP ${status}`;

	if (status === 401 || status === 403) return new ProviderError("not_authenticated", text);

	if (status === 429) return new ProviderError("rate_limited", text, true);

	if (status === 413 || ((status === 400 || status === 422) && CONTEXT_PATTERN.test(text)))
		return new ProviderError("context_too_large", text);

	if (status === 408 || status === 529 || status >= 500) return new ProviderError("unknown", text, true);

	return new ProviderError("unknown", text);
}

export async function errorFromResponse(response: Response): Promise<ProviderError> {
	const body = await response.text().catch(() => "");

	return errorFromStatus(response.status, errorMessage(body));
}

export function toProviderError(cause: unknown, signal?: AbortSignal): ProviderError {
	if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError"))
		return new ProviderError("aborted", "Generation stopped");

	if (cause instanceof ProviderError) return cause;
	const message = cause instanceof Error ? cause.message : String(cause);

	return new ProviderError("network", message || "Network error", true);
}

export const errorEvent = (error: ProviderError): GenerationEvent => ({
	type: "error",
	code: error.code,
	message: error.message,
	retryable: error.retryable,
});

export function healthError(error: ProviderError, fix?: string): ProviderHealth {
	const health: ProviderHealth = { ok: false, code: error.code, message: error.message };

	if (fix) health.fix = fix;

	return health;
}

export type SseEvent = { event?: string; data: string };

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = "";
	let event: string | undefined;
	let data: string[] = [];

	function* lines(final: boolean): Generator<SseEvent> {
		let newline: number;

		while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
			// A lone \r at the end may be the first half of \r\n
			if (buffer[newline] === "\r" && newline === buffer.length - 1 && !final) break;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));

			if (line === "") {
				if (data.length) yield { event, data: data.join("\n") };
				event = undefined;
				data = [];
				continue;
			}

			if (line.startsWith(":")) continue;
			const colon = line.indexOf(":");
			const field = colon === -1 ? line : line.slice(0, colon);
			let value = colon === -1 ? "" : line.slice(colon + 1);

			if (value.startsWith(" ")) value = value.slice(1);

			if (field === "event") event = value;
			else if (field === "data") data.push(value);
		}
	}

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			yield* lines(false);
		}

		buffer += decoder.decode();

		if (buffer) buffer += "\n";
		yield* lines(true);

		if (data.length) yield { event, data: data.join("\n") };
	} finally {
		reader.releaseLock();
	}
}

export type StreamPart =
	| { type: "text"; text: string }
	| { type: "status"; label: string; detail?: string }
	| { type: "usage"; usage: Usage }
	/** `end`, `max_tokens`, `refusal` or the provider's own reason */
	| { type: "stop"; reason: string };

/** No files is `invalid_output`, except an edit answered with text only, which is a reply. */
export async function* runTextGeneration(
	request: GenerationRequest,
	signal: AbortSignal,
	stream: () => AsyncIterable<StreamPart>,
): AsyncGenerator<GenerationEvent> {
	const parser = createTextProtocolParser();
	const usage: Usage = {};
	let stop: string | undefined;

	try {
		if (signal.aborted) throw new ProviderError("aborted", "Generation stopped");

		for await (const part of stream()) {
			if (signal.aborted) throw new ProviderError("aborted", "Generation stopped");

			if (part.type === "text") yield* parser.push(part.text);
			else if (part.type === "status")
				yield part.detail
					? { type: "status", label: part.label, detail: part.detail }
					: { type: "status", label: part.label };
			else if (part.type === "usage")
				Object.assign(usage, Object.fromEntries(Object.entries(part.usage).filter(([, v]) => v !== undefined)));
			else stop = part.reason;
		}

		if (signal.aborted) throw new ProviderError("aborted", "Generation stopped");
	} catch (error) {
		yield errorEvent(toProviderError(error, signal));

		return;
	}

	yield* parser.end();

	if (stop === "refusal") {
		yield errorEvent(new ProviderError("unknown", "The model declined this request."));

		return;
	}

	const changed = parser.written.length + parser.deleted.length;
	const textReply = request.task === "edit" && parser.hasMessage && !parser.truncated.length;

	if (!changed && !textReply) {
		const message =
			stop === "max_tokens" || parser.truncated.length
				? "The model hit its output limit before finishing a file."
				: "The model replied without any files.";

		yield errorEvent(new ProviderError("invalid_output", message, true));

		return;
	}

	yield Object.keys(usage).length ? { type: "done", usage } : { type: "done" };
}
