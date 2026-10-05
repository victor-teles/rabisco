import { describe, expect, test } from "bun:test";
import type { GenerationRequest } from "../../../shared/ai/contract";
import type { ProviderConfig, ProviderType } from "../../../shared/ai/settings";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { chunked, collect, fakeFetch, sse, streamOf } from "./test-sse";

const configFor = (type: ProviderType, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({ id: type, type, label: type, enabled: true, ...extra });

const request: GenerationRequest = {
	id: "g1",
	task: "create",
	model: "gpt-5",
	prompt: "A welcome screen",
	device: "desktop",
	context: {},
	files: [],
	history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
};

const reply = 'Done.\n<rabisco-file path="components/nav.tsx">\nexport function Nav() {\n\treturn null;\n}\n</rabisco-file>';

const chunks = (text: string, usage = true) => [
	...chunked(text, 6).map((piece, i) => ({ choices: [{ index: 0, delta: i === 0 ? { role: "assistant", content: piece } : { content: piece }, finish_reason: null }] })),
	{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	...(usage ? [{ choices: [], usage: { prompt_tokens: 50, completion_tokens: 30, cost: 0.002 } }] : []),
	"[DONE]",
];

const sseResponse = (events: unknown[], signal?: AbortSignal | null) => new Response(streamOf(chunked(sse(events), 11), signal), { headers: { "content-type": "text/event-stream" } });

const make = (config: ProviderConfig, handler: Parameters<typeof fakeFetch>[0], key: string | null = "sk-test") => {
	const fake = fakeFetch(handler);
	return { provider: createOpenAICompatibleProvider({ config, getApiKey: async () => key, fetch: fake.fetch }), requests: fake.requests };
};

describe("openai-compatible provider", () => {
	test("streams a generation from OpenAI", async () => {
		const { provider, requests } = make(configFor("openai"), ({ init }) => sseResponse(chunks(reply), init.signal));
		const events = await collect(provider.generate(request, new AbortController().signal));

		const { url, init, body } = requests[0]!;
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
		expect(init.headers).toMatchObject({ authorization: "Bearer sk-test" });
		expect(body).toMatchObject({ model: "gpt-5", stream: true, stream_options: { include_usage: true } });
		expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
		expect(body.messages[0].content).toContain("<rabisco-file");

		expect(events[0]).toEqual({ type: "message.delta", text: "Done.\n" });
		expect(events.find((e) => e.type === "file.start")).toEqual({ type: "file.start", path: "components/nav.tsx", kind: "component" });
		expect(events.find((e) => e.type === "file.end")).toEqual({ type: "file.end", path: "components/nav.tsx", content: "export function Nav() {\n\treturn null;\n}\n" });
		expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 50, outputTokens: 30, costUsd: 0.002 } });
	});

	test("OpenRouter sends attribution headers and images as data URLs", async () => {
		const { provider, requests } = make(configFor("openrouter"), ({ init }) => sseResponse(chunks(reply), init.signal));
		const withImage = { ...request, attachments: [{ name: "a.png", mediaType: "image/png" as const, data: "AAAA" }] };
		await collect(provider.generate(withImage, new AbortController().signal));
		const { url, init, body } = requests[0]!;
		expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(init.headers).toMatchObject({ "X-Title": "Rabisco", "HTTP-Referer": expect.any(String) });
		const content = body.messages.at(-1).content;
		expect(content[0].type).toBe("text");
		expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
		expect(provider.capabilities.images).toBe(true);
	});

	test("missing key: OpenAI fails, Ollama goes without", async () => {
		const openai = make(configFor("openai"), () => new Response(), null);
		const events = await collect(openai.provider.generate(request, new AbortController().signal));
		expect(events).toEqual([{ type: "error", code: "not_authenticated", message: "No OpenAI key", retryable: false }]);
		expect(await openai.provider.health()).toMatchObject({ ok: false, code: "not_authenticated", fix: expect.stringContaining("key") });

		const ollama = make(configFor("ollama"), ({ init }) => sseResponse(chunks(reply), init.signal), null);
		const out = await collect(ollama.provider.generate({ ...request, model: "qwen3-coder:30b" }, new AbortController().signal));
		expect(out.at(-1)?.type).toBe("done");
		expect(ollama.requests[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
		expect(ollama.requests[0]!.init.headers).not.toHaveProperty("authorization");
		expect(ollama.provider.capabilities.images).toBe(false);
	});

	test("retries without stream_options when the server rejects it", async () => {
		const { provider, requests } = make(configFor("openai-compatible", { baseUrl: "http://localhost:1234/v1" }), ({ body, init }) =>
			body.stream_options
				? new Response(JSON.stringify({ error: { message: "Unrecognized request argument: stream_options" } }), { status: 400 })
				: sseResponse(chunks(reply, false), init.signal),
		);
		const events = await collect(provider.generate(request, new AbortController().signal));
		expect(requests).toHaveLength(2);
		expect(requests[1]!.body.stream_options).toBeUndefined();
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("other 400s are errors", async () => {
		const { provider } = make(configFor("openai"), () => new Response(JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens" } }), { status: 400 }));
		const events = await collect(provider.generate(request, new AbortController().signal));
		expect(events).toEqual([{ type: "error", code: "context_too_large", message: "This model's maximum context length is 128000 tokens", retryable: false }]);
	});

	test("an error chunk mid-stream ends with error", async () => {
		const events = [...chunks(reply).slice(0, 3), { error: { message: "Rate limit exceeded", code: 429 } }];
		const { provider } = make(configFor("openrouter"), ({ init }) => sseResponse(events, init.signal));
		const out = await collect(provider.generate(request, new AbortController().signal));
		expect(out.at(-1)).toEqual({ type: "error", code: "rate_limited", message: "Rate limit exceeded", retryable: true });
	});

	test("finish_reason length mid-file is invalid_output", async () => {
		const events = [...chunks(reply.slice(0, 60)).slice(0, -3), { choices: [{ index: 0, delta: {}, finish_reason: "length" }] }, "[DONE]"];
		const { provider } = make(configFor("openai"), ({ init }) => sseResponse(events, init.signal));
		const out = await collect(provider.generate(request, new AbortController().signal));
		expect(out.at(-1)).toMatchObject({ type: "error", code: "invalid_output", message: expect.stringContaining("output limit") });
	});

	test("reasoning deltas become one status", async () => {
		const events = [{ choices: [{ delta: { reasoning: "hm" } }] }, { choices: [{ delta: { reasoning: "more" } }] }, ...chunks(reply)];
		const { provider } = make(configFor("openrouter"), ({ init }) => sseResponse(events, init.signal));
		const out = await collect(provider.generate(request, new AbortController().signal));
		expect(out.filter((e) => e.type === "status")).toEqual([{ type: "status", label: "Thinking" }]);
	});

	test("abort ends with aborted", async () => {
		const controller = new AbortController();
		const { provider } = make(configFor("openai"), ({ init }) => new Response(streamOf(chunked(sse(chunks(reply)), 11), init.signal, 5)));
		const out = [];
		for await (const event of provider.generate(request, controller.signal)) {
			out.push(event);
			if (event.type === "message.delta") controller.abort();
		}
		expect(out.at(-1)).toEqual({ type: "error", code: "aborted", message: "Generation stopped", retryable: false });
	});

	test("Ollama not running", async () => {
		const { provider } = make(configFor("ollama"), () => {
			throw new TypeError("Unable to connect. Is the computer able to access the url?");
		});
		expect(await provider.health()).toEqual({
			ok: false,
			code: "network",
			message: "Ollama isn't running",
			fix: "Start Ollama (ollama serve) or install it from ollama.com",
		});
		const events = await collect(provider.generate({ ...request, model: "llama3" }, new AbortController().signal));
		expect(events).toEqual([{ type: "error", code: "network", message: "Ollama isn't running", retryable: true }]);
		expect(await provider.listModels()).toEqual([]);
	});

	test("openai-compatible without a base URL", async () => {
		const { provider, requests } = make(configFor("openai-compatible"), () => new Response());
		expect(await provider.health()).toMatchObject({ ok: false, code: "unknown", fix: expect.stringContaining("base URL") });
		const events = await collect(provider.generate(request, new AbortController().signal));
		expect(events.at(-1)).toMatchObject({ type: "error", code: "unknown" });
		expect(requests).toHaveLength(0);
	});

	test("no model selected", async () => {
		const { provider } = make(configFor("openai"), () => new Response());
		const events = await collect(provider.generate({ ...request, model: "" }, new AbortController().signal));
		expect(events).toEqual([{ type: "error", code: "unknown", message: "No model selected", retryable: false }]);
	});

	test("listModels and health use /models", async () => {
		const { provider, requests } = make(configFor("openrouter"), () =>
			Response.json({ data: [{ id: "z/model", name: "Zed" }, { id: "a/model" }] }),
		);
		expect(await provider.listModels()).toEqual([
			{ id: "a/model", label: "a/model" },
			{ id: "z/model", label: "Zed" },
		]);
		expect(requests[0]!.url).toBe("https://openrouter.ai/api/v1/models");
		expect(await provider.health()).toEqual({ ok: true });

		const bad = make(configFor("openai"), () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
		expect(await bad.provider.health()).toMatchObject({ ok: false, code: "not_authenticated", message: "Incorrect API key" });
	});
});
