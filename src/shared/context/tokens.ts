// Values become CSS inside screen frames, so each must match a strict whitelist for its kind.

export const COLOR_TOKENS = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"success",
	"warning",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
] as const;

export const FONT_TOKENS = ["font-sans", "font-serif", "font-mono"] as const;

export const TOKEN_NAMES = [...COLOR_TOKENS, "radius", ...FONT_TOKENS, "spacing"] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** Custom tokens use Tailwind v4 theme namespaces, so the name is the class: `color-brand` is `bg-brand` (decision 0013) */
export const TOKEN_KINDS = ["color", "radius", "font", "font-weight", "text", "spacing", "shadow"] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

/** Names without the `--` prefix */
export type DesignTokens = { light: Record<string, string>; dark: Record<string, string> };

export type InvalidToken = {
	name: string;
	value: string;
	/** 1-based */
	line: number;
	reason: string;
};

export type ParsedDesignTokens = DesignTokens & { invalid: InvalidToken[] };

const NAMED_COLORS = new Set(
	(
		"transparent currentcolor black silver gray grey white maroon red purple fuchsia green lime olive yellow navy blue teal aqua " +
		"aliceblue antiquewhite aquamarine azure beige bisque blanchedalmond blueviolet brown burlywood cadetblue chartreuse " +
		"chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgrey darkgreen " +
		"darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
		"darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
		"gainsboro ghostwhite gold goldenrod greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
		"lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen lightpink " +
		"lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow limegreen linen magenta " +
		"mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
		"mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite oldlace olivedrab orange orangered orchid " +
		"palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue rebeccapurple " +
		"rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna skyblue slateblue slategray slategrey snow " +
		"springgreen steelblue tan thistle tomato turquoise violet wheat whitesmoke yellowgreen"
	).split(/\s+/),
);

// Whitelists. None of them allows `;{}<>\`, quotes in colors, nested parentheses or `/*`.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\([0-9a-z.%+\-,/\s]*\)$/i;

const VAR_REF = /^var\(--[a-z0-9-]+\)$/i;

const LENGTH = /^(?:0|\d*\.?\d+(?:px|rem|em|%))$/i;

/** `3rem` or `3rem/1.1`; the line height is a number or a length */
const FONT_SIZE = /^(0|\d*\.?\d+(?:px|rem|em|%))(?:\s*\/\s*(0|\d*\.?\d+(?:px|rem|em|%)?))?$/i;

const FONT_WEIGHT = /^(?:[1-9]\d{0,2}|1000|normal|bold)$/i;

/** A text style: the size and line height, then an optional weight and tracking, e.g. `2rem/1.2 600 -0.01em` */
const TEXT_STYLE =
	/^(\S+?(?:\s*\/\s*\S+)?)(?:\s+([1-9]\d{0,2}|1000|normal|bold))?(?:\s+(0|-?\d*\.?\d+(?:px|rem|em)))?$/i;

const SHADOW_LENGTH = /^(?:0|-?\d*\.?\d+(?:px|rem|em))$/i;

const FONT_FAMILY = String.raw`(?:"[a-z0-9 -]+"|'[a-z0-9 -]+'|[a-z][a-z0-9 -]*)`;

const FONT_STACK = new RegExp(String.raw`^${FONT_FAMILY}(?:\s*,\s*${FONT_FAMILY})*$`, "i");

const CUSTOM_NAME = /^(color|radius|font-weight|font|text|spacing|shadow)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;

/** Theme names the screen theme derives from the built-in tokens */
const DERIVED_RADII = new Set(["sm", "md", "lg", "xl"]);

/** Tailwind's own scales, which a custom name would replace in every screen */
const BUILT_IN_SHADOWS = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "none", "inner"]);

const BUILT_IN_WEIGHTS = new Set([
	"thin",
	"extralight",
	"light",
	"normal",
	"medium",
	"semibold",
	"bold",
	"extrabold",
	"black",
]);

