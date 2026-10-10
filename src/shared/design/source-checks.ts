import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { customTokenNames, tokenKind, tokenUtility, type DesignTokens } from "../context/tokens";
import { parseFile } from "../jsx/tree";
import { PALETTE, PALETTE_SHADES, parseClass, splitModifier } from "../tailwind/classes";
import type { DesignFinding } from "./findings";
import { lineAt } from "./locate";

const NEUTRAL_HUES = new Set(["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"]);

const CHROMATIC_HUES = new Set(Object.keys(PALETTE).filter((hue) => !NEUTRAL_HUES.has(hue)));

const SHADES = new Set<string>(PALETTE_SHADES);

// The prompt allows one accent family. Telling a status color from a second accent needs context the classes don't
// have, so one extra family is let through for it.
const MAX_PALETTE_FAMILIES = 2;

/** Per file, so a screen written with raw colors throughout still gives a readable list */
const MAX_RAW_COLOR_FINDINGS = 20;

const MAX_PROJECT_TOKENS_NAMED = 3;

const COLOR_UTILITY =
	/^(bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|from|via|to|fill|stroke|divide|outline|shadow|decoration|accent|caret)-(.+)$/;

const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

type Lightness = "light" | "mid" | "dark";

type ColorKind = { kind: "neutral"; lightness: Lightness } | { kind: "arbitrary" } | { kind: "palette"; hue: string };

type ColorClass = { raw: string; variants: string[]; prefix: string; color: ColorKind };

function lightnessOf(shade: number): Lightness {
	if (shade <= 200) return "light";

	return shade <= 600 ? "mid" : "dark";
}

function colorKind(value: string): ColorKind | null {
	const [base] = splitModifier(value);

	if (base === "white") return { kind: "neutral", lightness: "light" };

	if (base === "black") return { kind: "neutral", lightness: "dark" };

	if (base.startsWith("[") && base.endsWith("]")) {
		const inner = base.slice(1, -1);

		return inner.startsWith("#") || inner.startsWith("color:") || COLOR_FUNCTION.test(inner)
			? { kind: "arbitrary" }
			: null;
	}

	const palette = /^([a-z]+)-(\d+)$/.exec(base);

	if (!palette || !SHADES.has(palette[2]!)) return null;
	const hue = palette[1]!;

	if (NEUTRAL_HUES.has(hue)) return { kind: "neutral", lightness: lightnessOf(Number(palette[2])) };

	return CHROMATIC_HUES.has(hue) ? { kind: "palette", hue } : null;
}

function colorClass(raw: string): ColorClass | null {
	const parsed = parseClass(raw);
	const match = COLOR_UTILITY.exec(parsed.utility);

	if (!match || parsed.negative) return null;
	const color = colorKind(match[2]!);

	return color && { raw, variants: parsed.variants, prefix: match[1]!, color };
}

function themeClasses(prefix: string, lightness: Lightness): string[] {
	if (prefix === "bg") {
		if (lightness === "light") return ["bg-background", "bg-card", "bg-muted"];

		return lightness === "mid" ? ["bg-muted", "bg-accent"] : ["bg-primary", "bg-foreground"];
	}

	if (prefix === "text") {
		if (lightness === "light") return ["text-primary-foreground", "text-background"];

		return lightness === "mid" ? ["text-muted-foreground"] : ["text-foreground"];
	}

	if (prefix.startsWith("border") || prefix === "divide" || prefix === "outline") return [`${prefix}-border`];

	if (prefix === "ring") return ["ring-ring"];

	if (prefix === "ring-offset") return ["ring-offset-background"];

	if (lightness === "light") return [`${prefix}-background`, `${prefix}-muted`];

	return lightness === "mid" ? [`${prefix}-muted-foreground`] : [`${prefix}-foreground`, `${prefix}-primary`];
}

const list = (classes: string[]) => classes.join(", ");

function projectClasses(prefix: string, colors: string[]) {
	return colors.slice(0, MAX_PROJECT_TOKENS_NAMED).map((utility) => `${prefix}-${utility}`);
}

function suggestion(found: ColorClass, colors: string[]) {
	const variant = found.variants.map((name) => `${name}:`).join("");
	const lightness = found.color.kind === "neutral" ? found.color.lightness : "dark";
	const theme = themeClasses(found.prefix, lightness).map((name) => variant + name);
	const project = projectClasses(found.prefix, colors).map((name) => variant + name);

	return project.length
		? `Use a theme token (${list(theme)}) or a project token (${list(project)})`
		: `Use a theme token (${list(theme)})`;
}

type Occurrence = { found: ColorClass; start: number; count: number };

/** Each string literal and template chunk, which is where classes live (not comments or JSX text) */
function classTokens(source: string): { text: string; start: number }[] {
	const parsed = parseFile(source);
	const found: { text: string; start: number }[] = [];

	for (const token of parsed.tokens) {
		if (token.type !== tt.string && token.type !== tt.template) continue;
		const from = token.type === tt.string ? token.start + 1 : token.start;
		const to = token.type === tt.string ? token.end - 1 : token.end;

		for (const match of source.slice(from, to).matchAll(/\S+/g))
			found.push({ text: match[0], start: from + match.index });
	}

	return found;
}

/** Hard-coded colors in a file's class strings: neutrals and arbitrary values the theme should own, too many accents. */
export function sourceFindings(path: string, source: string, tokens: DesignTokens): DesignFinding[] {
	const colors: string[] = [];

	for (const name of customTokenNames(tokens)) if (tokenKind(name) === "color") colors.push(tokenUtility(name));
	const occurrences = new Map<string, Occurrence>();
	const families = new Map<string, number>();

	for (const { text, start } of classTokens(source)) {
		const found = colorClass(text);

		if (!found) continue;

		if (found.color.kind === "palette") {
			if (!families.has(found.color.hue)) families.set(found.color.hue, start);

			continue;
		}

		const seen = occurrences.get(text);

		if (seen) seen.count++;
		else occurrences.set(text, { found, start, count: 1 });
	}

	const at = (start: number) => ({ path, start, line: lineAt(source, start) });
	const findings: DesignFinding[] = [];

	for (const { found, start, count } of [...occurrences.values()].slice(0, MAX_RAW_COLOR_FINDINGS)) {
		const times = count > 1 ? ` (${count}×)` : "";
		const what = found.color.kind === "neutral" ? "a neutral color" : "a color";

		findings.push({
			rule: "raw-color",
			severity: "warning",
			message: `${found.raw}${times} hard-codes ${what}. ${suggestion(found, colors)} so the screen follows the theme.`,
			...at(start),
		});
	}

	if (families.size > MAX_PALETTE_FAMILIES) {
		const hues = [...families.keys()];
		const extra = families.get(hues[MAX_PALETTE_FAMILIES]!)!;
		const tokenHint = colors.length ? `bg-primary or ${list(projectClasses("bg", colors))}` : "bg-primary";

		findings.push({
			rule: "raw-color",
			severity: "warning",
			message: `Uses ${hues.length} palette color families (${hues.join(", ")}). Keep one accent and status colors; use ${tokenHint} for the rest.`,
			...at(extra),
		});
	}

	return findings.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}
