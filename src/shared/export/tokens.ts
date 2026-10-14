// The tokens a project's screens use, for a codebase: DTCG JSON for token tools, CSS variables, and a Tailwind v4 theme.

import { SCREEN_THEME_CSS } from "../../mainview/lib/render/theme";
import { customTokenNames, declarations, tokenKind, tokenThemeCss, type DesignTokens } from "../context/tokens";
import type { Json, JsonObject } from "../json";
import type { ExportFile } from "../types";
import { parseColor, toHex } from "./color";

export const TOKENS_DIR = "tokens/";

type Mode = "light" | "dark";

/** The values the canvas theme sets before DESIGN.md, from its `:root` and `.dark` blocks */
function baseValues(mode: Mode): [string, string][] {
	const selector = mode === "light" ? ":root" : ".dark";
	const start = SCREEN_THEME_CSS.indexOf(`\n${selector} {\n`);

	if (start < 0) return [];
	const body = SCREEN_THEME_CSS.slice(start, SCREEN_THEME_CSS.indexOf("\n}", start));

	return [...body.matchAll(/^\t--([a-z0-9-]+):\s*(.+?);$/gm)].map((match): [string, string] => [match[1]!, match[2]!]);
}

/** Every variable of a mode: the canvas theme, then the applied tokens over it */
export function resolvedTokens(theme: DesignTokens, mode: Mode): Map<string, string> {
	return new Map([...baseValues(mode), ...declarations(theme[mode])]);
}

const cssBlock = (selector: string, values: Map<string, string>) =>
	`${selector} {\n${[...values].map(([name, value]) => `\t--${name}: ${value};\n`).join("")}}\n`;

export function tokensCss(theme: DesignTokens): string {
	return `${cssBlock(":root", resolvedTokens(theme, "light"))}\n${cssBlock(".dark", resolvedTokens(theme, "dark"))}`;
}

/** The theme's `@theme inline` block, which maps `bg-primary` and `rounded-lg` to the variables */
function inlineTheme() {
	const start = SCREEN_THEME_CSS.indexOf("@theme inline {");

	return start < 0 ? "" : `${SCREEN_THEME_CSS.slice(start, SCREEN_THEME_CSS.indexOf("\n}", start) + 2)}\n`;
}

