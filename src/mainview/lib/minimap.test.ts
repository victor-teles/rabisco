import { describe, expect, test } from "bun:test";
import { centeredView, containsRect, minimapLayout, toCanvasPoint, visibleArea } from "./minimap";

describe("minimap", () => {
	test("fits the content into the box, keeping its proportions", () => {
		const layout = minimapLayout({ x: -100, y: 0, width: 2000, height: 500 }, 200, 120);

		expect(layout.scale).toBe(0.1);
		expect(layout).toMatchObject({ width: 200, height: 50 });
		expect(toCanvasPoint(layout, { x: 100, y: 25 })).toEqual({ x: 900, y: 250 });
	});

	test("visibleArea is the inverse of the viewport transform", () => {
		expect(visibleArea({ x: -200, y: 100, zoom: 2 }, 800, 600)).toEqual({ x: 100, y: -50, width: 400, height: 300 });
	});

	test("centeredView puts the point in the middle of the view", () => {
		const view = centeredView({ x: 500, y: 300 }, 0.5, 800, 600);
		const area = visibleArea(view, 800, 600);

		expect(area.x + area.width / 2).toBe(500);
		expect(area.y + area.height / 2).toBe(300);
	});

	test("containsRect", () => {
		const outer = { x: 0, y: 0, width: 100, height: 100 };

		expect(containsRect(outer, { x: 10, y: 10, width: 90, height: 90 })).toBe(true);
		expect(containsRect(outer, { x: 10, y: 10, width: 91, height: 10 })).toBe(false);
	});
});
