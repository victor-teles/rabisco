import { describe, expect, test } from "bun:test";
import { gapRects, insetBox, paddingRects } from "./spacing";

const none = { top: 0, right: 0, bottom: 0, left: 0 };

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("paddingRects", () => {
	test("draws each side inside the border, without overlapping corners", () => {
		const border = { top: 1, right: 1, bottom: 1, left: 1 };
		const padding = { top: 10, right: 20, bottom: 10, left: 20 };

		expect(paddingRects(box(0, 0, 102, 52), border, padding)).toEqual([
			box(1, 1, 100, 10),
			box(1, 41, 100, 10),
			box(1, 11, 20, 30),
			box(81, 11, 20, 30),
		]);
	});

	test("leaves out sides without padding", () => {
		expect(paddingRects(box(0, 0, 100, 50), none, { top: 0, right: 0, bottom: 0, left: 16 })).toEqual([
			box(0, 0, 16, 50),
		]);

		expect(paddingRects(box(0, 0, 100, 50), none, none)).toEqual([]);
	});

	test("never reaches past the box", () => {
		const rects = paddingRects(box(0, 0, 10, 10), none, { top: 8, right: 0, bottom: 8, left: 0 });
		expect(rects).toEqual([box(0, 0, 10, 8), box(0, 8, 10, 2)]);
	});
});

describe("gapRects", () => {
	const content = box(0, 0, 300, 100);

	test("a flex row: the space between neighbours, as tall as the line", () => {
		const children = [box(0, 0, 80, 100), box(96, 20, 80, 40), box(192, 0, 80, 100)];

		expect(gapRects(content, children, { row: 0, column: 16 }, "row")).toEqual([
			box(80, 0, 16, 100),
			box(176, 0, 16, 100),
		]);
	});

	test("a flex column swaps the axes", () => {
		const children = [box(0, 0, 300, 20), box(0, 28, 200, 20)];

		expect(gapRects(content, children, { row: 8, column: 0 }, "column")).toEqual([box(0, 20, 300, 8)]);
	});

	test("children in DOM order that isn't visual order (reversed rows)", () => {
		const children = [box(192, 0, 80, 100), box(96, 0, 80, 100), box(0, 0, 80, 100)];

		expect(gapRects(content, children, { row: 0, column: 16 }, "row")).toEqual([
			box(80, 0, 16, 100),
			box(176, 0, 16, 100),
		]);
	});

	test("a grid or wrapping row: gaps within lines and between them", () => {
		const grid = box(0, 0, 210, 210);
		const cells = [box(0, 0, 100, 100), box(110, 0, 100, 100), box(0, 110, 100, 100), box(110, 110, 100, 100)];

		expect(gapRects(grid, cells, { row: 10, column: 10 }, "row")).toEqual([
			box(100, 0, 10, 100),
			box(0, 100, 210, 10),
			box(100, 110, 10, 100),
		]);
	});

	test("only the axes that set a gap, and nothing for touching or hidden children", () => {
		const children = [box(0, 0, 100, 40), box(100, 0, 100, 40), box(0, 50, 100, 40), box(5, 5, 0, 0)];

		expect(gapRects(content, children, { row: 10, column: 0 }, "row")).toEqual([box(0, 40, 300, 10)]);
		expect(gapRects(content, children, { row: 0, column: 10 }, "row")).toEqual([]);
	});
});

test("insetBox never goes negative", () => {
	expect(insetBox(box(0, 0, 10, 10), { top: 8, right: 8, bottom: 8, left: 8 })).toEqual(box(8, 8, 0, 0));
});
