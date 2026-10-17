// The pen tool draws a path of anchors; a dragged anchor gets a handle and smooth curves on both sides

export type PenPoint = { x: number; y: number; handle?: { x: number; y: number } };

/** Room for the stroke at the edges, in pixels */
const PAD = 1;

const round = (value: number) => Math.round(value * 10) / 10;

/** The handle going out of an anchor; the one coming in mirrors it */
const after = (point: PenPoint) =>
	point.handle ? { x: point.x + point.handle.x, y: point.y + point.handle.y } : point;

const before = (point: PenPoint) =>
	point.handle ? { x: point.x - point.handle.x, y: point.y - point.handle.y } : point;

/** Anchors and handles, so curves stay inside */
export function penBounds(points: readonly PenPoint[]) {
	const xs = points.flatMap((point) => [point.x, after(point).x, before(point).x]);
	const ys = points.flatMap((point) => [point.y, after(point).y, before(point).y]);
	const x = Math.min(...xs) - PAD;
	const y = Math.min(...ys) - PAD;

	return { x, y, width: Math.max(...xs) + PAD - x, height: Math.max(...ys) + PAD - y };
}

/** `d` for the points, moved by `origin` */
export function penPathData(points: readonly PenPoint[], closed: boolean, origin = { x: 0, y: 0 }): string {
	const at = (point: { x: number; y: number }) => `${round(point.x - origin.x)} ${round(point.y - origin.y)}`;

	const segment = (from: PenPoint, to: PenPoint) =>
		from.handle || to.handle ? `C${at(after(from))} ${at(before(to))} ${at(to)}` : `L${at(to)}`;

	const [first, ...rest] = points;

	if (!first) return "";
	const parts = [`M${at(first)}`, ...rest.map((point, i) => segment(points[i]!, point))];

	if (closed && points.length > 2) {
		const last = points[points.length - 1]!;

		if (last.handle || first.handle) parts.push(segment(last, first));
		parts.push("Z");
	}

	return parts.join(" ");
}

/** An inline SVG sized to the path, stroked with the text color so it follows the theme */
export function penSnippet(points: readonly PenPoint[], closed: boolean): string | null {
	if (points.length < 2) return null;
	const bounds = penBounds(points);
	const width = Math.max(1, Math.ceil(bounds.width));
	const height = Math.max(1, Math.ceil(bounds.height));
	const d = penPathData(points, closed, bounds);

	return (
		`<svg viewBox="0 0 ${width} ${height}" fill="none" className="h-[${height}px] w-[${width}px] shrink-0 text-foreground">` +
		`<path d="${d}" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />` +
		`</svg>`
	);
}
