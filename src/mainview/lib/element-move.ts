import { findElement, mappedEntries, parseJsx } from "../../shared/jsx";
import { dropTarget, type DropTarget } from "./component-drop";
import { dropPlacement } from "./drop-placement";
import type { Box, DropLayout } from "./render/protocol";

/** The source range of an element being dragged on the canvas */
export type DraggedElement = { start: number; end: number };

/** `null` for what `moveElement` refuses: a root, or an element inside `{…}` (`.map`, conditions) */
export function draggedElement(source: string, start: number): DraggedElement | null {
	const element = findElement(parseJsx(source), start);

	if (!element || element.name === null || !element.parent || element.container) return null;

	return { start: element.start, end: element.end };
}

const inside = (dragged: DraggedElement, start: number) => start >= dragged.start && start < dragged.end;

/**
 * Where a moved element can go, like `dropTarget` for a component drop: hits on the element or its descendants pass
 * to its ancestors, so it never lands inside itself. `null` when nothing outside it can take it.
 */
export function moveTarget(
	source: string,
	dragged: DraggedElement,
	starts: readonly number[] | null,
): DropTarget | null {
	const outside = starts ? starts.filter((start) => !inside(dragged, start)) : null;
	const target = dropTarget(source, outside);

	return target && !inside(dragged, target.parent) ? target : null;
}

/** An item a `.map` renders from an array literal: dragging it reorders the array, among its `count` entries */
export type DraggedEntry = { start: number; parent: number; count: number };

export function draggedEntry(source: string, start: number): DraggedEntry | null {
	const parent = findElement(parseJsx(source), start)?.parent;
	const entries = parent ? mappedEntries(source, start) : null;

	return parent && entries ? { start, parent: parent.start, count: entries.length } : null;
}

const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * Where the instance at `box` goes among the instances `layout` holds: `from` and `to` are entry indexes, `to` counted
 * after it leaves. `null` when the rendered instances don't pair up with the entries.
 */
export function entryPlacement(
	layout: DropLayout,
	entry: DraggedEntry,
	box: Box,
	point: { x: number; y: number },
): { from: number; to: number; line: Box | null } | null {
	const boxes = layout.children.flatMap((child) => (child.start === entry.start ? [child.box] : []));

	if (boxes.length !== entry.count) return null;
	const pressed = center(box);
	const distance = (other: Box) => Math.hypot(center(other).x - pressed.x, center(other).y - pressed.y);
	const nearest = Math.min(...boxes.map(distance));
	const from = boxes.findIndex((other) => distance(other) === nearest);
	const slots = boxes.map((other, i) => ({ start: i, box: other }));
	const { index, line } = dropPlacement({ ...layout, children: slots }, (slot) => slot, point);

	return { from, to: index > from ? index - 1 : index, line };
}

/** Entry indexes in their new order, entry `from` moved to `to` */
export function entryOrder(count: number, from: number, to: number) {
	const order = Array.from({ length: count }, (_, i) => i);
	const [moved] = order.splice(from, 1);

	if (moved !== undefined) order.splice(to, 0, moved);

	return order;
}
