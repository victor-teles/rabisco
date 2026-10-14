import { describe, expect, test } from "bun:test";
import { alignElements, distributeElements, needsPlacements, type Arranged } from "./element-align";
import type { Placement } from "./render/protocol";

const screen = (parent: string, children: string[]) =>
	`export default function Screen() {\n\treturn (\n\t\t<div className="${parent}">\n${children.map((child) => `\t\t\t${child}`).join("\n")}\n\t\t</div>\n\t);\n}\n`;

const sourceOf = (result: Arranged) => {
	if ("refusal" in result) throw new Error(result.refusal);

	return result.source;
};

const ROW = screen("flex gap-4", [`<a className="p-2">A</a>`, `<b className="mx-2">B</b>`, `<i>C</i>`]);

const at = (source: string, text: string) => source.indexOf(text);

const placed = (x: number, y: number, width: number, height: number, margin = { x: 0, y: 0 }): Placement => ({
	box: { x, y, width, height },
	margin,
	container: { width: 320, height: 160 },
});

const FREE = screen("relative h-40 w-80", [
	`<a className="absolute left-2 top-2 size-10">A</a>`,
	`<b className="absolute left-20 top-8 size-16">B</b>`,
	`<i className="absolute right-4 bottom-6 h-8 w-12">C</i>`,
]);

const FREE_STARTS = [at(FREE, "<a"), at(FREE, "<b"), at(FREE, "<i")];

const FREE_PLACEMENTS = [placed(8, 8, 40, 40), placed(80, 32, 64, 64), placed(256, 120, 48, 32)];

describe("alignElements", () => {
	test("aligns some children of a row on the cross axis with self-*", () => {
		const result = alignElements(ROW, [at(ROW, "<a"), at(ROW, "<b")], "bottom", null);

		expect(sourceOf(result)).toContain(`<a className="p-2 self-end">A</a>`);
		expect(sourceOf(result)).toContain(`<b className="mx-2 self-end">B</b>`);
	});

	test("aligns every child of a row with items-* on the parent", () => {
		const source = screen("flex", [`<a className="self-start">A</a>`, `<b>B</b>`]);
		const result = alignElements(source, [at(source, "<a"), at(source, "<b")], "v-middle", null);

		expect(sourceOf(result)).toContain(`<div className="flex items-center">`);
		expect(sourceOf(result)).toContain(`<a>A</a>`);
	});

	test("keeps the selection on the elements after the parent's classes grow", () => {
		const source = screen("flex", [`<a>A</a>`, `<b>B</b>`]);
		const result = alignElements(source, [at(source, "<a"), at(source, "<b")], "top", null);

		if ("refusal" in result) throw new Error(result.refusal);

		expect(result.starts).toEqual([at(result.source, "<a"), at(result.source, "<b")]);
	});

	test("aligns along a row with justify-* when every child is selected", () => {
		const source = screen("flex flex-row-reverse", [`<a>A</a>`, `<b>B</b>`]);
		const result = alignElements(source, [at(source, "<a"), at(source, "<b")], "left", null);

		expect(sourceOf(result)).toContain(`<div className="flex flex-row-reverse justify-end">`);
	});

	test("refuses to align part of a row along it", () => {
		expect(alignElements(ROW, [at(ROW, "<a")], "right", null)).toEqual({
			refusal: "Select every child of the row to align them along it",
		});
	});

	test("centers in normal flow with auto margins", () => {
		const source = screen("p-4", [`<a className="w-64">A</a>`, `<b className="ml-auto">B</b>`]);
		const result = sourceOf(alignElements(source, [at(source, "<a"), at(source, "<b")], "h-center", null));

		expect(result).toContain(`<a className="w-64 mx-auto">A</a>`);
		expect(result).toContain(`<b className="mx-auto">B</b>`);
		expect(sourceOf(alignElements(result, [at(result, "<b")], "left", null))).toContain(`<b>B</b>`);
	});

	test("aligns grid items with justify-self-* and self-*", () => {
		const source = screen("grid grid-cols-2", [`<a>A</a>`, `<b>B</b>`]);

		expect(sourceOf(alignElements(source, [at(source, "<a")], "right", null))).toContain(
			`<a className="justify-self-end">A</a>`,
		);
		expect(sourceOf(alignElements(source, [at(source, "<a")], "bottom", null))).toContain(
			`<a className="self-end">A</a>`,
		);
	});

	test("aligns absolutely positioned elements by rewriting left-* and top-*", () => {
		const aligned = (alignment: Parameters<typeof alignElements>[2]) =>
			sourceOf(alignElements(FREE, FREE_STARTS, alignment, null, FREE_PLACEMENTS));

		expect(aligned("left")).toContain(`<i className="absolute bottom-6 left-2 h-8 w-12">C</i>`);
		expect(aligned("left")).toContain(`<b className="absolute top-8 left-2 size-16">B</b>`);
		expect(aligned("right")).toContain(`<a className="absolute top-2 left-66 size-10">A</a>`);
		expect(aligned("h-center")).toContain(`<a className="absolute top-2 left-34 size-10">A</a>`);
		expect(aligned("top")).toContain(`<i className="absolute top-2 right-4 h-8 w-12">C</i>`);
		expect(aligned("v-middle")).toContain(`<b className="absolute top-12 left-20 size-16">B</b>`);
		expect(aligned("bottom")).toContain(`<a className="absolute top-28 left-2 size-10">A</a>`);
	});

	test("aligns one absolutely positioned element in its containing block", () => {
		const source = screen("relative", [`<a className="absolute left-1/2 top-4 -translate-x-1/2 w-20">A</a>`]);
		const result = alignElements(source, [at(source, "<a")], "right", null, [placed(120, 16, 80, 20)]);

		expect(sourceOf(result)).toContain(`<a className="absolute top-4 left-60 w-20">A</a>`);
	});

	test("subtracts the margin and keeps a stretched element's size", () => {
		const source = screen("relative", [`<a className="absolute inset-x-4 top-0 mx-2">A</a>`]);
		const placement = placed(24, 0, 272, 20, { x: 8, y: 0 });
		const result = alignElements(source, [at(source, "<a")], "left", null, [placement]);

		expect(sourceOf(result)).toContain(`<a className="absolute top-0 -left-2 mx-2 w-68">A</a>`);
	});

	test("splits both-axis translate and leaves the other axis", () => {
		const source = screen("relative", [`<a className="absolute left-1/2 top-1/2 -translate-1/2">A</a>`]);
		const result = alignElements(source, [at(source, "<a")], "top", null, [placed(150, 70, 20, 20)]);

		expect(sourceOf(result)).toContain(`<a className="absolute top-0 left-1/2 -translate-x-1/2">A</a>`);
	});

	test("writes at the breakpoint that places the element", () => {
		const source = screen("relative", [`<a className="absolute right-4 top-2 md:left-8 md:-translate-y-1 w-10">A</a>`]);
		const starts = [at(source, "<a")];

		expect(sourceOf(alignElements(source, starts, "left", 800, [placed(32, 4, 40, 40)]))).toContain(
			`<a className="absolute right-4 top-2 md:right-auto md:left-0 md:-translate-y-1 w-10">A</a>`,
		);
		expect(sourceOf(alignElements(source, starts, "top", 400, [placed(272, 8, 40, 40)]))).toContain(
			`<a className="absolute top-0 right-4 md:left-8 md:-translate-y-1 w-10">A</a>`,
		);
		expect(sourceOf(alignElements(source, starts, "top", 800, [placed(32, 4, 40, 40)]))).toContain(
			`<a className="absolute right-4 top-2 md:top-0 md:left-8 w-10">A</a>`,
		);
	});

	test("resets a translate the breakpoint inherits", () => {
		const source = screen("relative", [`<a className="absolute -translate-x-1/2 md:left-8">A</a>`]);
		const result = alignElements(source, [at(source, "<a")], "left", 800, [placed(12, 0, 40, 40)]);

		expect(sourceOf(result)).toContain(`<a className="absolute -translate-x-1/2 md:left-0 md:translate-x-0">A</a>`);
	});

	test("allows absolutely positioned elements before they are measured", () => {
		expect(needsPlacements(FREE, FREE_STARTS, null)).toBe(true);
		expect(alignElements(FREE, FREE_STARTS, "left", null)).toEqual({ source: FREE, starts: FREE_STARTS });
	});

	test("refuses absolutely positioned and flowing elements together", () => {
		const source = screen("relative flex", [`<a className="absolute left-0">A</a>`, `<b>B</b>`]);
		const starts = [at(source, "<a"), at(source, "<b")];

		expect(alignElements(source, starts, "top", null)).toEqual({
			refusal: "Absolutely positioned elements can't be arranged with elements in the flow",
		});
	});

	test("arranges a fixed element only at the breakpoint where it is fixed", () => {
		const source = screen("flex", [`<a className="md:fixed">A</a>`, `<b>B</b>`]);
		const starts = [at(source, "<a"), at(source, "<b")];

		expect(needsPlacements(source, starts, 400)).toBe(false);
		expect(needsPlacements(source, starts, 800)).toBe(true);
	});

	test("refuses elements in different parents", () => {
		const source = screen("flex", [`<a><b>B</b></a>`, `<i>C</i>`]);

		expect(alignElements(source, [at(source, "<b"), at(source, "<i")], "top", null)).toEqual({
			refusal: "Select elements in the same parent to arrange them",
		});
	});
});

