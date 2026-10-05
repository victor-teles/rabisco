import { describe, expect, test } from "bun:test";
import type { GenerationRequest } from "../../../shared/ai/contract";
import { baseUrlFor, errorFromStatus, ProviderError, readSse, runTextGeneration, type StreamPart, toProviderError } from "./api-common";
import { collect, streamOf } from "./test-sse";

describe("readSse", () => {
	const text = "event: a\ndata: one\n\n: comment\ndata: two\r\ndata: lines\r\n\r\ndata:three\n\ndata: last";
	const expected = [
		{ event: "a", data: "one" },
		{ event: undefined, data: "two\nlines" },
		{ event: undefined, data: "three" },
		{ event: undefined, data: "last" },
	];

	test("parses events, comments, multi-line data and CRLF", async () => {
		expect(await collect(readSse(streamOf([text])))).toEqual(expected);
	});

	test("any chunking gives the same events", async () => {
		expect(await collect(readSse(streamOf([...text])))).toEqual(expected);
		for (let i = 1; i < text.length; i++) {
			expect(await collect(readSse(streamOf([text.slice(0, i), text.slice(i)])))).toEqual(expected);
		}
	});

	test("decodes multi-byte characters split across chunks", async () => {
		const bytes = new TextEncoder().encode("data: olá ✓\n\n");
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
				controller.close();
			},
		});
		expect(await collect(readSse(body))).toEqual([{ event: undefined, data: "olá ✓" }]);
	});
});

describe("errors", () => {
	test("maps HTTP statuses", () => {
		expect(errorFromStatus(401, "bad key")).toMatchObject({ code: "not_authenticated", retryable: false });
		expect(errorFromStatus(403, "")).toMatchObject({ code: "not_authenticated", message: "HTTP 403" });
		expect(errorFromStatus(429, "slow down")).toMatchObject({ code: "rate_limited", retryable: true });
		expect(errorFromStatus(413, "big")).toMatchObject({ code: "context_too_large" });
		expect(errorFromStatus(400, "prompt is too long: 300000 tokens")).toMatchObject({ code: "context_too_large" });
		expect(errorFromStatus(400, "This model's maximum context length is 8192 tokens")).toMatchObject({ code: "context_too_large" });
		expect(errorFromStatus(400, "bad field")).toMatchObject({ code: "unknown", retryable: false });
		expect(errorFromStatus(529, "overloaded")).toMatchObject({ code: "unknown", retryable: true });
	});

	test("maps thrown values", () => {
		expect(toProviderError(new TypeError("fetch failed"))).toMatchObject({ code: "network", retryable: true });
		expect(toProviderError(new DOMException("x", "AbortError"))).toMatchObject({ code: "aborted", retryable: false });
		const controller = new AbortController();
		controller.abort();
		expect(toProviderError(new Error("whatever"), controller.signal)).toMatchObject({ code: "aborted" });
		const own = new ProviderError("rate_limited", "x", true);
		expect(toProviderError(own)).toBe(own);
	});

	test("base URL from config or type default", () => {
		expect(baseUrlFor({ id: "a", type: "anthropic", label: "A", enabled: true })).toBe("https://api.anthropic.com");
		expect(baseUrlFor({ id: "o", type: "ollama", label: "O", enabled: true, baseUrl: "http://box:11434/v1/" })).toBe("http://box:11434/v1");
		expect(baseUrlFor({ id: "c", type: "openai-compatible", label: "C", enabled: true })).toBeNull();
	});
});

describe("runTextGeneration", () => {
	const request = (task: GenerationRequest["task"]): GenerationRequest => ({ id: "g", task, model: "m", prompt: "p", device: "mobile", context: {}, files: [] });
	const run = (task: GenerationRequest["task"], parts: StreamPart[], signal = new AbortController().signal) =>
		collect(
			runTextGeneration(request(task), signal, async function* () {
				yield* parts;
			}),
		);
	const file = '<rabisco-file path="screens/a.tsx">\nx\n</rabisco-file>';

	test("ends with done and usage", async () => {
		const events = await run("create", [
			{ type: "usage", usage: { inputTokens: 10 } },
			{ type: "text", text: file },
			{ type: "usage", usage: { outputTokens: 5 } },
		]);
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 10, outputTokens: 5 } });
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
	});

	test("zero files on create is invalid_output", async () => {
		const events = await run("create", [{ type: "text", text: "Sure! What colors?" }]);
		expect(events.at(-1)).toMatchObject({ type: "error", code: "invalid_output", retryable: true });
	});

	test("an edit answered with text only is a reply", async () => {
		const events = await run("edit", [{ type: "text", text: "It's blue because of DESIGN.md." }]);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("a truncated file with nothing else is invalid_output", async () => {
		const events = await run("create", [{ type: "text", text: '<rabisco-file path="screens/a.tsx">\nx' }, { type: "stop", reason: "max_tokens" }]);
		expect(events.at(-2)).toMatchObject({ type: "status", detail: "screens/a.tsx" });
		expect(events.at(-1)).toMatchObject({ type: "error", code: "invalid_output", message: expect.stringContaining("output limit") });
	});

	test("refusal is an error", async () => {
		const events = await run("create", [{ type: "text", text: file }, { type: "stop", reason: "refusal" }]);
		expect(events.at(-1)).toMatchObject({ type: "error", code: "unknown" });
	});

	test("a thrown error ends the stream", async () => {
		const events = await collect(
			runTextGeneration(request("create"), new AbortController().signal, async function* () {
				yield { type: "text", text: "hi" } as StreamPart;
				throw new ProviderError("rate_limited", "429", true);
			}),
		);
		expect(events).toEqual([
			{ type: "message.delta", text: "hi" },
			{ type: "error", code: "rate_limited", message: "429", retryable: true },
		]);
	});

	test("an aborted signal ends with aborted", async () => {
		const controller = new AbortController();
		const events = await collect(
			runTextGeneration(request("create"), controller.signal, async function* () {
				yield { type: "text", text: "hi" } as StreamPart;
				controller.abort();
				yield { type: "text", text: file } as StreamPart;
			}),
		);
		expect(events.at(-1)).toEqual({ type: "error", code: "aborted", message: "Generation stopped", retryable: false });
		expect(events.some((e) => e.type === "file.end")).toBe(false);
	});
});
