import { describe, expect, test } from "bun:test";
import { compile } from "tailwindcss";
import { readFileSync } from "fs";
import { join } from "path";
import { tokenFiles, tokensJson } from "./tokens";

const theme = {
	light: {
		primary: "#2563eb",
		radius: "0.75rem",
		"font-sans": '"Inter", system-ui, sans-serif',
		"color-brand": "oklch(0.6 0.2 25 / 80%)",
		"text-display": "3rem/1.1",
		"spacing-gutter": "24px",
		ring: "var(--primary)",
	},
	dark: { "color-brand": "#fb7185" },
};

const byPath = Object.fromEntries(tokenFiles(theme).map((file) => [file.path, file.content]));

describe("token export", () => {
	test("writes the files in tokens/", () => {
		expect(Object.keys(byPath).sort()).toEqual([
			"tokens/README.md",
			"tokens/tailwind.css",
			"tokens/tokens.css",
			"tokens/tokens.dark.json",
			"tokens/tokens.json",
		]);
	});

	test("tokens.css has every variable, the applied tokens over the canvas theme", () => {
		const css = byPath["tokens/tokens.css"]!;
		const root = css.slice(0, css.indexOf(".dark"));
		const dark = css.slice(css.indexOf(".dark"));

		expect(root).toContain("\t--primary: #2563eb;\n");
		expect(root).not.toContain("--primary: oklch(0.205 0 0)");
		expect(root).toContain("\t--radius: 0.75rem;\n");
		expect(root).toContain("\t--muted: oklch(0.97 0 0);\n");
		expect(root).toContain("\t--text-display: 3rem;\n\t--text-display--line-height: 1.1;\n");
		expect(dark).toContain("\t--primary: oklch(0.922 0 0);\n");
		expect(dark).toContain("\t--color-brand: #fb7185;\n");
	});

	test("tailwind.css builds bg-primary, rounded-lg, the custom utilities and dark:", async () => {
		const tailwind = readFileSync(join(import.meta.dir, "../../../node_modules/tailwindcss/index.css"), "utf8");

		const sheets = new Map([
			["tailwindcss", tailwind],
			["./tokens.css", byPath["tokens/tokens.css"]!],
		]);

		const compiler = await compile(`@import "tailwindcss";\n${byPath["tokens/tailwind.css"]}`, {
			base: "/",
			loadStylesheet: async (id, base) => ({ path: id, base, content: sheets.get(id)! }),
		});

		const css = compiler.build(["bg-primary", "rounded-lg", "bg-brand", "text-display", "p-gutter", "dark:bg-muted"]);

		expect(css).toContain("background-color: var(--primary)");
		expect(css).toContain("border-radius: var(--radius)");
		expect(css).toContain("background-color: var(--color-brand, currentcolor)");
		expect(css).toContain("font-size: var(--text-display, 1rem)");
		expect(css).toContain("padding: var(--spacing-gutter, 0)");
		expect(css).toContain(":is(.dark *)");
		expect(css).toContain("--primary: #2563eb");
	});

	test("tokens.json is DTCG", () => {
		const json = JSON.parse(tokensJson(theme).light);

		expect(json.color.primary).toEqual({
			$type: "color",
			$value: { colorSpace: "srgb", components: [0.1451, 0.3882, 0.9216], hex: "#2563eb" },
		});
		expect(json.color.muted.$value).toEqual({ colorSpace: "oklch", components: [0.97, 0, 0], hex: "#f5f5f5" });
		expect(json.color.brand.$value.alpha).toBe(0.8);
		expect(json.color.ring).toEqual({ $type: "color", $value: "{color.primary}" });
		expect(json.radius.base).toEqual({ $type: "dimension", $value: { value: 0.75, unit: "rem" } });
		expect(json.font.sans).toEqual({ $type: "fontFamily", $value: ["Inter", "system-ui", "sans-serif"] });
		expect(json.text.display.$value).toEqual({ value: 3, unit: "rem" });
		expect(json.text["display-line-height"]).toEqual({ $type: "number", $value: 1.1 });
		expect(json.spacing.gutter.$value).toEqual({ value: 24, unit: "px" });
		expect(json.color["subtle-foreground"]).toBeUndefined();
	});

	test("tokens.dark.json has only the dark values that differ", () => {
		const dark = JSON.parse(tokensJson(theme).dark);

		expect(dark.color.brand.$value.hex).toBe("#fb7185");
		expect(dark.color.background.$value.components).toEqual([0.145, 0, 0]);
		expect(dark.radius).toBeUndefined();
	});

	test("with no DESIGN.md tokens, the canvas theme", () => {
		const files = Object.fromEntries(tokenFiles({ light: {}, dark: {} }, "").map((file) => [file.path, file.content]));

		expect(files["tokens.css"]).toContain("--primary: oklch(0.205 0 0);");
		expect(files["tailwind.css"]).not.toContain("@theme reference");
		expect(JSON.parse(files["tokens.json"]!).radius.base.$value).toEqual({ value: 0.625, unit: "rem" });
	});
});