const isOneOf = <T extends string>(names: readonly T[], value: string): value is T =>
	names.some((name) => name === value);

const isColor = (value: string) =>
	HEX.test(value) || COLOR_FUNCTION.test(value) || VAR_REF.test(value) || NAMED_COLORS.has(value.toLowerCase());

/** Outside parentheses, so `rgb(0 0 0 / 0.1)` stays one part */
function splitOutside(value: string, separator: RegExp): string[] {
	const parts: string[] = [];
	let depth = 0;
	let part = "";

	for (const char of value) {
		if (char === "(") depth++;
		else if (char === ")") depth--;

		if (depth === 0 && separator.test(char)) {
			parts.push(part);
			part = "";
		} else part += char;
	}

	return [...parts, part];
}

/** `0 1px 3px rgb(0 0 0 / 0.1), inset 0 0 0 1px #0001`: two to four lengths, a color and `inset` per layer */
function isShadow(value: string): boolean {
	if (value === "none") return true;

	return splitOutside(value, /,/).every((layer) => {
		const words = splitOutside(layer.trim(), /\s/).filter(Boolean);
		const lengths = words.filter((word) => SHADOW_LENGTH.test(word)).length;
		const colors = words.filter((word) => !SHADOW_LENGTH.test(word) && word !== "inset" && isColor(word)).length;
		const insets = words.filter((word) => word === "inset").length;

		return lengths >= 2 && lengths <= 4 && colors <= 1 && insets <= 1 && lengths + colors + insets === words.length;
	});
}

export const isCustomToken = (name: string) => !isOneOf(TOKEN_NAMES, name) && CUSTOM_NAME.test(name);

/** `null` for an unknown name */
export function tokenKind(name: string): TokenKind | null {
	if (isOneOf(COLOR_TOKENS, name)) return "color";

	if (isOneOf(FONT_TOKENS, name)) return "font";

	if (name === "radius" || name === "spacing") return name;

	const custom = CUSTOM_NAME.exec(name)?.[1];

	return custom && isOneOf(TOKEN_KINDS, custom) ? custom : null;
}

/** The class part a custom token adds: `color-brand` is `brand` (`bg-brand`), `radius-card` is `card` (`rounded-card`) */
export const tokenUtility = (name: string) => CUSTOM_NAME.exec(name)?.[2] ?? name;

const CLASS_PREFIX: Record<TokenKind, string> = {
	color: "bg",
	radius: "rounded",
	font: "font",
	"font-weight": "font",
	text: "text",
	spacing: "p",
	shadow: "shadow",
};

/** One class a custom token makes, e.g. `bg-brand` or `p-gutter`; `null` for built-in names */
export function tokenClass(name: string): string | null {
	const kind = isCustomToken(name) ? tokenKind(name) : null;

	return kind ? `${CLASS_PREFIX[kind]}-${tokenUtility(name)}` : null;
}

/** `null` when the name is usable, else the reason */
export function validateTokenName(name: string): string | null {
	const kind = tokenKind(name);

	if (!kind) {
		return "Unknown token name, e.g. primary, radius, or a custom color-brand, radius-card, font-display, text-display";
	}

	const utility = tokenUtility(name);

	if (isCustomToken(name) && kind === "color" && isOneOf(COLOR_TOKENS, utility)) {
		return `Built in: name it ${utility}`;
	}

	if (isCustomToken(name) && kind === "radius" && DERIVED_RADII.has(utility)) {
		return "Built in: rounded-sm to rounded-xl follow radius";
	}

	if (kind === "shadow" && BUILT_IN_SHADOWS.has(utility)) return `Built in: shadow-${utility} is Tailwind's`;

	if (kind === "font-weight" && BUILT_IN_WEIGHTS.has(utility)) return `Built in: font-${utility} is Tailwind's`;

	return null;
}

