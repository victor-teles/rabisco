import { imageBeside, nearestScreen } from "./moodboard";
import type { CanvasImage, Device, Frame } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

export const RECREATE_GAP = 80;

const PHONE_MAX_WIDTH = 1320;

const TABLET_MIN_RATIO = 0.65;

const MIN_HEIGHT = 200;

const MAX_HEIGHT_RATIO = 8;

const SAMPLE_WIDTH = 160;

const TOLERANCE = 24;

export function recreateDevice(width: number, height: number): Device {
	const ratio = width / Math.max(1, height);

	if (ratio >= 1) return "desktop";

	if (ratio >= TABLET_MIN_RATIO) return "tablet";

	return width > PHONE_MAX_WIDTH ? "desktop" : "mobile";
}

export const recreatePrompt = (name: string) =>
	[
		`Recreate the screenshot in Image 1 (${name}) as one new, editable screen.`,
		"Match it as closely as you can: the layout and alignment, the spacing, the colors, the type sizes and weights, the corner radii, the borders and shadows, and the copy word for word.",
		"Build it from real elements: text as text, buttons as buttons, inputs as inputs, lists as lists. Use the project's components and tokens where they match the screenshot, and Tailwind arbitrary values where they don't.",
		"Draw photos, illustrations, avatars and logos with the placeholder component, at the same size and place.",
		"Name the screen after what it shows.",
	].join("\n");

export const recreateNote = (name: string) => `Recreate ${name} as a screen`;

const overlaps = (a: Rect, b: Rect) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function besideImage(frame: Frame, image: CanvasImage, taken: Rect[]): Frame {
	const tall = Math.round((frame.width * image.height) / Math.max(1, image.width));
	const height = Math.min(frame.width * MAX_HEIGHT_RATIO, Math.max(MIN_HEIGHT, tall));
	const placed: Frame = { ...frame, x: image.x + image.width + RECREATE_GAP, y: image.y, height, reference: image.id };

	for (let blocker = taken.find((rect) => overlaps(rect, placed)); blocker;) {
		placed.x = blocker.x + blocker.width + RECREATE_GAP;
		blocker = taken.find((rect) => overlaps(rect, placed));
	}

	return placed;
}

export function referenceOf(frame: Frame, images: CanvasImage[], frames: Frame[]): CanvasImage | null {
	const linked = frame.reference ? images.find((image) => image.id === frame.reference) : undefined;

	return linked ?? imageBeside(frame.file, images, frames);
}

export function screenOf(image: CanvasImage, frames: Frame[]): Frame | null {
	const linked = frames.find((frame) => frame.reference === image.id);
	const near = nearestScreen(image, frames);

	return linked ?? frames.find((frame) => frame.file === near?.file) ?? null;
}

export function sampleSize(width: number, height: number) {
	const scale = Math.min(1, SAMPLE_WIDTH / Math.max(1, width));

	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function pixelDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	const pixels = Math.min(a.length, b.length) / 4;

	if (!pixels) return 0;
	let differing = 0;

	for (let index = 0; index < pixels * 4; index += 4) {
		const red = Math.abs(a[index]! - b[index]!);
		const green = Math.abs(a[index + 1]! - b[index + 1]!);
		const blue = Math.abs(a[index + 2]! - b[index + 2]!);

		if (Math.max(red, green, blue) > TOLERANCE) differing++;
	}

	return differing / pixels;
}
