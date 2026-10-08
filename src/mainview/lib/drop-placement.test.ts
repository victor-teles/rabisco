import { describe, expect, test } from "bun:test";
import { dropPlacement } from "./drop-placement";
import type { Box, DropLayout } from "./render/protocol";

const b = (x: number, y: number, width = 100, height = 50): Box => ({ x, y, width, height });

const layout = (children: [number, Box][], style: Partial<DropLayout> = {}): DropLayout => ({
	start: 0,
	version: "v",
	box: b(0, 0, 1000, 1000),
	display: "block",
	flexDirection: "row",
	flexWrap: "nowrap",
	gridAutoFlow: "row",
	gridColumns: 0,
	direction: "ltr",
	children: children.map(([start, box]) => ({ start, box })),
	...style,
});

// Child starts are 10, 20, 30…; slot = start / 10 - 1
const slot = (start: number) => start / 10 - 1;

const row = layout(
	[
		[10, b(0, 0)],
		[20, b(120, 0)],
		[30, b(240, 0)],
	],
	{ display: "flex" },
);

describe("dropPlacement", () => {
	test("flex row", () => {
		expect(dropPlacement(row, slot, { x: 10, y: 20 })).toEqual({ index: 0, line: b(0, 0, 0, 50) });
		expect(dropPlacement(row, slot, { x: 150, y: 20 })).toEqual({ index: 1, line: b(110, 0, 0, 50) });
		expect(dropPlacement(row, slot, { x: 200, y: 20 })).toEqual({ index: 2, line: b(230, 0, 0, 50) });
		expect(dropPlacement(row, slot, { x: 900, y: 20 })).toEqual({ index: 3, line: b(340, 0, 0, 50) });
	});

	test("flex column and block stack vertically", () => {
		const children: [number, Box][] = [
			[10, b(0, 0)],
			[20, b(0, 60)],
		];

		const column = layout(children, { display: "flex", flexDirection: "column" });
		expect(dropPlacement(column, slot, { x: 500, y: 10 })).toEqual({ index: 0, line: b(0, 0, 100, 0) });
		expect(dropPlacement(column, slot, { x: 500, y: 40 })).toEqual({ index: 1, line: b(0, 55, 100, 0) });
		expect(dropPlacement(layout(children), slot, { x: 500, y: 200 })).toEqual({ index: 2, line: b(0, 110, 100, 0) });
	});

	test("reversed row", () => {
		const reversed = layout(
			[
				[10, b(240, 0)],
				[20, b(120, 0)],
				[30, b(0, 0)],
			],
			{ display: "flex", flexDirection: "row-reverse" },
		);

		expect(dropPlacement(reversed, slot, { x: 330, y: 20 })).toEqual({ index: 0, line: b(340, 0, 0, 50) });
		expect(dropPlacement(reversed, slot, { x: 200, y: 20 })).toEqual({ index: 1, line: b(230, 0, 0, 50) });
		expect(dropPlacement(reversed, slot, { x: 5, y: 20 })).toEqual({ index: 3, line: b(0, 0, 0, 50) });
	});

	test("rtl row", () => {
		const rtl = layout(
			[
				[10, b(240, 0)],
				[20, b(120, 0)],
			],
			{ display: "flex", direction: "rtl" },
		);

		expect(dropPlacement(rtl, slot, { x: 330, y: 20 })).toEqual({ index: 0, line: b(340, 0, 0, 50) });
	});

	test("grid and wrapping rows pick the nearest child by row", () => {
		const children: [number, Box][] = [
			[10, b(0, 0)],
			[20, b(120, 0)],
			[30, b(0, 60)],
			[40, b(120, 60)],
		];

		const grid = layout(children, { display: "grid", gridColumns: 2 });
		expect(dropPlacement(grid, slot, { x: 140, y: 80 })).toEqual({ index: 3, line: b(110, 60, 0, 50) });
		expect(dropPlacement(grid, slot, { x: 200, y: 10 })).toEqual({ index: 2, line: b(220, 0, 0, 50) });
		// Below the last row, past its last child
		expect(dropPlacement(grid, slot, { x: 900, y: 900 })).toEqual({ index: 4, line: b(220, 60, 0, 50) });

		const wrap = layout(children, { display: "flex", flexWrap: "wrap" });
		expect(dropPlacement(wrap, slot, { x: 10, y: 70 })).toEqual({ index: 2, line: b(0, 60, 0, 50) });
	});

	test("an empty container gets a drop zone", () => {
		expect(dropPlacement(layout([]), slot, { x: 0, y: 0 })).toEqual({ index: 0, line: null });
	});

	test(".map instances collapse into one slot", () => {
		const mapped = layout(
			[
				[10, b(0, 0)],
				[20, b(0, 60)],
				[20, b(0, 120)],
				[20, b(0, 180)],
				[30, b(0, 240)],
			],
			{ display: "flex", flexDirection: "column" },
		);

		// Between instances: before or after the whole expression
		expect(dropPlacement(mapped, slot, { x: 0, y: 125 })).toEqual({ index: 1, line: b(0, 55, 100, 0) });
		expect(dropPlacement(mapped, slot, { x: 0, y: 200 })).toEqual({ index: 2, line: b(0, 235, 100, 0) });
	});

	test("children outside the target's slots are ignored", () => {
		const mixed = layout(
			[
				[10, b(0, 0)],
				[99, b(120, 0)],
				[20, b(240, 0)],
			],
			{ display: "flex" },
		);

		const known = (start: number) => (start === 99 ? -1 : slot(start));
		expect(dropPlacement(mixed, known, { x: 150, y: 20 })).toEqual({ index: 1, line: b(170, 0, 0, 50) });
	});
});