/** `null` when valid, else the reason */
export function validateToken(name: string, value: string): string | null {
	const kind = tokenKind(name);
	const nameError = validateTokenName(name);

	if (!kind || nameError) return nameError;

	switch (kind) {
		case "color":
			return isColor(value) ? null : "Not a color, e.g. #2563eb, oklch(0.55 0.2 264) or rgb(37 99 235)";
		case "font":
			return FONT_STACK.test(value) ? null : 'Not a font stack, e.g. "Inter", system-ui, sans-serif';
		case "text":
			return parseTextStyle(value) ? null : "Not a text style, e.g. 3rem, 3rem/1.1 or 2rem/1.2 600 -0.01em";
		case "font-weight":
			return FONT_WEIGHT.test(value) ? null : "Not a font weight, e.g. 600 or bold";
		case "shadow":
			return isShadow(value) ? null : "Not a shadow, e.g. 0 4px 12px rgb(0 0 0 / 0.1)";
		case "radius":
		case "spacing":
			return LENGTH.test(value) ? null : "Not a length, e.g. 0.5rem or 8px";
	}
}

/** Built-in names in `TOKEN_NAMES` order, then custom names in the order they were written */
export function orderedTokenNames(...modes: Record<string, string>[]): string[] {
	const names = new Set(modes.flatMap((values) => Object.keys(values)));
	const builtIn: string[] = TOKEN_NAMES.filter((name) => names.has(name));

	return [...builtIn, ...[...names].filter((name) => !isOneOf(TOKEN_NAMES, name))];
}

/** Every custom name in either mode, sorted */
export function customTokenNames(tokens: DesignTokens): string[] {
	return orderedTokenNames(tokens.light, tokens.dark).filter(isCustomToken).sort();
}

/** Keeps line breaks so line numbers stay right; an unclosed comment runs to the end. */
function stripComments(markdown: string) {
	return markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ""));
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const ENTRY = /^(\s*[-*+]\s+)`?(?:--)?([a-z0-9][\w-]*)`?\s*:\s*(.*?)\s*$/i;

type TokenEntry = { name: string; value: string; dark: boolean; /** 0-based */ index: number };

type TokenSection = {
	level: number;
	/** 0-based line of the heading */
	heading: number;
	/** 0-based line after the section's last line */
	end: number;
	/** 0-based line of the first sub-heading that switches to dark values */
	darkHeading?: number;
};

type TokenScan = { entries: TokenEntry[]; sections: TokenSection[] };

/** Sub-headings containing "dark" switch to dark values. Comments and code fences don't count. */
function scanTokens(markdown: string): TokenScan {
	const lines = stripComments(markdown).split(/\r?\n/);
	const entries: TokenEntry[] = [];
	const sections: TokenSection[] = [];
	let section: TokenSection | null = null;
	let path: { level: number; dark: boolean }[] = [];
	let fence: string | null = null;

	lines.forEach((text, index) => {
		const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(text);

		if (fence) {
			if (fenceMatch && fenceMatch[1]!.startsWith(fence)) fence = null;

			return;
		}

		if (fenceMatch) {
			fence = fenceMatch[1]!;

			return;
		}

		const heading = HEADING.exec(text);

		if (heading) {
			const level = heading[1]!.length;
			const title = heading[2]!.trim();

			if (section && level > section.level) {
				const dark = /dark/i.test(title);
				path = path.filter((h) => h.level < level);
				path.push({ level, dark });

				if (dark && section.darkHeading === undefined) section.darkHeading = index;

				return;
			}

			if (section) section.end = index;
			section = /^(?:design\s+)?tokens$/i.test(title) ? { level, heading: index, end: lines.length } : null;
			path = [];

			if (section) sections.push(section);

			return;
		}

		const entry = section && ENTRY.exec(text);

		if (!entry) return;
		entries.push({
			name: entry[2]!.toLowerCase(),
			value: cleanValue(entry[3]!),
			dark: path.some((h) => h.dark),
			index,
		});
	});

	return { entries, sections };
}

