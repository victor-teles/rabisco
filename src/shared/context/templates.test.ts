import { describe, expect, test } from "bun:test";
import { CONTEXT_TEMPLATES, DESIGN_TEMPLATE, PRODUCT_TEMPLATE } from "./templates";

const contentLines = (markdown: string) =>
	markdown
		.replace(/<!--[\s\S]*?-->/g, "")
		.split("\n")
		.filter((line) => line.trim() && !/^#{1,6}\s/.test(line));

const headings = (markdown: string) => [...markdown.matchAll(/^#{2}\s+(.+)$/gm)].map((m) => m[1]);

describe("context templates", () => {
	test("untouched templates have no content outside headings and comments", () => {
		expect(contentLines(PRODUCT_TEMPLATE)).toEqual([]);
		expect(contentLines(DESIGN_TEMPLATE)).toEqual([]);
	});

	test("sections", () => {
		expect(PRODUCT_TEMPLATE.startsWith("# Product\n")).toBe(true);
		expect(headings(PRODUCT_TEMPLATE)).toEqual(["Audience", "Voice", "Constraints"]);
		expect(headings(DESIGN_TEMPLATE)).toEqual([
			"Visual direction",
			"Tokens",
			"Typography",
			"Layout & spacing",
			"Components",
			"Do / Don't",
		]);
	});

	test("keyed by file name", () => {
		expect(CONTEXT_TEMPLATES).toEqual({ "PRODUCT.md": PRODUCT_TEMPLATE, "DESIGN.md": DESIGN_TEMPLATE });
	});
});
