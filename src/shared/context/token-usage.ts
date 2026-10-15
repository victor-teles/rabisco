// Where screens and components use a token, read from their class strings like the other source tools (decision 0006)

import { classTokens } from "../design/source-checks";
import { parseColor } from "../export/color";
import { isComponentFile, isScreenFile } from "../project";
import {
	PALETTE,
	PALETTE_SHADES,
	isPaletteHue,
	parseClass,
	splitModifier,
	type ParsedClass,
} from "../tailwind/classes";
import type { ProjectFiles } from "../types";
import {
	COLOR_TOKENS,
	isCustomToken,
	orderedTokenNames,
	parseTextStyle,
	tokenKind,
	tokenUtility,
	type DesignTokens,
	type TokenKind,
} from "./tokens";

export const isCodeFile = (path: string) => isScreenFile(path) || isComponentFile(path);

const COLOR_PREFIXES = new Set(
	"bg text border border-x border-y border-t border-r border-b border-l border-s border-e ring ring-offset outline fill stroke from via to shadow divide placeholder caret accent decoration inset-shadow inset-ring".split(
		" ",
	),
);

const SPACING_PREFIXES = new Set(
	"p px py pt pr pb pl ps pe m mx my mt mr mb ml ms me gap gap-x gap-y space-x space-y w h size min-w min-h max-w max-h inset inset-x inset-y top right bottom left start end translate-x translate-y scroll-m scroll-p basis indent".split(
		" ",
	),
);

const RADIUS_PREFIXES = new Set(
	["", "-t", "-r", "-b", "-l", "-s", "-e", "-tl", "-tr", "-br", "-bl", "-ss", "-se", "-es", "-ee"].map(
		(side) => `rounded${side}`,
	),
);

const DERIVED_RADII = new Set(["sm", "md", "lg", "xl"]);

const isBuiltInColor = (name: string) => COLOR_TOKENS.some((color) => color === name);

const WEIGHTS = new Map([
	["normal", "400"],
	["bold", "700"],
]);

const weightOf = (value: string) => WEIGHTS.get(value.toLowerCase()) ?? value;

/** `rounded-sm` to `rounded-xl` follow `radius` (the screen theme's `--radius-*`) */
const DERIVED_RADIUS = new Map([
	["sm", (radius: string) => `calc(${radius} - 4px)`],
	["md", (radius: string) => `calc(${radius} - 2px)`],
	["lg", (radius: string) => radius],
	["xl", (radius: string) => `calc(${radius} + 4px)`],
]);

/** The kinds a class prefix can read */
function prefixKinds(prefix: string): TokenKind[] {
	const kinds: TokenKind[] = [];

	if (COLOR_PREFIXES.has(prefix)) kinds.push("color");

	if (SPACING_PREFIXES.has(prefix)) kinds.push("spacing");

	if (RADIUS_PREFIXES.has(prefix)) kinds.push("radius");

	if (prefix === "font") kinds.push("font", "font-weight");

	if (prefix === "text") kinds.push("text");

	if (prefix === "shadow") kinds.push("shadow");

	return kinds;
}

/** The token a class value names in one kind, if the project has it */
function tokenFor(kind: TokenKind, value: string, names: Set<string>): string | null {
	const candidates =
		kind === "color"
			? [isBuiltInColor(value) ? value : `color-${value}`]
			: kind === "radius" && DERIVED_RADII.has(value)
				? ["radius"]
				: kind === "font"
					? [`font-${value}`]
					: [`${kind}-${value}`];

	return candidates.find((name) => names.has(name)) ?? null;
}

/** One class's use of a token: `value` is where the token's part sits in the class, e.g. `brand` in `hover:bg-brand/50` */
type Reference = { name: string; prefix: string; parsed: ParsedClass; value: string; modifier: string | null };

