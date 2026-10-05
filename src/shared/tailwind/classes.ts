// Only classes without variants (`md:`, `hover:`…) are read or replaced; every other class keeps its text
// and place. A new class takes the place of the one it replaces, or goes at the end.

import { twMerge } from "tailwind-merge";
import { setAttribute } from "../jsx/transforms";
import { findElement, parseFile, type JsxElement } from "../jsx/tree";

/** `call`: the first string argument of `cn(…)`/`clsx(…)`…; `dynamic` is read-only. */
export type ClassNameKind = "none" | "string" | "literal" | "call" | "dynamic";

export type ClassNameInfo = {
	kind: ClassNameKind;
	editable: boolean;
	/** Decoded; empty when `none` or `dynamic` */
	classes: string;
	/** As written, for a read-only view; `null` without an attribute */
	text: string | null;
};

const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "classNames", "classnames", "twMerge", "twJoin"]);

/** The literal's content, between its quotes */
type ClassSpan = { info: ClassNameInfo; from: number; to: number; quote: string };

/** `null` when it isn't a string literal or has `${}` */
function scanLiteral(text: string, i: number): { end: number; quote: string; value: string } | null {
	const quote = text[i];

	if (quote !== '"' && quote !== "'" && quote !== "`") return null;
	let value = "";

	for (let j = i + 1; j < text.length; j++) {
		const ch = text[j]!;

		if (ch === quote) return { end: j + 1, quote, value };

		if (ch === "\\") {
			const next = text[j + 1];

			if (next === undefined) return null;
			value += next === "n" ? "\n" : next === "t" ? "\t" : next === "\n" ? "" : next;
			j++;
		} else if (quote === "`" && ch === "$" && text[j + 1] === "{") return null;
		else if (quote !== "`" && ch === "\n") return null;
		else value += ch;
	}

	return null;
}

const skipSpace = (text: string, i: number) => {
	while (i < text.length && /\s/.test(text[i]!)) i++;

	return i;
};

function locate(source: string, element: JsxElement): ClassSpan {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === "className");

	if (!attribute || attribute.kind !== "attribute")
		return { info: { kind: "none", editable: true, classes: "", text: null }, from: -1, to: -1, quote: "" };
	const value = attribute.value;
	const text = value ? source.slice(value.start, value.end) : "";

	if (!value) return { info: { kind: "string", editable: true, classes: "", text }, from: -1, to: -1, quote: "" };

	if (value.kind === "string") {
		return {
			info: { kind: "string", editable: true, classes: value.value, text },
			from: value.start + 1,
			to: value.end - 1,
			quote: value.raw[0]!,
		};
	}

	const dynamic: ClassSpan = {
		info: { kind: "dynamic", editable: false, classes: "", text },
		from: -1,
		to: -1,
		quote: "",
	};

	if (value.elements.length) return dynamic;
	// Offsets in `inner` are relative to just after the `{`
	const inner = value.text;
	const base = value.start + 1;
	let i = skipSpace(inner, 0);
	const literal = scanLiteral(inner, i);

	if (literal) {
		if (skipSpace(inner, literal.end) !== inner.length) return dynamic;

		return {
			info: { kind: "literal", editable: true, classes: literal.value, text },
			from: base + i + 1,
			to: base + literal.end - 1,
			quote: literal.quote,
		};
	}

	const name = /^[A-Za-z_$][\w$]*/.exec(inner.slice(i))?.[0];

	if (!name || !CLASS_HELPERS.has(name)) return dynamic;
	i = skipSpace(inner, i + name.length);

	if (inner[i] !== "(") return dynamic;
	i = skipSpace(inner, i + 1);
	const first = scanLiteral(inner, i);

	if (!first) return dynamic;
	const after = skipSpace(inner, first.end);

	if (inner[after] !== "," && inner[after] !== ")") return dynamic;

	return {
		info: { kind: "call", editable: true, classes: first.value, text },
		from: base + i + 1,
		to: base + first.end - 1,
		quote: first.quote,
	};
}

function elementIn(source: string, start: number): JsxElement | null {
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, start) : null;

	return element && element.name !== null ? element : null;
}

/** `null` when there is no element (or it is a fragment) */
export function readClassName(source: string, elementStart: number): ClassNameInfo | null {
	const element = elementIn(source, elementStart);

	return element ? classNameOf(source, element) : null;
}

export function classNameOf(source: string, element: JsxElement): ClassNameInfo {
	return locate(source, element).info;
}

function escapeLiteral(value: string, quote: string) {
	let text = value.replace(/\\/g, "\\\\");

	if (quote === "`") return text.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
	text = text.replace(/\n/g, "\\n");

	return quote === "'" ? text.replace(/'/g, "\\'") : text.replace(/"/g, '\\"');
}

/** `null` when `className` is dynamic. Empty classes remove the attribute, except inside `cn(…)`. */
export function setClassName(source: string, elementStart: number, classes: string): string | null {
	const element = elementIn(source, elementStart);

	if (!element) return null;
	const span = locate(source, element);
	const { kind } = span.info;

	if (kind === "dynamic") return null;
	const empty = !classes.trim();

	if (kind === "none") return empty ? source : setAttribute(source, elementStart, "className", classes);

	if (empty && kind !== "call") return setAttribute(source, elementStart, "className", null);

	if (kind === "string") {
		// `"` and `{}` can't sit in a plain attribute: setAttribute switches to `{"…"}`
		if (span.from < 0 || /["\n\r\\{}&]/.test(classes) || span.quote !== '"')
			return setAttribute(source, elementStart, "className", classes);

		return source.slice(0, span.from) + classes + source.slice(span.to);
	}

	return (
		source.slice(0, span.from) +
		escapeLiteral(kind === "call" && empty ? "" : classes, span.quote) +
		source.slice(span.to)
	);
}

/** `md:hover:!-mt-4` → variants `md`, `hover`; important; negative; `mt-4` */
export type ParsedClass = {
	raw: string;
	variants: string[];
	important: boolean;
	/** `!` written last (Tailwind v4) */
	importantLast: boolean;
	negative: boolean;
	/** Without variants, `!` and the leading `-` */
	utility: string;
};

/** Outside `[]` and `()` */
function splitTop(text: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let last = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
		else if (ch === separator && depth === 0) {
			parts.push(text.slice(last, i));
			last = i + 1;
		}
	}

	parts.push(text.slice(last));

	return parts;
}

export function parseClass(raw: string): ParsedClass {
	const parts = splitTop(raw, ":");
	let utility = parts.pop()!;
	let important = false;
	let importantLast = false;

	if (utility.endsWith("!")) {
		important = importantLast = true;
		utility = utility.slice(0, -1);
	} else if (utility.startsWith("!")) {
		important = true;
		utility = utility.slice(1);
	}

	const negative = utility.startsWith("-") && utility.length > 1;

	if (negative) utility = utility.slice(1);

	return { raw, variants: parts, important, importantLast, negative, utility };
}

/** `primary/50` → `["primary", "50"]` */
export function splitModifier(value: string): [string, string | null] {
	const parts = splitTop(value, "/");

	if (parts.length < 2) return [value, null];
	const modifier = parts.pop()!;

	return [parts.join("/"), modifier];
}

/** In color picker order */
export const THEME_COLORS = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"border",
	"input",
	"ring",
] as const;

