import { describe, expect, test } from "bun:test";
import { DESIGN_TEMPLATE } from "./templates";
import {
	changedTokenCount,
	customTokenNames,
	designTokensOf,
	parseDesignTokens,
	setDesignToken,
	TOKEN_NAMES,
	tokenClass,
	tokenThemeCss,
	tokensToCss,
	tokenUtility,
	validateToken,
	validateTokenName,
} from "./tokens";

const DESIGN = `# Design

Intro text with - primary: red that is not in the section.

## Tokens

- primary: oklch(0.55 0.2 264)
- primary-foreground: #ffffff
* \`--radius\`: \`0.75rem\`
- font-sans: "Inter", system-ui, sans-serif
- \`accent\`: rgb(37 99 235 / 50%);

### Dark

- primary: oklch(0.7 0.15 264)
- background: #0a0a0a

## Typography

- primary: blue
`;

describe("parseDesignTokens", () => {
	test("reads light and dark tokens of the section only", () => {
		const tokens = parseDesignTokens(DESIGN);
		expect(tokens.light).toEqual({
			primary: "oklch(0.55 0.2 264)",
			"primary-foreground": "#ffffff",
			radius: "0.75rem",
			"font-sans": '"Inter", system-ui, sans-serif',
			accent: "rgb(37 99 235 / 50%)",
		});
		expect(tokens.dark).toEqual({ primary: "oklch(0.7 0.15 264)", background: "#0a0a0a" });
		expect(tokens.invalid).toEqual([]);
	});

	test("the untouched template applies nothing", () => {
		expect(parseDesignTokens(DESIGN_TEMPLATE)).toEqual({ light: {}, dark: {}, invalid: [] });
	});

	test("ignores comments, code fences and other sections", () => {
		const md =
			"# Tokens\n<!-- - primary: red -->\n```\n# Not a heading\n- ring: blue\n```\n- ring: green\n<!-- unclosed\n- border: red";

		expect(parseDesignTokens(md)).toEqual({ light: { ring: "green" }, dark: {}, invalid: [] });
	});

	test("any heading level, case-insensitive; ends at a heading of the same or higher level", () => {
		const md = "## Colors\n### TOKENS\n- muted: #eee\n#### Notes\n- border: #ddd\n## Next\n- ring: #000";
		expect(parseDesignTokens(md).light).toEqual({ muted: "#eee", border: "#ddd" });
	});

	test("dark applies to nested sub-headings and stops at a sibling", () => {
		const md = "## Tokens\n### Dark mode\n#### Brand\n- primary: #111\n### Light\n- primary: #fff";
		expect(parseDesignTokens(md)).toMatchObject({ light: { primary: "#fff" }, dark: { primary: "#111" } });
	});

	test("reports unknown names and invalid values with their line", () => {
		const md =
			"## Tokens\n- primary: red; background: url(x)\n- brand: #fff\n- radius: big\n- font-mono: Fira{Code}\n- muted: #abc";

		const tokens = parseDesignTokens(md);
		expect(tokens.light).toEqual({ muted: "#abc" });
		expect(tokens.invalid.map(({ name, line }) => [name, line])).toEqual([
			["primary", 2],
			["brand", 3],
			["radius", 4],
			["font-mono", 5],
		]);
		expect(tokens.invalid[1]!.reason).toMatch(/Unknown token/);
	});

	test("the last value wins", () => {
		expect(parseDesignTokens("# Tokens\n- ring: red\n- ring: blue").light).toEqual({ ring: "blue" });
	});
});

