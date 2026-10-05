import { describe, expect, test } from "bun:test";
import { compiles, DASHBOARD } from "./test-fixtures";
import { injectLocations, insertChild, LOC_ATTRIBUTE, parseLocation, removeElement, setAttribute } from "./transforms";
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