/** Recognized as colors but not offered by the picker */
const EXTRA_THEME_COLORS = [
	"popover-foreground",
	"destructive-foreground",
	"success",
	"warning",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
];

export const SPECIAL_COLORS = ["black", "white", "transparent", "current", "inherit"] as const;

export const PALETTE_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

const PALETTE_HUES = {
	slate: [
		"98.4% 0.003 247.858",
		"96.8% 0.007 247.896",
		"92.9% 0.013 255.508",
		"86.9% 0.022 252.894",
		"70.4% 0.04 256.788",
		"55.4% 0.046 257.417",
		"44.6% 0.043 257.281",
		"37.2% 0.044 257.287",
		"27.9% 0.041 260.031",
		"20.8% 0.042 265.755",
		"12.9% 0.042 264.695",
	],
	gray: [
		"98.5% 0.002 247.839",
		"96.7% 0.003 264.542",
		"92.8% 0.006 264.531",
		"87.2% 0.01 258.338",
		"70.7% 0.022 261.325",
		"55.1% 0.027 264.364",
		"44.6% 0.03 256.802",
		"37.3% 0.034 259.733",
		"27.8% 0.033 256.848",
		"21% 0.034 264.665",
		"13% 0.028 261.692",
	],
	zinc: [
		"98.5% 0 0",
		"96.7% 0.001 286.375",
		"92% 0.004 286.32",
		"87.1% 0.006 286.286",
		"70.5% 0.015 286.067",
		"55.2% 0.016 285.938",
		"44.2% 0.017 285.786",
		"37% 0.013 285.805",
		"27.4% 0.006 286.033",
		"21% 0.006 285.885",
		"14.1% 0.005 285.823",
	],
	neutral: [
		"98.5% 0 0",
		"97% 0 0",
		"92.2% 0 0",
		"87% 0 0",
		"70.8% 0 0",
		"55.6% 0 0",
		"43.9% 0 0",
		"37.1% 0 0",
		"26.9% 0 0",
		"20.5% 0 0",
		"14.5% 0 0",
	],
	stone: [
		"98.5% 0.001 106.423",
		"97% 0.001 106.424",
		"92.3% 0.003 48.717",
		"86.9% 0.005 56.366",
		"70.9% 0.01 56.259",
		"55.3% 0.013 58.071",
		"44.4% 0.011 73.639",
		"37.4% 0.01 67.558",
		"26.8% 0.007 34.298",
		"21.6% 0.006 56.043",
		"14.7% 0.004 49.25",
	],
	red: [
		"97.1% 0.013 17.38",
		"93.6% 0.032 17.717",
		"88.5% 0.062 18.334",
		"80.8% 0.114 19.571",
		"70.4% 0.191 22.216",
		"63.7% 0.237 25.331",
		"57.7% 0.245 27.325",
		"50.5% 0.213 27.518",
		"44.4% 0.177 26.899",
		"39.6% 0.141 25.723",
		"25.8% 0.092 26.042",
	],
	orange: [
		"98% 0.016 73.684",
		"95.4% 0.038 75.164",
		"90.1% 0.076 70.697",
		"83.7% 0.128 66.29",
		"75% 0.183 55.934",
		"70.5% 0.213 47.604",
		"64.6% 0.222 41.116",
		"55.3% 0.195 38.402",
		"47% 0.157 37.304",
		"40.8% 0.123 38.172",
		"26.6% 0.079 36.259",
	],
	amber: [
		"98.7% 0.022 95.277",
		"96.2% 0.059 95.617",
		"92.4% 0.12 95.746",
		"87.9% 0.169 91.605",
		"82.8% 0.189 84.429",
		"76.9% 0.188 70.08",
		"66.6% 0.179 58.318",
		"55.5% 0.163 48.998",
		"47.3% 0.137 46.201",
		"41.4% 0.112 45.904",
		"27.9% 0.077 45.635",
	],
	yellow: [
		"98.7% 0.026 102.212",
		"97.3% 0.071 103.193",
		"94.5% 0.129 101.54",
		"90.5% 0.182 98.111",
		"85.2% 0.199 91.936",
		"79.5% 0.184 86.047",
		"68.1% 0.162 75.834",
		"55.4% 0.135 66.442",
		"47.6% 0.114 61.907",
		"42.1% 0.095 57.708",
		"28.6% 0.066 53.813",
	],
	lime: [
		"98.6% 0.031 120.757",
		"96.7% 0.067 122.328",
		"93.8% 0.127 124.321",
		"89.7% 0.196 126.665",
		"84.1% 0.238 128.85",
		"76.8% 0.233 130.85",
		"64.8% 0.2 131.684",
		"53.2% 0.157 131.589",
		"45.3% 0.124 130.933",
		"40.5% 0.101 131.063",
		"27.4% 0.072 132.109",
	],
	green: [
		"98.2% 0.018 155.826",
		"96.2% 0.044 156.743",
		"92.5% 0.084 155.995",
		"87.1% 0.15 154.449",
		"79.2% 0.209 151.711",
		"72.3% 0.219 149.579",
		"62.7% 0.194 149.214",
		"52.7% 0.154 150.069",
		"44.8% 0.119 151.328",
		"39.3% 0.095 152.535",
		"26.6% 0.065 152.934",
	],
	emerald: [
		"97.9% 0.021 166.113",
		"95% 0.052 163.051",
		"90.5% 0.093 164.15",
		"84.5% 0.143 164.978",
		"76.5% 0.177 163.223",
		"69.6% 0.17 162.48",
		"59.6% 0.145 163.225",
		"50.8% 0.118 165.612",
		"43.2% 0.095 166.913",
		"37.8% 0.077 168.94",
		"26.2% 0.051 172.552",
	],
	teal: [
		"98.4% 0.014 180.72",
		"95.3% 0.051 180.801",
		"91% 0.096 180.426",
		"85.5% 0.138 181.071",
		"77.7% 0.152 181.912",
		"70.4% 0.14 182.503",
		"60% 0.118 184.704",
		"51.1% 0.096 186.391",
		"43.7% 0.078 188.216",
		"38.6% 0.063 188.416",
		"27.7% 0.046 192.524",
	],
	cyan: [
		"98.4% 0.019 200.873",
		"95.6% 0.045 203.388",
		"91.7% 0.08 205.041",
		"86.5% 0.127 207.078",
		"78.9% 0.154 211.53",
		"71.5% 0.143 215.221",
		"60.9% 0.126 221.723",
		"52% 0.105 223.128",
		"45% 0.085 224.283",
		"39.8% 0.07 227.392",
		"30.2% 0.056 229.695",
	],
	sky: [
		"97.7% 0.013 236.62",
		"95.1% 0.026 236.824",
		"90.1% 0.058 230.902",
		"82.8% 0.111 230.318",
		"74.6% 0.16 232.661",
		"68.5% 0.169 237.323",
		"58.8% 0.158 241.966",
		"50% 0.134 242.749",
		"44.3% 0.11 240.79",
		"39.1% 0.09 240.876",
		"29.3% 0.066 243.157",
	],
	blue: [
		"97% 0.014 254.604",
		"93.2% 0.032 255.585",
		"88.2% 0.059 254.128",
		"80.9% 0.105 251.813",
		"70.7% 0.165 254.624",
		"62.3% 0.214 259.815",
		"54.6% 0.245 262.881",
		"48.8% 0.243 264.376",
		"42.4% 0.199 265.638",
		"37.9% 0.146 265.522",
		"28.2% 0.091 267.935",
	],
	indigo: [
		"96.2% 0.018 272.314",
		"93% 0.034 272.788",
		"87% 0.065 274.039",
		"78.5% 0.115 274.713",
		"67.3% 0.182 276.935",
		"58.5% 0.233 277.117",
		"51.1% 0.262 276.966",
		"45.7% 0.24 277.023",
		"39.8% 0.195 277.366",
		"35.9% 0.144 278.697",
		"25.7% 0.09 281.288",
	],
	violet: [
		"96.9% 0.016 293.756",
		"94.3% 0.029 294.588",
		"89.4% 0.057 293.283",
		"81.1% 0.111 293.571",
		"70.2% 0.183 293.541",
		"60.6% 0.25 292.717",
		"54.1% 0.281 293.009",
		"49.1% 0.27 292.581",
		"43.2% 0.232 292.759",
		"38% 0.189 293.745",
		"28.3% 0.141 291.089",
	],
	purple: [
		"97.7% 0.014 308.299",
		"94.6% 0.033 307.174",
		"90.2% 0.063 306.703",
		"82.7% 0.119 306.383",
		"71.4% 0.203 305.504",
		"62.7% 0.265 303.9",
		"55.8% 0.288 302.321",
		"49.6% 0.265 301.924",
		"43.8% 0.218 303.724",
		"38.1% 0.176 304.987",
		"29.1% 0.149 302.717",
	],
	fuchsia: [
		"97.7% 0.017 320.058",
		"95.2% 0.037 318.852",
		"90.3% 0.076 319.62",
		"83.3% 0.145 321.434",
		"74% 0.238 322.16",
		"66.7% 0.295 322.15",
		"59.1% 0.293 322.896",
		"51.8% 0.253 323.949",
		"45.2% 0.211 324.591",
		"40.1% 0.17 325.612",
		"29.3% 0.136 325.661",
	],
	pink: [
		"97.1% 0.014 343.198",
		"94.8% 0.028 342.258",
		"89.9% 0.061 343.231",
		"82.3% 0.12 346.018",
		"71.8% 0.202 349.761",
		"65.6% 0.241 354.308",
		"59.2% 0.249 0.584",
		"52.5% 0.223 3.958",
		"45.9% 0.187 3.815",
		"40.8% 0.153 2.432",
		"28.4% 0.109 3.907",
	],
	rose: [
		"96.9% 0.015 12.422",
		"94.1% 0.03 12.58",
		"89.2% 0.058 10.001",
		"81% 0.117 11.638",
		"71.2% 0.194 13.428",
		"64.5% 0.246 16.439",
		"58.6% 0.253 17.585",
		"51.4% 0.222 16.935",
		"45.5% 0.188 13.697",
		"41% 0.159 10.272",
		"27.1% 0.105 12.094",
	],
} satisfies Record<string, readonly string[]>;

