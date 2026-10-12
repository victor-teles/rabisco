import { isString } from "../guards";
import { isJsonObject, type Json, type JsonObject } from "../json";
import {
	COLOR_TOKENS,
	designTokensOf,
	orderedTokenNames,
	setDesignToken,
	validateToken,
	validateTokenName,
	type DesignTokens,
} from "./tokens";

export type BrandKit =
	| { kind: "design"; markdown: string; tokens: DesignTokens }
	| { kind: "tokens"; tokens: DesignTokens }
	| { kind: "error"; message: string };

export const MAX_BRAND_KIT_BYTES = 512 * 1024;

const GITHUB_BLOB = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

export function brandKitUrl(input: string): string | null {
	const trimmed = input.trim();

	if (!trimmed) return null;
	let url: URL;

	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const blob = GITHUB_BLOB.exec(url.href);

	return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}` : url.href;
}

const emptyTokens = (): DesignTokens => ({ light: {}, dark: {} });

const countTokens = (tokens: DesignTokens) => Object.keys(tokens.light).length + Object.keys(tokens.dark).length;

const isBuiltInColor = (name: string) => COLOR_TOKENS.some((color) => color === name);

const BARE_HSL = /^-?\d*\.?\d+(?:deg)?\s+\d*\.?\d+%\s+\d*\.?\d+%$/;

const GROUP_ALIASES = new Map([
	["colors", "color"],
	["fonts", "font"],
	["radii", "radius"],
	["sizes", "spacing"],
]);

function tokenValue(raw: string): string {
	const value = raw.replace(/\s*!important\s*$/i, "").trim();

	return BARE_HSL.test(value) ? `hsl(${value})` : value;
}

function tokenNameFor(raw: string, value: string): string | null {
	const name = raw
		.trim()
		.toLowerCase()
		.replace(/^--/, "")
		.replace(/^([a-z]+)(?=-|$)/, (group) => GROUP_ALIASES.get(group) ?? group);

	const builtIn = name.replace(/^color-/, "");
	const candidates = [name, builtIn, `color-${name}`];

	for (const candidate of candidates) {
		if (candidate.startsWith("color-") && isBuiltInColor(candidate.slice(6))) continue;

		if (!validateTokenName(candidate) && !validateToken(candidate, value)) return candidate;
	}

	return null;
}

function addToken(tokens: DesignTokens, dark: boolean, rawName: string, rawValue: string) {
	const value = tokenValue(rawValue);

	if (/^var\(/i.test(value)) return;
	const name = tokenNameFor(rawName, value);

	if (name) tokens[dark ? "dark" : "light"][name] = value;
}

const DARK_SELECTOR = /\.dark\b|\[data-theme=["']?dark|prefers-color-scheme:\s*dark/i;

const THEME_SELECTOR = /^\s*(?::root|html|body|@theme\b[^,]*|\.light|\[data-theme=["']?light["']?\])\s*$/i;

function cssTokens(css: string): DesignTokens {
	const tokens = emptyTokens();
	const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const darkMedia = /@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/gi;
	const darkStarts = [...text.matchAll(darkMedia)].map((match) => match.index);

	for (const block of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
		const dark =
			DARK_SELECTOR.test(block[1]!) ||
			darkStarts.some((start) => start < block.index && insideBlock(text, start, block.index));

		if (!dark && !block[1]!.split(",").some((selector) => THEME_SELECTOR.test(selector))) continue;

		for (const declaration of block[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
			addToken(tokens, dark, declaration[1]!, declaration[2]!);
		}
	}

	return tokens;
}

function insideBlock(text: string, start: number, at: number) {
	let depth = 0;

	for (let index = text.indexOf("{", start); index < at; index++) {
		if (text[index] === "{") depth++;
		else if (text[index] === "}") depth--;

		if (depth === 0) return false;
	}

	return depth > 0;
}

function stringRecord(value: Json | undefined): [string, string][] {
	if (!isJsonObject(value)) return [];

	return Object.entries(value).flatMap(([name, entry]) => (isString(entry) ? [[name, entry]] : []));
}

function leafValue(value: Json | undefined): string | null {
	if (isString(value)) return value;

	if (!isJsonObject(value)) return null;
	const leaf = value.$value ?? value.value;

	return isString(leaf) ? leaf : null;
}

function walkJson(value: JsonObject, path: string[], visit: (path: string[], value: string) => void) {
	for (const [key, entry] of Object.entries(value)) {
		if (key.startsWith("$")) continue;
		const leaf = leafValue(entry);

		if (leaf !== null) visit([...path, key], leaf);
		else if (isJsonObject(entry)) walkJson(entry, [...path, key], visit);
	}
}

function jsonTokens(root: JsonObject): DesignTokens {
	const tokens = emptyTokens();
	const vars = root.cssVars;

	if (isJsonObject(vars)) {
		for (const [name, value] of [...stringRecord(vars.theme), ...stringRecord(vars.light)]) {
			addToken(tokens, false, name, value);
		}

		for (const [name, value] of stringRecord(vars.dark)) addToken(tokens, true, name, value);

		return tokens;
	}

	walkJson(root, [], (path, value) => {
		const segments = path.map((segment) => segment.toLowerCase());
		const dark = segments.includes("dark");
		const name = segments.filter((segment) => segment !== "dark" && segment !== "light").join("-");

		if (name) addToken(tokens, dark, name, value);
	});

	return tokens;
}

function parseJson(text: string): Json | undefined {
	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		return JSON.parse(text) as Json;
	} catch {
		return undefined;
	}
}

const NO_TOKENS = "Rabisco found no tokens it can use in that file. Colors, radius and fonts need valid CSS values.";

const tokenKit = (tokens: DesignTokens): BrandKit =>
	countTokens(tokens) ? { kind: "tokens", tokens } : { kind: "error", message: NO_TOKENS };

export function parseBrandKit(text: string, url: string, contentType = ""): BrandKit {
	const trimmed = text.trim();
	const path = url.toLowerCase().split(/[?#]/)[0] ?? "";
	const type = contentType.toLowerCase();

	if (!trimmed) return { kind: "error", message: "That file is empty." };

	if (type.includes("text/html") || /^<(?:!doctype\s+html|html)\b/i.test(trimmed)) {
		return {
			kind: "error",
			message: "That link is a web page. Link to the raw file: a Design.md, a CSS theme or a JSON token file.",
		};
	}

	if (type.includes("json") || path.endsWith(".json") || /^[{[]/.test(trimmed)) {
		const json = parseJson(trimmed);

		return isJsonObject(json)
			? tokenKit(jsonTokens(json))
			: { kind: "error", message: "That JSON file can't be read." };
	}

	if (type.includes("text/css") || path.endsWith(".css") || /^(?:@[a-z-]+|:root)[^{]*\{/i.test(trimmed)) {
		return tokenKit(cssTokens(trimmed));
	}

	return { kind: "design", markdown: text, tokens: designTokensOf(text) };
}

type Rgb = [number, number, number];

type Lab = [number, number, number];

const linear = (channel: number) => {
	const c = channel / 255;

	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function oklab([r, g, b]: Rgb): Lab {
	const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

const chroma = ([, a, b]: Lab) => Math.hypot(a, b);

const distance = (x: Lab, y: Lab) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrastRatio(x: Rgb, y: Rgb): number {
	const [light, dark] = [luminance(x), luminance(y)].sort((a, b) => b - a);

	return (light! + 0.05) / (dark! + 0.05);
}

const hex = (rgb: Rgb) => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

type Cluster = { rgb: Rgb; lab: Lab; count: number };

export type LogoPalette = { colors: string[]; primary: string };

const WHITE: Rgb = [255, 255, 255];

const INK: Rgb = [10, 10, 10];

const CLUSTER_DISTANCE = 0.08;

const MIN_SHARE = 0.01;

const MIN_CHROMA = 0.05;

function clustersOf(pixels: ArrayLike<number>) {
	const bins = new Map<number, { sum: Rgb; count: number }>();
	let total = 0;

	for (let index = 0; index + 3 < pixels.length; index += 4) {
		if (pixels[index + 3]! < 200) continue;
		const [r, g, b] = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!];
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		const bin = bins.get(key) ?? { sum: [0, 0, 0], count: 0 };
		bin.sum = [bin.sum[0] + r, bin.sum[1] + g, bin.sum[2] + b];
		bin.count++;
		bins.set(key, bin);
		total++;
	}

	const clusters: Cluster[] = [];

	for (const bin of [...bins.values()].sort((a, b) => b.count - a.count)) {
		const rgb: Rgb = [bin.sum[0] / bin.count, bin.sum[1] / bin.count, bin.sum[2] / bin.count];
		const lab = oklab(rgb);
		const near = clusters.find((cluster) => distance(cluster.lab, lab) < CLUSTER_DISTANCE);

		if (!near) {
			clusters.push({ rgb, lab, count: bin.count });
			continue;
		}

		const count = near.count + bin.count;
		const mix = (i: 0 | 1 | 2) => (near.rgb[i] * near.count + rgb[i] * bin.count) / count;

		near.rgb = [mix(0), mix(1), mix(2)];
		near.lab = oklab(near.rgb);
		near.count = count;
	}

	return { clusters, total };
}

const isBackground = ({ lab }: Cluster) => lab[0] > 0.96 && chroma(lab) < 0.02;

export function logoPalette(pixels: ArrayLike<number>): LogoPalette | null {
	const { clusters, total } = clustersOf(pixels);

	if (!total) return null;

	const used = clusters.flatMap((cluster) =>
		cluster.count / total >= MIN_SHARE && !isBackground(cluster) ? [cluster] : [],
	);

	const vivid = used.find((cluster) => chroma(cluster.lab) >= MIN_CHROMA);
	const darkest = [...used].sort((a, b) => a.lab[0] - b.lab[0])[0];
	const primary = vivid ?? darkest;

	return primary ? { colors: used.slice(0, 6).map((cluster) => hex(cluster.rgb)), primary: hex(primary.rgb) } : null;
}

const rgbOf = (color: string): Rgb => [
	Number.parseInt(color.slice(1, 3), 16),
	Number.parseInt(color.slice(3, 5), 16),
	Number.parseInt(color.slice(5, 7), 16),
];

export function paletteTokens({ colors, primary }: LogoPalette): DesignTokens {
	const rgb = rgbOf(primary);
	const foreground = contrastRatio(rgb, WHITE) >= contrastRatio(rgb, INK) ? WHITE : INK;
	const vivid = colors.flatMap((color) => (chroma(oklab(rgbOf(color))) >= MIN_CHROMA ? [color] : []));
	const charts = vivid.includes(primary) ? [primary, ...vivid.filter((color) => color !== primary)] : vivid;
	const chartTokens = charts.slice(0, 5).map((color, index) => [`chart-${index + 1}`, color]);

	return {
		light: Object.fromEntries([
			["primary", primary],
			["primary-foreground", hex(foreground)],
			["ring", primary],
			...chartTokens,
		]),
		dark: {},
	};
}

export function withDesignTokens(markdown: string, tokens: DesignTokens): string {
	let text = markdown;

	for (const mode of ["light", "dark"] as const) {
		for (const name of orderedTokenNames(tokens[mode])) text = setDesignToken(text, name, mode, tokens[mode][name]!);
	}

	return text;
}
