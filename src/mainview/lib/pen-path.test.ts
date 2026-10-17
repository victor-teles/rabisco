import { describe, expect, test } from "bun:test";
import { penBounds, penPathData, penSnippet } from "./pen-path";

describe("pen path", () => {
	test("straight segments, open and closed", () => {
		const points = [
			{ x: 10, y: 10 },
			{ x: 50, y: 10 },
			{ x: 50, y: 40 },
		];

		expect(penPathData(points, false)).toBe("M10 10 L50 10 L50 40");
		expect(penPathData(points, true)).toBe("M10 10 L50 10 L50 40 Z");
		expect(penPathData(points.slice(0, 2), true)).toBe("M10 10 L50 10");
	});

	test("a dragged anchor curves both of its segments", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 40, y: 0, handle: { x: 10, y: 10 } },
			{ x: 80, y: 0 },
		];

		expect(penPathData(points, false)).toBe("M0 0 C0 0 30 -10 40 0 C50 10 80 0 80 0");
	});

	test("bounds hold the handles and room for the stroke", () => {
		expect(
			penBounds([
				{ x: 0, y: 0 },
				{ x: 40, y: 20, handle: { x: 0, y: 10 } },
			]),
		).toEqual({
			x: -1,
			y: -1,
			width: 42,
			height: 32,
		});
	});

	test("the snippet is an inline SVG at the path's size", () => {
		expect(
			penSnippet(
				[
					{ x: 100, y: 200 },
					{ x: 140, y: 230 },
				],
				false,
			),
		).toBe(
			'<svg viewBox="0 0 42 32" fill="none" className="h-[32px] w-[42px] shrink-0 text-foreground">' +
				'<path d="M1 1 L41 31" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />' +
				"</svg>",
		);
		expect(penSnippet([{ x: 0, y: 0 }], false)).toBeNull();
	});
});