export type PaletteHue = keyof typeof PALETTE_HUES;

/** Hue → the `oklch()` arguments of each shade in `PALETTE_SHADES` */
export const PALETTE: Readonly<Record<PaletteHue, readonly string[]>> = PALETTE_HUES;

export const isPaletteHue = (name: string): name is PaletteHue => Object.hasOwn(PALETTE, name);

/** Tailwind v4.1+ neutrals: recognized as colors, not offered by the picker */
const EXTRA_HUES = ["mauve", "olive", "mist", "taupe"];

const COLOR_WORDS = new Set<string>([...THEME_COLORS, ...EXTRA_THEME_COLORS, ...SPECIAL_COLORS]);

const PALETTE_COLOR = new RegExp(
	`^(?:${[...Object.keys(PALETTE), ...EXTRA_HUES].join("|")})-(?:${PALETTE_SHADES.join("|")})$`,
);

/** `[13px]` → `13px` */
const bracketed = (value: string) =>
	value.length > 2 && value[0] === "[" && value.endsWith("]") ? value.slice(1, -1) : null;

/** `(--brand)` → `--brand` */
const parenthesized = (value: string) =>
	value.length > 2 && value[0] === "(" && value.endsWith(")") ? value.slice(1, -1) : null;

const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;

const LENGTH =
	/^-?(?:\d+\.?\d*|\.\d+)(?:px|r?em|%|vh|vw|[sld]v[hw]|vmin|vmax|ch|ex|r?lh|pt|pc|cm|mm|in|q|cq[whib]|cqmin|cqmax)?$/i;

