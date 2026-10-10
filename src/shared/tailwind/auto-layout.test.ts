import { describe, expect, test } from "bun:test";
import { readAutoLayout, setAlignment, setDirection, setSpaced } from "./auto-layout";

describe("readAutoLayout", () => {
	test("a row reads justify on x and items on y", () => {
		expect(readAutoLayout("flex justify-center items-end")).toEqual({
			direction: "row",
			cell: { x: "center", y: "end" },
			spaced: false,
		});
	});

	test("a column reads justify on y and items on x", () => {
		expect(readAutoLayout("flex flex-col justify-end items-center")).toEqual({
			direction: "col",
			cell: { x: "center", y: "end" },
			spaced: false,
		});
	});

	test("no classes is top left, and stretch reads as start", () => {
		expect(readAutoLayout("flex items-stretch").cell).toEqual({ x: "start", y: "start" });
	});

	test("between, around and evenly are spaced", () => {
		expect(readAutoLayout("flex justify-between items-center")).toEqual({
			direction: "row",
			cell: { x: "start", y: "center" },
			spaced: true,
		});
		expect(readAutoLayout("flex justify-evenly").spaced).toBe(true);
	});

	test("a reversed row puts justify-start on the right", () => {
		expect(readAutoLayout("flex flex-row-reverse").cell).toEqual({ x: "end", y: "start" });
	});

	test("a state falls back to the default classes", () => {
		expect(readAutoLayout("flex flex-col items-center md:justify-end", "md")).toEqual({
			direction: "col",
			cell: { x: "center", y: "end" },
			spaced: false,
		});
	});
});

describe("setAlignment", () => {
	test("writes justify and items for a row", () => {
		expect(setAlignment("flex gap-2", { x: "center", y: "end" })).toBe("flex gap-2 justify-center items-end");
	});

	test("writes the axes swapped for a column", () => {
		expect(setAlignment("flex flex-col", { x: "end", y: "center" })).toBe("flex flex-col justify-center items-end");
	});

	test("top left removes justify and keeps a stretch", () => {
		expect(setAlignment("flex justify-center", { x: "start", y: "start" })).toBe("flex");
		expect(setAlignment("flex items-stretch justify-end", { x: "start", y: "start" })).toBe("flex items-stretch");
	});

	test("spaced keeps between and only moves the cross axis", () => {
		expect(setAlignment("flex justify-between", { x: "end", y: "center" })).toBe("flex justify-between items-center");
	});

	test("a reversed row writes the flipped justify", () => {
		expect(setAlignment("flex flex-row-reverse", { x: "start", y: "start" })).toBe("flex flex-row-reverse justify-end");
	});

	test("in a state, start overrides a default that isn't start", () => {
		expect(setAlignment("flex justify-center", { x: "start", y: "start" }, "md")).toBe(
			"flex justify-center md:justify-start",
		);
	});
});

describe("setSpaced", () => {
	test("on writes justify-between", () => {
		expect(setSpaced("flex justify-center items-center", true)).toBe("flex justify-between items-center");
	});

	test("off goes back to start", () => {
		expect(setSpaced("flex justify-between items-center", false)).toBe("flex items-center");
	});
});

describe("setDirection", () => {
	test("keeps the alignment where it shows", () => {
		expect(setDirection("flex justify-center items-end", "col")).toBe("flex justify-end items-center flex-col");
	});

	test("back to a row drops flex-col", () => {
		expect(setDirection("flex flex-col justify-center", "row")).toBe("flex items-center");
	});

	test("keeps spacing", () => {
		expect(setDirection("flex justify-between", "col")).toBe("flex justify-between flex-col");
	});
});