describe("distributeElements", () => {
	test("spaces every child of a row with justify-between and drops their side margins", () => {
		const result = sourceOf(distributeElements(ROW, [at(ROW, "<a"), at(ROW, "<b"), at(ROW, "<i")], "horizontal", null));

		expect(result).toContain(`<div className="flex gap-4 justify-between">`);
		expect(result).toContain(`<b>B</b>`);
	});

	test("refuses the cross axis and normal flow", () => {
		const all = [at(ROW, "<a"), at(ROW, "<b"), at(ROW, "<i")];

		expect(distributeElements(ROW, all, "vertical", null)).toEqual({
			refusal: "These elements sit in a row, so they distribute along it",
		});

		const block = screen("p-4", [`<a>A</a>`, `<b>B</b>`]);

		expect("refusal" in distributeElements(block, [at(block, "<a"), at(block, "<b")], "vertical", null)).toBe(true);
	});

	test("spaces absolutely positioned elements with equal gaps along either axis", () => {
		const horizontal = sourceOf(distributeElements(FREE, FREE_STARTS, "horizontal", null, FREE_PLACEMENTS));

		expect(horizontal).toContain(`<a className="absolute left-2 top-2 size-10">A</a>`);
		expect(horizontal).toContain(`<b className="absolute top-8 left-30 size-16">B</b>`);
		expect(horizontal).toContain(`<i className="absolute bottom-6 left-64 h-8 w-12">C</i>`);

		const vertical = sourceOf(distributeElements(FREE, FREE_STARTS, "vertical", null, FREE_PLACEMENTS));

		expect(vertical).toContain(`<b className="absolute top-13 left-20 size-16">B</b>`);
		expect(vertical).toContain(`<i className="absolute top-30 right-4 h-8 w-12">C</i>`);
	});
});
