import { describe, expect, test } from "bun:test";
import { emptyCanvas, FRAME_GAP, reconcileFrames } from "./project";
import type { Frame } from "./types";
import {
	alternatesOf,
	altNumber,
	altPath,
	baseOf,
	groupOf,
	nextAltNumber,
	pickVariation,
	placeNewFrames,
	selectionAfterPick,
	variationGroups,
} from "./variations";

const frame = (file: string, x: number, y = 0): Frame => ({ file, name: file, device: "mobile", x, y, width: 390, height: 844 });

describe("alternate names", () => {
	test("base and number", () => {
		expect(baseOf("screens/welcome.alt-2.tsx")).toBe("screens/welcome.tsx");
		expect(baseOf("screens/welcome.tsx")).toBe("screens/welcome.tsx");
		expect(baseOf("components/button.tsx")).toBe("components/button.tsx");
		expect(altNumber("screens/welcome.alt-12.tsx")).toBe(12);
		expect(altNumber("screens/welcome.tsx")).toBeNull();
		expect(altPath("screens/welcome.tsx", 3)).toBe("screens/welcome.alt-3.tsx");
	});

	test("next free number is one above the highest", () => {
		expect(nextAltNumber("screens/a.tsx", ["screens/a.tsx"])).toBe(1);
		expect(nextAltNumber("screens/a.tsx", ["screens/a.tsx", "screens/a.alt-1.tsx", "screens/a.alt-4.tsx", "screens/b.alt-9.tsx"])).toBe(5);
	});
});

describe("groups", () => {
	const paths = ["screens/a.tsx", "screens/a.alt-2.tsx", "screens/a.alt-1.tsx", "screens/b.tsx", "screens/c.alt-1.tsx"];

	test("only screens with alternates form groups, picked first", () => {
		expect(variationGroups(paths)).toEqual([
			{ base: "screens/a.tsx", picked: "screens/a.tsx", files: ["screens/a.tsx", "screens/a.alt-1.tsx", "screens/a.alt-2.tsx"] },
			{ base: "screens/c.tsx", picked: null, files: ["screens/c.alt-1.tsx"] },
		]);
		expect(groupOf("screens/a.alt-1.tsx", paths)?.base).toBe("screens/a.tsx");
		expect(groupOf("screens/b.tsx", paths)).toBeNull();
	});

	test("canvas groups mirror the files", () => {
		expect(alternatesOf(paths)).toEqual([
			{ picked: "screens/a.tsx", files: ["screens/a.tsx", "screens/a.alt-1.tsx", "screens/a.alt-2.tsx"] },
			{ picked: "screens/c.tsx", files: ["screens/c.alt-1.tsx"] },
		]);
	});
});

describe("pick", () => {
	test("swaps contents with the base file", () => {
		const files = { "screens/a.tsx": "A", "screens/a.alt-1.tsx": "B" };
		expect(pickVariation(files, "screens/a.alt-1.tsx")).toEqual([
			{ path: "screens/a.tsx", content: "B" },
			{ path: "screens/a.alt-1.tsx", content: "A" },
		]);
		expect(selectionAfterPick(["screens/a.alt-1.tsx", "screens/x.tsx"], "screens/a.alt-1.tsx")).toEqual(["screens/a.tsx", "screens/x.tsx"]);
	});

	test("takes the base name when the base is gone", () => {
		expect(pickVariation({ "screens/a.alt-1.tsx": "B" }, "screens/a.alt-1.tsx")).toEqual([
			{ path: "screens/a.tsx", content: "B" },
			{ path: "screens/a.alt-1.tsx", content: null },
		]);
	});

	test("picking the base or a missing file changes nothing", () => {
		expect(pickVariation({ "screens/a.tsx": "A" }, "screens/a.tsx")).toEqual([]);
		expect(pickVariation({ "screens/a.tsx": "A" }, "screens/a.alt-1.tsx")).toEqual([]);
	});
});

describe("placeNewFrames", () => {
	test("alternates go below their group, one row each", () => {
		const canvas = [frame("screens/a.tsx", 100, 50), frame("screens/b.tsx", 700)];
		const placed = placeNewFrames(canvas, [frame("screens/a.alt-1.tsx", 0), frame("screens/a.alt-2.tsx", 0)]);
		expect(placed.map(({ x, y }) => ({ x, y }))).toEqual([
			{ x: 100, y: 50 + 844 + FRAME_GAP },
			{ x: 100, y: 50 + (844 + FRAME_GAP) * 2 },
		]);
	});

	test("new screens keep their layout and move right of the canvas", () => {
		const canvas = [frame("screens/a.tsx", 0)];
		const placed = placeNewFrames(canvas, [frame("screens/b.tsx", 0), frame("screens/b.alt-1.tsx", 0, 964), frame("screens/c.tsx", 510)]);
		const x = 390 + FRAME_GAP * 2;
		expect(placed.map(({ file, x, y }) => ({ file, x, y }))).toEqual([
			{ file: "screens/b.tsx", x, y: 0 },
			{ file: "screens/b.alt-1.tsx", x, y: 964 },
			{ file: "screens/c.tsx", x: x + 510, y: 0 },
		]);
	});
});

describe("reconcileFrames", () => {
	test("an alternate added on disk goes below its screen", () => {
		const canvas = { ...emptyCanvas("x", "mobile"), frames: [frame("screens/a.tsx", 100, 20), frame("screens/b.tsx", 700)] };
		const files = { "screens/a.tsx": "", "screens/b.tsx": "", "screens/a.alt-1.tsx": "", "screens/c.tsx": "" };
		const added = reconcileFrames(canvas, files).frames.slice(2);
		expect(added.map(({ file, x, y }) => ({ file, x, y }))).toEqual([
			{ file: "screens/a.alt-1.tsx", x: 100, y: 20 + 844 + FRAME_GAP },
			{ file: "screens/c.tsx", x: 700 + 390 + FRAME_GAP * 2, y: 0 },
		]);
	});
});
