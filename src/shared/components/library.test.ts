import { describe, expect, test } from "bun:test";
import * as Lucide from "lucide-react";
import { transform } from "sucrase";
import { LIBRARY, searchLibrary } from "./library";
import { UI_MODULES } from "./ui-modules";

/** Capitalised JSX tags a snippet renders (`<Button`, `<CardTitle`). */
const tags = (snippet: string) => new Set([...snippet.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!));

describe("LIBRARY", () => {
	test("ids are unique and every item names a ui module", () => {
		expect(new Set(LIBRARY.map((item) => item.id)).size).toBe(LIBRARY.length);
		for (const item of LIBRARY) expect(item.module in UI_MODULES).toBe(true);
	});

	test("covers the useful shadcn pieces", () => {
		const modules = new Set(LIBRARY.map((item) => item.module));
		for (const name of ["button", "badge", "card", "input", "textarea", "avatar", "separator", "progress", "tabs", "toggle", "toggle-group", "kbd", "dialog", "popover", "dropdown-menu", "tooltip", "scroll-area", "collapsible"]) {
			expect(modules.has(name)).toBe(true);
		}
		const variants = LIBRARY.filter((item) => item.module === "button").map((item) => item.id);
		expect(variants).toEqual(expect.arrayContaining(["button", "button-outline", "button-ghost", "button-secondary", "button-destructive"]));
	});

	for (const item of LIBRARY) {
		test(`${item.id}: compiles, and imports exist and cover every tag`, () => {
			expect(() => transform(`<>${item.snippet}</>`, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true })).not.toThrow();
			const imported = new Set<string>();
			for (const { from, names } of item.imports) {
				for (const name of names) imported.add(name);
				if (from === "lucide-react") {
					for (const name of names) expect(Lucide[name as keyof typeof Lucide]).toBeDefined();
					continue;
				}
				const module = from.replace("@/components/ui/", "");
				expect(from.startsWith("@/components/ui/")).toBe(true);
				for (const name of names) expect(UI_MODULES[module]).toContain(name);
			}
			expect([...tags(item.snippet)].filter((tag) => !imported.has(tag))).toEqual([]);
			expect([...imported].filter((name) => !tags(item.snippet).has(name))).toEqual([]);
		});
	}

	test("snippets use theme classes, not hard-coded palette colors", () => {
		for (const item of LIBRARY) expect(item.snippet).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|red|blue|green|emerald|violet)-\d+/);
	});
});

describe("searchLibrary", () => {
	test("matches title, module and keywords; every word must match", () => {
		expect(searchLibrary("").length).toBe(LIBRARY.length);
		expect(searchLibrary("modal").map((i) => i.id)).toEqual(["dialog"]);
		expect(searchLibrary("button outline").map((i) => i.id)).toContain("button-outline");
		expect(searchLibrary("DROPDOWN").map((i) => i.id)).toEqual(["dropdown-menu"]);
		expect(searchLibrary("nothing-like-this")).toEqual([]);
	});
});
