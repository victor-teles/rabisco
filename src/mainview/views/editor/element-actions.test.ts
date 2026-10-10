import { describe, expect, test } from "bun:test";
import { elementCode, elementsCode, firstChildStart, hiddenState, lockedState } from "./element-actions";

const SOURCE = `export function A() {\n\treturn (\n\t\t<main>\n\t\t\t<>\n\t\t\t\t<p>Hi</p>\n\t\t\t</>\n\t\t\t{open && <b />}\n\t\t</main>\n\t);\n}\n`;

describe("firstChildStart", () => {
	test("goes through fragments", () => {
		expect(firstChildStart(SOURCE, SOURCE.indexOf("<main"))).toBe(SOURCE.indexOf("<p"));
	});

	test("is null for a leaf", () => {
		expect(firstChildStart(SOURCE, SOURCE.indexOf("<b"))).toBeNull();
	});
});

describe("elementCode", () => {
	test("drops the indent the element sits at", () => {
		expect(elementCode(SOURCE, SOURCE.indexOf("<main"))).toBe(
			`<main>\n\t<>\n\t\t<p>Hi</p>\n\t</>\n\t{open && <b />}\n</main>`,
		);
	});
});

describe("elementsCode", () => {
	test("joins several elements in file order and leaves out the nested ones", () => {
		const main = SOURCE.indexOf("<main");
		const p = SOURCE.indexOf("<p");
		const b = SOURCE.indexOf("<b");

		expect(elementsCode(SOURCE, [b, p])).toBe(`<p>Hi</p>\n<b />`);
		expect(elementsCode(SOURCE, [p, main])).toBe(elementCode(SOURCE, main));
	});
});

describe("hiddenState and lockedState", () => {
	const source = `const A = () => (\n\t<main>\n\t\t<p className="hidden">A</p>\n\t\t<p>B</p>\n\t</main>\n);\n`;
	const first = source.indexOf("<p");
	const second = source.indexOf("<p", first + 1);

	test("say Show only when every element is hidden", () => {
		expect(hiddenState(source, [first])).toBe(true);
		expect(hiddenState(source, [first, second])).toBe(false);
	});

	test("say Unlock only when every element is locked, through its ancestors too", () => {
		const locks = [{ file: "a.tsx", path: [0], name: "main" }];
		expect(lockedState(locks, "a.tsx", source, [first, second])).toBe(true);
		expect(lockedState([], "a.tsx", source, [first])).toBe(false);
	});
});
