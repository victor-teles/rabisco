import { describe, expect, test } from "bun:test";
import { addGuide, moveGuide, normalizeGuides, parseGuides } from "./guides";
import type { Frame } from "./types";

const frame: Frame = { file: "screens/a.tsx", name: "A", device: "desktop", x: 0, y: 0, width: 1280, height: 800 };

describe("guides", () => {
	test("normalize rounds, keeps them inside the frame and drops repeats", () => {
		expect(
			normalizeGuides(
				[
					{ axis: "y", at: 40.4 },
					{ axis: "x", at: 1300 },
					{ axis: "x", at: 80 },
					{ axis: "y", at: 40 },
					{ axis: "x", at: -1 },
				],
				frame,
			),
		).toEqual([
			{ axis: "x", at: 80 },
			{ axis: "y", at: 40 },
		]);
	});

	test("parse takes valid entries only", () => {
		expect(parseGuides([{ axis: "x", at: 12.6 }, { axis: "z", at: 1 }, { axis: "y" }, "x"])).toEqual([
			{ axis: "x", at: 13 },
		]);
		expect(parseGuides([])).toBeUndefined();
		expect(parseGuides({ axis: "x" })).toBeUndefined();
	});

	test("add and move; a guide moved out of the frame goes", () => {
		const one = { ...frame, guides: addGuide(frame, { axis: "x", at: 320 }) };

		expect(one.guides).toEqual([{ axis: "x", at: 320 }]);
		expect(moveGuide(one, 0, 640)).toEqual([{ axis: "x", at: 640 }]);
		expect(moveGuide(one, 0, -20)).toBeUndefined();
	});
});
