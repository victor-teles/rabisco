import { FRAME_GAP, isScreenFile, nextFrameX } from "./project";
import type { AlternateGroup, FileChange, Frame, ProjectFiles } from "./types";

// Decision 0004: groups follow from file names, so a file renamed outside Rabisco leaves its group.

export const MAX_VARIATIONS = 4;

const ALT = /^(screens\/[a-z0-9][a-z0-9-]*)\.alt-(\d+)\.tsx$/;

export const isAlternate = (path: string) => ALT.test(path);

/** `screens/welcome.alt-2.tsx` → `screens/welcome.tsx` */
export function baseOf(path: string) {
	const match = ALT.exec(path);

	return match ? `${match[1]}.tsx` : path;
}

/** `screens/welcome.alt-2.tsx` → 2 */
export function altNumber(path: string) {
	const match = ALT.exec(path);

	return match ? Number(match[2]) : null;
}

export const altPath = (base: string, n: number) => base.replace(/\.tsx$/, `.alt-${n}.tsx`);

/** One above the highest in `taken` */
export function nextAltNumber(base: string, taken: Iterable<string>) {
	let max = 0;

	for (const path of taken) if (baseOf(path) === base && path !== base) max = Math.max(max, altNumber(path)!);

	return max + 1;
}

export type VariationGroup = {
	base: string;
	/** `null` when only alternates are left */
	picked: string | null;
	/** Picked first, then alternates by number */
	files: string[];
};

export function variationGroups(paths: Iterable<string>): VariationGroup[] {
	const all = new Set(paths);
	const alts = new Map<string, string[]>();

	for (const path of all) {
		if (!isAlternate(path)) continue;
		const base = baseOf(path);
		alts.set(base, [...(alts.get(base) ?? []), path]);
	}

	return [...alts]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([base, files]) => {
			const sorted = files.sort((a, b) => altNumber(a)! - altNumber(b)!);
			const picked = all.has(base) ? base : null;

			return { base, picked, files: picked ? [picked, ...sorted] : sorted };
		});
}

export function groupOf(path: string, paths: Iterable<string>): VariationGroup | null {
	const base = baseOf(path);

	return variationGroups(paths).find((group) => group.base === base) ?? null;
}

/** Stored in `rabisco.json`; always mirrors the files */
export const alternatesOf = (paths: Iterable<string>): AlternateGroup[] =>
	variationGroups(paths).map((group) => ({ picked: group.picked ?? group.base, files: group.files }));

/** Swaps content with the base file, so `welcome.tsx` is always the chosen version and imports keep working. */
export function pickVariation(files: ProjectFiles, path: string): FileChange[] {
	const base = baseOf(path);

	if (base === path || !(path in files)) return [];

	if (!(base in files))
		return [
			{ path: base, content: files[path]! },
			{ path, content: null },
		];

	return [
		{ path: base, content: files[path]! },
		{ path, content: files[base]! },
	];
}

/** The picked content now lives in the base file, so the selection follows it there. */
export function selectionAfterPick(selection: string[], path: string) {
	const base = baseOf(path);

	return [...new Set(selection.map((file) => (file === path ? base : file)))];
}

/** Frames of an existing group go below it (one row per variation); the rest go right of everything. */
export function placeNewFrames(canvas: Frame[], created: Frame[]): Frame[] {
	if (!created.length) return [];
	const placed: Frame[] = [];
	const loose: Frame[] = [];
	const bottoms = new Map<string, { x: number; bottom: number }>();

	for (const frame of canvas) {
		if (!isScreenFile(frame.file)) continue;
		const base = baseOf(frame.file);
		const current = bottoms.get(base);
		const bottom = frame.y + frame.height;
		bottoms.set(base, {
			x: frame.file === base ? frame.x : (current?.x ?? frame.x),
			bottom: Math.max(current?.bottom ?? -Infinity, bottom),
		});
	}

	for (const frame of created) {
		const anchor = bottoms.get(baseOf(frame.file));

		if (!anchor) {
			loose.push(frame);
			continue;
		}

		const next = { ...frame, x: anchor.x, y: anchor.bottom + FRAME_GAP };
		bottoms.set(baseOf(frame.file), { x: anchor.x, bottom: next.y + next.height });
		placed.push(next);
	}

	if (loose.length) {
		const offset = nextFrameX([...canvas, ...placed]);
		const left = Math.min(...loose.map((frame) => frame.x));
		placed.push(...loose.map((frame) => ({ ...frame, x: frame.x - left + offset })));
	}

	return placed;
}
