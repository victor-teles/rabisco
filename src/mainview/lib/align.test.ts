import { describe, expect, test } from "bun:test";
import { align, boundsOf, distribute, intersects, rectFromPoints } from "./align";

const r = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe("geometry", () => {
	test("boundsOf", () => {
		expect(boundsOf([])).toBeNull();
		expect(boundsOf([r(0, 0), r(200, 50, 50, 300)])).toEqual({ x: 0, y: 0, width: 250, height: 350 });
	});

	test("rectFromPoints normalizes", () => {
		expect(rectFromPoints({ x: 10, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 10, height: 50 });
	});

	test("intersects", () => {
		expect(intersects(r(0, 0), r(50, 50))).toBe(true);
		expect(intersects(r(0, 0), r(100, 0))).toBe(true);
		expect(intersects(r(0, 0), r(101, 0))).toBe(false);
	});
});

describe("align", () => {
	const rects = [r(0, 0, 100, 100), r(300, 200, 50, 40)];

	test("left, right and center", () => {
		expect(align(rects, "left").map((x) => x.x)).toEqual([0, 0]);
		expect(align(rects, "right").map((x) => x.x)).toEqual([250, 300]);
		expect(align(rects, "h-center").map((x) => x.x)).toEqual([125, 150]);
	});

	test("top, bottom and middle", () => {
		expect(align(rects, "top").map((x) => x.y)).toEqual([0, 0]);
		expect(align(rects, "bottom").map((x) => x.y)).toEqual([140, 200]);
		expect(align(rects, "v-middle").map((x) => x.y)).toEqual([70, 100]);
	});

	test("keeps extra fields and needs two rects", () => {
		const one = [{ ...r(5, 5), file: "a" }];
		expect(align(one, "left")).toBe(one);
		expect(align([{ ...r(5, 5), file: "a" }, { ...r(0, 0), file: "b" }], "left")[0]!.file).toBe("a");
	});
});

describe("distribute", () => {
	test("horizontal spacing keeps the ends and evens the gaps", () => {
		// Input order is not position order
		const out = distribute([r(1000, 0, 100), r(0, 0, 100), r(150, 0, 200)], "horizontal");
		expect(out.map((x) => x.x)).toEqual([1000, 0, 450]);
	});

	test("vertical spacing", () => {
		const out = distribute([r(0, 0, 10, 10), r(0, 20, 10, 10), r(0, 100, 10, 10), r(0, 40, 10, 30)], "vertical");
		// span 110, occupied 60, gap 50/3
		expect(out.map((x) => x.y)).toEqual([0, 27, 100, 53]);
	});

	test("needs three rects", () => {
		const two = [r(0, 0), r(500, 0)];
		expect(distribute(two, "horizontal")).toBe(two);
	});
});
