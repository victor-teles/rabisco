import { describe, expect, test } from "bun:test";
import { DESIGN_TEMPLATE } from "./templates";
import { designSourceOf, parseThemeReply, themeUpdateOf, tokenBlock, tokenChanges, type AppliedTheme } from "./theme";

const PROSE = `## Colors

- **Coinbase Blue** (\`{colors.primary}\` — #0052ff): every primary CTA.
`;

const TOKENS = `## Tokens

- primary: #2563eb
`;

const NONE: AppliedTheme = { light: {}, dark: {} };

describe("designSourceOf", () => {
	test("is stable and ignores comments and blank lines", () => {
		expect(designSourceOf(PROSE)).toBe(designSourceOf(PROSE));
		expect(designSourceOf(`${PROSE}\n\n\n<!-- a note -->\n`)).toBe(designSourceOf(PROSE));
		expect(designSourceOf(PROSE.replace("#0052ff", "#0052fe"))).not.toBe(designSourceOf(PROSE));
	});

	test("is undefined without content", () => {
		expect(designSourceOf(undefined)).toBeUndefined();
		expect(designSourceOf(DESIGN_TEMPLATE)).toBeUndefined();
		expect(designSourceOf("# Design\n\n## Tokens\n")).toBeUndefined();
	});
});

describe("themeUpdateOf", () => {
	test("a Tokens section applies as it is, without AI", () => {
		expect(themeUpdateOf(NONE, TOKENS)).toEqual({
			kind: "tokens",
			tokens: { light: { primary: "#2563eb" }, dark: {} },
			count: 1,
			source: designSourceOf(TOKENS),
		});
		expect(themeUpdateOf({ light: { primary: "#2563eb" }, dark: {} }, TOKENS)).toBeNull();
	});

	test("prose asks to read the theme until that source is applied", () => {
		const source = designSourceOf(PROSE)!;
		expect(themeUpdateOf(NONE, PROSE)).toEqual({ kind: "read", source });
		expect(themeUpdateOf({ light: { primary: "#0052ff" }, dark: {}, source }, PROSE)).toBeNull();
		expect(themeUpdateOf({ ...NONE, source }, `${PROSE}\nMore prose.`)).toEqual({
			kind: "read",
			source: designSourceOf(`${PROSE}\nMore prose.`)!,
		});
	});

	test("a commented-out Tokens section counts as prose", () => {
		const commented = `${PROSE}\n## Tokens\n\n<!--\n- primary: #000000\n-->\n`;
		expect(themeUpdateOf(NONE, commented)?.kind).toBe("read");
	});

	test("an empty DESIGN.md offers to clear an applied theme", () => {
		expect(themeUpdateOf(NONE, undefined)).toBeNull();
		expect(themeUpdateOf(NONE, DESIGN_TEMPLATE)).toBeNull();
		expect(themeUpdateOf({ light: { primary: "#111" }, dark: {}, source: "x" }, DESIGN_TEMPLATE)).toEqual({
			kind: "tokens",
			tokens: { light: {}, dark: {} },
			count: 1,
			source: undefined,
		});
	});
});

describe("parseThemeReply", () => {
	test("reads the block, light and dark", () => {
		const reply = `## Tokens\n\n- background: #ffffff\n- primary: #0052ff\n- radius: 12px\n\n### Dark\n\n- background: #0a0b0d\n`;
		const parsed = parseThemeReply(reply);
		expect(parsed.light).toEqual({ background: "#ffffff", primary: "#0052ff", radius: "12px" });
		expect(parsed.dark).toEqual({ background: "#0a0b0d" });
	});

	test("tolerates fences, a missing heading, missing bullets and CSS", () => {
		const reply = "Here is the theme:\n```css\n--primary: #0052ff;\nforeground: #0a0b0d\n```\n";
		expect(parseThemeReply(reply).light).toEqual({ primary: "#0052ff", foreground: "#0a0b0d" });
	});

	test("drops unknown names and invalid values", () => {
		const reply = `## Tokens\n- primary: #0052ff\n- brand-blue: #0052ff\n- ring: red; } body { color: red\n- font-sans: "Inter", system-ui, sans-serif\n- radius: big`;
		const parsed = parseThemeReply(reply);
		expect(parsed.light).toEqual({ primary: "#0052ff", "font-sans": '"Inter", system-ui, sans-serif' });
		expect(parsed.invalid.map((token) => token.name)).toEqual(["brand-blue", "ring", "radius"]);
	});

	test("round-trips tokenBlock", () => {
		const tokens = { light: { primary: "#0052ff", radius: "1rem" }, dark: { primary: "#4d8bff" } };
		const { light, dark } = parseThemeReply(tokenBlock(tokens));
		expect({ light, dark }).toEqual(tokens);
		expect(tokenBlock({ light: { primary: "#000" }, dark: {} })).not.toContain("Dark");
	});
});

test("tokenChanges lists added, changed and removed tokens in token order", () => {
	const from = { light: { radius: "1rem", primary: "#111" }, dark: { primary: "#222" } };
	const to = { light: { primary: "#999", background: "#fff", radius: "1rem" }, dark: {} };
	expect(tokenChanges(from, to)).toEqual([
		{ name: "background", dark: false, value: "#fff" },
		{ name: "primary", dark: false, value: "#999" },
		{ name: "primary", dark: true, value: undefined },
	]);
});
