import type { Rect } from "./align";
import { MAX_FRAME_SIZE, MIN_FRAME_SIZE } from "./device-presets";
import { guidesFor, linesX, linesY, nearestOffset, type Guide } from "./snapping";

/** Compass points: corners and sides of a frame */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Per axis, the side the handle moves: -1 the left or top, 1 the right or bottom, 0 neither */
export const handleSides = (handle: Handle) => ({
	x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
	y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
});

/** Figma's modifiers: ⇧ keeps the aspect ratio, ⌥ resizes from the center */
export type ResizeOptions = { keepRatio?: boolean; fromCenter?: boolean };

const clampSize = (size: number) => Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, size));

/** Where the start side goes once the length changes from `before` to `after` */
function place(start: number, before: number, after: number, side: number, fromCenter: boolean) {
	if (fromCenter) return start + (before - after) / 2;

	return side === -1 ? start + before - after : start;
}

/** `origin` dragged by `handle`, by `dx`/`dy` canvas units; whole pixels, within the frame size limits */
export function resizeRect(
	origin: Rect,
	handle: Handle,
	dx: number,
	dy: number,
	{ keepRatio = false, fromCenter = false }: ResizeOptions = {},
): Rect {
	const sides = handleSides(handle);
	const factor = fromCenter ? 2 : 1;
	let width = origin.width + sides.x * dx * factor;
	let height = origin.height + sides.y * dy * factor;

	if (keepRatio) {
		const scaleX = width / origin.width;
		const scaleY = height / origin.height;
		const scale = sides.x && sides.y ? Math.max(scaleX, scaleY) : sides.x ? scaleX : scaleY;
		width = origin.width * scale;
		height = origin.height * scale;
	}

	width = Math.round(clampSize(width));
	height = Math.round(clampSize(height));

	return {
		x: Math.round(place(origin.x, origin.width, width, sides.x, fromCenter)),
		y: Math.round(place(origin.y, origin.height, height, sides.y, fromCenter)),
		width,
		height,
	};
}

/** The resized rect, and the guides it lines up with */
export type SnappedResize = { rect: Rect; guides: Guide[] };

/** Moves the sides the handle drags onto the nearest edge or center of `others` within `threshold` */
export function snapResize(
	rect: Rect,
	handle: Handle,
	others: Rect[],
	threshold: number,
	fromCenter = false,
): SnappedResize {
	const sides = handleSides(handle);
	const factor = fromCenter ? 2 : 1;
	const next = { ...rect };

	if (sides.x) {
		const edge = sides.x === 1 ? rect.x + rect.width : rect.x;
		const grow = Math.round(nearestOffset([edge], others.flatMap(linesX), threshold)) * sides.x;
		const width = rect.width + grow * factor;

		if (width >= MIN_FRAME_SIZE && width <= MAX_FRAME_SIZE) {
			next.width = width;

			if (sides.x === -1 || fromCenter) next.x = rect.x - grow;
		}
	}

	if (sides.y) {
		const edge = sides.y === 1 ? rect.y + rect.height : rect.y;
		const grow = Math.round(nearestOffset([edge], others.flatMap(linesY), threshold)) * sides.y;
		const height = rect.height + grow * factor;

		if (height >= MIN_FRAME_SIZE && height <= MAX_FRAME_SIZE) {
			next.height = height;

			if (sides.y === -1 || fromCenter) next.y = rect.y - grow;
		}
	}

	return { rect: next, guides: guidesFor(next, others) };
}
