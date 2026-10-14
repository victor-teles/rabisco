import { describe, expect, test } from "bun:test";
import { alignElements, distributeElements, type Arranged } from "./element-align";

const screen = (parent: string, children: string[]) =>
	`export default function Screen() {\n\treturn (\n\t\t<div className="${parent}">\n${children.map((child) => `\t\t\t${child}`).join("\n")}\n\t\t</div>\n\t);\n}\n`;

const sourceOf = (result: Arranged) => {
	if ("refusal" in result) throw new Error(result.refusal);

	return result.source;
};

const ROW = screen("flex gap-4", [`<a className="p-2">A</a>`, `<b className="mx-2">B</b>`, `<i>C</i>`]);

const at = (source: string, text: string) => source.indexOf(text);

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

	test("refuses absolutely positioned elements on both axes and adds no classes", () => {
		const source = screen("relative h-40", [
			`<a className="absolute left-2 top-2">A</a>`,
			`<b className="absolute left-10 top-8">B</b>`,
		]);

		const starts = [at(source, "<a"), at(source, "<b")];
		const refusal = { refusal: "Absolutely positioned elements can't be aligned yet" };

		expect(alignElements(source, starts, "h-center", null)).toEqual(refusal);
		expect(alignElements(source, starts, "right", null)).toEqual(refusal);
		expect(alignElements(source, starts, "v-middle", null)).toEqual(refusal);
		expect(alignElements(source, [at(source, "<a")], "top", 1024)).toEqual(refusal);
	});

	test("refuses a fixed element at the breakpoint where it is fixed", () => {
		const source = screen("flex", [`<a className="md:fixed">A</a>`, `<b>B</b>`]);
		const starts = [at(source, "<a"), at(source, "<b")];

		expect("refusal" in alignElements(source, starts, "top", 400)).toBe(false);
		expect(alignElements(source, starts, "top", 800)).toEqual({
			refusal: "Absolutely positioned elements can't be aligned yet",
		});
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

	test("refuses absolutely positioned children of a row", () => {
		const source = screen("relative flex", [
			`<a className="absolute left-0">A</a>`,
			`<b className="absolute left-8">B</b>`,
		]);

		expect(distributeElements(source, [at(source, "<a"), at(source, "<b")], "horizontal", null)).toEqual({
			refusal: "Absolutely positioned elements can't be distributed yet",
		});
	});
});
