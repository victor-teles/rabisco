import type { Rect } from "./align";

/** A smart guide: on axis `x` a vertical line at `x = at` from `y = from` to `y = to`; on `y` a horizontal one */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

/** Lines closer than this count as aligned, so rounding to whole pixels doesn't hide a guide */
const ALIGNED = 0.5;

export const linesX = (rect: Rect) => [rect.x, rect.x + rect.width / 2, rect.x + rect.width];

export const linesY = (rect: Rect) => [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

/** The smallest shift that puts one of `lines` on one of `targets`, else 0 when none is within `threshold` */
export function nearestOffset(lines: number[], targets: number[], threshold: number) {
	let best: number | null = null;

	for (const line of lines) {
		for (const target of targets) {
			const offset = target - line;

			if (Math.abs(offset) <= threshold && (best === null || Math.abs(offset) < Math.abs(best))) best = offset;
		}
	}

	return best ?? 0;
}

/** Guides through every edge and center of `rect` that lines up with one of `others`, spanning both */
export function guidesFor(rect: Rect, others: Rect[]): Guide[] {
	const guides: Guide[] = [];

	const collect = (axis: Guide["axis"], lines: (rect: Rect) => number[]) => {
		const start = axis === "x" ? rect.y : rect.x;
		const end = axis === "x" ? rect.y + rect.height : rect.x + rect.width;

		for (const at of new Set(lines(rect))) {
			let from = start;
			let to = end;
			let found = false;

			for (const other of others) {
				if (!lines(other).some((line) => Math.abs(line - at) <= ALIGNED)) continue;
				found = true;
				from = Math.min(from, axis === "x" ? other.y : other.x);
				to = Math.max(to, axis === "x" ? other.y + other.height : other.x + other.width);
			}

			if (found) guides.push({ axis, at, from, to });
		}
	};

	collect("x", linesX);
	collect("y", linesY);

	return guides;
}

/** Where a dragged rect lands, and the guides it lines up with */
export type SnappedMove = { x: number; y: number; guides: Guide[] };

/** Moves `rect` so its edges or center meet the nearest edge or center of `others` within `threshold`, per axis */
export function snapMove(rect: Rect, others: Rect[], threshold: number): SnappedMove {
	const x = Math.round(rect.x + nearestOffset(linesX(rect), others.flatMap(linesX), threshold));
	const y = Math.round(rect.y + nearestOffset(linesY(rect), others.flatMap(linesY), threshold));

	return { x, y, guides: guidesFor({ ...rect, x, y }, others) };
}
