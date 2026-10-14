import { GLYPH_FIELDS, TEXT_TAG, type CapturedBox, type CapturedNode } from "../../import/captured-tree";
import type { FontSet } from "./font";

export type GlyphRun = { text: string; size: number; weight: number; letterSpacing: number };

export type GlyphSource = { measured: number[]; firstTop: number | null; runs: GlyphRun[]; lineHeight: number | null };

export type TextFrame = {
	box: CapturedBox;
	align: string;
	textCase: string;
	maxLines: number | null;
	truncated: boolean;
	wraps: boolean;
};

export type PlacedGlyph = { codepoint: number; x: number; y: number; size: number; weight: number };

type Measured = PlacedGlyph & { width: number };

const ELLIPSIS = 0x2026;

const SPACE = 0x20;

export function measuredOf(nodes: CapturedNode[], out: number[] = []): number[] {
	for (const node of nodes) {
		if (node.tag === TEXT_TAG) out.push(...(node.glyphs ?? []));
		else measuredOf(node.children, out);
	}

	return out;
}

export function firstTopOf(nodes: CapturedNode[]): number | null {
	for (const node of nodes) {
		if (node.tag === TEXT_TAG && node.glyphs?.length) return node.box.y;

		if (node.tag !== TEXT_TAG) {
			const top = firstTopOf(node.children);

			if (top !== null) return top;
		}
	}

	return null;
}

function caseOf(text: string, textCase: string) {
	if (textCase === "UPPER") return text.toUpperCase();

	if (textCase === "LOWER") return text.toLowerCase();

	return textCase === "TITLE"
		? text.replace(/(^|\s)(\S)/g, (_, space: string, char: string) => space + char.toUpperCase())
		: text;
}

function measuredLines(source: GlyphSource, fonts: FontSet): Measured[][] {
	const lines: Measured[][] = [];
	const ratio = fonts.ascent / (fonts.ascent + fonts.descent);
	let baseline = Number.NaN;

	for (let i = 0; i + GLYPH_FIELDS <= source.measured.length; i += GLYPH_FIELDS) {
		const [codepoint = 0, x = 0, top = 0, width = 0, height = 0, size = 0, weight = 400] = source.measured.slice(
			i,
			i + GLYPH_FIELDS,
		);

		const y = top + height * ratio;

		if (!(Math.abs(y - baseline) <= size * 0.5)) {
			lines.push([]);
			baseline = y;
		}

		lines[lines.length - 1]!.push({ codepoint, x, y, width, size, weight });
	}

	const firstTop = source.measured[2] ?? 0;
	const shift = (source.firstTop ?? firstTop) - firstTop;

	for (const line of lines) for (const glyph of line) glyph.y += shift;

	return lines;
}

function laidOutLines(source: GlyphSource, frame: TextFrame, fonts: FontSet): Measured[][] {
	const lines: Measured[][] = [[]];
	const height = fonts.ascent + fonts.descent;
	let x = 0;

	for (const run of source.runs) {
		for (const char of caseOf(run.text, frame.textCase)) {
			if (char === "\n") {
				lines.push([]);
				x = 0;
				continue;
			}

			const codepoint = char.codePointAt(0) ?? 0;
			const advance = (fonts.outline(codepoint, run.weight)?.advance ?? 0) * run.size + run.letterSpacing;
			const line = lines[lines.length - 1]!;
			const space = line.map((glyph) => glyph.codepoint).lastIndexOf(SPACE);

			if (frame.wraps && char !== " " && x + advance > frame.box.width && space > 0) {
				const moved = line.splice(space);
				const start = moved[1]?.x ?? x;

				lines.push(moved.slice(1).map((glyph) => ({ ...glyph, x: glyph.x - start })));
				x -= start;
			}

			lines[lines.length - 1]!.push({ codepoint, x, y: 0, width: advance, size: run.size, weight: run.weight });
			x += advance;
		}
	}

	let top = frame.box.y;

	for (const line of lines) {
		const size = Math.max(0, ...line.map((glyph) => glyph.size)) || source.runs[0]?.size || 16;
		const lineHeight = source.lineHeight ?? height * size;
		const baseline = top + (lineHeight - height * size) / 2 + fonts.ascent * size;

		for (const glyph of line) glyph.y = baseline;
		top += lineHeight;
	}

	return lines;
}

function collapsedAt(line: Measured[]) {
	return line.findIndex((glyph, i) => {
		const previous = line[i - 1];

		return !!previous && (glyph.width <= 0 || glyph.x < previous.x + previous.width / 2);
	});
}

function truncate(lines: Measured[][], frame: TextFrame, fonts: FontSet): Measured[][] {
	const right = frame.box.width;
	const kept = frame.maxLines ? lines.slice(0, frame.maxLines) : lines;
	const last = kept[kept.length - 1];
	const endOf = (glyph: Measured | undefined) => (glyph ? glyph.x + glyph.width : 0);
	const collapsed = last ? collapsedAt(last) : -1;

	if (collapsed > 0) last?.splice(collapsed);

	if (!last?.length || (collapsed < 0 && kept.length === lines.length && endOf(last[last.length - 1]) <= right))
		return kept;
	const { size, weight, y } = last[last.length - 1]!;
	const ellipsis = (fonts.outline(ELLIPSIS, weight)?.advance ?? 0) * size;

	while (last.length && endOf(last[last.length - 1]) + ellipsis > right) last.pop();

	last.push({ codepoint: ELLIPSIS, x: endOf(last[last.length - 1]), y, width: ellipsis, size, weight });

	return kept;
}

export function placeGlyphs(source: GlyphSource, frame: TextFrame, fonts: FontSet): PlacedGlyph[] {
	const measured = source.measured.length >= GLYPH_FIELDS;

	let lines = (measured ? measuredLines(source, fonts) : laidOutLines(source, frame, fonts)).filter(
		(line) => line.length,
	);

	const left = Math.min(...lines.map((line) => line[0]!.x));
	const { box } = frame;

	const placed = lines.map((line) => {
		const start = line[0]!.x;
		const width = Math.max(...line.map((glyph) => glyph.x + glyph.width)) - start;
		const space = box.width - width;
		const offset = frame.align === "CENTER" ? space / 2 : frame.align === "RIGHT" ? space : start - left;

		return line.map((glyph) => ({ ...glyph, x: glyph.x - start + offset, y: glyph.y - box.y }));
	});

	lines = frame.truncated ? truncate(placed, frame, fonts) : placed;

	return lines.flat().map(({ codepoint, x, y, size, weight }) => ({ codepoint, x, y, size, weight }));
}