/** Imported after `tailwindcss`, so `bg-primary`, `rounded-card` and `dark:` work in any Tailwind v4 app */
export function tailwindTheme(theme: DesignTokens): string {
	const custom = tokenThemeCss(customTokenNames(theme));

	return [
		`@import "./tokens.css";\n`,
		`@custom-variant dark (&:is(.dark *));\n`,
		inlineTheme(),
		custom && `/* The custom DESIGN.md tokens: tokens.css sets their values */\n${custom}`,
	]
		.filter(Boolean)
		.join("\n");
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;

const OKLCH = new RegExp(
	String.raw`^oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})\s+(${NUMBER})(?:deg)?\s*(?:/\s*(${NUMBER})(%?))?\s*\)$`,
	"i",
);

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** DTCG color: `oklch()` keeps its space, other colors become sRGB; both carry a `hex` fallback */
function colorValue(value: string): JsonObject | null {
	const rgba = parseColor(value);

	if (!rgba) return null;
	const oklch = OKLCH.exec(value.trim());

	const percent = (n: string, unit: string | undefined, scale: number) =>
		round(unit === "%" ? Number(n) / 100 : Number(n) / scale);

	const components = oklch
		? [percent(oklch[1]!, oklch[2], 1), round(Number(oklch[3])), round(Number(oklch[4]))]
		: [rgba.r, rgba.g, rgba.b].map((channel) => round(channel / 255));

	const alpha = oklch?.[5] === undefined ? rgba.a : percent(oklch[5], oklch[6], 1);

	const space = { colorSpace: oklch ? "oklch" : "srgb", components };
	const hex = toHex(rgba);

	return alpha === 1 ? { ...space, hex } : { ...space, alpha: round(alpha), hex };
}

/** DTCG dimensions are px or rem */
function dimensionValue(value: string): JsonObject | null {
	if (value === "0") return { value: 0, unit: "px" };
	const match = new RegExp(`^(${NUMBER})(px|rem)$`).exec(value);

	return match ? { value: Number(match[1]), unit: match[2]! } : null;
}

const fontFamilyValue = (value: string) => value.split(",").map((family) => family.trim().replace(/^["']|["']$/g, ""));

/** Theme colors DESIGN.md can't set, like `subtle-foreground` */
const COLOR_VARIABLES = new Set(inlineTheme().match(/(?<=--color-)[a-z0-9-]+/g) ?? []);

type DtcgToken = { group: string; name: string; type: string; value: Json };

/** `primary` → color.primary, `radius` → radius.base, `font-sans` → font.sans, `text-display` → text.display */
function placement(name: string): { group: string; name: string } | null {
	const kind = tokenKind(name);

	if (!kind) return COLOR_VARIABLES.has(name) ? { group: "color", name } : null;

	if (kind === "color") return { group: "color", name: name.replace(/^color-/, "") };

	if (name === "radius" || name === "spacing") return { group: name, name: "base" };

	return { group: kind, name: name.slice(kind.length + 1) };
}

/** A reference to another color is a DTCG alias; values DTCG can't hold, like `color-mix()`, are left to tokens.css */
function dtcgToken(name: string, value: string): DtcgToken | null {
	const place = placement(name.replace(/--line-height$/, ""));

	if (!place) return null;

	if (name.endsWith("--line-height")) {
		const line = dimensionValue(value);
		const number = Number(value);

		const lineValue = line ?? (Number.isFinite(number) ? number : null);

		if (lineValue === null) return null;

		return { ...place, name: `${place.name}-line-height`, type: line ? "dimension" : "number", value: lineValue };
	}

	const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
	const target = alias ? placement(alias) : null;

	if (target)
		return {
			...place,
			type: place.group === "font" ? "fontFamily" : "color",
			value: `{${target.group}.${target.name}}`,
		};

	switch (place.group) {
		case "color": {
			const color = colorValue(value);

			return color ? { ...place, type: "color", value: color } : null;
		}

		case "font":
			return { ...place, type: "fontFamily", value: fontFamilyValue(value) };

		default: {
			const dimension = dimensionValue(value);

			return dimension ? { ...place, type: "dimension", value: dimension } : null;
		}
	}
}

function dtcgJson(tokens: DtcgToken[]) {
	const groups = new Map<string, Record<string, Json>>();

	for (const token of tokens) {
		const group = groups.get(token.group) ?? {};
		group[token.name] = { $type: token.type, $value: token.value };
		groups.set(token.group, group);
	}

	return `${JSON.stringify(Object.fromEntries(groups), null, "\t")}\n`;
}

const dtcgTokens = (values: Map<string, string>) =>
	[...values].flatMap(([name, value]) => {
		const token = dtcgToken(name, value);

		return token ? [token] : [];
	});

/** `tokens.json` has every light value; `tokens.dark.json` has the dark values that differ, to layer over it */
export function tokensJson(theme: DesignTokens) {
	const light = resolvedTokens(theme, "light");
	const darkOnly = new Map([...resolvedTokens(theme, "dark")].filter(([name, value]) => light.get(name) !== value));

	return { light: dtcgJson(dtcgTokens(light)), dark: dtcgJson(dtcgTokens(darkOnly)) };
}

function readme(theme: DesignTokens) {
	const custom = customTokenNames(theme);

	return `# Design tokens

Exported from Rabisco: the canvas theme with the \`DESIGN.md\` tokens applied over it.

- \`tokens.css\`: every token as a CSS variable. \`:root\` holds the light values and \`.dark\` the dark ones.
- \`tailwind.css\`: a Tailwind v4 theme. Import it after Tailwind, and \`bg-primary\`, \`rounded-lg\`${custom.length ? ` and the custom tokens (${custom.map((name) => `\`${name}\``).join(", ")})` : ""} work:

  \`\`\`css
  @import "tailwindcss";
  @import "./tokens/tailwind.css";
  \`\`\`

- \`tokens.json\`: the light values in the [Design Tokens format](https://www.designtokens.org/tr/2025.10/format/) (DTCG), for Style Dictionary and other token tools. \`tokens.dark.json\` has the dark values that differ.

Values DTCG can't hold, such as \`color-mix()\`, are only in \`tokens.css\`.
`;
}

/** Under `dir`, so a project export can put them in a folder */
export function tokenFiles(theme: DesignTokens, dir = TOKENS_DIR): ExportFile[] {
	const json = tokensJson(theme);

	return [
		{ path: `${dir}tokens.json`, content: json.light },
		{ path: `${dir}tokens.dark.json`, content: json.dark },
		{ path: `${dir}tokens.css`, content: tokensCss(theme) },
		{ path: `${dir}tailwind.css`, content: tailwindTheme(theme) },
		{ path: `${dir}README.md`, content: readme(theme) },
	];
}
