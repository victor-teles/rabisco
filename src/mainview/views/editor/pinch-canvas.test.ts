import { describe, expect, test } from "bun:test";
import { coverTop, fitText } from "./pinch-canvas";

describe("coverTop", () => {
	test("fills the box width and keeps the top of a tall image", () => {
		expect(coverTop({ width: 195, height: 844 }, { x: 10, y: 20, width: 39, height: 84.4 })).toEqual({
			x: 10,
			y: 20,
			width: 39,
			height: 168.8,
		});
	});

	test("centers a wide image horizontally", () => {
		expect(coverTop({ width: 400, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
			x: -150,
			y: 0,
			width: 400,
			height: 100,
		});
	});
});

describe("fitText", () => {
	const measure = (text: string) => text.length * 10;

	test("keeps text that fits", () => {
		expect(fitText("Home", 40, measure)).toBe("Home");
	});

	test("cuts the longest prefix that fits with an ellipsis", () => {
		expect(fitText("Settings", 50, measure)).toBe("Sett…");
	});

	test("leaves only the ellipsis when nothing else fits", () => {
		expect(fitText("Settings", 5, measure)).toBe("…");
	});
});