const LENGTH_FUNCTION = /^(?:calc|clamp|min|max)\(/i;

/** From its type hint or its shape; `null` when not arbitrary */
function arbitraryType(value: string): "color" | "length" | "number" | "var" | "other" | null {
	const inner = bracketed(value) ?? parenthesized(value);

	if (inner === null) return null;
	const hint = /^([a-z-]+):/.exec(inner)?.[1];

	if (hint)
		return hint === "color"
			? "color"
			: hint === "length" || hint === "percentage"
				? "length"
				: hint === "number"
					? "number"
					: "other";

	if (inner.startsWith("--") || /^var\(/i.test(inner)) return "var";

	if (inner.startsWith("#") || COLOR_FUNCTION.test(inner) || inner === "currentColor" || inner === "transparent")
		return "color";

	if (/^-?\d*\.?\d+$/.test(inner)) return "number";

	if (LENGTH.test(inner) || LENGTH_FUNCTION.test(inner)) return "length";

	return "other";
}

const OPACITY_MODIFIER = /^(?:\d+(?:\.\d+)?|\[[^\]]+\]|\([^)]+\))$/;

export function isColorValue(value: string): boolean {
	const [base, modifier] = splitModifier(value);

	if (modifier !== null && !OPACITY_MODIFIER.test(modifier)) return false;

	if (COLOR_WORDS.has(base) || PALETTE_COLOR.test(base)) return true;
	const type = arbitraryType(base);

	return type === "color" || type === "var";
}

/** `value` follows the prefix: `4` in `p-4`, `""` for a bare `rounded` */
export type ScaleOption = { value: string; label: string; hint?: string };

export type Scale = {
	kind:
		| "spacing"
		| "size"
		| "fontSize"
		| "fontWeight"
		| "lineHeight"
		| "letterSpacing"
		| "radius"
		| "borderWidth"
		| "opacity"
		| "shadow";
	options: ScaleOption[];
	negative?: boolean;
};

const SPACING_STEPS = [
	0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64,
	72, 80, 96,
];

const spacingOptions = (): ScaleOption[] => [
	{ value: "0", label: "0", hint: "0px" },
	{ value: "px", label: "px", hint: "1px" },
	...SPACING_STEPS.slice(1).map((step) => ({ value: String(step), label: String(step), hint: `${step * 4}px` })),
];

export const SPACING_SCALE: Scale = { kind: "spacing", options: spacingOptions() };

export const MARGIN_SCALE: Scale = {
	kind: "spacing",
	negative: true,
	options: [{ value: "auto", label: "auto" }, ...spacingOptions()],
};

const FRACTIONS = ["1/2", "1/3", "2/3", "1/4", "3/4"];

export const SIZE_SCALE: Scale = {
	kind: "size",
	options: [
		{ value: "auto", label: "auto" },
		{ value: "full", label: "full", hint: "100%" },
		{ value: "fit", label: "fit", hint: "fit content" },
		{ value: "min", label: "min", hint: "min content" },
		{ value: "max", label: "max", hint: "max content" },
		{ value: "screen", label: "screen", hint: "viewport" },
		...FRACTIONS.map((f) => ({
			value: f,
			label: f,
			hint: `${Math.round((Number(f[0]) / Number(f[2])) * 1000) / 10}%`,
		})),
		...spacingOptions(),
	],
};

const CONTAINERS: [string, number][] = [
	["3xs", 256],
	["2xs", 288],
	["xs", 320],
	["sm", 384],
	["md", 448],
	["lg", 512],
	["xl", 576],
	["2xl", 672],
	["3xl", 768],
	["4xl", 896],
	["5xl", 1024],
	["6xl", 1152],
	["7xl", 1280],
];

export const MAX_SIZE_SCALE: Scale = {
	kind: "size",
	options: [
		{ value: "none", label: "none" },
		{ value: "prose", label: "prose", hint: "65ch" },
		...CONTAINERS.map(([name, px]) => ({ value: name, label: name, hint: `${px}px` })),
		...SIZE_SCALE.options.filter((o) => o.value !== "auto"),
	],
};

const FONT_SIZES: [string, number][] = [
	["xs", 12],
	["sm", 14],
	["base", 16],
	["lg", 18],
	["xl", 20],
	["2xl", 24],
	["3xl", 30],
	["4xl", 36],
	["5xl", 48],
	["6xl", 60],
	["7xl", 72],
	["8xl", 96],
	["9xl", 128],
];

export const FONT_SIZE_SCALE: Scale = {
	kind: "fontSize",
	options: FONT_SIZES.map(([name, px]) => ({ value: name, label: name, hint: `${px}px` })),
};

const FONT_WEIGHTS: [string, number][] = [
	["thin", 100],
	["extralight", 200],
	["light", 300],
	["normal", 400],
	["medium", 500],
	["semibold", 600],
	["bold", 700],
	["extrabold", 800],
	["black", 900],
];

export const FONT_WEIGHT_SCALE: Scale = {
	kind: "fontWeight",
	options: FONT_WEIGHTS.map(([name, weight]) => ({
		value: name,
		label: name[0]!.toUpperCase() + name.slice(1),
		hint: String(weight),
	})),
};

export const LINE_HEIGHT_SCALE: Scale = {
	kind: "lineHeight",
	options: [
		...[
			["none", "1"],
			["tight", "1.25"],
			["snug", "1.375"],
			["normal", "1.5"],
			["relaxed", "1.625"],
			["loose", "2"],
		].map(([value, hint]) => ({ value: value!, label: value!, hint })),
		...[3, 4, 5, 6, 7, 8, 9, 10].map((step) => ({ value: String(step), label: String(step), hint: `${step * 4}px` })),
	],
};

export const LETTER_SPACING_SCALE: Scale = {
	kind: "letterSpacing",
	options: [
		["tighter", "-0.05em"],
		["tight", "-0.025em"],
		["normal", "0em"],
		["wide", "0.025em"],
		["wider", "0.05em"],
		["widest", "0.1em"],
	].map(([value, hint]) => ({ value: value!, label: value!, hint })),
};

export const RADIUS_SCALE: Scale = {
	kind: "radius",
	options: [
		{ value: "none", label: "none", hint: "0px" },
		{ value: "xs", label: "xs", hint: "2px" },
		{ value: "sm", label: "sm", hint: "6px" },
		{ value: "", label: "base" },
		{ value: "md", label: "md", hint: "8px" },
		{ value: "lg", label: "lg", hint: "10px" },
		{ value: "xl", label: "xl", hint: "14px" },
		{ value: "2xl", label: "2xl", hint: "16px" },
		{ value: "3xl", label: "3xl", hint: "24px" },
		{ value: "4xl", label: "4xl", hint: "32px" },
		{ value: "full", label: "full", hint: "pill" },
	],
};