/** The last valid value wins. */
export function parseDesignTokens(markdown: string): ParsedDesignTokens {
	const result: ParsedDesignTokens = { light: {}, dark: {}, invalid: [] };

	for (const { name, value, dark, index } of scanTokens(markdown).entries) {
		const reason = validateToken(name, value);

		if (reason) result.invalid.push({ name, value, line: index + 1, reason });
		else (dark ? result.dark : result.light)[name] = value;
	}

	return result;
}

function cleanValue(raw: string) {
	let value = raw.trim();
	const ticks = /^`+([^`]*)`+$/.exec(value);

	if (ticks) value = ticks[1]!.trim();

	return value.replace(/\s*;$/, "");
}

const isBlank = (line: string | undefined) => line !== undefined && line.trim() === "";

/**
 * Sets one token's value in DESIGN.md's Tokens section, or removes it with `null`. The rest of the file stays as it
 * was: an existing line keeps its place, a new one goes after its mode's last entry, and a missing `### Dark` or
 * `## Tokens` heading is added.
 */
export function setDesignToken(markdown: string, name: string, mode: "light" | "dark", value: string | null): string {
	const lines = markdown.split("\n");
	const { entries, sections } = scanTokens(markdown);
	const dark = mode === "dark";
	const matches = entries.filter((entry) => entry.name === name && entry.dark === dark);
	const line = (bullet = "- ") => `${bullet}${name}: ${value}`;

	if (value === null) {
		const removed = new Set(matches.map((entry) => entry.index));

		return lines.filter((_, index) => !removed.has(index)).join("\n");
	}

	const last = matches.at(-1);

	if (last) {
		const bullet = /^\s*[-*+]\s+/.exec(lines[last.index]!)?.[0];
		lines[last.index] = line(bullet) + (lines[last.index]!.endsWith("\r") ? "\r" : "");

		return lines.join("\n");
	}

	const section = sections[0];

	if (!section) {
		const body = markdown.replace(/\s+$/, "");
		const block = dark ? ["## Tokens", "", "### Dark", "", line()] : ["## Tokens", "", line()];

		return `${body}${body ? "\n\n" : ""}${block.join("\n")}\n`;
	}

	const anchor = entries.filter((entry) => entry.dark === dark && entry.index < section.end).at(-1)?.index;

	const insert = (at: number, block: string[]) => {
		if (lines[at] !== undefined && !isBlank(lines[at]) && !ENTRY.test(lines[at]!)) block.push("");
		lines.splice(at, 0, ...block);

		return lines.join("\n");
	};

	if (anchor !== undefined) return insert(anchor + 1, [line()]);

	const heading = dark ? section.darkHeading : section.heading;

	if (heading !== undefined) {
		const at = isBlank(lines[heading + 1]) ? heading + 2 : heading + 1;

		return insert(at, at === heading + 1 ? ["", line()] : [line()]);
	}

	let end = section.end;

	while (end > section.heading + 1 && isBlank(lines[end - 1])) end--;

	return insert(end, ["", `${"#".repeat(section.level + 1)} Dark`, "", line()]);
}

function block(selector: string, entries: [string, string][]) {
	if (!entries.length) return "";

	return `${selector} {\n${entries.map(([name, value]) => `\t--${name}: ${value};\n`).join("")}}\n`;
}

export type TextStyle = { size: string; lineHeight?: string; weight?: string; tracking?: string };

/** The parts of a `text-*` value; `null` when it isn't one */
export function parseTextStyle(value: string): TextStyle | null {
	const match = TEXT_STYLE.exec(value.trim());
	const size = match ? FONT_SIZE.exec(match[1]!) : null;

	if (!match || !size) return null;
	const style: TextStyle = { size: size[1]! };

	if (size[2] !== undefined) style.lineHeight = size[2];

	if (match[2] !== undefined) style.weight = match[2];

	if (match[3] !== undefined) style.tracking = match[3];

	return style;
}

