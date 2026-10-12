import type { Attachment } from "./ai/contract";
import { assetKey } from "./assets";
import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { CanvasImage, Frame } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

export const MOODBOARD_PREFIX = "/moodboard/";

export const MOODBOARD_EXTENSIONS: Record<Attachment["mediaType"], string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

export const MAX_REFERENCES = 6;

export const NEAR_DISTANCE = 600;

export const MOODBOARD_IMAGE_WIDTH = 480;

export const isMoodboardSrc = (src: string) => src.startsWith(MOODBOARD_PREFIX) && assetKey(src) === src;

export function normalizeImages(raw: Json | undefined): CanvasImage[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const images: CanvasImage[] = [];

	for (const entry of raw) {
		if (!isJsonObject(entry) || !isString(entry.id) || !isString(entry.src) || seen.has(entry.id)) continue;
		const { x, y, width, height } = entry;

		if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) continue;

		if (width <= 0 || height <= 0 || !isMoodboardSrc(entry.src)) continue;
		seen.add(entry.id);
		images.push({
			id: entry.id,
			src: entry.src,
			name: isString(entry.name) ? entry.name : "image",
			x,
			y,
			width,
			height,
		});
	}

	return images;
}

export function gapBetween(a: Rect, b: Rect) {
	const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
	const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);

	return Math.hypot(dx, dy);
}

export function nearestScreen(image: Rect, frames: Frame[]): { file: string; gap: number } | null {
	let closest: { file: string; gap: number } | null = null;

	for (const frame of frames) {
		const gap = gapBetween(image, frame);

		if (!closest || gap < closest.gap) closest = { file: frame.file, gap };
	}

	return closest && closest.gap <= NEAR_DISTANCE ? closest : null;
}

export function imageBeside(file: string, images: CanvasImage[], frames: Frame[]): CanvasImage | null {
	let best: { image: CanvasImage; gap: number } | null = null;

	for (const image of images) {
		const closest = nearestScreen(image, frames);

		if (closest?.file === file && (!best || closest.gap < best.gap)) best = { image, gap: closest.gap };
	}

	return best?.image ?? null;
}

const readingOrder = (a: CanvasImage, b: CanvasImage) => a.y - b.y || a.x - b.x;

export function moodboardReferences(images: CanvasImage[], frames: Frame[], targets: string[]): CanvasImage[] {
	if (!targets.length) return [...images].sort(readingOrder).slice(0, MAX_REFERENCES);

	const near = images.flatMap((image) => {
		const closest = nearestScreen(image, frames);

		return closest && targets.includes(closest.file) ? [{ image, gap: closest.gap }] : [];
	});

	return near
		.sort((a, b) => a.gap - b.gap)
		.slice(0, MAX_REFERENCES)
		.map((entry) => entry.image)
		.sort(readingOrder);
}

export function fitImage(width: number, height: number) {
	const scale = width > MOODBOARD_IMAGE_WIDTH ? MOODBOARD_IMAGE_WIDTH / width : 1;

	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