function references(raw: string, names: Set<string>): Reference[] {
	const parsed = parseClass(raw);
	const found: Reference[] = [];

	for (let dash = parsed.utility.indexOf("-"); dash > 0; dash = parsed.utility.indexOf("-", dash + 1)) {
		const prefix = parsed.utility.slice(0, dash);
		const [value, modifier] = splitModifier(parsed.utility.slice(dash + 1));

		for (const kind of prefixKinds(prefix)) {
			const name = tokenFor(kind, value, names);

			if (name) found.push({ name, prefix, parsed, value, modifier });
		}
	}

	return found;
}

/** `md:hover:!-mt-4` with `utility` in place of `mt-4` */
function rebuild(parsed: ParsedClass, utility: string) {
	const variants = parsed.variants.map((variant) => `${variant}:`).join("");
	const important = parsed.important && !parsed.importantLast ? "!" : "";

	return `${variants}${important}${parsed.negative ? "-" : ""}${utility}${parsed.importantLast ? "!" : ""}`;
}

const withModifier = (value: string, modifier: string | null) => (modifier === null ? value : `${value}/${modifier}`);

const varPattern = (name: string) => new RegExp(String.raw`--${name}(?![a-z0-9-])`, "g");

export type TokenUsage = { count: number; paths: string[] };

/** Class uses and `var(--name)` references, per token, in screens and components */
export function tokenUsages(files: ProjectFiles, tokens: DesignTokens): Map<string, TokenUsage> {
	const names = new Set(orderedTokenNames(tokens.light, tokens.dark));
	const usages = new Map<string, TokenUsage>();

	const add = (name: string, path: string, count = 1) => {
		const usage = usages.get(name) ?? { count: 0, paths: [] };
		usage.count += count;

		if (!usage.paths.includes(path)) usage.paths.push(path);
		usages.set(name, usage);
	};

	for (const [path, source] of Object.entries(files)) {
		if (!isCodeFile(path)) continue;

		for (const { text } of classTokens(source)) for (const { name } of references(text, names)) add(name, path);

		for (const name of names) {
			const count = (source.match(varPattern(name)) ?? []).length;

			if (count) add(name, path, count);
		}
	}

	return usages;
}

type Rewrite = (text: string) => string[] | null;

/** Applies `rewrite` to each class; `null` keeps a class as it is */
function rewriteClasses(source: string, rewrite: Rewrite): string {
	let text = source;

	for (const { text: raw, start } of classTokens(source).reverse()) {
		const next = rewrite(raw);

		if (next) text = text.slice(0, start) + next.join(" ") + text.slice(start + raw.length);
	}

	return text;
}

function rewriteFiles(files: ProjectFiles, rewrite: (source: string) => string): ProjectFiles {
	const changed: ProjectFiles = {};

	for (const [path, source] of Object.entries(files)) {
		if (!isCodeFile(path)) continue;
		const next = rewrite(source);

		if (next !== source) changed[path] = next;
	}

	return changed;
}

const utilityOf = (name: string) => (isCustomToken(name) ? tokenUtility(name) : name);

/** The files whose classes and `var(--from)` references now name `to`; tokens of another kind keep their classes */
export function renameTokenUsages(files: ProjectFiles, from: string, to: string): ProjectFiles {
	const names = new Set([from]);
	// `radius` also sets rounded-sm to rounded-xl, which no other token can
	const sameKind = tokenKind(from) === tokenKind(to) && from !== "radius";

	return rewriteFiles(files, (source) => {
		const renamed = sameKind
			? rewriteClasses(source, (raw) => {
					const found = references(raw, names)[0];

					return found
						? [rebuild(found.parsed, `${found.prefix}-${withModifier(utilityOf(to), found.modifier)}`)]
						: null;
				})
			: source;

		return renamed.replace(varPattern(from), `--${to}`);
	});
}

/** Spaces become `_` inside an arbitrary value, and quotes would end the class string */
const arbitrary = (value: string) =>
	`[${value
		.replace(/["']/g, "")
		.trim()
		.replace(/\s*,\s*/g, ",")
		.replace(/\s+/g, "_")}]`;

