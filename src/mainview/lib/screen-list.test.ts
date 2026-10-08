import { describe, expect, test } from "bun:test";
import type { Frame } from "../../shared/types";
import { matchesScreen, reorderFrames, stepTarget } from "./screen-list";

const frame = (file: string, name = file): Frame => ({
	file: `screens/${file}.tsx`,
	name,
	device: "mobile",
	x: 0,
	y: 0,
	width: 390,
	height: 844,
});

const frames = ["a", "b", "c", "d"].map((file) => frame(file));

const files = (list: Frame[]) => list.map((f) => f.file.slice(8, -4)).join("");

const path = (file: string) => `screens/${file}.tsx`;

describe("reorderFrames", () => {
	test("moves frames in front of another, keeping their order", () => {
		expect(files(reorderFrames(frames, [path("d"), path("b")], path("a")))).toBe("bdac");
		expect(files(reorderFrames(frames, [path("a")], null))).toBe("bcda");
	});

	test("returns the same array when nothing moves", () => {
		expect(reorderFrames(frames, [path("a")], path("b"))).toBe(frames);
		expect(reorderFrames(frames, [path("b")], path("b"))).toBe(frames);
		expect(reorderFrames(frames, [], null)).toBe(frames);
		expect(reorderFrames(frames, [path("x")], null)).toBe(frames);
	});
});

describe("stepTarget", () => {
	test("up goes in front of the frame above", () => {
		expect(stepTarget(frames, [path("c")], -1)).toBe(path("b"));
		expect(stepTarget(frames, [path("a")], -1)).toBeUndefined();
	});

	test("down goes past the frame below", () => {
		expect(stepTarget(frames, [path("b")], 1)).toBe(path("d"));
		expect(stepTarget(frames, [path("c")], 1)).toBeNull();
		expect(stepTarget(frames, [path("d")], 1)).toBeUndefined();
		expect(files(reorderFrames(frames, [path("a"), path("b")], stepTarget(frames, [path("a"), path("b")], 1)!))).toBe(
			"cabd",
		);
	});
});

test("matchesScreen looks at the name and the path, ignoring case", () => {
	expect(matchesScreen(frame("home", "Welcome"), "WEL")).toBe(true);
	expect(matchesScreen(frame("home", "Welcome"), "home")).toBe(true);
	expect(matchesScreen(frame("home", "Welcome"), "  ")).toBe(true);
	expect(matchesScreen(frame("home", "Welcome"), "pricing")).toBe(false);
});
