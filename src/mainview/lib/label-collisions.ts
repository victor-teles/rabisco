import type { Rect } from "./align";

/** A screen or a section, in canvas units */
export type Labelled = Rect & { name: string };

/** Screen pixels: a screen's name sits above it, a section's name inside its top-left corner */
export const FRAME_LABEL_HEIGHT = 20;

export const SECTION_LABEL_INSET = 8;

export const SECTION_LABEL_HEIGHT = 24;

export const SECTION_LABEL_PADDING = 16;

const below = (gap: number, room: number) => (gap > 0 ? room / gap : Infinity);

/** Labels keep their screen size while the gaps between boxes scale with the zoom */
function underFrame(frame: Labelled, nameWidth: number, other: Rect) {
	if (other.y >= frame.y || frame.x >= other.x + other.width) return 0;

	if (other.x > frame.x && other.x - frame.x >= frame.width) return 0;
	const across = other.x > frame.x ? nameWidth / (other.x - frame.x) : Infinity;

	return Math.min(below(frame.y - other.y - other.height, FRAME_LABEL_HEIGHT), across);
}

function underSection(frame: Labelled, section: Labelled, sectionWidth: number) {
	const inside =
		frame.x >= section.x &&
		frame.y >= section.y &&
		frame.x < section.x + section.width &&
		frame.y < section.y + section.height;

	if (!inside) return 0;
	const room = FRAME_LABEL_HEIGHT + SECTION_LABEL_INSET + SECTION_LABEL_HEIGHT;

	return Math.min(below(frame.y - section.y, room), below(frame.x - section.x, SECTION_LABEL_INSET + sectionWidth));
}

/**
 * The zoom below which each screen's name would run into another screen or a section's name, as Figma hides them.
 * `measure` is a name's width in screen pixels.
 */
export function labelLimits(
	frames: (Labelled & { file: string })[],
	sections: Labelled[],
	measure: (name: string) => number,
) {
	const limits = new Map<string, number>();
	const sectionWidths = sections.map((section) => measure(section.name) + SECTION_LABEL_PADDING);

	for (const frame of frames) {
		const width = measure(frame.name);
		let limit = 0;

		for (const other of frames) if (other !== frame) limit = Math.max(limit, underFrame(frame, width, other));

		sections.forEach((section, i) => {
			limit = Math.max(limit, underSection(frame, section, sectionWidths[i] ?? 0));
		});

		if (limit > 0) limits.set(frame.file, limit);
	}

	return limits;
}
