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
/** Token values by name */
export type TokenSet = Record<string, string>;

export type TokenValues = { light: TokenSet; dark: TokenSet };

/** One option of a mode group: only the tokens it changes (decision 0028) */
export type TokenModeOption = TokenValues & { name: string };

/** `### <Group> mode: <Option>` headings; the first option is the default */
export type TokenModeGroup = { name: string; options: TokenModeOption[] };

export type DesignTokens = TokenValues & { modes?: TokenModeGroup[] };

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

/** Every custom name in either scheme or any mode option, sorted */
export function customTokenNames(tokens: DesignTokens): string[] {
	const options = (tokens.modes ?? []).flatMap((group) =>
		group.options.flatMap((option) => [option.light, option.dark]),
	);

	return orderedTokenNames(tokens.light, tokens.dark, ...options)
		.filter(isCustomToken)
		.sort();
}

/** The tokens more than one group sets; the group written later wins */
export function contestedTokenNames(groups: readonly TokenModeGroup[]): string[] {
	const setBy = new Map<string, Set<string>>();

	for (const group of groups) {
		for (const option of group.options) {
			for (const name of [...Object.keys(option.light), ...Object.keys(option.dark)]) {
				const owners = setBy.get(name) ?? new Set<string>();
				owners.add(group.name);
				setBy.set(name, owners);
			}
		}
	}

	return [...setBy].flatMap(([name, owners]) => (owners.size > 1 ? [name] : []));
}

/** Keeps line breaks so line numbers stay right; an unclosed comment runs to the end. */
function stripComments(markdown: string) {
	return markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ""));
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const ENTRY = /^(\s*[-*+]\s+)`?(?:--)?([a-z0-9][\w-]*)`?\s*:\s*(.*?)\s*$/i;

type ModeRef = { group: string; option: string };

type TokenEntry = { name: string; value: string; dark: boolean; mode?: ModeRef; /** 0-based */ index: number };

type ModeHeading = ModeRef & { title: string; /** 0-based */ index: number; reason?: string };

const MODE_HEADING = /^(.*?)\bmode\s*:\s*(.*)$/i;

/** The `scheme` group is the Dark heading (decision 0028) */
const SCHEME_GROUP_NAME = "scheme";

const isModeName = (name: string) => /^[a-z0-9-]+$/.test(name);

export const modeSlug = (name: string) =>
	name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

type HeadingPath = { level: number; dark: boolean; mode?: ModeRef; dropped?: boolean }[];

type TokenSection = {
	level: number;
	/** 0-based line of the heading */
	heading: number;
	/** 0-based line after the section's last line */
	end: number;
	/** 0-based line of the first sub-heading that switches to dark values */
	darkHeading?: number;
};

type TokenScan = { entries: TokenEntry[]; sections: TokenSection[]; modes: ModeHeading[] };

function modeHeading(title: string, index: number, taken: Map<string, Set<string>>): ModeHeading | null {
	const match = MODE_HEADING.exec(title);

	if (!match) return null;
	const group = modeSlug(match[1]!);
	const option = modeSlug(match[2]!);
	const heading: ModeHeading = { group, option, title, index };

	if (!group || !option) heading.reason = "Name the group and the option, e.g. Brand mode: Acme";
	else if (group === SCHEME_GROUP_NAME) heading.reason = "The scheme group is the Dark heading";
	else if (taken.get(group)?.has(option)) heading.reason = "This group already has this option";
	else taken.set(group, (taken.get(group) ?? new Set()).add(option));

	return heading;
}

/**
 * Sub-headings containing "dark" switch to dark values; `### <Group> mode: <Option>` starts a mode option, with its
 * own `#### Dark`. Comments and code fences don't count.
 */
