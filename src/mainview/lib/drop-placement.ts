import type { Box, DropLayout } from "./render/protocol";

type Point = { x: number; y: number };

/** `index` is the slot to insert at; `line` is frame-local with no thickness, `null` for an empty container */
export type Placement = { index: number; line: Box | null };

type Item = { slot: number; box: Box };

function union(a: Box, b: Box): Box {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);

	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

/** Instances of one `.map` share a slot: a drop goes before or after all of them */
function itemsOf(layout: DropLayout, slotOf: (start: number) => number): Item[] {
	const bySlot = new Map<number, Item>();

	for (const child of layout.children) {
		const slot = slotOf(child.start);

		if (slot < 0 || (!child.box.width && !child.box.height)) continue;
		const item = bySlot.get(slot);
		bySlot.set(slot, { slot, box: item ? union(item.box, child.box) : child.box });
	}

	return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

/** `forward` is the direction later slots go in along the axis */
function lineBetween(previous: Box | undefined, next: Box | undefined, horizontal: boolean, forward: number): Box {
	const start = (box: Box) => (horizontal ? box.x : box.y);
	const end = (box: Box) => start(box) + (horizontal ? box.width : box.height);
	const leaving = (box: Box) => (forward > 0 ? end(box) : start(box));
	const entering = (box: Box) => (forward > 0 ? start(box) : end(box));

	const at =
		previous && next ? (leaving(previous) + entering(next)) / 2 : previous ? leaving(previous) : entering(next!);

	const boxes = [previous, next].filter((box): box is Box => !!box);
	const from = Math.min(...boxes.map((box) => (horizontal ? box.y : box.x)));
	const to = Math.max(...boxes.map((box) => (horizontal ? box.y + box.height : box.x + box.width)));

	return horizontal ? { x: at, y: from, width: 0, height: to - from } : { x: from, y: at, width: to - from, height: 0 };
}

function linear(items: Item[], point: Point, horizontal: boolean, forward: number): Placement {
	const along = (value: Point) => (horizontal ? value.x : value.y) * forward;
	const center = (box: Box) => along({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
	const i = items.findIndex((item) => along(point) < center(item.box));
	const next = i < 0 ? undefined : items[i];
	const previous = i < 0 ? items.at(-1) : items[i - 1];

	return {
		index: next ? next.slot : previous!.slot + 1,
		line: lineBetween(previous?.box, next?.box, horizontal, forward),
	};
}

const distance = (from: number, size: number, value: number) =>
	value < from ? from - value : value > from + size ? value - from - size : 0;

const overlapsRow = (a: Box, b: Box) => a.y < b.y + b.height && b.y < a.y + a.height;

/** Wrapping rows: the nearest row, then the nearest child in it; the line stands beside that child */
function wrapped(items: Item[], point: Point, forward: number): Placement {
	const rowDistance = (item: Item) => distance(item.box.y, item.box.height, point.y);
	const nearestRow = Math.min(...items.map(rowDistance));
	const center = (item: Item) => item.box.x + item.box.width / 2;

	const nearest = items
		.filter((item) => rowDistance(item) === nearestRow)
		.reduce((best, item) => {
			const gap = distance(item.box.x, item.box.width, point.x) - distance(best.box.x, best.box.width, point.x);

			return gap < 0 || (gap === 0 && Math.abs(center(item) - point.x) < Math.abs(center(best) - point.x))
				? item
				: best;
		});

	const i = items.indexOf(nearest);
	const before = (point.x - center(nearest)) * forward < 0;
	const neighbour = items[before ? i - 1 : i + 1];
	const beside = neighbour && overlapsRow(neighbour.box, nearest.box) ? neighbour.box : undefined;

	return before
		? { index: nearest.slot, line: lineBetween(beside, nearest.box, true, forward) }
		: { index: nearest.slot + 1, line: lineBetween(nearest.box, beside, true, forward) };
}

/** `slotOf` maps a child's start to its slot in the target container, -1 for children it doesn't hold */
export function dropPlacement(layout: DropLayout, slotOf: (start: number) => number, point: Point): Placement {
	const items = itemsOf(layout, slotOf);

	if (!items.length) return { index: 0, line: null };
	const rtl = layout.direction === "rtl" ? -1 : 1;
	const flex = layout.display.includes("flex");
	const row = flex && layout.flexDirection.startsWith("row");
	const reverse = flex && layout.flexDirection.endsWith("reverse") ? -1 : 1;
	const wraps = row && layout.flexWrap.startsWith("wrap");

	if ((layout.display.includes("grid") && layout.gridColumns > 1) || wraps)
		return wrapped(items, point, rtl * (row ? reverse : 1));

	return row ? linear(items, point, true, rtl * reverse) : linear(items, point, false, flex ? reverse : 1);
}
