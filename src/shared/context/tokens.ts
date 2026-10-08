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

export const TOKEN_NAMES = [...COLOR_TOKENS, "radius", ...FONT_TOKENS] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

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

const FONT_FAMILY = String.raw`(?:"[a-z0-9 -]+"|'[a-z0-9 -]+'|[a-z][a-z0-9 -]*)`;

const FONT_STACK = new RegExp(String.raw`^${FONT_FAMILY}(?:\s*,\s*${FONT_FAMILY})*$`, "i");

const isOneOf = <T extends string>(names: readonly T[], value: string): value is T =>
	names.some((name) => name === value);

const isColor = (value: string) =>
	HEX.test(value) || COLOR_FUNCTION.test(value) || VAR_REF.test(value) || NAMED_COLORS.has(value.toLowerCase());

/** `null` when valid, else the reason */
export function validateToken(name: string, value: string): string | null {
	if (!isOneOf(TOKEN_NAMES, name)) return "Unknown token name, e.g. primary, muted-foreground or radius";

	if (name === "radius") return LENGTH.test(value) ? null : "Not a length, e.g. 0.5rem or 8px";

	if (isOneOf(FONT_TOKENS, name)) {
		return FONT_STACK.test(value) ? null : 'Not a font stack, e.g. "Inter", system-ui, sans-serif';
	}

	return isColor(value) ? null : "Not a color, e.g. #2563eb, oklch(0.55 0.2 264) or rgb(37 99 235)";
}

/** Keeps line breaks so line numbers stay right; an unclosed comment runs to the end. */
function stripComments(markdown: string) {
	return markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ""));
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const ENTRY = /^\s*[-*+]\s+`?(?:--)?([a-z0-9][\w-]*)`?\s*:\s*(.*?)\s*$/i;

/** Sub-headings containing "dark" switch to dark values; the last valid value wins. */
export function parseDesignTokens(markdown: string): ParsedDesignTokens {
	const result: ParsedDesignTokens = { light: {}, dark: {}, invalid: [] };
	const lines = stripComments(markdown).split(/\r?\n/);
	/** 0 outside the section */
	let sectionLevel = 0;
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

			if (sectionLevel && level > sectionLevel) {
				path = path.filter((h) => h.level < level);
				path.push({ level, dark: /dark/i.test(title) });

				return;
			}

			sectionLevel = /^(?:design\s+)?tokens$/i.test(title) ? level : 0;
			path = [];

			return;
		}

		if (!sectionLevel) return;

		const entry = ENTRY.exec(text);

		if (!entry) return;
		const name = entry[1]!.toLowerCase();
		const value = cleanValue(entry[2]!);
		const reason = validateToken(name, value);

		if (reason) {
			result.invalid.push({ name, value, line: index + 1, reason });

			return;
		}

		const mode = path.some((h) => h.dark) ? result.dark : result.light;
		mode[name] = value;
	});

	return result;
}

function cleanValue(raw: string) {
	let value = raw.trim();
	const ticks = /^`+([^`]*)`+$/.exec(value);

	if (ticks) value = ticks[1]!.trim();

	return value.replace(/\s*;$/, "");
}

function block(selector: string, entries: [string, string][]) {
	if (!entries.length) return "";

	return `${selector} {\n${entries.map(([name, value]) => `\t--${name}: ${value};\n`).join("")}}\n`;
}

// Light colors use `:root:not(.dark)` so they don't beat the theme's own `.dark` values.
// Values are re-validated so hand-built `tokens` can't inject CSS.
export function tokensToCss(tokens: DesignTokens): string {
	const valid = (values: Record<string, string>) =>
		Object.entries(values).filter(([name, value]) => validateToken(name, value) === null);

	const isColorToken = ([name]: [string, string]) => isOneOf(COLOR_TOKENS, name);
	const light = valid(tokens.light);

	return (
		block(
			":root",
			light.filter((e) => !isColorToken(e)),
		) +
		block(":root:not(.dark)", light.filter(isColorToken)) +
		block(".dark", valid(tokens.dark))
	);
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
