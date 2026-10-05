import type { ScreenMeta } from "../../shared/ai/contract";
import { FRAME_GAP, framesForNewScreens, screenNameFromPath } from "../../shared/project";
import type { Device, Frame } from "../../shared/types";
import { altNumber, baseOf, MAX_VARIATIONS } from "../../shared/variations";

/** Editor-side helpers for variations (decision 0004): labels, chat notes, draft layout. */

/** A stored or typed count, kept within 1…MAX_VARIATIONS. */
export function clampVariations(value: unknown, fallback = 1) {
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
	return Math.min(MAX_VARIATIONS, Math.max(1, Math.round(n)));
}

/** `Welcome`, or `Welcome (alt 2)` for an alternate. The screen's name comes from its own frame when it has one. */
export function variationName(path: string, frames: Frame[]) {
	const base = baseOf(path);
	const name = frames.find((frame) => frame.file === base)?.name || screenNameFromPath(base);
	const n = altNumber(path);
	return n === null ? name : `${name} (alt ${n})`;
}

/** Status lines of parallel variations: the primary's stay as they are, the others say which variation they belong to. */
export const variantLabel = (label: string, variant?: number) => (variant ? `Variation ${variant + 1} · ${label}` : label);

/** What the chat shows for "Vary this" */
export const varyNote = (name: string, direction: string) => `Vary ${name}${direction.trim() ? `: ${direction.trim()}` : ""}`;

/** The prompt of a vary run without a direction */
export const VARY_PROMPT = "Explore a different take on this screen: keep its purpose and content, change the layout and styling.";

export const mixNote = (section: string, sourceName: string, receiverName: string) =>
	`Mix: ${section.trim()} from ${sourceName} into ${receiverName}`;

export const mixPrompt = (section: string, sourceName: string, sourcePath: string) =>
	`Take the ${section.trim()} from ${sourceName} (${sourcePath}) and use it in this screen, replacing its equivalent. Keep everything else.`;

/**
 * Draft frames for screens a generation is still writing, from the canvas
 * origin: one column per screen, its variations below it (row N = `alt-N`),
 * like the result's own layout. `placeNewFrames` then moves them into place.
 */
export function draftLayout(paths: string[], meta: Record<string, ScreenMeta | undefined>, device: Device): Frame[] {
	const columns: string[] = [];
	for (const path of paths) if (!columns.includes(baseOf(path))) columns.push(baseOf(path));
	const out: Frame[] = [];
	let x = 0;
	for (const base of columns) {
		const members = framesForNewScreens(
			paths.filter((path) => baseOf(path) === base),
			meta,
			device,
		);
		let width = 0;
		for (const frame of members) {
			const row = altNumber(frame.file) ?? 0;
			out.push({ ...frame, x, y: row * (frame.height + FRAME_GAP) });
			width = Math.max(width, frame.width);
		}
		x += width + FRAME_GAP;
	}
	return out;
}
