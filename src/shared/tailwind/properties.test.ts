import { describe, expect, test } from "bun:test";
import { baseClasses, hiddenStarts, isHidden, pasteProperties, setHidden } from "./properties";

describe("baseClasses", () => {
	test("leaves out responsive and state variants", () => {
		expect(baseClasses("flex gap-2 md:gap-4 hover:bg-muted p-4 !mt-2 -mx-1")).toBe("flex gap-2 p-4 !mt-2 -mx-1");
	});

	test("keeps arbitrary values that hold a colon", () => {
		expect(baseClasses("bg-[url(a:b)] dark:bg-black")).toBe("bg-[url(a:b)]");
	});
});

describe("pasteProperties", () => {
	test("replaces the base classes and keeps the target's own variants", () => {
		expect(pasteProperties("p-2 text-sm md:p-4 hover:underline", "rounded-lg bg-primary p-6 md:p-8")).toBe(
			"rounded-lg bg-primary p-6 md:p-4 hover:underline",
		);
	});

	test("on an element without classes", () => {
		expect(pasteProperties("", "flex gap-2")).toBe("flex gap-2");
	});
});

describe("hidden", () => {
	test("reads only the base `hidden` class", () => {
		expect(isHidden("p-2 hidden")).toBe(true);
		expect(isHidden("inline-flex hidden!")).toBe(true);
		expect(isHidden("!hidden")).toBe(true);
		expect(isHidden("md:hidden flex")).toBe(false);
		expect(isHidden("hidden-x")).toBe(false);
	});

	test("adds and removes it, leaving the other classes", () => {
		expect(setHidden("p-4 gap-2", true)).toBe("p-4 gap-2 hidden");
		expect(setHidden("p-4 hidden gap-2", false)).toBe("p-4 gap-2");
		expect(setHidden("hidden", true)).toBe("hidden");
		expect(setHidden("md:hidden", false)).toBe("md:hidden");
	});

	test("wins over a display class the CSS would order after it", () => {
		expect(setHidden("inline-flex gap-2", true)).toBe("inline-flex gap-2 hidden!");
		expect(setHidden("md:flex", true)).toBe("md:flex hidden!");
		expect(setHidden("inline-flex hidden!", false)).toBe("inline-flex");
	});
});

describe("hiddenStarts", () => {
	test("finds the elements with a base `hidden` class", () => {
		const source = `const A = () => (\n\t<div>\n\t\t<p className="hidden">A</p>\n\t\t<p className="md:hidden">B</p>\n\t</div>\n);\n`;
		expect(hiddenStarts(source)).toEqual([source.indexOf("<p")]);
		expect(hiddenStarts("<div")).toEqual([]);
	});
});
