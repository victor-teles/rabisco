/** Canvas geometry for selection, alignment and distribution. Pure, canvas-space units. */

export type Rect = { x: number; y: number; width: number; height: number };

export type Alignment = "left" | "h-center" | "right" | "top" | "v-middle" | "bottom";

export type Axis = "horizontal" | "vertical";

export function boundsOf(rects: Rect[]): Rect | null {
	if (!rects.length) return null;
	const minX = Math.min(...rects.map((r) => r.x));
	const minY = Math.min(...rects.map((r) => r.y));
	const maxX = Math.max(...rects.map((r) => r.x + r.width));
	const maxY = Math.max(...rects.map((r) => r.y + r.height));

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect spanned by two corner points, in any order. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
	return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** True when the rects overlap or touch. */
export function intersects(a: Rect, b: Rect) {
	return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** Aligns every rect to the selection bounds (Figma behaviour). Returns copies in the same order. */
export function align<T extends Rect>(rects: T[], alignment: Alignment): T[] {
	const bounds = boundsOf(rects);

	if (!bounds || rects.length < 2) return rects;

	return rects.map((r) => {
		switch (alignment) {
			case "left":
				return { ...r, x: bounds.x };
			case "right":
				return { ...r, x: bounds.x + bounds.width - r.width };
			case "h-center":
				return { ...r, x: Math.round(bounds.x + (bounds.width - r.width) / 2) };
			case "top":
				return { ...r, y: bounds.y };
			case "bottom":
				return { ...r, y: bounds.y + bounds.height - r.height };
			case "v-middle":
				return { ...r, y: Math.round(bounds.y + (bounds.height - r.height) / 2) };
		}
	});
}

/**
 * Equal gaps between rects along `axis`. The first and last rects (by
 * position) stay put; needs at least 3. Returns copies in the same order.
 */
export function distribute<T extends Rect>(rects: T[], axis: Axis): T[] {
	if (rects.length < 3) return rects;
	const pos = axis === "horizontal" ? "x" : "y";
	const size = axis === "horizontal" ? "width" : "height";
	const order = rects.map((_, i) => i).sort((a, b) => rects[a]![pos] - rects[b]![pos] || a - b);
	const first = rects[order[0]!]!;
	const last = rects[order.at(-1)!]!;
	const span = last[pos] + last[size] - first[pos];
	const occupied = rects.reduce((sum, r) => sum + r[size], 0);
	const gap = (span - occupied) / (rects.length - 1);
	const result = [...rects];
	let cursor = first[pos];

	for (const index of order) {
		const r = rects[index]!;
		result[index] = { ...r, [pos]: index === order.at(-1) ? r[pos] : Math.round(cursor) };
		cursor += r[size] + gap;
	}

	return result;
}
