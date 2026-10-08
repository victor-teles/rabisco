import { describe, expect, test } from "bun:test";
import {
	draggedGap,
	draggedPadding,
	gapLabel,
	gapPartOf,
	gapParts,
	gapPreview,
	handleDimensions,
	paddingLabel,
	paddingSides,
	resizedSize,
	setFixedSize,
	setGap,
	setPadding,
	setSizeMode,
	sizeLabel,
	sizeMode,
	sizePreview,
	spacingPixels,
	spacingValue,
} from "./resize";

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe("spacingValue", () => {
	test("snaps to the nearest step of the scale", () => {
		expect(spacingValue(256)).toBe("64");
		expect(spacingValue(250)).toBe("64");
		expect(spacingValue(270)).toBe("64");
		expect(spacingValue(278)).toBe("72");
		expect(spacingValue(17)).toBe("4");
		expect(spacingValue(1)).toBe("px");
		expect(spacingValue(0)).toBe("0");
		expect(spacingValue(-20)).toBe("0");
		expect(spacingValue(6)).toBe("1.5");
	});

	test("takes whole units beyond the named steps", () => {
		expect(spacingValue(400)).toBe("100");
		expect(spacingValue(401)).toBe("100");
	});

	test("round-trips through pixels", () => {
		expect(spacingPixels("64")).toBe(256);
		expect(spacingPixels("px")).toBe(1);
		expect(spacingPixels("0.5")).toBe(2);
		expect(spacingPixels("full")).toBeNull();
		expect(spacingPixels("")).toBeNull();
	});
});

describe("sizes", () => {
	test("reads the mode from the classes and the parent", () => {
		expect(sizeMode("p-4", "width", null)).toBe("hug");
		expect(sizeMode("w-fit", "width", null)).toBe("hug");
		expect(sizeMode("w-64", "width", null)).toBe("fixed");
		expect(sizeMode("size-10", "height", null)).toBe("fixed");
		expect(sizeMode("w-full", "width", "column")).toBe("fill");
		expect(sizeMode("flex-1", "width", "row")).toBe("fill");
		expect(sizeMode("flex-1", "width", "column")).toBe("hug");
	});

	test("writes a fixed size and stops a grown child", () => {
		expect(setFixedSize("p-4", "width", "64", null)).toBe("p-4 w-64");
		expect(setFixedSize("flex-1 p-4", "width", "64", "row")).toBe("p-4 w-64");
		expect(setFixedSize("w-10 h-12", "height", "10", null)).toBe("size-10");
	});

	test("fills with flex-1 along the parent's main axis, full elsewhere", () => {
		expect(setSizeMode("w-64 p-4", "width", "fill", "row", 0)).toBe("p-4 flex-1");
		expect(setSizeMode("w-64 p-4", "width", "fill", "column", 0)).toBe("w-full p-4");
		expect(setSizeMode("h-10", "height", "fill", null, 0)).toBe("h-full");
	});

	test("hugs by removing the size where the layout already hugs, with fit elsewhere", () => {
		expect(setSizeMode("flex-1 w-64", "width", "hug", "row", 0)).toBe("");
		expect(setSizeMode("w-64 p-2", "width", "hug", "column", 0)).toBe("w-fit p-2");
		expect(setSizeMode("w-64", "width", "hug", null, 0)).toBe("w-fit");
		expect(setSizeMode("h-40", "height", "hug", null, 0)).toBe("");
		expect(setSizeMode("h-40", "height", "hug", "row", 0)).toBe("h-fit");
	});

	test("fixes the rendered size on the scale", () => {
		expect(setSizeMode("w-full", "width", "fixed", null, 250)).toBe("w-64");
	});

	test("labels what a drag writes", () => {
		expect(sizeLabel({ width: "64" })).toBe("w-64");
		expect(sizeLabel({ width: "10", height: "10" })).toBe("size-10");
		expect(sizeLabel({ width: "10", height: "12" })).toBe("w-10 h-12");
	});

	test("previews a size, without growth along the main axis", () => {
		expect(sizePreview({ width: 256 }, null)).toEqual({ width: "256px" });
		expect(sizePreview({ width: 256, height: 40 }, "row")).toEqual({
			width: "256px",
			"flex-grow": "0",
			"flex-basis": "auto",
			height: "40px",
		});
	});
});

describe("resize handles", () => {
	test("move the dimensions of their edge or corner", () => {
		expect(handleDimensions("e")).toEqual(["width"]);
		expect(handleDimensions("n")).toEqual(["height"]);
		expect(handleDimensions("sw")).toEqual(["width", "height"]);
	});

	test("grow away from the opposite edge", () => {
		const start = { width: 100, height: 50 };

		expect(resizedSize("e", start, { x: 20, y: 5 })).toEqual({ width: 120 });
		expect(resizedSize("w", start, { x: 20, y: 5 })).toEqual({ width: 80 });
		expect(resizedSize("nw", start, { x: -10, y: -10 })).toEqual({ width: 110, height: 60 });
		expect(resizedSize("s", start, { x: 0, y: -80 })).toEqual({ height: 0 });
	});
});

describe("padding", () => {
	test("grows toward the element's center", () => {
		const start = { top: 16, right: 16, bottom: 16, left: 16 };

		expect(draggedPadding("top", start, { x: 0, y: 8 })).toBe(24);
		expect(draggedPadding("bottom", start, { x: 0, y: 8 })).toBe(8);
		expect(draggedPadding("left", start, { x: 8, y: 0 })).toBe(24);
		expect(draggedPadding("right", none, { x: 8, y: 0 })).toBe(0);
	});

	test("takes the opposite side with ⇧ and every side with ⌥", () => {
		expect(paddingSides("top", { all: false, symmetric: false })).toEqual(["top"]);
		expect(paddingSides("left", { all: false, symmetric: true })).toEqual(["left", "right"]);
		expect(paddingSides("left", { all: true, symmetric: true })).toEqual(["top", "right", "bottom", "left"]);
	});

	test("writes the shortest classes", () => {
		expect(setPadding("p-4", ["top"], "8")).toBe("px-4 pt-8 pb-4");
		expect(setPadding("p-4", ["top", "right", "bottom", "left"], "8")).toBe("p-8");
		expect(setPadding("px-2", ["top", "bottom"], "2")).toBe("p-2");
		expect(paddingLabel(["top", "bottom"], "4")).toBe("py-4");
		expect(paddingLabel(["left"], "4")).toBe("pl-4");
	});
});

describe("gap", () => {
	test("follows the gap box's orientation", () => {
		expect(gapPartOf({ width: 16, height: 100 })).toBe("x");
		expect(gapPartOf({ width: 100, height: 16 })).toBe("y");
		expect(draggedGap("x", 16, { x: 8, y: 100 })).toBe(24);
		expect(draggedGap("y", 16, { x: 0, y: -40 })).toBe(0);
	});

	test("writes one gap in flex, the dragged part in a grid or a split gap", () => {
		expect(gapParts("gap-4", "x", "row")).toEqual(["x", "y"]);
		expect(gapParts("gap-x-4 gap-y-2", "y", "column")).toEqual(["y"]);
		expect(gapParts("gap-4", "x", "grid")).toEqual(["x"]);
		expect(setGap("flex gap-4", ["x", "y"], "6")).toBe("flex gap-6");
		expect(setGap("grid gap-4", ["x"], "6")).toBe("grid gap-x-6 gap-y-4");
		expect(gapLabel("grid gap-4", ["x"], "6")).toBe("gap-x-6 gap-y-4");
		expect(gapPreview(["x"], 24)).toEqual({ "column-gap": "24px" });
	});
});