export const BORDER_WIDTH_SCALE: Scale = {
	kind: "borderWidth",
	options: [
		{ value: "0", label: "0", hint: "0px" },
		{ value: "", label: "1", hint: "1px" },
		{ value: "2", label: "2", hint: "2px" },
		{ value: "4", label: "4", hint: "4px" },
		{ value: "8", label: "8", hint: "8px" },
	],
};

export const OPACITY_SCALE: Scale = {
	kind: "opacity",
	options: [0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100].map((n) => ({
		value: String(n),
		label: String(n),
		hint: `${n}%`,
	})),
};

export const SHADOW_SCALE: Scale = {
	kind: "shadow",
	options: [
		{ value: "none", label: "none" },
		{ value: "2xs", label: "2xs" },
		{ value: "xs", label: "xs" },
		{ value: "sm", label: "sm" },
		{ value: "", label: "base" },
		{ value: "md", label: "md" },
		{ value: "lg", label: "lg" },
		{ value: "xl", label: "xl" },
		{ value: "2xl", label: "2xl" },
	],
};

/** Spaces become `_`, as Tailwind expects */
const arbitrary = (text: string) => `[${text.trim().replace(/\s+/g, "_")}]`;

const optionByHint = (scale: Scale, hint: string) => scale.options.find((o) => o.hint === hint);

/** `16px` → `4` when on the scale, otherwise `[16px]`. Callers treat empty input as "unset" first. */
export function parseScaleInput(input: string, scale: Scale): string | null {
	let text = input.trim();

	if (!text) return null;

	if (scale.negative && text.startsWith("-")) {
		const inner = parseScaleInput(text.slice(1), { ...scale, negative: false });

		return inner && inner !== "auto" && inner !== "0" ? `-${inner}` : inner === "0" ? "0" : null;
	}

	if (text.startsWith("-") && scale.kind !== "letterSpacing") return null;

	if (/^[[(].*[\])]$/.test(text)) return arbitraryType(text) === null ? null : text.replace(/\s+/g, "_");
	const lower = text.toLowerCase();

	const option =
		scale.options.find((o) => o.value === lower && o.value !== "") ??
		scale.options.find((o) => o.label.toLowerCase() === lower);

	if (option) return option.value;
	// `16px` in a spacing field, `50%` in a size field, `0.025em` for tracking: the scale value it names
	const named = scale.options.find((o) => o.hint?.toLowerCase() === lower);

	if (named) return named.value;

	if (scale.kind === "size" && /^\d+\/\d+$/.test(text)) return text;
	const number = /^\d*\.?\d+$/.test(text) ? Number(text) : null;
	const px = /^(\d*\.?\d+)px$/i.exec(text);

	switch (scale.kind) {
		case "spacing":
		case "size":
			if (number !== null) return number % 0.25 === 0 ? String(number) : arbitrary(`${number * 4}px`);

			if (px) {
				const n = Number(px[1]);

				if (n === 1) return "px";

				return (
					optionByHint(scale, `${n}px`)?.value ?? (n % 1 === 0 && n % 4 === 0 ? String(n / 4) : arbitrary(`${n}px`))
				);
			}

			break;
		case "fontSize":
		case "radius":
			if (number !== null || px) {
				const n = number ?? Number(px![1]);

				return optionByHint(scale, `${n}px`)?.value ?? arbitrary(`${n}px`);
			}

			break;
		case "borderWidth":
			if (number !== null) return number % 1 === 0 ? (number === 1 ? "" : String(number)) : arbitrary(`${number}px`);

			if (px) return Number(px[1]) === 1 ? "" : Number(px[1]) % 1 === 0 ? px[1]! : arbitrary(text);
			break;
		case "fontWeight":
			if (number !== null)
				return FONT_WEIGHTS.find(([, w]) => w === number)?.[0] ?? (number % 1 === 0 ? `[${number}]` : null);
			break;
		case "lineHeight":
			if (number !== null) return number % 1 === 0 && number >= 3 ? String(number) : `[${number}]`;

			if (px) return arbitrary(text);
			break;
		case "opacity":
			text = text.replace(/%$/, "");

			if (/^\d*\.?\d+$/.test(text) && Number(text) <= 100)
				return Number(text) % 1 === 0 ? String(Number(text)) : `[${Number(text) / 100}]`;

			return null;
		case "letterSpacing":
		case "shadow":
			break;
	}

	if (LENGTH.test(text) || LENGTH_FUNCTION.test(text)) return arbitrary(text);

	return null;
}

export type ValueLabel = { label: string; hint?: string };

export function describeValue(value: string, scale: Scale): ValueLabel {
	const negative = scale.negative && value.startsWith("-");
	const base = negative ? value.slice(1) : value;
	const option = scale.options.find((o) => o.value === base);

	if (option)
		return negative
			? { label: `-${option.label}`, hint: option.hint ? `-${option.hint}` : undefined }
			: { label: option.label, hint: option.hint };
	const inner = bracketed(base);

	if (inner !== null) return { label: `${negative ? "-" : ""}${inner.replace(/_/g, " ")}` };

	if ((scale.kind === "spacing" || scale.kind === "size") && /^\d*\.?\d+$/.test(base))
		return { label: value, hint: `${negative ? "-" : ""}${Number(base) * 4}px` };

	return { label: value };
}

