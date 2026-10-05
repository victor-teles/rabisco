import { describe, expect, test } from "bun:test";
import type { GenerationEvent, GenerationRequest, ProviderErrorCode } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { ANTHROPIC_FALLBACK_MODELS, createAnthropicProvider } from "./anthropic";
import type { Json } from "../../../shared/json";
import { chunked, collect, fakeFetch, sse, streamOf } from "./test-sse";

const config: ProviderConfig = { id: "anthropic", type: "anthropic", label: "Anthropic", enabled: true };

const request: GenerationRequest = {
	id: "g1",
	task: "create",
	model: "claude-sonnet-5-5",
	prompt: "A welcome screen",
	device: "mobile",
	context: { product: "Habits" },
	files: [],
	attachments: [{ name: "sketch.png", mediaType: "image/png", data: "AAAA" }],
	history: [
		{ role: "assistant", content: "Welcome to Rabisco" },
		{ role: "user", content: "Earlier ask" },
		{ role: "assistant", content: "Earlier answer" },
	],
};

const reply =
	'Here it is.\n<rabisco-file path="screens/welcome.tsx" kind="screen" name="Welcome" device="mobile">\nexport default function Welcome() {\n\treturn <div className="h-full" />;\n}\n</rabisco-file>';

const textEvents = (text: string) => [
	{ type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 1 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
	...chunked(text, 5).map((piece) => ({
		type: "content_block_delta",
		index: 1,
		delta: { type: "text_delta", text: piece },
	})),
	{ type: "content_block_stop", index: 1 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
	{ type: "message_stop" },
];

const sseResponse = (events: Json[], signal?: AbortSignal | null) =>
	new Response(streamOf(chunked(sse(events, true), 13), signal), { headers: { "content-type": "text/event-stream" } });

const provider = (handler: Parameters<typeof fakeFetch>[0], key: string | null = "sk-test") => {
	const fake = fakeFetch(handler);

	return {
		provider: createAnthropicProvider({ config, getApiKey: async () => key, fetch: fake.fetch }),
		requests: fake.requests,
	};
};

describe("anthropic provider", () => {
	test("streams a generation", async () => {
		const { provider: p, requests } = provider(({ init }) => sseResponse(textEvents(reply), init.signal));
		const events = await collect(p.generate(request, new AbortController().signal));

		const { url, init, body } = requests[0]!;
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		expect(init.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
		expect(body).toMatchObject({ model: "claude-sonnet-5-5", stream: true, max_tokens: 32000 });
		expect(body.system[0].text).toContain("<rabisco-file");
		// Leading assistant turn dropped; history kept in order; request last with the image first
		expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
		const last = body.messages[2].content;
		expect(last[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
		expect(last[1].text).toContain("<product>");

		expect(events[0]).toEqual({ type: "status", label: "Thinking" });
		expect(events.filter((e) => e.type === "file.end")).toEqual([
			{
				type: "file.end",
				path: "screens/welcome.tsx",
				content: 'export default function Welcome() {\n\treturn <div className="h-full" />;\n}\n',
			},
		]);
		expect(events.find((e) => e.type === "file.start")).toEqual({
			type: "file.start",
			path: "screens/welcome.tsx",
			kind: "screen",
			screen: { name: "Welcome", device: "mobile" },
		});
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 120, outputTokens: 42 } });
	});

	test("no key is not_authenticated", async () => {
		const { provider: p, requests } = provider(() => new Response("{}"), null);
		const events = await collect(p.generate(request, new AbortController().signal));
		expect(events).toEqual([
			{ type: "error", code: "not_authenticated", message: "No Anthropic API key", retryable: false },
		]);
		expect(requests).toHaveLength(0);
		expect(await p.health()).toMatchObject({
			ok: false,
			code: "not_authenticated",
			fix: expect.stringContaining("API key"),
		});
	});

	test("HTTP errors map to codes", async () => {
		const cases: [number, string, ProviderErrorCode, boolean][] = [
			[401, "invalid x-api-key", "not_authenticated", false],
			[429, "rate limited", "rate_limited", true],
			[400, "prompt is too long: 250000 tokens > 200000 maximum", "context_too_large", false],
		];

		for (const [status, message, code, retryable] of cases) {
			const { provider: p } = provider(
				() => new Response(JSON.stringify({ type: "error", error: { type: "x", message } }), { status }),
			);

			const events = await collect(p.generate(request, new AbortController().signal));
			expect(events).toEqual([{ type: "error", code, message, retryable }]);
		}
	});

	test("network failure is retryable", async () => {
		const { provider: p } = provider(() => {
			throw new TypeError("Unable to connect");
		});

		const events = await collect(p.generate(request, new AbortController().signal));
		expect(events).toEqual([{ type: "error", code: "network", message: "Unable to connect", retryable: true }]);
	});

	test("an error event mid-stream ends with error", async () => {
		const events = [
			...textEvents(reply).slice(0, 6),
			{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
		];

		const { provider: p } = provider(({ init }) => sseResponse(events, init.signal));
		const out = await collect(p.generate(request, new AbortController().signal));
		expect(out.at(-1)).toEqual({ type: "error", code: "rate_limited", message: "Overloaded", retryable: true });
		expect(out.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
	});

	test("max_tokens mid-file ends with invalid_output and a truncation status", async () => {
		const events = textEvents(reply.slice(0, 120)).map((e) =>
			e.type === "message_delta" ? { ...e, delta: { stop_reason: "max_tokens" } } : e,
		);

		const { provider: p } = provider(({ init }) => sseResponse(events, init.signal));
		const out = await collect(p.generate(request, new AbortController().signal));
		expect(out.some((e) => e.type === "file.end")).toBe(false);
		expect(out.at(-2)).toEqual({ type: "status", label: "File cut off", detail: "screens/welcome.tsx" });
		expect(out.at(-1)).toMatchObject({ type: "error", code: "invalid_output", retryable: true });
	});

	test("abort stops the stream promptly with aborted", async () => {
		const controller = new AbortController();

		const { provider: p } = provider(
			({ init }) => new Response(streamOf(chunked(sse(textEvents(reply), true), 13), init.signal, 5)),
		);

		const out: GenerationEvent[] = [];

		for await (const event of p.generate(request, controller.signal)) {
			out.push(event);

			if (event.type === "file.start") controller.abort();
		}

		expect(out.at(-1)).toEqual({ type: "error", code: "aborted", message: "Generation stopped", retryable: false });
		expect(out.some((e) => e.type === "file.end")).toBe(false);
	});

	test("listModels uses /v1/models and falls back to the static list", async () => {
		const { provider: p, requests } = provider(() =>
			Response.json({ data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }], has_more: false }),
		);

		expect(await p.listModels()).toEqual([{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }]);
		expect(requests[0]!.url).toStartWith("https://api.anthropic.com/v1/models");
		expect(await p.health()).toEqual({ ok: true });

		const { provider: down } = provider(() => new Response("nope", { status: 500 }));
		expect(await down.listModels()).toEqual(ANTHROPIC_FALLBACK_MODELS);
		expect(await down.health()).toMatchObject({ ok: false, code: "unknown" });
	});

	test("capabilities", () => {
		const { provider: p } = provider(() => new Response());
		expect(p.capabilities).toEqual({ streaming: true, images: true, agentic: false, maxContextTokens: 200_000 });
		expect(p.kind).toBe("api");
		expect(p.id).toBe("anthropic");
	});
});
