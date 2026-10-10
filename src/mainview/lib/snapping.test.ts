import { describe, expect, test } from "bun:test";
import { guidesFor, nearestOffset, snapMove } from "./snapping";

const r = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe("nearestOffset", () => {
	test("picks the closest pair within the threshold", () => {
		expect(nearestOffset([0, 50, 100], [104, 203], 6)).toBe(4);
		expect(nearestOffset([0], [-3, 5], 6)).toBe(-3);
	});

	test("is 0 when nothing is close enough", () => {
		expect(nearestOffset([0, 100], [200], 6)).toBe(0);
		expect(nearestOffset([0], [], 6)).toBe(0);
	});
});

describe("snapMove", () => {
	const others = [r(0, 0, 200, 100)];

	test("snaps a left edge to another's right edge and shows a guide", () => {
		const snapped = snapMove(r(204, 300), others, 6);

		expect(snapped.x).toBe(200);
		expect(snapped.y).toBe(300);
		expect(snapped.guides).toContainEqual({ axis: "x", at: 200, from: 0, to: 400 });
	});

	test("snaps centers", () => {
		// The other's center is 100; this one's is x + 25
		const snapped = snapMove(r(78, 500, 50, 50), others, 6);

		expect(snapped.x).toBe(75);
		expect(snapped.guides.find((guide) => guide.axis === "x")?.at).toBe(100);
	});

	test("snaps each axis on its own", () => {
		const snapped = snapMove(r(500, 103), others, 6);

		expect(snapped).toMatchObject({ x: 500, y: 100 });
		expect(snapped.guides).toEqual([{ axis: "y", at: 100, from: 0, to: 600 }]);
	});

	test("leaves a rect far from the others alone", () => {
		expect(snapMove(r(700, 700), others, 6)).toEqual({ x: 700, y: 700, guides: [] });
	});
});

describe("guidesFor", () => {
	test("spans every rect on the line", () => {
		const guides = guidesFor(r(0, 500), [r(0, 0), r(0, 1000, 50, 50)]);

		expect(guides).toContainEqual({ axis: "x", at: 0, from: 0, to: 1050 });
	});
});
