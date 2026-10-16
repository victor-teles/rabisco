import { describe, expect, test } from "bun:test";
import type { ProviderType } from "../../../shared/ai/settings";
import { OPENAI_IMAGE_MODEL, OPENROUTER_IMAGE_MODEL, parseImageDataUrl } from "./images";
import { createMockProvider } from "./mock";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { fakeFetch } from "./test-sse";

const providerFor = (type: ProviderType, handler: Parameters<typeof fakeFetch>[0]) => {
	const fake = fakeFetch(handler);

	const provider = createOpenAICompatibleProvider({
		config: { id: type, type, label: type, enabled: true },
		getApiKey: async () => "sk-test",
		fetch: fake.fetch,
	});

	return { provider, requests: fake.requests };
};

const signal = new AbortController().signal;

describe("image generation", () => {
	test("OpenAI calls the images endpoint with the aspect's size", async () => {
		const { provider, requests } = providerFor("openai", () => Response.json({ data: [{ b64_json: "cG5n" }] }));
		const image = await provider.generateImage!({ prompt: "A bowl of ramen", aspect: "portrait" }, signal);

		expect(image).toEqual({ mediaType: "image/png", data: "cG5n" });
		expect(requests[0]!.url).toBe("https://api.openai.com/v1/images/generations");
		expect(requests[0]!.body).toMatchObject({
			model: OPENAI_IMAGE_MODEL,
			prompt: "A bowl of ramen",
			size: "1024x1536",
		});
	});

	test("OpenRouter asks a chat model for an image and reads the data URL", async () => {
		const { provider, requests } = providerFor("openrouter", () =>
			Response.json({
				choices: [{ message: { images: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,anBn" } }] } }],
			}),
		);

		const image = await provider.generateImage!({ prompt: "A forest", aspect: "landscape" }, signal);

		expect(image).toEqual({ mediaType: "image/jpeg", data: "anBn" });
		expect(requests[0]!.body).toMatchObject({ model: OPENROUTER_IMAGE_MODEL, modalities: ["image", "text"] });
	});

	test("errors keep the provider's codes", async () => {
		const { provider } = providerFor("openai", () => new Response("bad key", { status: 401 }));

		await expect(provider.generateImage!({ prompt: "x", aspect: "square" }, signal)).rejects.toMatchObject({
			code: "not_authenticated",
		});

		const empty = providerFor("openai", () => Response.json({ data: [] })).provider;

		await expect(empty.generateImage!({ prompt: "x", aspect: "square" }, signal)).rejects.toMatchObject({
			code: "invalid_output",
		});
	});

	test("endpoints without an image model don't offer it", () => {
		expect(providerFor("ollama", () => Response.json({})).provider.generateImage).toBeUndefined();
		expect(providerFor("openai-compatible", () => Response.json({})).provider.generateImage).toBeUndefined();
	});

	test("the mock draws an SVG", async () => {
		const image = await createMockProvider({ delayMs: 0 }).generateImage!(
			{ prompt: "Café <b>", aspect: "square" },
			signal,
		);

		expect(image.mediaType).toBe("image/svg+xml");
		expect(atob(image.data)).toContain('width="1024" height="1024"');
		expect(atob(image.data)).toContain("Caf &#60;b&#62;");
	});

	test("parseImageDataUrl accepts only raster images", () => {
		expect(parseImageDataUrl("data:image/webp;base64,AAAA")).toEqual({ mediaType: "image/webp", data: "AAAA" });
		expect(parseImageDataUrl("data:text/html;base64,AAAA")).toBeNull();
	});
});