describe("validateToken", () => {
	test("accepts CSS colors", () => {
		for (const value of [
			"#fff",
			"#ffff",
			"#2563eb",
			"#2563ebcc",
			"rgb(37, 99, 235)",
			"rgba(0 0 0 / 0.5)",
			"hsl(220 90% 56%)",
			"hsla(220deg, 90%, 56%, .5)",
			"oklch(0.55 0.2 264)",
			"oklch(1 0 0 / 10%)",
			"oklab(0.5 -0.1 0.1)",
			"lab(50% 40 59.5)",
			"lch(52.2% 72.2 50)",
			"oklch(0.5 none 264)",
			"RebeccaPurple",
			"transparent",
			"var(--primary)",
		]) {
			expect(validateToken("primary", value)).toBeNull();
		}
	});

	test("rejects anything that could escape the declaration", () => {
		for (const value of [
			"red;",
			"red; } body { display: none",
			"#fff}",
			"#ggg",
			"#12345",
			"rgb(0 0 0) url(x)",
			"url(https://x/y.png)",
			"rgb(0 0 0 /* x */)",
			"rgb(calc(1) 0 0)",
			"expression(alert(1))",
			"@import 'x'",
			"</style><script>",
			"red\\;",
			"var(--x);color:red",
			"notacolor",
			"",
		]) {
			expect(validateToken("primary", value)).not.toBeNull();
		}
	});

	test("lengths and font stacks", () => {
		for (const ok of ["0", "8px", "0.5rem", ".75rem", "1em", "50%"]) expect(validateToken("radius", ok)).toBeNull();

		for (const bad of ["8", "-1px", "calc(1rem)", "1rem;", "8 px"]) expect(validateToken("radius", bad)).not.toBeNull();

		for (const ok of [
			'"Inter", system-ui, sans-serif',
			"'Geist Mono', monospace",
			"Georgia",
			"IBM Plex Sans,sans-serif",
		]) {
			expect(validateToken("font-sans", ok)).toBeNull();
		}

		for (const bad of ['"Inter";', "Inter, url(x)", '"x" } *{', "a,,b", '"unclosed', "@font-face", "a/*b*/"]) {
			expect(validateToken("font-sans", bad)).not.toBeNull();
		}
	});

	test("every token name has a kind", () => {
		expect(TOKEN_NAMES).toHaveLength(30);
		expect(validateToken("chart-5", "#000")).toBeNull();
		expect(validateToken("font-serif", "serif")).toBeNull();
	});
});

describe("tokensToCss", () => {
	test("emits overrides for light, dark, radius and fonts", () => {
		expect(tokensToCss(parseDesignTokens(DESIGN))).toBe(
			":root {\n" +
				"\t--radius: 0.75rem;\n" +
				'\t--font-sans: "Inter", system-ui, sans-serif;\n' +
				"}\n" +
				":root:not(.dark) {\n" +
				"\t--primary: oklch(0.55 0.2 264);\n" +
				"\t--primary-foreground: #ffffff;\n" +
				"\t--accent: rgb(37 99 235 / 50%);\n" +
				"}\n" +
				".dark {\n" +
				"\t--primary: oklch(0.7 0.15 264);\n" +
				"\t--background: #0a0a0a;\n" +
				"}\n",
		);
	});

	test("empty without tokens", () => {
		expect(tokensToCss({ light: {}, dark: {} })).toBe("");
	});

	test("drops invalid values that were not parsed", () => {
		expect(tokensToCss({ light: { primary: "red;}*{x:y", brand: "#fff" }, dark: { ring: "#000" } })).toBe(
			".dark {\n\t--ring: #000;\n}\n",
		);
	});
});

// The common DESIGN.md format (tokens in front matter, colors named in prose) has no tokens section,
// so it applies nothing; the Context panel says so and offers to add one.
const PROSE_DESIGN = `## Overview

Quiet and institutional, one blue accent.

## Colors

### Brand & Accent
- **Brand Blue** (\`{colors.primary}\` — #0052ff): every primary CTA.
- **Muted** (\`{colors.muted}\` — #7c828a): sub-titles.

## Shapes

| Token | Value |
|---|---|
| \`{rounded.pill}\` | 100px |
`;

describe("DESIGN.md without a tokens section", () => {
	test("applies nothing", () => {
		expect(designTokensOf(PROSE_DESIGN)).toEqual({ light: {}, dark: {} });
	});

	test("the template's tokens are commented out until the user keeps them", () => {
		expect(designTokensOf(DESIGN_TEMPLATE)).toEqual({ light: {}, dark: {} });

		const uncommented = designTokensOf(DESIGN_TEMPLATE.replace(/<!--|-->/g, ""));
		expect(uncommented.light.primary).toBe("oklch(0.55 0.2 264)");
		expect(uncommented.dark.primary).toBe("oklch(0.7 0.15 264)");
	});
});

