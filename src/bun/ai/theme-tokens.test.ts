import { describe, expect, test } from "bun:test";
import { themeTokensText } from "./theme-tokens";

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
