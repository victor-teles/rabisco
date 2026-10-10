// Moves rendered instances with transforms while a list item drags, so the screen never re-renders mid-drag.
import type { Box, OrderPreview } from "../lib/render/protocol";
import { boxOf } from "./inspect";

type Offset = { x: number; y: number };

/** Sub-pixel differences from layout rounding */
const EPSILON = 0.5;

/** If no render follows a settle within this time, the drop was refused: the items go back */
const SETTLE_TIMEOUT = 2000;

const TRANSITION = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";

const sameSize = (a: Box, b: Box) => Math.abs(a.width - b.width) < EPSILON && Math.abs(a.height - b.height) < EPSILON;

/**
 * How far each instance moves, in instance order, so slot `i` shows instance `order[i]`. Items of one size take each
 * other's places; items of different sizes in a row or column pack along it with the gaps they had.
 */
export function reorderOffsets(boxes: Box[], order: number[]): Offset[] {
	const offsets = boxes.map(() => ({ x: 0, y: 0 }));

	if (boxes.length < 2 || order.length !== boxes.length) return offsets;
	const first = boxes[0]!;
	const second = boxes[1]!;
	const horizontal = Math.abs(second.x - first.x) >= Math.abs(second.y - first.y);
	const start = (box: Box) => (horizontal ? box.x : box.y);
	const size = (box: Box) => (horizontal ? box.width : box.height);
	const forward = start(second) >= start(first) ? 1 : -1;
	// Mirrored when the items run backwards (rtl, `-reverse`), so they always pack from `lead` onwards
	const lead = (box: Box) => (forward > 0 ? start(box) : -(start(box) + size(box)));
	const gaps = boxes.slice(1).map((box, i) => lead(box) - lead(boxes[i]!) - size(boxes[i]!));

	if (boxes.every((box) => sameSize(box, first)) || gaps.some((gap) => gap < -EPSILON)) {
		order.forEach((instance, slot) => {
			offsets[instance] = { x: boxes[slot]!.x - boxes[instance]!.x, y: boxes[slot]!.y - boxes[instance]!.y };
		});

		return offsets;
	}

	let at = lead(first);

	order.forEach((instance, slot) => {
		const box = boxes[instance]!;
		const along = forward * (at - lead(box));
		offsets[instance] = horizontal ? { x: along, y: 0 } : { x: 0, y: along };
		at += size(box) + (gaps[slot] ?? 0);
	});

	return offsets;
}

type Saved = { style: CSSStyleDeclaration; property: string; before: string; priority: string };

type Instance = { styles: CSSStyleDeclaration[]; box: Box };

/** `first` tells one list from another, since a slide back can still run when the next drag starts */
type Preview = { first: Element | undefined; instances: Instance[]; saved: Saved[] };

let current: Preview | null = null;

let restoring = 0;

const PROPERTIES = ["transform", "transition", "z-index"];

const hasStyle = (element: Element): element is HTMLElement | SVGElement =>
	element instanceof HTMLElement || element instanceof SVGElement;

/** Measured once, before any transform, and kept for the whole drag */
function start(instances: Element[][]): Preview | null {
	const measured: Instance[] = [];
	const saved: Saved[] = [];

	for (const elements of instances) {
		const box = boxOf(elements);

		if (!box) return null;
		const styles = elements.flatMap((element) => (hasStyle(element) ? [element.style] : []));

		for (const style of styles)
			for (const property of PROPERTIES)
				saved.push({
					style,
					property,
					before: style.getPropertyValue(property),
					priority: style.getPropertyPriority(property),
				});
		measured.push({ styles, box });
	}

	return { first: instances[0]?.[0], instances: measured, saved };
}

const set = (instance: Instance, property: string, value: string) => {
	for (const style of instance.styles) style.setProperty(property, value, "important");
};

const boxOfItem = (instance: Instance) => instance.box;

const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * `instances` are every rendered instance of the item; a repeated parent holds `order.length` of them each, and they
 * all reorder. The one nearest `preview.box` follows `preview.offset`, or settles into its slot without one.
 */
export function previewOrder(instances: Element[][], preview: OrderPreview) {
	const count = preview.order.length;

	if (!count || instances.length % count) return;

	if (!current || current.first !== instances[0]?.[0] || current.instances.length !== instances.length) {
		restore();
		current = start(instances);
	}

	window.clearTimeout(restoring);

	if (!current) return;

	const all = current.instances;
	const pressed = center(preview.box);

	const distance = (instance: Instance) =>
		Math.hypot(center(instance.box).x - pressed.x, center(instance.box).y - pressed.y);

	const nearest = Math.min(...all.map(distance));
	const dragged = all.findIndex((instance) => distance(instance) === nearest);

	for (let group = 0; group < all.length; group += count) {
		const items = all.slice(group, group + count);
		const offsets = reorderOffsets(items.map(boxOfItem), preview.order);

		items.forEach((item, i) => {
			const held = group + i === dragged;
			const offset = held && preview.offset ? preview.offset : offsets[i]!;
			set(item, "transition", offset === preview.offset ? "none" : TRANSITION);
			set(item, "z-index", held ? "10" : "");
			set(item, "transform", `translate(${offset.x}px, ${offset.y}px)`);
		});
	}

	// Settling: the render that applies the move clears this
	if (!preview.offset) restoring = window.setTimeout(() => clearOrder(true), SETTLE_TIMEOUT);
}

function restore() {
	for (const { style, property, before, priority } of current?.saved ?? []) {
		if (before) style.setProperty(property, before, priority);
		else style.removeProperty(property);
	}

	current = null;
}

/** `animate` slides the items back first; a render clears at once, since its DOM already shows the new order */
export function clearOrder(animate: boolean) {
	window.clearTimeout(restoring);

	if (!current) return;

	if (!animate) return restore();

	for (const instance of current.instances) {
		set(instance, "transition", TRANSITION);
		set(instance, "transform", "translate(0px, 0px)");
	}

	restoring = window.setTimeout(restore, 200);
}
