// Guides are lines on a screen, dragged from the rulers; they live in canvas.json with the frame

import { isFiniteNumber } from "./guards";
import { isJsonObject, type Json } from "./json";
import type { Frame, FrameGuide } from "./types";

/** Whole pixels, inside the frame, one per position */
export function normalizeGuides(guides: readonly FrameGuide[], frame: Pick<Frame, "width" | "height">): FrameGuide[] {
	const seen = new Set<string>();
	const kept: FrameGuide[] = [];

	for (const guide of guides) {
		const at = Math.round(guide.at);
		const key = `${guide.axis}${at}`;

		if (at < 0 || at > (guide.axis === "x" ? frame.width : frame.height) || seen.has(key)) continue;
		seen.add(key);
		kept.push({ axis: guide.axis, at });
	}

	return kept.sort((a, b) => (a.axis === b.axis ? a.at - b.at : a.axis === "x" ? -1 : 1));
}

export function parseGuides(raw: Json | undefined): FrameGuide[] | undefined {
	if (!Array.isArray(raw)) return undefined;

	const guides = raw.flatMap((item): FrameGuide[] => {
		if (!isJsonObject(item)) return [];
		const { axis, at } = item;

		return (axis === "x" || axis === "y") && isFiniteNumber(at) ? [{ axis, at: Math.round(at) }] : [];
	});

	return guides.length ? guides : undefined;
}

/** Moves the guide at `index`; outside the frame removes it */
export function moveGuide(frame: Frame, index: number, at: number): FrameGuide[] | undefined {
	const guides = (frame.guides ?? []).map((guide, i) => (i === index ? { ...guide, at } : guide));
	const next = normalizeGuides(guides, frame);

	return next.length ? next : undefined;
}

export function addGuide(frame: Frame, guide: FrameGuide): FrameGuide[] {
	return normalizeGuides([...(frame.guides ?? []), guide], frame);
}