/** CSS colors (`#fff`, `oklch(…)`) become arbitrary values. */
export function parseColorInput(input: string): string | null {
	const text = input.trim();

	if (!text) return null;

	if (isColorValue(text)) return text.replace(/\s+/g, "_");

	if (/^#[0-9a-f]{3,8}$/i.test(text) || COLOR_FUNCTION.test(text)) return arbitrary(text);

	return null;
}

/** For a swatch; opacity modifiers resolve through `color-mix`. */
export function colorCss(value: string, token: (name: string) => string = (name) => `var(--${name})`): string | null {
	if (!isColorValue(value)) return null;
	const [base, modifier] = splitModifier(value);
	let css: string | null;

	if (base === "inherit") css = null;
	else if (base === "current") css = "currentColor";
	else if (base === "black") css = "#000";
	else if (base === "white") css = "#fff";
	else if (base === "transparent") css = "transparent";
	else if (PALETTE_COLOR.test(base)) {
		const dash = base.lastIndexOf("-");
		const hue = base.slice(0, dash);
		const shadeName = base.slice(dash + 1);
		const shade = isPaletteHue(hue) ? PALETTE[hue][PALETTE_SHADES.findIndex((s) => s === shadeName)] : undefined;
		css = shade ? `oklch(${shade})` : null;
	} else if (COLOR_WORDS.has(base)) css = token(base);
	else {
		const inner = (bracketed(base) ?? parenthesized(base) ?? "").replace(/^color:/, "").replace(/_/g, " ");
		css = inner.startsWith("--") ? `var(${inner})` : inner || null;
	}

	if (!css || modifier === null) return css;
	const amount = bracketed(modifier) ?? modifier;

	const percent = /^\d*\.?\d+$/.test(amount)
		? Number(amount) <= 1 && amount.includes(".")
			? Number(amount) * 100
			: Number(amount)
		: null;

	return percent === null ? css : `color-mix(in oklab, ${css} ${percent}%, transparent)`;
}

export type SimpleProp =
	| "display"
	| "flexDirection"
	| "flexWrap"
	| "justifyContent"
	| "alignItems"
	| "minWidth"
	| "maxWidth"
	| "minHeight"
	| "maxHeight"
	| "fontSize"
	| "fontWeight"
	| "fontFamily"
	| "lineHeight"
	| "letterSpacing"
	| "textAlign"
	| "textColor"
	| "backgroundColor"
	| "borderColor"
	| "borderStyle"
	| "opacity"
	| "boxShadow"
	| "shadowColor";

/** Written by several classes that cover parts of a box: `p`, `px`, `pt`… */
export type BoxGroup = "gap" | "padding" | "margin" | "size" | "borderWidth" | "borderRadius";

/** By part (`top`, `tl`, `width`…); `null` when unset */
export type Box = Record<string, string | null>;

type Alias = {
	name: string;
	parts: readonly string[];
	/** Logical sides: recognized, never written */ readOnly?: boolean;
};

type BoxSpec = { parts: readonly string[]; aliases: readonly Alias[] };

const SIDES = ["top", "right", "bottom", "left"] as const;

const sideAliases = (base: string, sep: string): Alias[] => [
	{ name: base, parts: SIDES },
	{ name: `${base}${sep}x`, parts: ["left", "right"] },
	{ name: `${base}${sep}y`, parts: ["top", "bottom"] },
	{ name: `${base}${sep}t`, parts: ["top"] },
	{ name: `${base}${sep}r`, parts: ["right"] },
	{ name: `${base}${sep}b`, parts: ["bottom"] },
	{ name: `${base}${sep}l`, parts: ["left"] },
	{ name: `${base}${sep}s`, parts: ["left"], readOnly: true },
	{ name: `${base}${sep}e`, parts: ["right"], readOnly: true },
];

/** Corners are `tl`/`tr`/`br`/`bl` */
export const BOXES: Record<BoxGroup, BoxSpec> = {
	padding: { parts: SIDES, aliases: sideAliases("p", "") },
	margin: { parts: SIDES, aliases: sideAliases("m", "") },
	borderWidth: { parts: SIDES, aliases: sideAliases("border", "-") },
	gap: {
		parts: ["x", "y"],
		aliases: [
			{ name: "gap", parts: ["x", "y"] },
			{ name: "gap-x", parts: ["x"] },
			{ name: "gap-y", parts: ["y"] },
		],
	},
	size: {
		parts: ["width", "height"],
		aliases: [
			{ name: "size", parts: ["width", "height"] },
			{ name: "w", parts: ["width"] },
			{ name: "h", parts: ["height"] },
		],
	},
	borderRadius: {
		parts: ["tl", "tr", "br", "bl"],
		aliases: [
			{ name: "rounded", parts: ["tl", "tr", "br", "bl"] },
			{ name: "rounded-t", parts: ["tl", "tr"] },
			{ name: "rounded-r", parts: ["tr", "br"] },
			{ name: "rounded-b", parts: ["br", "bl"] },
			{ name: "rounded-l", parts: ["tl", "bl"] },
			{ name: "rounded-tl", parts: ["tl"] },
			{ name: "rounded-tr", parts: ["tr"] },
			{ name: "rounded-br", parts: ["br"] },
			{ name: "rounded-bl", parts: ["bl"] },
			{ name: "rounded-s", parts: ["tl", "bl"], readOnly: true },
			{ name: "rounded-e", parts: ["tr", "br"], readOnly: true },
			{ name: "rounded-ss", parts: ["tl"], readOnly: true },
			{ name: "rounded-se", parts: ["tr"], readOnly: true },
			{ name: "rounded-es", parts: ["bl"], readOnly: true },
			{ name: "rounded-ee", parts: ["br"], readOnly: true },
		],
	},
};

/** `name` is the class prefix (the alias in a box group); `value` is `""` for a bare `border`. */
export type ClassHit = { prop: SimpleProp | BoxGroup; name: string; value: string };

const DISPLAY = new Set([
	"block",
	"inline-block",
	"inline",
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"contents",
	"flow-root",
	"list-item",
	"table",
	"inline-table",
	"table-row",
	"table-cell",
	"hidden",
]);

const FLEX_DIRECTION = new Set(["row", "row-reverse", "col", "col-reverse"]);

const FLEX_WRAP = new Set(["wrap", "wrap-reverse", "nowrap"]);

const JUSTIFY = new Set([
	"start",
	"end",
	"center",
	"between",
	"around",
	"evenly",
	"stretch",
	"normal",
	"baseline",
	"center-safe",
	"end-safe",
]);

const ITEMS = new Set(["start", "end", "center", "baseline", "baseline-last", "stretch", "center-safe", "end-safe"]);

const TEXT_ALIGN = new Set(["left", "center", "right", "justify", "start", "end"]);

const FONT_SIZE_NAMES = new Set(FONT_SIZES.map(([name]) => name));

const FONT_WEIGHT_NAMES = new Set(FONT_WEIGHTS.map(([name]) => name));

const BORDER_STYLES = new Set(["solid", "dashed", "dotted", "double", "hidden", "none"]);

const SHADOW_SIZES = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "none", "inner"]);

/** Longer alternatives first so `gap-x-4` isn't `gap` + `x-4` */
const PADDING = /^(px|py|pt|pr|pb|pl|ps|pe|p)-(.+)$/;

const MARGIN = /^(mx|my|mt|mr|mb|ml|ms|me|m)-(.+)$/;

const GAP = /^(gap-x|gap-y|gap)-(.+)$/;