/** The classes that draw what the token drew, with its value written out */
function detachedClasses(found: Reference, kind: TokenKind, value: string): string[] {
	const utility = (prefix: string, inner: string, modifier = found.modifier) =>
		rebuild(found.parsed, `${prefix}-${withModifier(inner, modifier)}`);

	switch (kind) {
		case "font":
			return [utility("font", arbitrary(`family-name:${value}`))];
		case "font-weight":
			return [utility("font", arbitrary(weightOf(value)))];
		case "radius": {
			const derived = found.name === "radius" ? DERIVED_RADIUS.get(found.value) : undefined;

			return [utility(found.prefix, arbitrary(derived ? derived(value) : value))];
		}

		case "text": {
			const style = parseTextStyle(value);

			if (!style) return [found.parsed.raw];

			const lineHeight = found.modifier ?? (style.lineHeight === undefined ? null : arbitrary(style.lineHeight));

			const classes = [utility("text", arbitrary(style.size), lineHeight)];

			if (style.weight !== undefined) classes.push(utility("font", arbitrary(weightOf(style.weight)), null));

			if (style.tracking !== undefined) classes.push(utility("tracking", arbitrary(style.tracking), null));

			return classes;
		}

		default:
			return [utility(found.prefix, arbitrary(value))];
	}
}

/** Every use of the token gets the value back, so screens look the same without it. A color with its own dark value
 * keeps it as a `dark:` class. */
export function detachTokenUsages(files: ProjectFiles, name: string, tokens: DesignTokens): ProjectFiles {
	const kind = tokenKind(name);
	const light = tokens.light[name] ?? tokens.dark[name];
	const dark = tokens.dark[name];

	if (!kind || light === undefined) return {};
	const names = new Set([name]);

	return rewriteFiles(files, (source) => {
		const detached = rewriteClasses(source, (raw) => {
			const found = references(raw, names)[0];

			if (!found) return null;

			const classes = detachedClasses(found, kind, light);

			if (kind === "color" && dark !== undefined && dark !== light && !found.parsed.variants.includes("dark")) {
				const darkClass = parseClass(`dark:${raw}`);
				classes.push(...detachedClasses({ ...found, parsed: darkClass }, kind, dark));
			}

			return classes;
		});

		return detached
			.replace(new RegExp(String.raw`\[var\(--${name}\)\]`, "g"), arbitrary(light))
			.replace(new RegExp(String.raw`var\(--${name}\)`, "g"), light);
	});
}

/** A class with a raw value the project has a token for: `bg-[#e11d48]` is `bg-brand` */
export type RawMatch = { path: string; start: number; raw: string; replacement: string; token: string };

const REM = 16;

/** Lengths compare in px */
function lengthKey(value: string): string | null {
	const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());

	if (!match) return null;
	const number = Number(match[1]) * (match[2] === "rem" ? REM : 1);

	return match[2] || number === 0 ? `${Math.round(number * 100) / 100}px` : null;
}

function colorKey(value: string): string | null {
	const color = parseColor(value);

	return color ? `${color.r},${color.g},${color.b},${Math.round(color.a * 100)}` : null;
}

const shadowKey = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/\s*,\s*/g, ",")
		.replace(/\s+/g, " ");

const KEYS: Partial<Record<TokenKind, (value: string) => string | null>> = {
	color: colorKey,
	radius: lengthKey,
	spacing: lengthKey,
	"font-weight": weightOf,
	shadow: shadowKey,
	text: (value) => {
		const style = parseTextStyle(value);

		return style && Object.keys(style).length === 1 ? lengthKey(style.size) : null;
	},
};

/** `[#e11d48]` → `#e11d48`, `[color:var(--x)]` → `var(--x)`, spaces back from `_` */
function arbitraryValue(value: string): string | null {
	if (!(value.startsWith("[") && value.endsWith("]"))) return null;

	return value
		.slice(1, -1)
		.replace(/^[a-z-]+:(?!\/)/, "")
		.replace(/_/g, " ");
}

