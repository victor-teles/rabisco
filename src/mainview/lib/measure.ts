import type { Box } from "./render/protocol";

export type MeasureAxis = "x" | "y";

export type MeasureSegment = { axis: MeasureAxis; from: number; to: number; at: number };

export type MeasureLine = MeasureSegment & { value: number };

export type Measurement = { lines: MeasureLine[]; guides: MeasureSegment[] };

type Span = { start: number; end: number };

const spanOf = (box: Box, axis: MeasureAxis): Span =>
	axis === "x" ? { start: box.x, end: box.x + box.width } : { start: box.y, end: box.y + box.height };

const across = (axis: MeasureAxis): MeasureAxis => (axis === "x" ? "y" : "x");

const apart = (a: Span, b: Span) => a.end <= b.start || b.end <= a.start;

const overlapCenter = (a: Span, b: Span) => (Math.max(a.start, b.start) + Math.min(a.end, b.end)) / 2;

const between = (a: number, b: number) => ({ from: Math.min(a, b), to: Math.max(a, b) });

function linesAlong(axis: MeasureAxis, selected: Box, target: Box): Measurement {
	const main = { selected: spanOf(selected, axis), target: spanOf(target, axis) };
	const cross = { selected: spanOf(selected, across(axis)), target: spanOf(target, across(axis)) };
	const crossApart = apart(cross.selected, cross.target);

	if (!apart(main.selected, main.target)) {
		if (crossApart) return { lines: [], guides: [] };

		const at = overlapCenter(cross.selected, cross.target);

		const edges = [
			between(main.selected.start, main.target.start),
			between(main.selected.end, main.target.end),
		].flatMap(({ from, to }) => (to > from ? [{ axis, from, to, at, value: to - from }] : []));

		return { lines: edges, guides: [] };
	}

	const after = main.target.start >= main.selected.end;
	const from = after ? main.selected.end : main.target.end;
	const to = after ? main.target.start : main.selected.start;

	if (!crossApart) {
		const at = overlapCenter(cross.selected, cross.target);

		return { lines: [{ axis, from, to, at, value: to - from }], guides: [] };
	}

	const at = (cross.selected.start + cross.selected.end) / 2;
	const touch = after ? to : from;
	const edge = at < cross.target.start ? cross.target.start : cross.target.end;

	return {
		lines: [{ axis, from, to, at, value: to - from }],
		guides: [{ axis: across(axis), ...between(at, edge), at: touch }],
	};
}

export function measure(selected: Box, target: Box): Measurement {
	const x = linesAlong("x", selected, target);
	const y = linesAlong("y", selected, target);

	return { lines: [...x.lines, ...y.lines], guides: [...x.guides, ...y.guides] };
}

export const measureLabel = (value: number) => String(Math.round(value * 10) / 10);
