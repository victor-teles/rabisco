import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssPatch } from "./css-patch";
import { createCompiler } from "./tailwind";

const root = join(import.meta.dir, "../../../..");

const stylesheets = {
	tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
	"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
};

async function builds(base: string[], ...steps: string[][]) {
	const compiler = await createCompiler(stylesheets);
	const sheets = [compiler.build(base)];

	for (const step of steps) sheets.push(compiler.build(step));

	return sheets;
}

function selectors(css: string) {
	return Array.from(css.matchAll(/^\s*(\.[^\s{]+)\s*\{/gm), (match) => match[1]);
}

describe("cssPatch", () => {
	test("sends the new rule without the rules it can't override", async () => {
		const [sent, next] = await builds(["flex", "p-4", "text-sm", "bg-white"], ["px-12"]);
		const patch = cssPatch(sent!, next!)!;

		expect(selectors(patch)).toEqual([".px-12"]);
		expect(patch).not.toContain("@layer");
		expect(patch.length).toBeLessThan(500);
	});

	test("resends a later rule for the same property so a new px-12 cannot beat md:px-4", async () => {
		const [sent, next] = await builds(["md:px-4", "pl-2", "flex"], ["px-12"]);
		const patch = cssPatch(sent!, next!)!;

		expect(selectors(patch)).toEqual([".px-12", ".pl-2", ".md\\:px-4"]);
	});

	test("keeps the utilities layer around !important rules, since layers order those the other way round", async () => {
		const [sent, next] = await builds(["px-4!"], ["px-12!"]);

		expect(cssPatch(sent!, next!)).toStartWith("@layer utilities {");
	});

	test("a later rule for another pseudo-element is left out", async () => {
		const [sent, next] = await builds(["before:bg-black", "hover:bg-white"], ["bg-red-500"]);
		const patch = cssPatch(sent!, next!)!;

		expect(patch).toContain(".bg-red-500");
		expect(patch).toContain(".hover\\:bg-white");
		expect(patch).not.toContain("before\\:bg-black");
	});

	test("a new theme color leaves the theme layer alone, so :root keeps its variables", async () => {
		const [sent, next] = await builds(["flex"], ["bg-lime-950"], ["animate-shimmer"]);

		expect(cssPatch(sent!, next!)).not.toContain("@layer theme");
		expect(cssPatch(next!, next!)).toBe("");
	});

	test("carries new @property rules", async () => {
		const [sent, next] = await builds(["flex"], ["shadow-2xl"]);

		expect(cssPatch(sent!, next!)).toContain("@property --tw-shadow ");
	});

	test("is null when the next sheet drops a rule", async () => {
		const [sent, next] = await builds(["flex", "px-12"], ["p-4"]);
		const [fresh] = await builds(["p-4"]);

		expect(cssPatch(next!, fresh!)).toBeNull();
		expect(cssPatch(sent!, next!)).not.toBeNull();
	});

	test("braces in strings and comments don't split a rule", () => {
		const sent = '@layer utilities {\n  .a {\n    content: "}";\n  }\n}';
		const next = '@layer utilities {\n  .a {\n    content: "}";\n  }\n  /* } */\n  .b {\n    content: "{";\n  }\n}';

		expect(cssPatch(sent, next)).toBe('/* } */\n  .b {\n    content: "{";\n  }');
	});
});
