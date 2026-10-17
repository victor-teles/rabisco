import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "./json";
import { isSectionColor } from "./sections";
import type { Annotation, CanvasArrow, CanvasNote } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

export const NOTE_SIZE = { width: 200, height: 200 };

export const MIN_NOTE_SIZE = 80;

/** Shorter drags place a default note or nothing for an arrow */
export const MIN_ARROW_LENGTH = 8;

export const MAX_NOTE_TEXT = 4000;

function parseNote(entry: JsonObject, id: string): CanvasNote | null {
	const { x, y, width, height, text } = entry;

	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;

	if (width <= 0 || height <= 0) return null;

	const note: CanvasNote = {
		kind: "note",
		id,
		text: isString(text) ? text.substring(0, MAX_NOTE_TEXT) : "",
		color: isSectionColor(entry.color) ? entry.color : "yellow",
		x,
		y,
		width,
		height,
	};

	if (isString(entry.page)) note.page = entry.page;

	return note;
}

function parseArrow(entry: JsonObject, id: string): CanvasArrow | null {
	const { x1, y1, x2, y2 } = entry;

	if (!isFiniteNumber(x1) || !isFiniteNumber(y1) || !isFiniteNumber(x2) || !isFiniteNumber(y2)) return null;

	if (Math.hypot(x2 - x1, y2 - y1) < MIN_ARROW_LENGTH) return null;
	const arrow: CanvasArrow = { kind: "arrow", id, x1, y1, x2, y2 };

	if (isString(entry.page)) arrow.page = entry.page;

	return arrow;
}

export function normalizeAnnotations(raw: Json | undefined): Annotation[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const annotations: Annotation[] = [];

	for (const entry of raw) {
		if (!isJsonObject(entry) || !isString(entry.id) || seen.has(entry.id)) continue;

		const parsed =
			entry.kind === "note" ? parseNote(entry, entry.id) : entry.kind === "arrow" ? parseArrow(entry, entry.id) : null;

		if (!parsed) continue;
		seen.add(entry.id);
		annotations.push(parsed);
	}

	return annotations;
}

export function annotationBounds(annotation: Annotation): Rect {
	if (annotation.kind === "note") {
		const { x, y, width, height } = annotation;

		return { x, y, width, height };
	}

	const { x1, y1, x2, y2 } = annotation;

	return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function moveAnnotation<T extends Annotation>(annotation: T, dx: number, dy: number): T {
	if (annotation.kind === "note") return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };

	return {
		...annotation,
		x1: annotation.x1 + dx,
		y1: annotation.y1 + dy,
		x2: annotation.x2 + dx,
		y2: annotation.y2 + dy,
	};
}

/** Figma's ⇧ while drawing a line: the nearest 45° */
export function snapAngle(from: { x: number; y: number }, to: { x: number; y: number }) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);

	return { x: Math.round(from.x + Math.cos(angle) * length), y: Math.round(from.y + Math.sin(angle) * length) };
}
