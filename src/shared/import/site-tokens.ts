import { contrastRatio, parseBrandKit } from "../context/brand-kit";
import { TOKEN_NAMES, validateToken, type DesignTokens } from "../context/tokens";
import { TEXT_TAG, type CapturedNode } from "./captured-tree";
import type { UrlCapture } from "./url-capture";

type Rgb = [number, number, number];

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

const hex = (rgb: Rgb) => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function rgbOf(color: string): Rgb | null {
	const hexMatch = HEX.exec(color.trim());

	if (hexMatch) {
		const channel = (index: number) => Number.parseInt(hexMatch[index]!, 16);

		return [channel(1), channel(2), channel(3)];
	}

	const match = RGB.exec(color.trim());

	if (!match) return null;
	const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]) / (match[4].endsWith("%") ? 100 : 1);

	return alpha < 1 ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function opaqueColor(value: string | undefined): string | null {
	if (!value) return null;
	const rgb = rgbOf(value);

	if (rgb) return hex(rgb);

	return /^rgba?\(/i.test(value.trim()) || value === "transparent" ? null : value.trim();
}

const WHITE: Rgb = [255, 255, 255];

const INK: Rgb = [10, 10, 10];

const BUTTON_TAGS = new Set(["button", "a"]);

const isButton = (node: CapturedNode) => BUTTON_TAGS.has(node.tag) || node.attrs?.role === "button";

type Tally = Map<string, number>;

const add = (tally: Tally, key: string | null, weight = 1) => {
	if (key) tally.set(key, (tally.get(key) ?? 0) + weight);
};

const top = (tally: Tally, skip: (key: string) => boolean = () => false) =>
	[...tally].sort((a, b) => b[1] - a[1]).find(([key]) => !skip(key))?.[0] ?? null;

type Tallies = { text: Tally; fills: Tally; fillText: Tally; links: Tally; radii: Tally; borders: Tally };

function walk(node: CapturedNode, color: string, tallies: Tallies, inButton: boolean) {
	if (node.tag === TEXT_TAG) {
		const length = node.text?.trim().length ?? 0;

		add(tallies.text, color, length);

		if (inButton) add(tallies.fillText, color, length);

		return;
	}

	const own = opaqueColor(node.styles.color) ?? color;
	const fill = opaqueColor(node.styles["background-color"]);
	const button = isButton(node);

	if (button && fill) add(tallies.fills, fill);

	if (node.tag === "a" && !fill) add(tallies.links, own);

	if ((button || node.tag === "input") && node.styles["border-top-left-radius"]) {
		add(tallies.radii, node.styles["border-top-left-radius"]);
	}

	if (node.styles["border-top-style"] || node.styles["border-bottom-style"]) {
		add(tallies.borders, opaqueColor(node.styles["border-top-color"] ?? node.styles["border-bottom-color"]));
	}

	for (const child of node.children) walk(child, own, tallies, inButton || (button && fill !== null));
}

function pageBackground(root: CapturedNode, width: number): string {
	let node = root;
	let color = opaqueColor(root.styles["background-color"]) ?? "#ffffff";

	for (;;) {
		const [only, ...rest] = node.children.filter((child) => child.tag !== TEXT_TAG);

		if (!only || rest.length || only.box.width < width * 0.9) return color;
		node = only;
		color = opaqueColor(node.styles["background-color"]) ?? color;
	}
}

function fontStack(value: string | undefined): string | null {
	if (!value) return null;

	const families = value.split(",").flatMap((family) => {
		const name = family.trim();

		return validateToken("font-sans", name) ? [] : [name];
	});

	return families.length ? families.join(", ") : null;
}

function readableOn(color: string): string {
	const rgb = rgbOf(color) ?? WHITE;

	return hex(contrastRatio(rgb, WHITE) >= contrastRatio(rgb, INK) ? WHITE : INK);
}

const isBuiltIn = (name: string) => TOKEN_NAMES.some((token) => token === name);

function varTokens(vars: Record<string, string>): Record<string, string> {
	const css = Object.entries(vars)
		.map(([name, value]) => `${name}: ${value};`)
		.join("\n");

	const kit = css ? parseBrandKit(`:root {\n${css}\n}`, "site.css", "text/css") : null;

	if (!kit || kit.kind === "error") return {};

	return Object.fromEntries(
		Object.entries(kit.tokens.light).flatMap(([name, value]) => (isBuiltIn(name) ? [[name, value]] : [])),
	);
}

export function siteTokens({ tree, vars }: UrlCapture): DesignTokens {
	const tallies: Tallies = {
		text: new Map(),
		fills: new Map(),
		fillText: new Map(),
		links: new Map(),
		radii: new Map(),
		borders: new Map(),
	};

	const background = pageBackground(tree.root, tree.width);

	walk(tree.root, opaqueColor(tree.root.styles.color) ?? "#000000", tallies, false);
	const foreground = top(tallies.text) ?? "#000000";

	const primary =
		top(tallies.fills, (fill) => fill === background) ?? top(tallies.links, (link) => link === foreground);

	const label = top(tallies.fillText);
	const border = top(tallies.borders, (color) => color === background);

	const found = {
		background,
		foreground,
		primary,
		"primary-foreground": primary && (label && label !== primary ? label : readableOn(primary)),
		ring: primary,
		border,
		input: border,
		radius: top(tallies.radii, (radius) => radius === "0px"),
		"font-sans": fontStack(tree.root.styles["font-family"]),
	};

	const light: DesignTokens["light"] = {};

	for (const [name, value] of Object.entries({ ...found, ...varTokens(vars) })) {
		if (value && !validateToken(name, value)) light[name] = value;
	}

	return { light, dark: {} };
}