const SIZE = /^(size|w|h)-(.+)$/;

const MIN_MAX = /^(min-w|max-w|min-h|max-h)-(.+)$/;

const ROUNDED = /^rounded(?:-(tl|tr|br|bl|ss|se|es|ee|t|r|b|l|s|e))?(?:-(.+))?$/;

const BORDER = /^border(?:-(x|y|t|r|b|l|s|e))?(?:-(.+))?$/;

const MIN_MAX_PROP = new Map<string, SimpleProp>([
	["min-w", "minWidth"],
	["max-w", "maxWidth"],
	["min-h", "minHeight"],
	["max-h", "maxHeight"],
]);

const isBorderWidth = (value: string) =>
	/^\d+$/.test(value) || arbitraryType(value) === "length" || arbitraryType(value) === "number";

/** `null` for variants or a utility the model doesn't cover */
export function classifyClass(raw: string): ClassHit | null {
	const parsed = parseClass(raw);

	if (parsed.variants.length) return null;

	return classifyUtility(parsed.utility, parsed.negative);
}

function classifyUtility(u: string, negative: boolean): ClassHit | null {
	const sign = negative ? "-" : "";
	const hit = (prop: ClassHit["prop"], name: string, value: string): ClassHit => ({ prop, name, value: sign + value });

	if (!negative) {
		if (DISPLAY.has(u)) return hit("display", "", u);

		if (u.startsWith("flex-") && FLEX_DIRECTION.has(u.slice(5))) return hit("flexDirection", "flex", u.slice(5));

		if (u.startsWith("flex-") && FLEX_WRAP.has(u.slice(5))) return hit("flexWrap", "flex", u.slice(5));

		if (u.startsWith("justify-") && JUSTIFY.has(u.slice(8))) return hit("justifyContent", "justify", u.slice(8));

		if (u.startsWith("items-") && ITEMS.has(u.slice(6))) return hit("alignItems", "items", u.slice(6));
	}

	let match: RegExpExecArray | null;

	if ((match = MARGIN.exec(u))) return hit("margin", match[1]!, match[2]!);

	if ((match = /^tracking-(.+)$/.exec(u))) return hit("letterSpacing", "tracking", match[1]!);

	// Everything below takes no negative
	if (negative) return null;

	if ((match = PADDING.exec(u))) return hit("padding", match[1]!, match[2]!);

	if ((match = GAP.exec(u))) return hit("gap", match[1]!, match[2]!);

	if ((match = SIZE.exec(u))) return hit("size", match[1]!, match[2]!);

	if ((match = MIN_MAX.exec(u))) return hit(MIN_MAX_PROP.get(match[1]!)!, match[1]!, match[2]!);

	if ((match = ROUNDED.exec(u)))
		return hit("borderRadius", match[1] ? `rounded-${match[1]}` : "rounded", match[2] ?? "");

	if ((match = BORDER.exec(u))) {
		const side = match[1];
		const value = match[2] ?? "";
		const name = side ? `border-${side}` : "border";

		if (value === "" || isBorderWidth(value)) return hit("borderWidth", name, value);

		if (side) return null;

		if (BORDER_STYLES.has(value)) return hit("borderStyle", "border", value);

		if (isColorValue(value)) return hit("borderColor", "border", value);

		return null;
	}

	if ((match = /^text-(.+)$/.exec(u))) {
		const value = match[1]!;

		if (TEXT_ALIGN.has(value)) return hit("textAlign", "text", value);
		const [base, modifier] = splitModifier(value);

		if (FONT_SIZE_NAMES.has(base) && (modifier === null || /^(?:\d*\.?\d+|\[.+\]|[a-z]+)$/.test(modifier)))
			return hit("fontSize", "text", value);
		const type = arbitraryType(base);

		if (type === "length" || (type === "number" && modifier === null)) return hit("fontSize", "text", value);

		if (isColorValue(value)) return hit("textColor", "text", value);

		return null;
	}

	if ((match = /^font-(.+)$/.exec(u))) {
		const value = match[1]!;

		if (FONT_WEIGHT_NAMES.has(value)) return hit("fontWeight", "font", value);
		const type = arbitraryType(value);

		if (type === "number" || value.startsWith("[weight:") || value.startsWith("(number:"))
			return hit("fontWeight", "font", value);

		// `font-sans`, `font-mono`, `font-display`, `font-['Inter']`: families are an open set
		if (type === null || type === "other" || type === "var")
			return /^[\w-]+$/.test(value) || type ? hit("fontFamily", "font", value) : null;

		return null;
	}

	if ((match = /^leading-(.+)$/.exec(u))) return hit("lineHeight", "leading", match[1]!);

	if ((match = /^bg-(.+)$/.exec(u))) return isColorValue(match[1]!) ? hit("backgroundColor", "bg", match[1]!) : null;

	if ((match = /^opacity-(.+)$/.exec(u)))
		return /^\d*\.?\d+$/.test(match[1]!) || arbitraryType(match[1]!) ? hit("opacity", "opacity", match[1]!) : null;

	if (u === "shadow") return hit("boxShadow", "shadow", "");

	if ((match = /^shadow-(.+)$/.exec(u))) {
		const value = match[1]!;

		if (SHADOW_SIZES.has(value)) return hit("boxShadow", "shadow", value);

		if (isColorValue(value)) return hit("shadowColor", "shadow", value);

		if (arbitraryType(value) === "other") return hit("boxShadow", "shadow", value);

		return null;
	}

	return null;
}

type Token = { text: string; start: number; end: number; parsed: ParsedClass; hit: ClassHit | null };

function tokenize(classes: string): Token[] {
	const tokens: Token[] = [];

	for (const match of classes.matchAll(/\S+/g)) {
		const parsed = parseClass(match[0]);
		const hit = parsed.variants.length ? null : classifyUtility(parsed.utility, parsed.negative);
		tokens.push({ text: match[0], start: match.index!, end: match.index! + match[0].length, parsed, hit });
	}

	return tokens;
}

/** Carries over the `!` of the class it replaces */
function formatClass(name: string, value: string, like?: ParsedClass): string {
	const negative = value.startsWith("-");
	const body = negative ? value.slice(1) : value;
	const utility = `${negative ? "-" : ""}${name}${name && body ? "-" : ""}${body}`;

	if (!like?.important) return utility;

	return like.importantLast ? `${utility}!` : `!${utility}`;
}

