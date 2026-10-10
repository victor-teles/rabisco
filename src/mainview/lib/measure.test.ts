import { describe, expect, test } from "bun:test";
import { measure, measureLabel } from "./measure";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("measure", () => {
	test("inside its parent: one line from each side to the parent's edge, through the element's center", () => {
		expect(measure(box(20, 30, 100, 40), box(0, 0, 200, 100))).toEqual({
			lines: [
				{ axis: "x", from: 0, to: 20, at: 50, value: 20 },
				{ axis: "x", from: 120, to: 200, at: 50, value: 80 },
				{ axis: "y", from: 0, to: 30, at: 70, value: 30 },
				{ axis: "y", from: 70, to: 100, at: 70, value: 30 },
			],
			guides: [],
		});
	});

	test("a child of the selection measures from the child's center", () => {
		const { lines } = measure(box(0, 0, 200, 100), box(20, 30, 100, 40));
		expect(lines.map((line) => [line.axis, line.value, line.at])).toEqual([
			["x", 20, 50],
			["x", 80, 50],
			["y", 30, 70],
			["y", 30, 70],
		]);
	});

	test("side by side: the gap, through the middle of the shared height", () => {
		expect(measure(box(0, 0, 50, 40), box(70, 20, 50, 60))).toEqual({
			lines: [{ axis: "x", from: 50, to: 70, at: 30, value: 20 }],
			guides: [],
		});
	});

	test("stacked with the target above: the vertical gap only", () => {
		expect(measure(box(10, 100, 50, 20), box(0, 0, 80, 60)).lines).toEqual([
			{ axis: "y", from: 60, to: 100, at: 35, value: 40 },
		]);
	});

	test("diagonal: both gaps from the selection's center, with guides out to the target", () => {
		expect(measure(box(0, 0, 40, 40), box(100, 100, 20, 20))).toEqual({
			lines: [
				{ axis: "x", from: 40, to: 100, at: 20, value: 60 },
				{ axis: "y", from: 40, to: 100, at: 20, value: 60 },
			],
			guides: [
				{ axis: "y", from: 20, to: 100, at: 100 },
				{ axis: "x", from: 20, to: 100, at: 100 },
			],
		});
	});

	test("the same box, or touching edges, have nothing to measure", () => {
		expect(measure(box(0, 0, 10, 10), box(0, 0, 10, 10)).lines).toEqual([]);
		expect(measure(box(0, 0, 10, 10), box(0, 0, 10, 20)).lines).toEqual([
			{ axis: "y", from: 10, to: 20, at: 5, value: 10 },
		]);
	});
});

test("labels keep one decimal at most", () => {
	expect(measureLabel(16)).toBe("16");
	expect(measureLabel(12.345)).toBe("12.3");
});
