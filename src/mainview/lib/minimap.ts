import type { Rect } from "./align";
import type { Viewport } from "./viewport";

type Point = { x: number; y: number };

/** `scale` maps canvas units to minimap pixels; `bounds` is the canvas area it shows */
export type MinimapLayout = { bounds: Rect; scale: number; width: number; height: number };

/** The content, fitted into `maxWidth` × `maxHeight` */
export function minimapLayout(content: Rect, maxWidth: number, maxHeight: number): MinimapLayout {
	const scale = Math.min(maxWidth / Math.max(1, content.width), maxHeight / Math.max(1, content.height));

	return { bounds: content, scale, width: content.width * scale, height: content.height * scale };
}

/** The canvas area a `width` × `height` view shows */
export function visibleArea(view: Viewport, width: number, height: number): Rect {
	return { x: -view.x / view.zoom, y: -view.y / view.zoom, width: width / view.zoom, height: height / view.zoom };
}

export const containsRect = (outer: Rect, inner: Rect) =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.width <= outer.x + outer.width &&
	inner.y + inner.height <= outer.y + outer.height;

/** The minimap point (in its pixels) in canvas units */
export const toCanvasPoint = (layout: MinimapLayout, point: Point): Point => ({
	x: layout.bounds.x + point.x / layout.scale,
	y: layout.bounds.y + point.y / layout.scale,
});

/** The viewport that centers `point` in a `width` × `height` view, at the same zoom */
export const centeredView = (point: Point, zoom: number, width: number, height: number): Viewport => ({
	zoom,
	x: width / 2 - point.x * zoom,
	y: height / 2 - point.y * zoom,
});