export function formatTextStyle({ size, lineHeight, weight, tracking }: TextStyle): string {
	return [lineHeight === undefined ? size : `${size}/${lineHeight}`, weight, tracking].filter(Boolean).join(" ");
}

/** A text token's line height, weight and tracking are their own variables, the way Tailwind's theme declares them */
export function declarations(values: Record<string, string>): [string, string][] {
	return Object.entries(values).flatMap(([name, value]): [string, string][] => {
		if (validateToken(name, value) !== null) return [];

		const style = tokenKind(name) === "text" ? parseTextStyle(value) : null;

		if (!style) return [[name, value]];

		const parts: [string, string][] = [[name, style.size]];

		if (style.lineHeight !== undefined) parts.push([`${name}--line-height`, style.lineHeight]);

		if (style.weight !== undefined) parts.push([`${name}--font-weight`, style.weight]);

		if (style.tracking !== undefined) parts.push([`${name}--letter-spacing`, style.tracking]);

		return parts;
	});
}

// Light built-in colors use `:root:not(.dark)` so they don't beat the theme's own `.dark` values. Custom tokens have
// no theme value, so their light value applies in dark mode too unless they set a dark one.
// Values are re-validated so hand-built `tokens` can't inject CSS.
export function tokensToCss(tokens: DesignTokens): string {
	const builtInColors = Object.fromEntries(
		Object.entries(tokens.light).filter(([name]) => isOneOf(COLOR_TOKENS, name)),
	);

	const rest = Object.fromEntries(Object.entries(tokens.light).filter(([name]) => !(name in builtInColors)));

	return (
		block(":root", declarations(rest)) +
		block(":root:not(.dark)", declarations(builtInColors)) +
		block(".dark", declarations(tokens.dark))
	);
}

/** What `bg-brand` falls back to before a value arrives, or in a mode without one */
const FALLBACKS: Record<TokenKind, string> = {
	color: "currentcolor",
	radius: "0",
	font: "inherit",
	"font-weight": "inherit",
	text: "1rem",
	spacing: "0",
	shadow: "0 0 #0000",
};

/**
 * The custom names for Tailwind's `@theme`, without their values. `reference` makes `bg-brand` read
 * `var(--color-brand, …)` and emits no variables, so the values can come from the theme stylesheet and a value edit
 * rebuilds nothing.
 */
export function tokenThemeCss(names: Iterable<string>): string {
	const lines = [...names].flatMap((name) => {
		const kind = isCustomToken(name) ? tokenKind(name) : null;

		if (!kind) return [];

		// Tailwind writes a shadow's value into the class, so it has to be a reference to the stylesheet's
		const fallback = kind === "shadow" ? `var(--${name}, ${FALLBACKS[kind]})` : FALLBACKS[kind];
		const line = `\t--${name}: ${fallback};`;

		if (kind !== "text") return [line];

		return [
			line,
			`\t--${name}--line-height: normal;`,
			`\t--${name}--font-weight: inherit;`,
			`\t--${name}--letter-spacing: inherit;`,
		];
	});

	return lines.length ? `@theme reference {\n${lines.join("\n")}\n}\n` : "";
}

const NO_TOKENS: DesignTokens = { light: {}, dark: {} };

/** The valid tokens of DESIGN.md, the way screens apply them */
export function designTokensOf(markdown: string | undefined): DesignTokens {
	if (!markdown) return NO_TOKENS;
	const { light, dark } = parseDesignTokens(markdown);

	return { light, dark };
}

/** Tokens added, changed or removed; a light and a dark value count apart */
export function changedTokenCount(from: DesignTokens, to: DesignTokens): number {
	const count = (a: Record<string, string>, b: Record<string, string>) =>
		[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((name) => a[name] !== b[name]).length;

	return count(from.light, to.light) + count(from.dark, to.dark);
}