describe("applied tokens", () => {
	test("designTokensOf drops invalid entries", () => {
		expect(designTokensOf("## Tokens\n- primary: #fff\n- ring: nope{}")).toEqual({
			light: { primary: "#fff" },
			dark: {},
		});
		expect(designTokensOf(undefined)).toEqual({ light: {}, dark: {} });
	});

	test("changedTokenCount counts added, changed and removed tokens per mode", () => {
		const from = { light: { primary: "#111", radius: "1rem" }, dark: { primary: "#222" } };
		expect(changedTokenCount(from, from)).toBe(0);
		expect(changedTokenCount(from, { light: { primary: "#111", radius: "1rem" }, dark: { primary: "#222" } })).toBe(0);
		expect(changedTokenCount(from, { light: { primary: "#999", ring: "red" }, dark: { primary: "#222" } })).toBe(3);
		expect(changedTokenCount(from, { light: {}, dark: {} })).toBe(3);
	});
});

describe("custom tokens", () => {
	const CUSTOM = `## Tokens

- color-brand: #e11d48
- radius-card: 1.25rem
- font-display: "Fraunces", serif
- text-display: 3rem/1.1
- text-caption: 0.75rem
- spacing: 0.3rem
- spacing-gutter: 24px

### Dark

- color-brand: #fb7185
`;

	test("are read with the namespace that makes the class", () => {
		const tokens = parseDesignTokens(CUSTOM);
		expect(tokens.invalid).toEqual([]);
		expect(tokens.light["color-brand"]).toBe("#e11d48");
		expect(tokens.dark).toEqual({ "color-brand": "#fb7185" });
		expect(customTokenNames(tokens)).toEqual([
			"color-brand",
			"font-display",
			"radius-card",
			"spacing-gutter",
			"text-caption",
			"text-display",
		]);
		expect(tokenUtility("color-brand")).toBe("brand");
		expect(tokenUtility("primary")).toBe("primary");
	});

	test("values are checked for their kind; built-in names can't be shadowed", () => {
		expect(validateToken("color-brand", "url(x)")).not.toBeNull();
		expect(validateToken("radius-card", "big")).not.toBeNull();
		expect(validateToken("text-display", "3rem/1.1;}")).not.toBeNull();
		expect(validateToken("text-display", "48px/56px")).toBeNull();
		expect(validateToken("font-display", '"Inter";')).not.toBeNull();
		expect(validateToken("color-primary", "#fff")).toContain("primary");
		expect(validateToken("radius-lg", "1rem")).not.toBeNull();
		expect(validateToken("shadow-card", "0 1px red")).not.toBeNull();
		expect(validateToken("color-Brand", "#fff")).not.toBeNull();
		expect(validateToken("color-", "#fff")).not.toBeNull();
	});

	test("CSS: custom light values apply in both modes, text splits its line height", () => {
		expect(tokensToCss(designTokensOf(CUSTOM))).toBe(
			":root {\n" +
				"\t--color-brand: #e11d48;\n" +
				"\t--radius-card: 1.25rem;\n" +
				'\t--font-display: "Fraunces", serif;\n' +
				"\t--text-display: 3rem;\n" +
				"\t--text-display--line-height: 1.1;\n" +
				"\t--text-caption: 0.75rem;\n" +
				"\t--spacing: 0.3rem;\n" +
				"\t--spacing-gutter: 24px;\n" +
				"}\n" +
				".dark {\n" +
				"\t--color-brand: #fb7185;\n" +
				"}\n",
		);
	});

	test("the compiler gets names with fallbacks, not values", () => {
		expect(tokenThemeCss(["color-brand", "text-display", "primary", "spacing", "nope"])).toBe(
			"@theme reference {\n" +
				"\t--color-brand: currentcolor;\n" +
				"\t--text-display: 1rem;\n" +
				"\t--text-display--line-height: normal;\n" +
				"}\n",
		);
		expect(tokenThemeCss([])).toBe("");
	});
});

