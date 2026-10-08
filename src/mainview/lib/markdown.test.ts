import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
	test("code, strong, em and links", () => {
		expect(parseInline("Use `Card` with **bold** and *soft* or _light_ [docs](https://x.dev)")).toEqual([
			{ type: "text", text: "Use " },
			{ type: "code", text: "Card" },
			{ type: "text", text: " with " },
			{ type: "strong", children: [{ type: "text", text: "bold" }] },
			{ type: "text", text: " and " },
			{ type: "em", children: [{ type: "text", text: "soft" }] },
			{ type: "text", text: " or " },
			{ type: "em", children: [{ type: "text", text: "light" }] },
			{ type: "text", text: " " },
			{ type: "link", href: "https://x.dev", children: [{ type: "text", text: "docs" }] },
		]);
	});

	test("unsafe link targets stay text", () => {
		expect(parseInline("[click](javascript:alert(1))")).toEqual([
			{ type: "text", text: "click" },
			{ type: "text", text: ")" },
		]);
		expect(parseInline("[file](./a.tsx)")).toEqual([{ type: "text", text: "file" }]);
	});

	test("leaves snake_case, lone stars and HTML as text", () => {
		expect(parseInline("a_b_c 2 * 3 <img src=x>")).toEqual([{ type: "text", text: "a_b_c 2 * 3 <img src=x>" }]);
	});
});

describe("parseMarkdown", () => {
	test("headings, paragraphs with line breaks, lists, quotes and code", () => {
		const blocks = parseMarkdown(
			"## Done\n\nI added\ntwo screens.\n\n- Home\n- Settings\n  with a toggle\n\n1. One\n2. Two\n\n> Note\n\n```tsx\n<Card />\n```",
		);

		expect(blocks).toEqual([
			{ type: "heading", children: [{ type: "text", text: "Done" }] },
			{ type: "paragraph", children: [{ type: "text", text: "I added\ntwo screens." }] },
			{
				type: "list",
				ordered: false,
				start: 1,
				items: [[{ type: "text", text: "Home" }], [{ type: "text", text: "Settings\nwith a toggle" }]],
			},
			{
				type: "list",
				ordered: true,
				start: 1,
				items: [[{ type: "text", text: "One" }], [{ type: "text", text: "Two" }]],
			},
			{ type: "quote", children: [{ type: "text", text: "Note" }] },
			{ type: "code", text: "<Card />" },
		]);
	});

	test("an unclosed fence runs to the end, as while streaming", () => {
		expect(parseMarkdown("Here:\n```\nconst a = 1;")).toEqual([
			{ type: "paragraph", children: [{ type: "text", text: "Here:" }] },
			{ type: "code", text: "const a = 1;" },
		]);
	});

	test("the bullets Rabisco writes are a list", () => {
		expect(parseMarkdown("I left them out:\n• a.tsx: bad\n• b.tsx: worse")).toEqual([
			{ type: "paragraph", children: [{ type: "text", text: "I left them out:" }] },
			{
				type: "list",
				ordered: false,
				start: 1,
				items: [[{ type: "text", text: "a.tsx: bad" }], [{ type: "text", text: "b.tsx: worse" }]],
			},
		]);
	});
});
