import { describe, expect, test } from "bun:test";
import { resizeRect, snapResize } from "./frame-resize";

const origin = { x: 100, y: 100, width: 400, height: 200 };

describe("resizeRect", () => {
	test("a corner moves its two sides", () => {
		expect(resizeRect(origin, "se", 50, 20)).toEqual({ x: 100, y: 100, width: 450, height: 220 });
		expect(resizeRect(origin, "nw", 50, 20)).toEqual({ x: 150, y: 120, width: 350, height: 180 });
	});

	test("a side moves only its axis", () => {
		expect(resizeRect(origin, "e", 30, 999)).toEqual({ x: 100, y: 100, width: 430, height: 200 });
		expect(resizeRect(origin, "n", 999, -40)).toEqual({ x: 100, y: 60, width: 400, height: 240 });
	});

	test("⇧ keeps the aspect ratio", () => {
		expect(resizeRect(origin, "se", 400, 0, { keepRatio: true })).toEqual({ x: 100, y: 100, width: 800, height: 400 });
		expect(resizeRect(origin, "e", -200, 0, { keepRatio: true })).toEqual({ x: 100, y: 100, width: 200, height: 100 });
	});

	test("⌥ resizes from the center", () => {
		expect(resizeRect(origin, "e", 50, 0, { fromCenter: true })).toEqual({ x: 50, y: 100, width: 500, height: 200 });
	});

	test("never goes below the minimum size, and keeps the far side put", () => {
		expect(resizeRect(origin, "w", 1000, 0)).toEqual({ x: 460, y: 100, width: 40, height: 200 });
	});

	test("rounds to whole pixels", () => {
		expect(resizeRect(origin, "se", 10.4, 10.6)).toEqual({ x: 100, y: 100, width: 410, height: 211 });
	});
});

describe("snapResize", () => {
	const others = [{ x: 0, y: 500, width: 520, height: 100 }];

	test("moves the dragged side onto a nearby edge", () => {
		const { rect, guides } = snapResize({ x: 100, y: 100, width: 416, height: 200 }, "e", others, 6);

		expect(rect).toEqual({ x: 100, y: 100, width: 420, height: 200 });
		expect(guides).toContainEqual({ axis: "x", at: 520, from: 100, to: 600 });
	});

	test("moves a left side and keeps the right one", () => {
		const { rect } = snapResize({ x: 3, y: 100, width: 497, height: 200 }, "w", others, 6);

		expect(rect).toEqual({ x: 0, y: 100, width: 500, height: 200 });
	});

	test("leaves the sides the handle doesn't drag", () => {
		const { rect } = snapResize({ x: 3, y: 100, width: 300, height: 200 }, "e", others, 6);

		expect(rect.x).toBe(3);
	});
});
