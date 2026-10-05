import { describe, expect, test } from "bun:test";
import { DESIGN_TEMPLATE } from "./templates";
import { parseDesignTokens, TOKEN_NAMES, tokensToCss, validateToken } from "./tokens";

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
		const md = "# Tokens\n<!-- - primary: red -->\n```\n# Not a heading\n- ring: blue\n```\n- ring: green\n<!-- unclosed\n- border: red";
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
		const md = "## Tokens\n- primary: red; background: url(x)\n- brand: #fff\n- radius: big\n- font-mono: Fira{Code}\n- muted: #abc";
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
		for (const ok of ['"Inter", system-ui, sans-serif', "'Geist Mono', monospace", "Georgia", "IBM Plex Sans,sans-serif"]) {
			expect(validateToken("font-sans", ok)).toBeNull();
		}
		for (const bad of ['"Inter";', "Inter, url(x)", '"x" } *{', "a,,b", '"unclosed', "@font-face", "a/*b*/"]) {
			expect(validateToken("font-sans", bad)).not.toBeNull();
		}
	});

	test("every token name has a kind", () => {
		expect(TOKEN_NAMES).toHaveLength(29);
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
		expect(tokensToCss({ light: { primary: "red;}*{x:y", brand: "#fff" }, dark: { ring: "#000" } })).toBe(".dark {\n\t--ring: #000;\n}\n");
	});
});
