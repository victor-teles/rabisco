import { describe, expect, test } from "bun:test";
import type { DesignTokens } from "../../shared/context/tokens";
import { modesText, themeTokensText } from "./theme-tokens";

describe("themeTokensText", () => {
	test("lists each custom token with the classes it makes and its values", () => {
		const text = themeTokensText({
			light: {
				"color-brand": "#e11d48",
				"radius-card": "1.25rem",
				"font-display": '"Fraunces", serif',
				"text-display": "3rem/1.1",
				"spacing-gutter": "24px",
			},
			dark: { "color-brand": "#fb7185" },
		});

		expect(text).toContain(
			"# Theme tokens\nScreens render with the project's theme. Use these classes rather than raw values",
		);
		expect(text).toContain("- bg-brand / text-brand / border-brand (color-brand: #e11d48, dark #fb7185)");
		expect(text).toContain("- rounded-card (radius-card: 1.25rem)");
		expect(text).toContain('- font-display (font-display: "Fraunces", serif)');
		expect(text).toContain("- text-display (text-display: 3rem/1.1)");
		expect(text).toContain("- p-gutter / gap-gutter (spacing-gutter: 24px)");
		expect(text).not.toContain("Set by this project");
	});

	test("built-in tokens the project sets go on one line, in token order", () => {
		const text = themeTokensText({
			light: { radius: "0.75rem", primary: "#0052ff" },
			dark: { primary: "#3b82f6", background: "#0a0b0d" },
		});

		expect(text).toContain("- Built in: bg-, text- and border- with background");
		expect(text).toContain(
			"- Set by this project: background: dark #0a0b0d; primary: #0052ff, dark #3b82f6; radius: 0.75rem",
		);
	});

	test("a value that is the same in both modes shows once", () => {
		expect(themeTokensText({ light: { "color-brand": "red" }, dark: { "color-brand": "red" } })).toContain(
			"(color-brand: red)",
		);
	});

	test("null when the theme sets nothing", () => {
		expect(themeTokensText({ light: {}, dark: {} })).toBeNull();
		expect(themeTokensText({ light: { "not-a-token": "1" }, dark: {} })).toBeNull();
	});
});

test("modesText lists the values of the options the targets render in", () => {
	const theme: DesignTokens = {
		light: {},
		dark: {},
		modes: [
			{
				name: "brand",
				options: [
					{ name: "default", light: {}, dark: {} },
					{ name: "acme", light: { primary: "#e11d48" }, dark: { primary: "#fb7185" } },
				],
			},
		],
	};

	const text = modesText({ "screens/a.tsx": { scheme: "light", brand: "acme" } }, theme);

	expect(text).toContain('- screens/a.tsx: light, acme (data-mode-brand="acme")');
	expect(text).toContain("- brand acme values, over the project's: primary: #e11d48; primary (dark): #fb7185");
	expect(modesText({ "screens/a.tsx": { scheme: "dark", brand: "default" } }, theme)).not.toContain("values, over");
});