function scanTokens(markdown: string): TokenScan {
	const lines = stripComments(markdown).split(/\r?\n/);
	const entries: TokenEntry[] = [];
	const sections: TokenSection[] = [];
	const modes: ModeHeading[] = [];
	const taken = new Map<string, Set<string>>();
	let section: TokenSection | null = null;
	let path: HeadingPath = [];
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
				path = path.filter((h) => h.level < level);
				const mode = modeHeading(title, index, taken);

				if (mode) {
					modes.push(mode);
					path.push(mode.reason ? { level, dark: false, dropped: true } : { level, dark: false, mode });

					return;
				}

				const dark = /dark/i.test(title);
				const inMode = path.some((h) => h.mode || h.dropped);
				path.push({ level, dark });

				if (dark && !inMode && section.darkHeading === undefined) section.darkHeading = index;

				return;
			}

			if (section) section.end = index;
			section = /^(?:design\s+)?tokens$/i.test(title) ? { level, heading: index, end: lines.length } : null;
			path = [];

			if (section) sections.push(section);

			return;
		}

		const entry = section && ENTRY.exec(text);

		if (!entry || path.some((h) => h.dropped)) return;
		const mode = [...path].reverse().find((h) => h.mode)?.mode;

		const token: TokenEntry = {
			name: entry[2]!.toLowerCase(),
			value: cleanValue(entry[3]!),
			dark: path.some((h) => h.dark),
			index,
		};

		if (mode) token.mode = mode;
		entries.push(token);
	});

	return { entries, sections, modes };
}

