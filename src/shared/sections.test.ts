import { describe, expect, test } from "bun:test";
import {
	groupBySection,
	membersOf,
	moveSection,
	nextSectionName,
	normalizeSections,
	SECTION_PADDING,
	sectionAround,
	sectionOf,
} from "./sections";
import type { CanvasSection, Frame } from "./types";

const frame = (file: string, x: number, y: number): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y,
	width: 100,
	height: 200,
});

const section = (id: string, x: number, y: number, width: number, height: number): CanvasSection => ({
	id,
	name: id,
	color: "gray",
	x,
	y,
	width,
	height,
});

describe("normalizeSections", () => {
	test("keeps valid sections, fills name and color, drops broken and duplicate ones", () => {
		const sections = normalizeSections([
			{ id: "a", name: "Onboarding", color: "blue", x: 0, y: 0, width: 10, height: 10 },
			{ id: "b", name: " ", color: "teal", x: 0, y: 0, width: 10, height: 10 },
			{ id: "a", name: "Again", color: "red", x: 0, y: 0, width: 10, height: 10 },
			{ id: "c", x: 0, y: 0, width: 0, height: 10 },
			{ id: "d", x: "0", y: 0, width: 10, height: 10 },
			"e",
		]);

		expect(sections).toEqual([
			{ id: "a", name: "Onboarding", color: "blue", x: 0, y: 0, width: 10, height: 10 },
			{ id: "b", name: "Section", color: "gray", x: 0, y: 0, width: 10, height: 10 },
		]);
		expect(normalizeSections(undefined)).toEqual([]);
	});
});

describe("sections", () => {
	test("a new section wraps the screens with room for their labels", () => {
		const around = sectionAround([frame("a", 0, 0), frame("b", 200, 100)], "s", "Section 1");

		expect(around).toEqual({
			id: "s",
			name: "Section 1",
			color: "gray",
			x: -SECTION_PADDING,
			y: -SECTION_PADDING,
			width: 300 + SECTION_PADDING * 2,
			height: 300 + SECTION_PADDING * 2,
		});
		expect(sectionAround([], "s", "x")).toBeNull();
	});

	test("names count up past the ones taken", () => {
		expect(nextSectionName([])).toBe("Section 1");
		expect(nextSectionName([{ ...section("a", 0, 0, 1, 1), name: "Section 2" }])).toBe("Section 3");
	});

	test("a screen belongs to the innermost section that holds its center", () => {
		const outer = section("outer", 0, 0, 1000, 1000);
		const inner = section("inner", 0, 0, 300, 300);

		expect(sectionOf(frame("a", 50, 50), [outer, inner])?.id).toBe("inner");
		expect(sectionOf(frame("b", 500, 500), [outer, inner])?.id).toBe("outer");
		expect(sectionOf(frame("c", 260, 0), [inner])).toBeUndefined();
		expect(sectionOf(frame("d", 2000, 0), [outer])).toBeUndefined();
	});

	test("moving a section moves its screens and the sections inside it", () => {
		const outer = section("outer", 0, 0, 1000, 1000);
		const inner = section("inner", 10, 10, 300, 300);
		const apart = section("apart", 2000, 0, 300, 300);
		const frames = [frame("in", 50, 50), frame("out", 1500, 0)];
		const moved = moveSection([outer, inner, apart], frames, "outer", 5, -5);

		expect(moved.sections.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
			{ id: "outer", x: 5, y: -5 },
			{ id: "inner", x: 15, y: 5 },
			{ id: "apart", x: 2000, y: 0 },
		]);
		expect(moved.frames[0]).toMatchObject({ x: 55, y: 45 });
		expect(moved.frames[1]).toBe(frames[1]!);
		expect(membersOf(outer, [outer, inner, apart], frames)).toEqual({ frames: ["in"], sections: ["inner"] });
	});

	test("a move by nothing or of a missing section changes nothing", () => {
		const sections = [section("a", 0, 0, 100, 100)];
		const frames = [frame("a", 0, 0)];

		expect(moveSection(sections, frames, "a", 0, 0).sections).toBe(sections);
		expect(moveSection(sections, frames, "x", 4, 4).frames).toBe(frames);
	});

	test("the screens list groups by section, empty sections included, loose screens last", () => {
		const a = section("a", 0, 0, 500, 500);
		const b = section("b", 1000, 0, 500, 500);
		const frames = [frame("one", 1100, 0), frame("two", 3000, 0), frame("three", 0, 0)];

		expect(groupBySection(frames, [a, b, section("empty", 9000, 0, 10, 10)])).toEqual([
			{ section: a, frames: [frames[2]!] },
			{ section: b, frames: [frames[0]!] },
			{ section: section("empty", 9000, 0, 10, 10), frames: [] },
			{ section: null, frames: [frames[1]!] },
		]);
		expect(groupBySection(frames.slice(0, 1), [])).toEqual([{ section: null, frames: frames.slice(0, 1) }]);
	});
});