function paletteColor(value: string): string | null {
	const match = /^([a-z]+)-(\d+)$/.exec(value);
	const shades: readonly string[] = PALETTE_SHADES;

	if (!match || !isPaletteHue(match[1]!) || !shades.includes(match[2]!)) return null;

	return `oklch(${PALETTE[match[1]][shades.indexOf(match[2]!)]})`;
}

/** The kind of value a raw class sets with this prefix */
function rawKinds(prefix: string): TokenKind[] {
	if (prefix === "text") return ["text", "color"];

	if (prefix === "font") return ["font-weight"];

	if (prefix === "shadow") return ["shadow", "color"];

	return prefixKinds(prefix).filter((kind) => kind !== "font" && kind !== "text");
}

/** Text prefers a `-foreground` color and backgrounds the other ones, when two tokens share a value */
function preferred(prefix: string, names: string[]): string | undefined {
	const wantsForeground = prefix === "text";

	return names.find((name) => name.endsWith("foreground") === wantsForeground) ?? names[0];
}

/** Arbitrary values and palette colors in screens and components that equal a token's light value */
export function rawTokenMatches(files: ProjectFiles, tokens: DesignTokens): RawMatch[] {
	const byKey = new Map<string, string[]>();

	for (const name of orderedTokenNames(tokens.light)) {
		const kind = tokenKind(name);
		const key = kind ? KEYS[kind]?.(tokens.light[name]!) : null;

		if (!kind || !key || (!isCustomToken(name) && kind !== "color")) continue;
		byKey.set(`${kind}:${key}`, [...(byKey.get(`${kind}:${key}`) ?? []), name]);
	}

	const matches: RawMatch[] = [];

	if (!byKey.size) return matches;

	for (const [path, source] of Object.entries(files)) {
		if (!isCodeFile(path)) continue;

		for (const { text: raw, start } of classTokens(source)) {
			const parsed = parseClass(raw);
			const dash = parsed.utility.search(/-(?=\[|[a-z]+-\d+(?:\/|$))/);

			if (dash <= 0) continue;
			const prefix = parsed.utility.slice(0, dash);
			const [value, modifier] = splitModifier(parsed.utility.slice(dash + 1));
			const literal = arbitraryValue(value) ?? paletteColor(value);

			if (literal === null || (!value.startsWith("[") && !COLOR_PREFIXES.has(prefix))) continue;

			for (const kind of rawKinds(prefix)) {
				const key = KEYS[kind]?.(literal);
				const token = key ? preferred(prefix, byKey.get(`${kind}:${key}`) ?? []) : undefined;

				if (!token) continue;

				// A text size's modifier is its line height, which the token would replace
				if (kind === "text" && modifier !== null) break;
				const replacement = rebuild(parsed, `${prefix}-${withModifier(utilityOf(token), modifier)}`);

				matches.push({ path, start, raw, replacement, token });

				break;
			}
		}
	}

	return matches;
}

/** The files after the replacements; a match whose text moved is skipped */
export function replaceRawMatches(files: ProjectFiles, matches: RawMatch[]): ProjectFiles {
	const changed: ProjectFiles = {};
	const byPath = new Map<string, RawMatch[]>();

	for (const match of matches) byPath.set(match.path, [...(byPath.get(match.path) ?? []), match]);

	for (const [path, found] of byPath) {
		let text = files[path];

		if (text === undefined) continue;

		for (const match of [...found].sort((x, y) => y.start - x.start)) {
			if (text.slice(match.start, match.start + match.raw.length) !== match.raw) continue;
			text = text.slice(0, match.start) + match.replacement + text.slice(match.start + match.raw.length);
		}

		if (text !== files[path]) changed[path] = text;
	}

	return changed;
}