describe("setDesignToken", () => {
	const DOC =
		"# Design\n\n## Tokens\n\n- primary: #111\n* `radius`: 1rem\n\n### Dark\n\n- primary: #eee\n\n## Typography\n\nText\n";

	test("changes a value in place, keeping the bullet", () => {
		expect(setDesignToken(DOC, "radius", "light", "0.5rem")).toBe(DOC.replace("* `radius`: 1rem", "* radius: 0.5rem"));
		expect(setDesignToken(DOC, "primary", "dark", "#fff")).toBe(DOC.replace("- primary: #eee", "- primary: #fff"));
	});

	test("adds after the mode's last entry", () => {
		const light = setDesignToken(DOC, "color-brand", "light", "#e11d48");
		expect(light).toBe(DOC.replace("* `radius`: 1rem\n", "* `radius`: 1rem\n- color-brand: #e11d48\n"));

		const dark = setDesignToken(DOC, "color-brand", "dark", "#fb7185");
		expect(dark).toBe(DOC.replace("- primary: #eee\n", "- primary: #eee\n- color-brand: #fb7185\n"));
		expect(designTokensOf(dark).dark).toEqual({ primary: "#eee", "color-brand": "#fb7185" });
	});

	test("removes every line of the name in that mode only", () => {
		const doc = setDesignToken(DOC, "primary", "light", null);
		expect(designTokensOf(doc)).toEqual({ light: { radius: "1rem" }, dark: { primary: "#eee" } });
	});

	test("adds a Dark sub-heading at the end of the section", () => {
		const doc = "## Tokens\n\n- primary: #111\n\n## Typography\n";
		const next = setDesignToken(doc, "primary", "dark", "#eee");
		expect(next).toBe("## Tokens\n\n- primary: #111\n\n### Dark\n\n- primary: #eee\n\n## Typography\n");
		expect(designTokensOf(next)).toEqual({ light: { primary: "#111" }, dark: { primary: "#eee" } });
	});

	test("adds a Tokens section when there is none", () => {
		expect(setDesignToken("# Design\n\nProse.\n", "color-brand", "light", "#e11d48")).toBe(
			"# Design\n\nProse.\n\n## Tokens\n\n- color-brand: #e11d48\n",
		);
		expect(designTokensOf(setDesignToken("", "primary", "dark", "#000"))).toEqual({
			light: {},
			dark: { primary: "#000" },
		});
	});

	test("an empty section and the template's commented tokens", () => {
		const empty = setDesignToken("## Tokens\n\n## Next\n", "ring", "light", "#000");
		expect(empty).toBe("## Tokens\n\n- ring: #000\n\n## Next\n");

		const template = setDesignToken(DESIGN_TEMPLATE, "color-brand", "light", "#e11d48");
		expect(designTokensOf(template)).toEqual({ light: { "color-brand": "#e11d48" }, dark: {} });
		expect(designTokensOf(setDesignToken(template, "color-brand", "dark", "#fb7185")).dark).toEqual({
			"color-brand": "#fb7185",
		});
	});
});

describe("tokenClass", () => {
	test("maps a custom token to the class it makes", () => {
		expect(tokenClass("color-brand")).toBe("bg-brand");
		expect(tokenClass("radius-card")).toBe("rounded-card");
		expect(tokenClass("font-display")).toBe("font-display");
		expect(tokenClass("text-display")).toBe("text-display");
		expect(tokenClass("spacing-gutter")).toBe("p-gutter");
	});

	test("is null for built-in and unknown names", () => {
		expect(tokenClass("primary")).toBeNull();
		expect(tokenClass("font-sans")).toBeNull();
		expect(tokenClass("brand")).toBeNull();
	});
});

describe("validateTokenName", () => {
	test("checks the name alone", () => {
		expect(validateTokenName("color-brand")).toBeNull();
		expect(validateTokenName("radius")).toBeNull();
		expect(validateTokenName("brand")).toContain("Unknown token name");
		expect(validateTokenName("radius-lg")).toContain("Built in");
	});
});
