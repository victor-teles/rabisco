import { describe, expect, test } from "bun:test";
import { reorderOffsets } from "./reorder";

const row = (widths: number[], gap = 10) => {
	let x = 0;

	return widths.map((width) => {
		const box = { x, y: 0, width, height: 40 };
		x += width + gap;

		return box;
	});
};

describe("reorderOffsets", () => {
	test("items of one size take each other's places", () => {
		const boxes = row([100, 100, 100]);

		// The first item goes last; the others shift back one place
		expect(reorderOffsets(boxes, [1, 2, 0])).toEqual([
			{ x: 220, y: 0 },
			{ x: -110, y: 0 },
			{ x: -110, y: 0 },
		]);
	});

	test("items of different sizes pack along the row with their gaps", () => {
		const boxes = row([50, 100, 30]);

		// Order 2, 0, 1: the 30 wide item starts the row, then 50, then 100
		expect(reorderOffsets(boxes, [2, 0, 1])).toEqual([
			{ x: 40, y: 0 },
			{ x: 40, y: 0 },
			{ x: -170, y: 0 },
		]);
	});

	test("packs a reversed row from its right edge", () => {
		const boxes = row([50, 100, 30]).map((box) => ({ ...box, x: 300 - box.x - box.width }));

		expect(reorderOffsets(boxes, [2, 0, 1]).map((offset) => offset.x)).toEqual([-40, -40, 170]);
	});

	test("stacks columns vertically", () => {
		const boxes = [0, 50].map((y) => ({ x: 0, y, width: 200, height: 40 }));

		expect(reorderOffsets(boxes, [1, 0])).toEqual([
			{ x: 0, y: 50 },
			{ x: 0, y: -50 },
		]);
	});

	test("leaves everything in place for the identity order or a mismatch", () => {
		const boxes = row([100, 60]);

		expect(reorderOffsets(boxes, [0, 1])).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		]);
		expect(reorderOffsets(boxes, [0])).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		]);
	});
});
