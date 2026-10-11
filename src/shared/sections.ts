import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { CanvasSection, Frame, SectionColor } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

export type SectionGroup = { section: CanvasSection | null; frames: Frame[] };

export type SectionMove = { sections: CanvasSection[]; frames: Frame[] };

export const SECTION_COLORS: readonly SectionColor[] = [
	"gray",
	"red",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
];

export const SECTION_PADDING = 80;

export const MIN_SECTION_SIZE = 40;

export const isSectionColor = (value: Json | undefined): value is SectionColor =>
	SECTION_COLORS.some((color) => color === value);

export function normalizeSections(raw: Json | undefined): CanvasSection[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const sections: CanvasSection[] = [];

	for (const entry of raw) {
		if (!isJsonObject(entry) || !isString(entry.id) || seen.has(entry.id)) continue;
		const { x, y, width, height } = entry;

		if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) continue;

		if (width <= 0 || height <= 0) continue;
		seen.add(entry.id);

		sections.push({
			id: entry.id,
			name: isString(entry.name) && entry.name.trim() ? entry.name : "Section",
			color: isSectionColor(entry.color) ? entry.color : "gray",
			x,
			y,
			width,
			height,
		});
	}

	return sections;
}

export function nextSectionName(sections: CanvasSection[]) {
	const taken = new Set(sections.map((section) => section.name));
	let n = sections.length + 1;

	while (taken.has(`Section ${n}`)) n++;

	return `Section ${n}`;
}

export function sectionAround(frames: Frame[], id: string, name: string): CanvasSection | null {
	if (!frames.length) return null;
	const left = Math.min(...frames.map((frame) => frame.x));
	const top = Math.min(...frames.map((frame) => frame.y));
	const right = Math.max(...frames.map((frame) => frame.x + frame.width));
	const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));

	return {
		id,
		name,
		color: "gray",
		x: left - SECTION_PADDING,
		y: top - SECTION_PADDING,
		width: right - left + SECTION_PADDING * 2,
		height: bottom - top + SECTION_PADDING * 2,
	};
}

const holdsPoint = (section: Rect, x: number, y: number) =>
	x >= section.x && x <= section.x + section.width && y >= section.y && y <= section.y + section.height;

export const holdsFrame = (section: Rect, frame: Rect) =>
	holdsPoint(section, frame.x + frame.width / 2, frame.y + frame.height / 2);

const holdsRect = (outer: Rect, inner: Rect) =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.width <= outer.x + outer.width &&
	inner.y + inner.height <= outer.y + outer.height;

export function sectionAt(x: number, y: number, sections: CanvasSection[]): CanvasSection | undefined {
	let found: CanvasSection | undefined;

	for (const section of sections) {
		if (!holdsPoint(section, x, y)) continue;

		if (!found || section.width * section.height < found.width * found.height) found = section;
	}

	return found;
}

export const sectionOf = (frame: Frame, sections: CanvasSection[]) =>
	sectionAt(frame.x + frame.width / 2, frame.y + frame.height / 2, sections);

export function moveSection(
	sections: CanvasSection[],
	frames: Frame[],
	id: string,
	dx: number,
	dy: number,
): SectionMove {
	const moved = sections.find((section) => section.id === id);

	if (!moved || (dx === 0 && dy === 0)) return { sections, frames };

	return {
		sections: sections.map((section) =>
			section.id === id || holdsRect(moved, section) ? { ...section, x: section.x + dx, y: section.y + dy } : section,
		),
		frames: frames.map((frame) => (holdsFrame(moved, frame) ? { ...frame, x: frame.x + dx, y: frame.y + dy } : frame)),
	};
}

export function membersOf(section: CanvasSection, sections: CanvasSection[], frames: Frame[]) {
	return {
		frames: frames.flatMap((frame) => (holdsFrame(section, frame) ? [frame.file] : [])),
		sections: sections.flatMap((other) => (other.id !== section.id && holdsRect(section, other) ? [other.id] : [])),
	};
}

export function groupBySection(frames: Frame[], sections: CanvasSection[]): SectionGroup[] {
	const groups = new Map<string, Frame[]>(sections.map((section) => [section.id, []]));
	const loose: Frame[] = [];

	for (const frame of frames) {
		const section = sectionOf(frame, sections);

		if (section) groups.get(section.id)?.push(frame);
		else loose.push(frame);
	}

	const grouped = sections.map((section) => ({ section, frames: groups.get(section.id) ?? [] }));

	return loose.length ? [...grouped, { section: null, frames: loose }] : grouped;
}
