import type { Box } from "./protocol";

export type Insets = { top: number; right: number; bottom: number; left: number };

/** Frame-local CSS pixels: the padding inside the border, and the space between laid-out children. */
export type Spacing = { padding: Box[]; gaps: Box[] };

/** Gaps run along the main axis: `row` is a flex row or a grid, `column` a flex column. */
export type Axis = "row" | "column";

/** What the resize and spacing handles start from, in CSS pixels. */
export type ElementLayout = {
	padding: Insets;
	gap: { row: number; column: number };
	/** How the element lays out its children: `grid`, a flex direction, or `null` for other displays */
	flow: Axis | "grid" | null;
	/** The parent's flex direction; `null` when the parent isn't a flex container */
	parent: Axis | null;
};

/** Sub-pixel slivers from rounding aren't padding or gaps */
const EPSILON = 0.5;

const solid = (box: Box) => box.width > EPSILON && box.height > EPSILON;

export function insetBox(box: Box, insets: Insets): Box {
	return {
		x: box.x + insets.left,
		y: box.y + insets.top,
		width: Math.max(0, box.width - insets.left - insets.right),
		height: Math.max(0, box.height - insets.top - insets.bottom),
	};
}

/** Top and bottom span the full width; left and right fit between them, so no area is drawn twice. */
export function paddingRects(box: Box, border: Insets, padding: Insets): Box[] {
	const inner = insetBox(box, border);
	const top = Math.min(padding.top, inner.height);
	const bottom = Math.min(padding.bottom, inner.height - top);
	const middle = inner.height - top - bottom;

	return [
		{ x: inner.x, y: inner.y, width: inner.width, height: top },
		{ x: inner.x, y: inner.y + inner.height - bottom, width: inner.width, height: bottom },
		{ x: inner.x, y: inner.y + top, width: Math.min(padding.left, inner.width), height: middle },
		{
			x: inner.x + inner.width - Math.min(padding.right, inner.width),
			y: inner.y + top,
			width: Math.min(padding.right, inner.width),
			height: middle,
		},
	].filter(solid);
}

const flip = (box: Box): Box => ({ x: box.y, y: box.x, width: box.height, height: box.width });

/** Children that overlap on the cross axis share a line; lines are in cross-axis order */
function linesOf(children: Box[]): Box[][] {
	const sorted = [...children].sort((a, b) => a.y - b.y || a.x - b.x);
	const lines: { top: number; bottom: number; items: Box[] }[] = [];

	for (const child of sorted) {
		const line = lines.at(-1);

		if (line && child.y < line.bottom - EPSILON) {
			line.items.push(child);
			line.bottom = Math.max(line.bottom, child.y + child.height);
		} else lines.push({ top: child.y, bottom: child.y + child.height, items: [child] });
	}

	return lines.map((line) => line.items.sort((a, b) => a.x - b.x));
}

/** In row orientation: `main` separates items in a line, `cross` separates lines */
function rowGaps(content: Box, children: Box[], main: number, cross: number): Box[] {
	const gaps: Box[] = [];
	const lines = linesOf(children);
	let previousBottom: number | null = null;

	for (const items of lines) {
		const top = Math.min(...items.map((item) => item.y));
		const bottom = Math.max(...items.map((item) => item.y + item.height));

		if (cross > 0 && previousBottom !== null)
			gaps.push({ x: content.x, y: previousBottom, width: content.width, height: top - previousBottom });

		if (main > 0) {
			for (let i = 1; i < items.length; i++) {
				const before = items[i - 1]!;
				const after = items[i]!;
				const x = before.x + before.width;
				gaps.push({ x, y: top, width: after.x - x, height: bottom - top });
			}
		}

		previousBottom = previousBottom === null ? bottom : Math.max(previousBottom, bottom);
	}

	return gaps.filter(solid);
}

/** The space between neighbouring children, where the container sets a gap; `content` is its content box. */
export function gapRects(content: Box, children: Box[], gap: { row: number; column: number }, axis: Axis): Box[] {
	const visible = children.filter(solid);

	if (axis === "row") return rowGaps(content, visible, gap.column, gap.row);

	return rowGaps(flip(content), visible.map(flip), gap.row, gap.column).map(flip);
}
