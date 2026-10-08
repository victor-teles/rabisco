import { describe, expect, test } from "bun:test";
import { compiles, DASHBOARD } from "./test-fixtures";
import {
	childSlots,
	duplicateElement,
	injectLocations,
	insertAt,
	insertChild,
	isElementCode,
	LOC_ATTRIBUTE,
	moveAmongSiblings,
	moveElement,
	parseLocation,
	pasteElement,
	removeElement,
	setAttribute,
	unwrapElement,
	wrapElement,
	wrapInStack,
} from "./transforms";
import { findElement, flatten, parseJsx } from "./tree";

const at = (source: string, needle: string) => {
	const index = source.indexOf(needle);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

describe("insertChild", () => {
	test("appends as the last child, indented one level deeper", () => {
		const out = insertChild(DASHBOARD, at(DASHBOARD, "<header"), `<Badge>New</Badge>`)!;
		expect(out).toContain(`\t\t\t</Button>\n\t\t\t<Badge>New</Badge>\n\t\t</header>`);
		expect(compiles(out)).toBe(true);
	});

	test("re-indents multi-line snippets", () => {
		const snippet = `    <Card>\n      <CardContent>Hi</CardContent>\n    </Card>`;
		const out = insertChild(DASHBOARD, at(DASHBOARD, "<header"), snippet)!;
		expect(out).toContain(`\t\t\t<Card>\n\t\t\t\t<CardContent>Hi</CardContent>\n\t\t\t</Card>\n\t\t</header>`);
	});

	test("opens a self-closing parent", () => {
		const source = `export function A() {\n\treturn (\n\t\t<div className="a" />\n\t);\n}\n`;
		expect(insertChild(source, at(source, "<div"), "<span />")).toBe(
			`export function A() {\n\treturn (\n\t\t<div className="a">\n\t\t\t<span />\n\t\t</div>\n\t);\n}\n`,
		);
	});

	test("breaks an inline closing tag onto its own line, fragments too", () => {
		const source = `const a = <p>Hi</p>;\nconst b = <></>;\n`;
		expect(insertChild(source, 10, "<b />")).toBe(`const a = <p>Hi\n\t<b />\n</p>;\nconst b = <></>;\n`);
		const out = insertChild(source, at(source, "<>"), "<i />")!;
		expect(out).toContain(`const b = <>\n\t<i />\n</>;`);
		expect(compiles(out)).toBe(true);
	});

	test("uses the file's space indentation", () => {
		const source = `const a = (\n  <ul>\n    <li />\n  </ul>\n);\n`;
		expect(insertChild(source, at(source, "<ul"), "<li>Two</li>")).toBe(
			`const a = (\n  <ul>\n    <li />\n    <li>Two</li>\n  </ul>\n);\n`,
		);
	});

	test("null when there is no element there", () => {
		expect(insertChild(DASHBOARD, 3, "<b />")).toBeNull();
		expect(insertChild("const a = <div>", 10, "<b />")).toBeNull();
	});
});

describe("insertAt", () => {
	const list = `const a = (\n\t<ul>\n\t\t<li>One</li>\n\t\t<li>Two</li>\n\t</ul>\n);\n`;
	const ul = at(list, "<ul");

	test("before slot index, on its own line, indented like the siblings", () => {
		const first = insertAt(list, ul, 0, "<li>Zero</li>")!;
		expect(first.source).toBe(
			`const a = (\n\t<ul>\n\t\t<li>Zero</li>\n\t\t<li>One</li>\n\t\t<li>Two</li>\n\t</ul>\n);\n`,
		);
		expect(first.start).toBe(at(first.source, "<li>Zero"));
		const middle = insertAt(list, ul, 1, "<li>Half</li>")!;
		expect(middle.source).toContain(`<li>One</li>\n\t\t<li>Half</li>\n\t\t<li>Two</li>`);
		expect(middle.source.slice(middle.start).startsWith("<li>Half")).toBe(true);
	});

	test("at the end or past it appends", () => {
		const expected = `\t\t<li>Two</li>\n\t\t<li>Three</li>\n\t</ul>`;

		for (const index of [2, 9, Infinity]) {
			const out = insertAt(list, ul, index, "<li>Three</li>")!;
			expect(out.source).toContain(expected);
			expect(out.source.slice(out.start).startsWith("<li>Three")).toBe(true);
		}
	});

	test("re-indents multi-line snippets to the sibling's indent", () => {
		const out = insertAt(DASHBOARD, at(DASHBOARD, `<div className="grid`), 1, `<Card>\n  <CardContent />\n</Card>`)!;
		expect(out.source).toContain(
			`\t\t\t\t</Card>\n\t\t\t\t<Card>\n\t\t\t\t\t<CardContent />\n\t\t\t\t</Card>\n\t\t\t\t<Card className`,
		);
		expect(out.source.slice(out.start).startsWith("<Card>\n")).toBe(true);
		expect(compiles(out.source)).toBe(true);
	});

	test("opens a self-closing parent at any index", () => {
		const source = `const a = (\n\t<div className="a" />\n);\n`;
		const out = insertAt(source, at(source, "<div"), 0, "<span />")!;
		expect(out.source).toBe(`const a = (\n\t<div className="a">\n\t\t<span />\n\t</div>\n);\n`);
		expect(out.start).toBe(at(out.source, "<span"));
	});

	test("inline parents stay inline for one-line snippets", () => {
		const source = `const a = <div><A /><B /></div>;`;
		expect(insertAt(source, 10, 0, "<X />")).toEqual({ source: `const a = <div><X /><A /><B /></div>;`, start: 15 });
		expect(insertAt(source, 10, 1, "<X />")!.source).toBe(`const a = <div><A /><X /><B /></div>;`);
		expect(insertAt(source, 10, 2, "<X />")!.source).toBe(`const a = <div><A /><B />\n\t<X />\n</div>;`);
		const multi = insertAt(source, 10, 1, "<X>\n\t<Y />\n</X>")!;
		expect(multi.source).toBe(`const a = <div><A />\n\t<X>\n\t\t<Y />\n\t</X>\n\t<B /></div>;`);
		expect(multi.source.slice(multi.start).startsWith("<X>")).toBe(true);
		expect(compiles(multi.source)).toBe(true);
	});

	test("an expression is one slot", () => {
		const ulStart = at(DASHBOARD, `<ul className="divide-y`);
		const out = insertAt(DASHBOARD, ulStart, 0, "<li>First</li>")!;
		expect(out.source).toContain(`<ul className="divide-y px-5">\n\t\t\t\t<li>First</li>\n\t\t\t\t{ORDERS.map(`);
		expect(insertAt(DASHBOARD, ulStart, 1, "<li>Last</li>")!.source).toContain(
			`\t\t\t\t))}\n\t\t\t\t<li>Last</li>\n\t\t\t</ul>`,
		);
	});

	test("visible text is a slot; indentation and comments aren't", () => {
		const source = `const a = (\n\t<p>\n\t\t{/* note */}\n\t\tHello <b>there</b>!\n\t</p>\n);\n`;
		const p = at(source, "<p");
		const parent = findElement(parseJsx(source), p)!;
		expect(childSlots(parent).map((slot) => source.slice(slot.start, slot.end))).toEqual([
			"Hello",
			"<b>there</b>",
			"!",
		]);
		expect(insertAt(source, p, 0, "<i />")!.source).toContain(`\t\t{/* note */}\n\t\t<i />\n\t\tHello <b>`);
		expect(insertAt(source, p, 1, "<i />")!.source).toContain(`Hello <i /><b>there</b>!`);
		expect(insertAt(source, p, 2, "<i />")!.source).toContain(`<b>there</b><i />!`);
	});

	test("null when there is no element there", () => {
		expect(insertAt(DASHBOARD, 3, 0, "<b />")).toBeNull();
		expect(insertAt(list, ul, 0, "  ")).toBeNull();
	});
});

describe("setAttribute", () => {
	const source = `const a = <Button variant="ghost" disabled onClick={go}>Save</Button>;`;
	const start = at(source, "<Button");

	test("replaces in place", () => {
		expect(setAttribute(source, start, "variant", "outline")).toBe(
			`const a = <Button variant="outline" disabled onClick={go}>Save</Button>;`,
		);
		expect(setAttribute(source, start, "disabled", 3)).toContain(`disabled={3} onClick`);
	});

	test("appends after the other attributes", () => {
		expect(setAttribute(source, start, "size", "sm")).toBe(
			`const a = <Button variant="ghost" disabled onClick={go} size="sm">Save</Button>;`,
		);
		expect(setAttribute(`const b = <Separator />;`, 10, "vertical", true)).toBe(`const b = <Separator vertical />;`);
	});

	test("strings that quotes can't hold use an expression", () => {
		expect(setAttribute(source, start, "title", 'Say "hi"')).toContain(`title={"Say \\"hi\\""}`);
		expect(setAttribute(source, start, "title", "a\nb")).toContain(`title={"a\\nb"}`);
		expect(compiles(setAttribute(source, start, "title", 'x "{y}" &amp;')!)).toBe(true);
	});

	test("false and null remove it", () => {
		expect(setAttribute(source, start, "disabled", false)).toBe(
			`const a = <Button variant="ghost" onClick={go}>Save</Button>;`,
		);
		expect(setAttribute(source, start, "variant", null)).toBe(`const a = <Button disabled onClick={go}>Save</Button>;`);
		expect(setAttribute(source, start, "missing", null)).toBe(source);
	});

	test("keeps one attribute per line layouts", () => {
		const multi = `const a = (\n\t<Button\n\t\tvariant="ghost"\n\t\tsize="sm"\n\t>\n\t\tSave\n\t</Button>\n);\n`;
		const added = setAttribute(multi, at(multi, "<Button"), "disabled", true)!;
		expect(added).toContain(`\t\tsize="sm"\n\t\tdisabled\n\t>`);
		expect(setAttribute(multi, at(multi, "<Button"), "size", null)).toBe(
			`const a = (\n\t<Button\n\t\tvariant="ghost"\n\t>\n\t\tSave\n\t</Button>\n);\n`,
		);
	});

	test("null for fragments, bad names and missing elements", () => {
		expect(setAttribute(`const a = <></>;`, 10, "x", "y")).toBeNull();
		expect(setAttribute(source, start, "bad name", "y")).toBeNull();
		expect(setAttribute(source, 0, "x", "y")).toBeNull();
	});
});

describe("removeElement", () => {
	test("removes the element's lines", () => {
		const out = removeElement(DASHBOARD, at(DASHBOARD, "<TabBar"))!;
		expect(out).toContain(`\t\t\t</a>\n\t\t</div>`);
		expect(compiles(out)).toBe(true);
	});

	test("inside an expression it becomes null; a child expression that held only it goes", () => {
		const out = removeElement(DASHBOARD, at(DASHBOARD, "<li"))!;
		expect(out).toContain(`{ORDERS.map((order) => (\n\t\t\t\t\tnull\n\t\t\t\t))}`);
		expect(removeElement(DASHBOARD, at(DASHBOARD, '<p className="px-5'))).toContain(`{open && null}`);
		const icon = `const a = <Button icon={<Star />}>{<b />}</Button>;`;
		expect(removeElement(icon, at(icon, "<Star"))).toBe(`const a = <Button icon={null}>{<b />}</Button>;`);
		expect(removeElement(icon, at(icon, "<b"))).toBe(`const a = <Button icon={<Star />}></Button>;`);
	});

	test("inline elements are cut out", () => {
		const source = `const a = <p>Hi <b>there</b>!</p>;`;
		expect(removeElement(source, at(source, "<b"))).toBe(`const a = <p>Hi !</p>;`);
		expect(removeElement(source, 1)).toBeNull();
	});

	test("a root becomes null, with the parens that held it", () => {
		const screen = `export default function A() {\n\treturn (\n\t\t<main>\n\t\t\t<p>Hi</p>\n\t\t</main>\n\t);\n}\n`;
		expect(removeElement(screen, at(screen, "<main"))).toBe(`export default function A() {\n\treturn null;\n}\n`);
		const arrow = `const Row = () => (\n\t<div />\n);\n`;
		expect(removeElement(arrow, at(arrow, "<div"))).toBe(`const Row = () => null;\n`);
		expect(removeElement(`const x = <div />;`, 10)).toBe(`const x = null;`);
		expect(removeElement(`function A() { return(<div />); }`, 22)).toBe(`function A() { return null; }`);
		const call = `const y = wrap(<div />);`;
		expect(removeElement(call, at(call, "<div"))).toBe(`const y = wrap(null);`);

		for (const source of [screen, arrow, call]) expect(compiles(removeElement(source, at(source, "<"))!)).toBe(true);
	});

	test("a brace-less attribute value becomes {null}", () => {
		const source = `const a = <Card icon=<Star /> title="x" />;`;
		const out = removeElement(source, at(source, "<Star"))!;
		expect(out).toBe(`const a = <Card icon={null} title="x" />;`);
		expect(compiles(out)).toBe(true);
	});
});

describe("duplicateElement", () => {
	test("puts the copy on the next line, indented like the element", () => {
		const start = at(DASHBOARD, "<h1");
		const result = duplicateElement(DASHBOARD, start)!;
		const line = `<h1 className="text-xl font-semibold">{title}</h1>`;
		expect(result.source).toContain(`\t\t\t${line}\n\t\t\t${line}\n`);
		expect(result.source.slice(result.start).startsWith(line)).toBe(true);
		expect(findElement(parseJsx(result.source), result.start)?.name).toBe("h1");
		expect(compiles(result.source)).toBe(true);
	});

	test("copies a multi-line element whole", () => {
		const source = `export function A() {\n\treturn (\n\t\t<ul>\n\t\t\t<li>\n\t\t\t\tOne\n\t\t\t</li>\n\t\t</ul>\n\t);\n}\n`;
		const result = duplicateElement(source, at(source, "<li"))!;
		expect(result.source).toBe(
			`export function A() {\n\treturn (\n\t\t<ul>\n\t\t\t<li>\n\t\t\t\tOne\n\t\t\t</li>\n\t\t\t<li>\n\t\t\t\tOne\n\t\t\t</li>\n\t\t</ul>\n\t);\n}\n`,
		);
		expect(result.start).toBe(source.indexOf("</ul>") + 1);
	});

	test("stays inline among inline siblings", () => {
		const source = `const a = <p>Hi <b>there</b></p>;`;
		expect(duplicateElement(source, at(source, "<b"))).toEqual({
			source: `const a = <p>Hi <b>there</b><b>there</b></p>;`,
			start: at(source, "</p>"),
		});
	});

	test("refuses roots and elements inside expressions", () => {
		const source = `const a = <div>{open && <span />}</div>;`;
		expect(duplicateElement(source, at(source, "<div"))).toBeNull();
		expect(duplicateElement(source, at(source, "<span"))).toBeNull();
		expect(duplicateElement(source, 3)).toBeNull();
	});
});

describe("wrapElement", () => {
	test("moves an element on its own line one level in", () => {
		const source = `export function A() {\n\treturn (\n\t\t<main>\n\t\t\t<p>\n\t\t\t\tHi\n\t\t\t</p>\n\t\t</main>\n\t);\n}\n`;
		const start = at(source, "<p");
		const result = wrapElement(source, start)!;
		expect(result.source).toBe(
			`export function A() {\n\treturn (\n\t\t<main>\n\t\t\t<div>\n\t\t\t\t<p>\n\t\t\t\t\tHi\n\t\t\t\t</p>\n\t\t\t</div>\n\t\t</main>\n\t);\n}\n`,
		);
		expect(result.start).toBe(start);
		expect(findElement(parseJsx(result.source), result.start)?.name).toBe("div");
	});

	test("wraps inline elements and roots in place", () => {
		const source = `const a = <p>Hi <b>there</b></p>;`;
		expect(wrapElement(source, at(source, "<b"))?.source).toBe(`const a = <p>Hi <div><b>there</b></div></p>;`);
		expect(wrapElement(source, at(source, "<p"))?.source).toBe(`const a = <div><p>Hi <b>there</b></p></div>;`);
	});

	test("keeps the screen compiling", () => {
		const result = wrapElement(DASHBOARD, at(DASHBOARD, "<header"))!;
		expect(compiles(result.source)).toBe(true);
		expect(result.source).toContain(`\t\t<div>\n\t\t\t<header className=`);
	});

	test("returns null without an element at the offset", () => {
		expect(wrapElement(`const a = 1;`, 0)).toBeNull();
	});

	test("writes a className for a flex stack", () => {
		const source = `const a = (\n\t<main>\n\t\t<p>Hi</p>\n\t</main>\n);\n`;
		const result = wrapInStack(source, at(source, "<p"))!;
		expect(result.source).toBe(
			`const a = (\n\t<main>\n\t\t<div className="flex flex-col gap-2">\n\t\t\t<p>Hi</p>\n\t\t</div>\n\t</main>\n);\n`,
		);
		expect(result.start).toBe(at(source, "<p"));
		const inline = `const a = <p>Hi <b>there</b></p>;`;
		expect(wrapElement(inline, at(inline, "<b"), "span", "flex")?.source).toBe(
			`const a = <p>Hi <span className="flex"><b>there</b></span></p>;`,
		);
	});
});

const LIST = `export function A() {\n\treturn (\n\t\t<ul>\n\t\t\t<li>One</li>\n\t\t\t<li>\n\t\t\t\tTwo\n\t\t\t</li>\n\t\t\t<li>Three</li>\n\t\t</ul>\n\t);\n}\n`;

/** The element's name at `start`, to check that the returned offset follows it */
const nameAt = (source: string, start: number) => findElement(parseJsx(source), start)?.name;

describe("moveAmongSiblings", () => {
	test("swaps with the next sibling, multi-line ones too", () => {
		const result = moveAmongSiblings(LIST, at(LIST, "<li>One"), 1)!;
		expect(result.source).toBe(
			`export function A() {\n\treturn (\n\t\t<ul>\n\t\t\t<li>\n\t\t\t\tTwo\n\t\t\t</li>\n\t\t\t<li>One</li>\n\t\t\t<li>Three</li>\n\t\t</ul>\n\t);\n}\n`,
		);
		expect(result.source.slice(result.start).startsWith("<li>One")).toBe(true);
		expect(compiles(result.source)).toBe(true);
	});

	test("swaps with the previous sibling", () => {
		const result = moveAmongSiblings(LIST, at(LIST, "<li>Three"), -1)!;
		expect(result.source).toContain(
			`\t\t\t<li>One</li>\n\t\t\t<li>Three</li>\n\t\t\t<li>\n\t\t\t\tTwo\n\t\t\t</li>\n\t\t</ul>`,
		);
		expect(result.source.slice(result.start).startsWith("<li>Three")).toBe(true);
	});

	test("inline siblings stay inline; lone spaces aren't siblings", () => {
		const source = `const a = <div><A /> <B /><C /></div>;`;
		const result = moveAmongSiblings(source, at(source, "<A"), 1)!;
		expect(result).toEqual({ source: `const a = <div><B /> <A /><C /></div>;`, start: at(source, "<B") });
		expect(nameAt(result.source, result.start)).toBe("A");
	});

	test("text and expressions are siblings", () => {
		const text = `const a = <p>Hi <b>there</b></p>;`;
		expect(moveAmongSiblings(text, at(text, "<b"), -1)).toEqual({
			source: `const a = <p><b>there</b> Hi</p>;`,
			start: 13,
		});
		const ul = moveAmongSiblings(DASHBOARD, at(DASHBOARD, `<ul className="divide-y`), -1)!;
		expect(ul.source).toContain(`\t\t\t<ul className="divide-y px-5">\n\t\t\t\t{ORDERS.map(`);
		expect(nameAt(ul.source, ul.start)).toBe("ul");
		expect(compiles(ul.source)).toBe(true);
	});

	test("null at the edges, for roots and inside expressions", () => {
		expect(moveAmongSiblings(LIST, at(LIST, "<li>One"), -1)).toBeNull();
		expect(moveAmongSiblings(LIST, at(LIST, "<li>Three"), 1)).toBeNull();
		expect(moveAmongSiblings(LIST, at(LIST, "<ul"), 1)).toBeNull();
		expect(moveAmongSiblings(DASHBOARD, at(DASHBOARD, "<li"), 1)).toBeNull();
	});
});

describe("moveElement", () => {
	const ul = at(LIST, "<ul");

	test("reorders forward: the index counts slots before the move", () => {
		const result = moveElement(LIST, at(LIST, "<li>One"), ul, 3)!;
		expect(result.source).toBe(
			`export function A() {\n\treturn (\n\t\t<ul>\n\t\t\t<li>\n\t\t\t\tTwo\n\t\t\t</li>\n\t\t\t<li>Three</li>\n\t\t\t<li>One</li>\n\t\t</ul>\n\t);\n}\n`,
		);
		expect(result.source.slice(result.start).startsWith("<li>One")).toBe(true);
		const middle = moveElement(LIST, at(LIST, "<li>One"), ul, 2)!;
		expect(middle.source).toContain(`\t\t\t</li>\n\t\t\t<li>One</li>\n\t\t\t<li>Three</li>`);
		expect(middle.source.slice(middle.start).startsWith("<li>One")).toBe(true);
	});

	test("reorders back, multi-line elements whole", () => {
		const result = moveElement(LIST, at(LIST, "<li>\n"), ul, 0)!;
		expect(result.source).toContain(
			`\t\t<ul>\n\t\t\t<li>\n\t\t\t\tTwo\n\t\t\t</li>\n\t\t\t<li>One</li>\n\t\t\t<li>Three</li>`,
		);
		expect(result.start).toBe(at(LIST, "<li>One"));
		expect(nameAt(result.source, result.start)).toBe("li");
	});

	test("its own slot and the one after leave the source as it is", () => {
		const start = at(LIST, "<li>\n");

		for (const index of [1, 2]) expect(moveElement(LIST, start, ul, index)).toEqual({ source: LIST, start });
	});

	test("moves into another container, before or after it in the file, re-indented", () => {
		const header = at(DASHBOARD, "<h1");
		const card = at(DASHBOARD, `<CardContent className="px-4">`);
		const later = moveElement(DASHBOARD, header, card, 0)!;
		expect(later.source).toContain(`<header className="flex items-center justify-between px-5 pt-12">\n\t\t\t<Button`);
		expect(later.source).toContain(
			`<CardContent className="px-4">\n\t\t\t\t\t\t<h1 className="text-xl font-semibold">{title}</h1>\n\t\t\t\t\t\t<p className="text-sm`,
		);
		expect(nameAt(later.source, later.start)).toBe("h1");
		expect(compiles(later.source)).toBe(true);
		const search = at(DASHBOARD, "<Search");
		const earlier = moveElement(DASHBOARD, search, card, 2)!;
		expect(earlier.source).toContain(
			`$12,480</p>\n\t\t\t\t\t\t<Search className="absolute left-8 top-2.5 size-4" />\n\t\t\t\t\t</CardContent>`,
		);
		expect(earlier.source).toContain(`<div className="relative px-5">\n\t\t\t\t<input`);
		expect(earlier.source.slice(earlier.start).startsWith("<Search")).toBe(true);
		expect(compiles(earlier.source)).toBe(true);
	});

	test("moves out to an ancestor, before or after the slot holding it", () => {
		const root = at(DASHBOARD, `<div className="flex h-full`);
		const revenue = at(DASHBOARD, `<p className="text-2xl font-semibold">$12,480`);
		const first = moveElement(DASHBOARD, revenue, root, 0)!;
		expect(first.source).toContain(
			`<div className="flex h-full flex-col bg-background">\n\t\t\t<p className="text-2xl font-semibold">$12,480</p>\n\t\t\t<Header`,
		);
		expect(first.start).toBe(at(DASHBOARD, "<Header"));
		const last = moveElement(DASHBOARD, revenue, root, Infinity)!;
		expect(last.source).toContain(
			`\t\t\t<TabBar active={0} />\n\t\t\t<p className="text-2xl font-semibold">$12,480</p>\n\t\t</div>`,
		);
		expect(last.source.slice(last.start).startsWith(`<p className="text-2xl font-semibold">$12,480`)).toBe(true);

		for (const result of [first, last]) expect(compiles(result.source)).toBe(true);
	});

	test("into a self-closing parent and between inline siblings", () => {
		const source = `const a = (\n\t<div>\n\t\t<span>x</span>\n\t\t<section />\n\t\t<p>Hi <b>a</b><i>b</i></p>\n\t</div>\n);\n`;
		const opened = moveElement(source, at(source, "<span"), at(source, "<section"), 0)!;
		expect(opened.source).toBe(
			`const a = (\n\t<div>\n\t\t<section>\n\t\t\t<span>x</span>\n\t\t</section>\n\t\t<p>Hi <b>a</b><i>b</i></p>\n\t</div>\n);\n`,
		);
		expect(nameAt(opened.source, opened.start)).toBe("span");
		const inline = moveElement(source, at(source, "<i>"), at(source, "<p>"), 1)!;
		expect(inline.source).toContain(`<p>Hi <i>b</i><b>a</b></p>`);
		expect(nameAt(inline.source, inline.start)).toBe("i");
	});

	test("refuses roots, elements inside expressions, and moving into itself", () => {
		const root = at(DASHBOARD, `<div className="flex h-full`);
		expect(moveElement(DASHBOARD, root, at(DASHBOARD, "<ul"), 0)).toBeNull();
		expect(moveElement(DASHBOARD, at(DASHBOARD, "<li"), root, 0)).toBeNull();
		const grid = at(DASHBOARD, `<div className="grid`);
		expect(moveElement(DASHBOARD, grid, grid, 0)).toBeNull();
		expect(moveElement(DASHBOARD, grid, at(DASHBOARD, "<CardContent"), 0)).toBeNull();
		expect(moveElement(DASHBOARD, grid, 3, 0)).toBeNull();
		expect(moveElement(DASHBOARD, grid, at(DASHBOARD, "<input"), 0)).toBeNull();
	});
});

describe("unwrapElement", () => {
	test("puts the children in its place, one level out", () => {
		const source = `const a = (\n\t<main>\n\t\t<section className="p-4">\n\t\t\t<h1>Title</h1>\n\t\t\t<div>\n\t\t\t\t<p>Body</p>\n\t\t\t</div>\n\t\t</section>\n\t</main>\n);\n`;
		const result = unwrapElement(source, at(source, "<section"))!;
		expect(result.source).toBe(
			`const a = (\n\t<main>\n\t\t<h1>Title</h1>\n\t\t<div>\n\t\t\t<p>Body</p>\n\t\t</div>\n\t</main>\n);\n`,
		);
		expect(result.start).toBe(at(source, "<section"));
		expect(nameAt(result.source, result.start)).toBe("h1");
		expect(compiles(result.source)).toBe(true);
	});

	test("undoes wrapElement", () => {
		const wrapped = wrapInStack(DASHBOARD, at(DASHBOARD, "<header"))!;
		expect(unwrapElement(wrapped.source, wrapped.start)).toEqual({
			source: DASHBOARD,
			start: at(DASHBOARD, "<header"),
		});
	});

	test("inline children and text", () => {
		const source = `const a = <p>Hi <span><b>a</b> and <i>b</i></span>!</p>;`;
		const result = unwrapElement(source, at(source, "<span"))!;
		expect(result.source).toBe(`const a = <p>Hi <b>a</b> and <i>b</i>!</p>;`);
		expect(nameAt(result.source, result.start)).toBe("b");
		const text = `const a = <p>Hi <span>there</span></p>;`;
		expect(unwrapElement(text, at(text, "<span"))).toEqual({ source: `const a = <p>Hi there</p>;`, start: 10 });
	});

	test("a root keeps its single element child", () => {
		const source = `const a = (\n\t<div>\n\t\t<main>\n\t\t\t<p>Hi</p>\n\t\t</main>\n\t</div>\n);\n`;
		const result = unwrapElement(source, at(source, "<div"))!;
		expect(result.source).toBe(`const a = (\n\t<main>\n\t\t<p>Hi</p>\n\t</main>\n);\n`);
		expect(nameAt(result.source, result.start)).toBe("main");
	});

	test("refuses leaves, and roots or expressions that would lose their single element", () => {
		expect(unwrapElement(LIST, at(LIST, "<li>One"))).not.toBeNull();
		expect(unwrapElement(`const a = <div><b /></div>;`, at(`const a = <div><b /></div>;`, "<b"))).toBeNull();
		expect(unwrapElement(LIST, at(LIST, "<ul"))).toBeNull();
		expect(unwrapElement(`const a = <p>Hi</p>;`, 10)).toBeNull();
		const expression = `const a = <div>{open && <p><b /><i /></p>}</div>;`;
		expect(unwrapElement(expression, at(expression, "<p"))).toBeNull();
		expect(unwrapElement(`const a = <div>{open && <p><b /></p>}</div>;`, 24)?.source).toBe(
			`const a = <div>{open && <b />}</div>;`,
		);
	});
});

describe("isElementCode", () => {
	test("elements, not screens or plain text", () => {
		expect(isElementCode(`<Button>Save</Button>`)).toBe(true);
		expect(isElementCode(`\n<li>One</li>\n<li>Two</li>\n`)).toBe(true);
		expect(isElementCode(`export default function A() {\n\treturn <div />;\n}`)).toBe(false);
		expect(isElementCode(`hello`)).toBe(false);
		expect(isElementCode(`<div>`)).toBe(false);
	});
});

describe("pasteElement", () => {
	test("goes right after the selected element", () => {
		const result = pasteElement(LIST, at(LIST, "<li>One"), `<li>\n  Pasted\n</li>`)!;
		expect(result.source).toContain(
			`\t\t\t<li>One</li>\n\t\t\t<li>\n\t\t\t\tPasted\n\t\t\t</li>\n\t\t\t<li>\n\t\t\t\tTwo`,
		);
		expect(result.source.slice(result.start).startsWith("<li>\n\t\t\t\tPasted")).toBe(true);
		const last = pasteElement(LIST, at(LIST, "<li>Three"), `<li>Four</li>`)!;
		expect(last.source).toContain(`\t\t\t<li>Three</li>\n\t\t\t<li>Four</li>\n\t\t</ul>`);
	});

	test("into an empty container, or as the root's last child", () => {
		const source = `const a = (\n\t<main>\n\t\t<div className="p-4" />\n\t\t<input />\n\t</main>\n);\n`;
		const inside = pasteElement(source, at(source, "<div"), `<p>Hi</p>`)!;
		expect(inside.source).toContain(`<div className="p-4">\n\t\t\t<p>Hi</p>\n\t\t</div>`);
		const afterInput = pasteElement(source, at(source, "<input"), `<p>Hi</p>`)!;
		expect(afterInput.source).toContain(`\t\t<input />\n\t\t<p>Hi</p>\n\t</main>`);
		const root = pasteElement(source, at(source, "<main"), `<p>Hi</p>`)!;
		expect(root.source).toContain(`\t\t<input />\n\t\t<p>Hi</p>\n\t</main>`);
		expect(root.source.slice(root.start).startsWith("<p>Hi")).toBe(true);
	});

	test("several elements land together", () => {
		const result = pasteElement(LIST, at(LIST, "<li>Three"), `<li>A</li>\n<li>B</li>`)!;
		expect(result.source).toContain(`\t\t\t<li>Three</li>\n\t\t\t<li>A</li>\n\t\t\t<li>B</li>\n\t\t</ul>`);
		expect(compiles(result.source)).toBe(true);
	});

	test("refuses code that isn't elements, and void roots", () => {
		expect(pasteElement(LIST, at(LIST, "<li>One"), `export default function A() {}`)).toBeNull();
		expect(pasteElement(`const a = <img />;`, 10, `<p />`)).toBeNull();
	});
});

describe("injectLocations", () => {
	test("tags every element but fragments with its original start", () => {
		const out = injectLocations(DASHBOARD);
		const original = flatten(parseJsx(DASHBOARD)).filter((e) => e.name !== null);

		const tagged = flatten(parseJsx(out)).filter((e) =>
			e.attributes.some((a) => a.kind === "attribute" && a.name === LOC_ATTRIBUTE),
		);

		expect(tagged.length).toBe(original.length);

		for (const element of tagged) {
			const attribute = element.attributes.find((a) => a.kind === "attribute" && a.name === LOC_ATTRIBUTE);

			const loc = Number(
				attribute?.kind === "attribute" && attribute.value?.kind === "string" ? attribute.value.value : Number.NaN,
			);

			expect(findElement(parseJsx(DASHBOARD), loc)?.name).toBe(element.name);
		}

		expect(out).toContain(`<li ${LOC_ATTRIBUTE}="${at(DASHBOARD, "<li")}" key={order.id}`);
		expect(out).toContain(`<Card ${LOC_ATTRIBUTE}="${at(DASHBOARD, "<Card")}" className="gap-1 py-4">`);
		expect(compiles(out)).toBe(true);
	});

	test("keeps every line on its line", () => {
		const out = injectLocations(DASHBOARD);
		expect(out.split("\n").length).toBe(DASHBOARD.split("\n").length);
		const lines = out.split("\n");
		DASHBOARD.split("\n").forEach((line, i) => expect(lines[i]!.replace(/ data-rabisco-loc="\d+"/g, "")).toBe(line));
	});

	test("skips fragments", () => {
		expect(injectLocations(`const a = <><Fragment key="k"><b /></Fragment><React.Fragment /></>;`)).toBe(
			`const a = <><Fragment key="k"><b data-rabisco-loc="30" /></Fragment><React.Fragment /></>;`,
		);
	});

	test("idempotent and safe on bad input", () => {
		const once = injectLocations(`const a = <div><span /></div>;`);
		expect(once).toBe(`const a = <div data-rabisco-loc="10"><span data-rabisco-loc="15" /></div>;`);
		expect(injectLocations(once)).toBe(once);
		expect(injectLocations("const a = <div>")).toBe("const a = <div>");
	});

	test("with a path, each value carries the file too", () => {
		const out = injectLocations(`const a = <div><Card><span /></Card></div>;`, "screens/home.tsx");
		expect(out).toBe(
			`const a = <div data-rabisco-loc="screens/home.tsx:10"><Card data-rabisco-loc="screens/home.tsx:15"><span data-rabisco-loc="screens/home.tsx:21" /></Card></div>;`,
		);
		expect(injectLocations(out, "screens/home.tsx")).toBe(out);
		const lines = injectLocations(DASHBOARD, "screens/dashboard.tsx").split("\n");
		expect(lines.length).toBe(DASHBOARD.split("\n").length);
		expect(compiles(lines.join("\n"))).toBe(true);
	});
});

describe("parseLocation", () => {
	test("reads path and offset, or a bare offset", () => {
		expect(parseLocation("screens/home.tsx:120")).toEqual({ path: "screens/home.tsx", start: 120 });
		expect(parseLocation("42")).toEqual({ path: null, start: 42 });
		expect(parseLocation("screens/a.tsx:x")).toBeNull();
		expect(parseLocation("")).toBeNull();
		expect(parseLocation(null)).toBeNull();
	});
});