/** The last valid value wins. Groups and options keep the order DESIGN.md writes them in. */
export function parseDesignTokens(markdown: string): ParsedDesignTokens {
	const result: ParsedDesignTokens = { light: {}, dark: {}, invalid: [] };
	const { entries, modes } = scanTokens(markdown);
	const groups = new Map<string, TokenModeGroup>();
	const options = new Map<string, TokenModeOption>();

	for (const heading of modes) {
		if (heading.reason) {
			result.invalid.push({ name: heading.title, value: "", line: heading.index + 1, reason: heading.reason });
			continue;
		}

		const group = groups.get(heading.group) ?? { name: heading.group, options: [] };
		const option: TokenModeOption = { name: heading.option, light: {}, dark: {} };
		group.options.push(option);
		groups.set(heading.group, group);
		options.set(`${heading.group}:${heading.option}`, option);
	}

	for (const { name, value, dark, mode, index } of entries) {
		const reason = validateToken(name, value);
		const target = mode ? options.get(`${mode.group}:${mode.option}`) : result;

		if (reason) result.invalid.push({ name, value, line: index + 1, reason });
		else if (target) (dark ? target.dark : target.light)[name] = value;
	}

	if (groups.size) result.modes = [...groups.values()];

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
	const projectEntries = entries.filter((entry) => !entry.mode);
	const matches = projectEntries.filter((entry) => entry.name === name && entry.dark === dark);
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

	const anchor = projectEntries.filter((entry) => entry.dark === dark && entry.index < section.end).at(-1)?.index;

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

export type NewModeOption = { group: string; option: string; values: TokenValues };

export function modeOptionError(markdown: string, group: string, option: string): string | null {
	const groupSlug = modeSlug(group);
	const optionSlug = modeSlug(option);

	if (!groupSlug) return "Name the group";

	if (groupSlug === SCHEME_GROUP_NAME) return "The scheme group is the Dark heading";

	if (!optionSlug) return "Name the mode";
	const known = parseDesignTokens(markdown).modes?.find((candidate) => candidate.name === groupSlug);

	return known?.options.some((candidate) => candidate.name === optionSlug) ? "This group already has this mode" : null;
}

export function addModeOption(markdown: string, { group, option, values }: NewModeOption): string {
	const lines = markdown.split("\n");
	const { sections, modes } = scanTokens(markdown);
	const section = sections[0];
	const level = (section?.level ?? 2) + 1;
	const groupSlug = modeSlug(group);
	const existing = modes.filter((heading) => heading.group === groupSlug && !heading.reason);
	const groupTitle = existing[0] ? MODE_HEADING.exec(existing[0].title)![1]!.trim() : group.trim();
	const entries = (set: TokenSet) => orderedTokenNames(set).map((name) => `- ${name}: ${set[name]}`);
	const dark = entries(values.dark);
	const fallback = modeSlug(option) === "default" ? "Base" : "Default";

	const block = [
		...(existing.length ? [] : [`${"#".repeat(level)} ${groupTitle} mode: ${fallback}`, ""]),
		`${"#".repeat(level)} ${groupTitle} mode: ${option.trim()}`,
		"",
		...entries(values.light),
		...(dark.length ? ["", `${"#".repeat(level + 1)} Dark`, "", ...dark] : []),
	];

	if (!section) {
		const body = markdown.replace(/\s+$/, "");

		return `${body}${body ? "\n\n" : ""}${["## Tokens", "", ...block].join("\n")}\n`;
	}

	const last = existing.at(-1);
	let end = section.end;

	if (last) {
		const lastLevel = HEADING.exec(lines[last.index]!)![1]!.length;

		const next = lines.findIndex(
			(text, index) => index > last.index && index < section.end && (HEADING.exec(text)?.[1]!.length ?? 7) <= lastLevel,
		);

		if (next !== -1) end = next;
	}

	while (end > section.heading + 1 && isBlank(lines[end - 1])) end--;
	const after = lines[end] !== undefined && !isBlank(lines[end]) ? [""] : [];

	lines.splice(end, 0, "", ...block, ...after);

	return lines.join("\n");
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
// A mode option's selectors carry its attribute, so they beat the project values in both schemes (decision 0028).
export function tokensToCss(tokens: DesignTokens): string {
	const options = (tokens.modes ?? []).flatMap((group) =>
		isModeName(group.name) && group.name !== SCHEME_GROUP_NAME
			? group.options.flatMap((option) => {
					if (!isModeName(option.name)) return [];

					return [valueBlocks(option, `[data-mode-${group.name}="${option.name}"]`)];
				})
			: [],
	);

	return valueBlocks(tokens) + options.join("");
}

function valueBlocks(values: TokenValues, attribute = "") {
	const builtInColors = Object.fromEntries(
		Object.entries(values.light).filter(([name]) => isOneOf(COLOR_TOKENS, name)),
	);

	const rest = Object.fromEntries(Object.entries(values.light).filter(([name]) => !(name in builtInColors)));

	return (
		block(`:root${attribute}`, declarations(rest)) +
		block(`:root:not(.dark)${attribute}`, declarations(builtInColors)) +
		block(attribute ? `:root.dark${attribute}` : ".dark", declarations(values.dark))
	);
}

const DRAFT_SELECTOR = ":root:root";

const draftCache = new WeakMap<TokenValues, string>();

export function draftCss(draft: TokenValues): string {
	let css = draftCache.get(draft);

	if (css === undefined) draftCache.set(draft, (css = valueBlocks(draft, DRAFT_SELECTOR)));

	return css;
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
	const { light, dark, modes } = parseDesignTokens(markdown);

	return modes ? { light, dark, modes } : { light, dark };
}

/** Every value keyed by its place, `brand=acme:primary` for a mode option's; an option with no values still counts */
function placedValues(tokens: DesignTokens, scheme: "light" | "dark") {
	const places = (tokens.modes ?? []).flatMap((group) =>
		group.options.flatMap((option) => {
			const place = `${group.name}=${option.name}:`;
			const values = Object.entries(option[scheme]).map(([name, value]): [string, string] => [place + name, value]);

			return scheme === "light" ? [[place, ""] satisfies [string, string], ...values] : values;
		}),
	);

	return new Map([...Object.entries(tokens[scheme]), ...places]);
}

/** Tokens added, changed or removed; a light and a dark value count apart, and so does each mode option */
export function changedTokenCount(from: DesignTokens, to: DesignTokens): number {
	const count = (a: Map<string, string>, b: Map<string, string>) =>
		[...new Set([...a.keys(), ...b.keys()])].filter((name) => a.get(name) !== b.get(name)).length;

	return (
		count(placedValues(from, "light"), placedValues(to, "light")) +
		count(placedValues(from, "dark"), placedValues(to, "dark"))
	);
}
