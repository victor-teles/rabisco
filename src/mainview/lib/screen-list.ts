import type { Frame } from "../../shared/types";

/**
 * Moves `moving` (in their current order) in front of `before`, or to the end when it is `null`.
 * Returns `frames` itself when nothing moves, so the history gets no empty step.
 */
export function reorderFrames(frames: Frame[], moving: string[], before: string | null): Frame[] {
	const movingSet = new Set(moving);

	if (!movingSet.size || (before !== null && movingSet.has(before))) return frames;
	const moved: Frame[] = [];
	const rest: Frame[] = [];

	for (const frame of frames) (movingSet.has(frame.file) ? moved : rest).push(frame);

	if (!moved.length) return frames;
	const at = before === null ? rest.length : rest.findIndex((frame) => frame.file === before);

	if (at === -1) return frames;
	const next = [...rest.slice(0, at), ...moved, ...rest.slice(at)];

	return next.every((frame, index) => frame === frames[index]) ? frames : next;
}

/** Where `moving` goes for one step up (-1) or down (1): past the nearest frame that isn't moving */
export function stepTarget(frames: Frame[], moving: string[], direction: -1 | 1): string | null | undefined {
	const movingSet = new Set(moving);
	const indexes = frames.flatMap((frame, index) => (movingSet.has(frame.file) ? [index] : []));

	if (!indexes.length) return undefined;

	if (direction === -1) {
		const above = frames
			.slice(0, indexes[0])
			.reverse()
			.find((frame) => !movingSet.has(frame.file));

		return above?.file;
	}

	const last = indexes.at(-1)!;
	const below = frames.findIndex((frame, index) => index > last && !movingSet.has(frame.file));

	if (below === -1) return undefined;

	return frames.slice(below + 1).find((frame) => !movingSet.has(frame.file))?.file ?? null;
}

/** Case-insensitive, on the name and the file path */
export function matchesScreen(frame: Frame, query: string) {
	const needle = query.trim().toLowerCase();

	return !needle || frame.name.toLowerCase().includes(needle) || frame.file.toLowerCase().includes(needle);
}
