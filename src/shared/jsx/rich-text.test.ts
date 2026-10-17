import { describe, expect, test } from "bun:test";
import { findElement, parseJsx } from "./tree";
import { hasMarks, readRichText, richChildren, richPlainText } from "./rich-text";

const paragraph = (children: string) => {
	const source = `export default function S() {\n\treturn <p className="text-sm">${children}</p>;\n}\n`;

	return findElement(parseJsx(source), source.indexOf("<p"))!;
};

describe("rich text", () => {
	test("reads text with strong, em and links", () => {
		expect(readRichText(paragraph('Hi <strong>there</strong>, see <a href="/docs">the <em>docs</em></a>'))).toEqual([
			{ text: "Hi " },
			{ text: "there", bold: true },
			{ text: ", see " },
			{ text: "the ", href: "/docs" },
			{ text: "docs", italic: true, href: "/docs" },
		]);
		expect(readRichText(paragraph('Plain {"text"} only'))).toEqual([{ text: "Plain text only" }]);
		expect(readRichText(paragraph("<b>Bold</b> and <i>italic</i>"))).toEqual([
			{ text: "Bold", bold: true },
			{ text: " and " },
			{ text: "italic", italic: true },
		]);
	});

	test("refuses other elements, attributes and code", () => {
		expect(readRichText(paragraph("Hi <span>there</span>"))).toBeNull();
		expect(readRichText(paragraph('Hi <strong className="x">there</strong>'))).toBeNull();
		expect(readRichText(paragraph("Hi <a>there</a>"))).toBeNull();
		expect(readRichText(paragraph("Hi {name}"))).toBeNull();
		expect(readRichText(paragraph("Hi <Badge>there</Badge>"))).toBeNull();
	});

	test("writes runs as one line of JSX", () => {
		expect(
			richChildren([
				{ text: "Hi " },
				{ text: "there", bold: true },
				{ text: ", see " },
				{ text: "the ", href: "/docs" },
				{ text: "docs", italic: true, bold: true, href: "/docs" },
			]),
		).toBe('Hi <strong>there</strong>, see <a href="/docs">the <strong><em>docs</em></strong></a>');
		expect(richChildren([{ text: "a < b" }, { text: "{x}", italic: true }])).toBe('{"a < b"}<em>{"{x}"}</em>');
		expect(richChildren([{ text: "One" }, { text: " two" }])).toBe("One two");
	});

	test("a round trip keeps the runs", () => {
		const runs = [{ text: "Save " }, { text: "40%", bold: true }, { text: " today", italic: true }];

		expect(readRichText(paragraph(richChildren(runs)))).toEqual(runs);
		expect(richPlainText(runs)).toBe("Save 40% today");
		expect(hasMarks(runs)).toBe(true);
		expect(hasMarks([{ text: "x" }])).toBe(false);
	});
});
