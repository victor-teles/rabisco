import type { Frame } from "../../shared/types";
import { intersects, type Rect } from "./align";

/** ⇧-click: adds the file if missing, removes it if present. */
export function toggleInSelection(selection: string[], file: string) {
	return selection.includes(file) ? selection.filter((f) => f !== file) : [...selection, file];
}

/**
 * Frames touched by a marquee. With `additive` (⇧ held) they join `base`,
 * the selection when the marquee started; otherwise they replace it.
 */
export function marqueeSelection(frames: Frame[], marquee: Rect, base: string[], additive: boolean) {
	const hits = frames.filter((frame) => intersects(frame, marquee)).map((frame) => frame.file);
	if (!additive) return hits;
	return [...base, ...hits.filter((file) => !base.includes(file))];
}

/** Keeps canvas order, drops files that have no frame. */
export function selectedFrames(frames: Frame[], selection: string[]) {
	const set = new Set(selection);
	return frames.filter((frame) => set.has(frame.file));
}

export function sameSelection(a: string[], b: string[]) {
	return a.length === b.length && a.every((file, i) => file === b[i]);
}
