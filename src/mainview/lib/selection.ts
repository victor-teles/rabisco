import type { Frame } from "../../shared/types";
import { intersects, type Rect } from "./align";

export function toggleInSelection(selection: string[], file: string) {
	return selection.includes(file) ? selection.filter((f) => f !== file) : [...selection, file];
}

/** `base` is the selection when the marquee started; `additive` (⇧) joins it instead of replacing it. */
export function marqueeSelection(frames: Frame[], marquee: Rect, base: string[], additive: boolean) {
	const hits = frames.flatMap((frame) => (intersects(frame, marquee) ? [frame.file] : []));

	if (!additive) return hits;

	return [...base, ...hits.filter((file) => !base.includes(file))];
}

export function selectedFrames(frames: Frame[], selection: string[]) {
	const set = new Set(selection);

	return frames.filter((frame) => set.has(frame.file));
}

export function sameSelection(a: string[], b: string[]) {
	return a.length === b.length && a.every((file, i) => file === b[i]);
}

/** Right-click acts on the selection when it holds `file`, else selects just `file` first, as in Figma. */
export function contextSelection(selection: string[], file: string) {
	return selection.includes(file) ? selection : [file];
}
