import type { GeneratedImage, ImageAspect, ImageRequest } from "../../../shared/ai/contract";
import type { JsonObject } from "../../../shared/json";
import { arrayOr, objectOr, optionalString } from "../../json";
import { ProviderError } from "./api-common";

export type PostJson = (path: string, body: JsonObject) => Promise<JsonObject>;

export type ImageMaker = (post: PostJson, request: ImageRequest) => Promise<GeneratedImage>;

export const OPENAI_IMAGE_MODEL = "gpt-image-1";

export const OPENROUTER_IMAGE_MODEL = "google/gemini-2.5-flash-image";

const OPENAI_SIZES: Record<ImageAspect, string> = {
	square: "1024x1024",
	landscape: "1536x1024",
	portrait: "1024x1536",
};

const ASPECT_WORDS: Record<ImageAspect, string> = {
	square: "Square image (1:1).",
	landscape: "Landscape image (3:2).",
	portrait: "Portrait image (2:3).",
};

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const noImage = () => new ProviderError("invalid_output", "The image model sent no image");

export const openAIImage: ImageMaker = async (post, request) => {
	const json = await post("/images/generations", {
		model: OPENAI_IMAGE_MODEL,
		prompt: request.prompt,
		size: OPENAI_SIZES[request.aspect],
		n: 1,
	});

	const data = optionalString(objectOr(arrayOr(json.data)[0]).b64_json);

	if (!data) throw noImage();

	return { mediaType: "image/png", data };
};

export function parseImageDataUrl(url: string): GeneratedImage | null {
	const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
	const mediaType = MEDIA_TYPES.find((type) => type === match?.[1]);

	return match && mediaType ? { mediaType, data: match[2]! } : null;
}

export const openRouterImage: ImageMaker = async (post, request) => {
	const json = await post("/chat/completions", {
		model: OPENROUTER_IMAGE_MODEL,
		modalities: ["image", "text"],
		messages: [{ role: "user", content: `${request.prompt}\n\n${ASPECT_WORDS[request.aspect]}` }],
	});

	const message = objectOr(objectOr(arrayOr(json.choices)[0]).message);
	const url = optionalString(objectOr(objectOr(arrayOr(message.images)[0]).image_url).url);
	const image = url ? parseImageDataUrl(url) : null;

	if (!image) throw noImage();

	return image;
};