/** `insert` goes in place of token `at` (or at the end); whitespace between kept classes stays as written. */
function rewrite(classes: string, tokens: Token[], drop: Set<number>, at: number | null, insert: string[]): string {
	if (!tokens.length) return insert.length ? `${classes}${insert.join(" ")}` : classes;
	let out = classes.slice(0, tokens[0]!.start);
	let last = -1;
	tokens.forEach((token, i) => {
		const text = i === at ? insert.join(" ") : drop.has(i) ? "" : token.text;

		if (!text) return;

		// After a kept class, keep the gap that followed it, so dropped classes take their own leading gap
		if (last >= 0) out += classes.slice(tokens[last]!.end, tokens[last + 1]!.start) || " ";
		out += text;
		last = i;
	});

	if (at === null && insert.length) out += (last >= 0 ? " " : "") + insert.join(" ");

	return out + classes.slice(tokens[tokens.length - 1]!.end);
}

/** Unrecognized classes that `added` overrides per tailwind-merge (`bg-brand` vs `bg-red-500`) */
function conflicting(tokens: Token[], added: string[]): number[] {
	const found: number[] = [];
	tokens.forEach((token, i) => {
		if (token.hit || token.parsed.variants.length) return;

		for (const cls of added) {
			if (twMerge(`${token.text} ${cls}`) === cls) {
				found.push(i);

				return;
			}
		}
	});

	return found;
}

export const splitClasses = (classes: string) => classes.split(/\s+/).filter(Boolean);

/** The last unprefixed class that sets it wins */
export function getStyle(classes: string, prop: SimpleProp): string | null {
	let value: string | null = null;

	for (const token of tokenize(classes)) if (token.hit?.prop === prop) value = token.hit.value;

	return value;
}

const SIMPLE_PREFIX: Record<SimpleProp, string> = {
	display: "",
	flexDirection: "flex",
	flexWrap: "flex",
	justifyContent: "justify",
	alignItems: "items",
	minWidth: "min-w",
	maxWidth: "max-w",
	minHeight: "min-h",
	maxHeight: "max-h",
	fontSize: "text",
	fontWeight: "font",
	fontFamily: "font",
	lineHeight: "leading",
	letterSpacing: "tracking",
	textAlign: "text",
	textColor: "text",
	backgroundColor: "bg",
	borderColor: "border",
	borderStyle: "border",
	opacity: "opacity",
	boxShadow: "shadow",
	shadowColor: "shadow",
};

/** `("backgroundColor", "primary/50")` → `bg-primary/50` */
export const styleClass = (prop: SimpleProp, value: string) => formatClass(SIMPLE_PREFIX[prop], value);

/** Replaces the first unprefixed class that set it and drops the others; variant classes stay. */
export function setStyle(classes: string, prop: SimpleProp, value: string | null): string {
	const tokens = tokenize(classes);
	const matches = tokens.flatMap((token, i) => (token.hit?.prop === prop ? [i] : []));

	if (value === null) {
		if (!matches.length) return classes;

		return rewrite(classes, tokens, new Set(matches), null, []);
	}

	const first = matches[0];
	const cls = formatClass(SIMPLE_PREFIX[prop], value, first === undefined ? undefined : tokens[first]!.parsed);

	if (matches.length === 1 && tokens[first!]!.text === cls) return classes;
	const drop = new Set([...matches, ...conflicting(tokens, [cls])]);
	const at = first ?? [...drop].sort((a, b) => a - b)[0] ?? null;

	return rewrite(classes, tokens, drop, at, [cls]);
}

/** Most specific wins (`pt-2` over `py-4` over `p-6`), then the last one */
export function getBox(classes: string, group: BoxGroup): Box {
	const spec = BOXES[group];
	const box: Box = Object.fromEntries(spec.parts.map((part) => [part, null]));
	const rank: Record<string, number> = {};

	for (const token of tokenize(classes)) {
		if (token.hit?.prop !== group) continue;
		const alias = spec.aliases.find((a) => a.name === token.hit!.name);

		if (!alias) continue;

		for (const part of alias.parts) {
			if (rank[part] !== undefined && rank[part]! < alias.parts.length) continue;
			rank[part] = alias.parts.length;
			box[part] = token.hit.value;
		}
	}

	return box;
}

/** Shortest form: `p-4`, `px-4 py-2`, or one per side */
export function boxClasses(group: BoxGroup, box: Box): string[] {
	const spec = BOXES[group];
	const remaining = new Set(spec.parts.filter((part) => box[part] !== null && box[part] !== undefined));
	const writable = spec.aliases.filter((alias) => !alias.readOnly);
	const bySize = [...writable].sort((a, b) => b.parts.length - a.parts.length);
	const chosen = new Set<Alias>();

	for (const alias of bySize) {
		if (!alias.parts.every((part) => remaining.has(part))) continue;
		const value = box[alias.parts[0]!];

		if (!alias.parts.every((part) => box[part] === value)) continue;
		chosen.add(alias);

		for (const part of alias.parts) remaining.delete(part);
	}

	return writable.filter((alias) => chosen.has(alias)).map((alias) => formatClass(alias.name, box[alias.parts[0]!]!));
}

const sameBox = (a: Box, b: Box, parts: readonly string[]) =>
	parts.every((part) => (a[part] ?? null) === (b[part] ?? null));

/** Parts missing from `box` count as unset; unchanged values leave `classes` as is. */
export function setBox(classes: string, group: BoxGroup, box: Box): string {
	const spec = BOXES[group];

	if (sameBox(getBox(classes, group), box, spec.parts)) return classes;
	const tokens = tokenize(classes);
	const matches = tokens.flatMap((token, i) => (token.hit?.prop === group ? [i] : []));
	const first = matches[0];
	const like = first === undefined ? undefined : tokens[first]!.parsed;
	const added = boxClasses(group, box).map((cls) => (like?.important ? formatClassLike(cls, like) : cls));
	const drop = new Set([...matches, ...conflicting(tokens, added)]);
	const at = first ?? [...drop].sort((a, b) => a - b)[0] ?? null;

	return rewrite(classes, tokens, drop, at, added);
}

const formatClassLike = (cls: string, like: ParsedClass) => (like.importantLast ? `${cls}!` : `!${cls}`);

/** e.g. `["left", "right"]` for padding X */
export function setBoxParts(classes: string, group: BoxGroup, parts: readonly string[], value: string | null): string {
	const box = getBox(classes, group);

	for (const part of parts) box[part] = value;

	return setBox(classes, group, box);
}
