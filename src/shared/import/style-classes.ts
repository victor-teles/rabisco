import { COLOR_TOKENS, isCustomToken, tokenKind, tokenUtility } from "../context/tokens";
import { parseColor, toHex, toOklab, type Rgba } from "../export/color";
import { PALETTE } from "../tailwind/classes";

type Lab = [number, number, number];

type ColorOption = { name: string; lab: Lab };

export type Matcher = {
	color: (value: string) => string | null;
	spacing: (value: string) => string | null;
	size: (value: string, box?: number) => string | null;
	maxWidth: (value: string) => string | null;
	fontSize: (value: string) => { name: string; px: number } | null;
	radius: (value: string, box: number) => string | null;
	shadow: (value: string) => string | null;
	arbitrary: { colors: Set<string>; radii: Set<string> };
};

const TOKEN_DISTANCE = 0.02;

const PALETTE_DISTANCE = 0.01;

const SNAP_PX = 1;

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

export const FONT_LINE_HEIGHTS = new Map(
	Object.entries({
		xs: 16 / 12,
		sm: 20 / 14,
		base: 1.5,
		lg: 28 / 18,
		xl: 28 / 20,
		"2xl": 32 / 24,
		"3xl": 36 / 30,
		"4xl": 40 / 36,
		"5xl": 1,
		"6xl": 1,
		"7xl": 1,
		"8xl": 1,
		"9xl": 1,
	}),
);

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

const FRACTIONS: [string, number][] = [
	["full", 100],
	["1/2", 50],
	["1/3", 100 / 3],
	["2/3", 200 / 3],
	["1/4", 25],
	["3/4", 75],
];

const SHADOWS: [string, number, number][] = [
	["2xs", 1, 0],
	["xs", 1, 2],
	["sm", 1, 3],
	["md", 4, 6],
	["lg", 10, 15],
	["xl", 20, 25],
	["2xl", 25, 50],
];

export const px = (value: string) => {
	const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());

	return match ? Number(match[1]) : null;
};

const remPx = (value: string | undefined) => {
	const match = value ? /^(-?\d*\.?\d+)(rem|px)$/.exec(value.trim()) : null;

	if (!match) return null;

	return match[2] === "rem" ? Number(match[1]) * 16 : Number(match[1]);
};

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

const distance = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const arbitrary = (value: string) =>
	`[${value
		.trim()
		.replace(/["'`\\]/g, "")
		.replace(/\s+/g, "_")}]`;

function nearest<T>(options: T[], score: (option: T) => number, limit: number): T | null {
	let best: T | null = null;
	let bestScore = limit;

	for (const option of options) {
		const value = score(option);

		if (value <= bestScore) {
			best = option;
			bestScore = value;
		}
	}

	return best;
}

const alphaModifier = (alpha: number) => {
	const percent = Math.round(alpha * 100);

	return percent % 5 === 0 ? `/${percent}` : `/[${round(alpha, 3)}]`;
};

type ColorOptions = { tokens: ColorOption[]; palette: ColorOption[] };

function colorOptions(theme: Record<string, string>): ColorOptions {
	const tokens: ColorOption[] = [];

	for (const [name, value] of Object.entries(theme)) {
		const builtin = COLOR_TOKENS.some((token) => token === name);

		if (!builtin && !(isCustomToken(name) && tokenKind(name) === "color")) continue;
		const rgba = parseColor(value);

		if (rgba && rgba.a === 1) tokens.push({ name: builtin ? name : tokenUtility(name), lab: toOklab(rgba) });
	}

	const palette: ColorOption[] = [
		{ name: "white", lab: toOklab({ r: 255, g: 255, b: 255, a: 1 }) },
		{ name: "black", lab: toOklab({ r: 0, g: 0, b: 0, a: 1 }) },
	];

	for (const [hue, shades] of Object.entries(PALETTE)) {
		shades.forEach((value, i) => {
			const rgba = parseColor(`oklch(${value})`);
			const shade = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"][i];

			if (rgba && shade) palette.push({ name: `${hue}-${shade}`, lab: toOklab(rgba) });
		});
	}

	return { tokens, palette };
}

export function createMatcher(theme: Record<string, string>): Matcher {
	const { tokens, palette } = colorOptions(theme);
	const radius = remPx(theme.radius) ?? 10;
	const spacingStep = remPx(theme.spacing) ?? 4;
	const arbitraryValues = { colors: new Set<string>(), radii: new Set<string>() };

	const fontTokens: { name: string; px: number }[] = [];

	const radii: [string, number][] = [
		["xs", 2],
		["sm", radius - 4],
		["md", radius - 2],
		["lg", radius],
		["xl", radius + 4],
		["2xl", 16],
		["3xl", 24],
		["4xl", 32],
	];

	for (const [name, value] of Object.entries(theme)) {
		const size = remPx(value);

		if (!isCustomToken(name) || size === null) continue;
		const kind = tokenKind(name);

		if (kind === "text") fontTokens.push({ name: tokenUtility(name), px: size });
		else if (kind === "radius") radii.unshift([tokenUtility(name), size]);
	}

	const color = (value: string) => {
		const rgba: Rgba | null = parseColor(value);

		if (!rgba) return null;

		if (rgba.a === 0) return "transparent";
		const lab = toOklab(rgba);
		const alpha = rgba.a < 1 ? alphaModifier(rgba.a) : "";

		const match =
			nearest(tokens, (option) => distance(option.lab, lab), TOKEN_DISTANCE) ??
			nearest(palette, (option) => distance(option.lab, lab), PALETTE_DISTANCE);

		if (match) return match.name + alpha;
		const hex = toHex(rgba);
		arbitraryValues.colors.add(hex);

		return `[${hex}]${alpha}`;
	};

	const spacing = (value: string) => {
		if (value === "auto") return "auto";
		const size = px(value);

		if (size === null) return null;
		const sign = size < 0 ? "-" : "";
		const abs = Math.abs(size);

		if (abs === 0) return "0";

		if (abs === 1) return `${sign}px`;
		const steps = Math.round((abs / spacingStep) * 2) / 2;

		if (Math.abs(steps * spacingStep - abs) <= 0.5) return `${sign}${steps}`;

		return `${sign}[${round(abs)}px]`;
	};

	const size = (value: string, box?: number) => {
		const percent = /^(\d*\.?\d+)%$/.exec(value.trim());

		if (percent) {
			const fraction = nearest(FRACTIONS, ([, n]) => Math.abs(n - Number(percent[1])), 0.5);

			return fraction ? fraction[0] : arbitrary(value);
		}

		if (value === "100vh") return "screen";
		const length = px(value);

		if (length === null) return null;

		if (box !== undefined && box > 0 && Math.abs(length - box) > SNAP_PX) return null;

		return spacing(`${length}px`);
	};

	const maxWidth = (value: string) => {
		const length = px(value);

		if (length === null) return size(value);
		const container = nearest(CONTAINERS, ([, n]) => Math.abs(n - length), SNAP_PX);

		return container ? container[0] : spacing(value);
	};

	const fontSize = (value: string) => {
		const length = px(value);

		if (length === null) return null;
		const token = nearest(fontTokens, (option) => Math.abs(option.px - length), SNAP_PX);

		if (token) return { name: token.name, px: token.px };
		const step = nearest(FONT_SIZES, ([, n]) => Math.abs(n - length), SNAP_PX);

		return step ? { name: step[0], px: step[1] } : { name: arbitrary(`${round(length)}px`), px: length };
	};

	const radiusClass = (value: string, box: number) => {
		const length = px(value) ?? (value.endsWith("%") && Number.parseFloat(value) >= 50 ? Infinity : null);

		if (length === null) return null;

		if (length === 0) return "none";

		if (length >= 9999 || (box > 0 && length >= box / 2)) return "full";
		const step = nearest(radii, ([, n]) => Math.abs(n - length), SNAP_PX);

		if (step) return step[0];
		const exact = `${round(length)}px`;
		arbitraryValues.radii.add(exact);

		return `[${exact}]`;
	};

	const shadow = (value: string) => {
		const layers = value.split(/,(?![^(]*\))/);
		const lengths = (layers[0] ?? "").match(/-?\d*\.?\d+px/g)?.map((length) => px(length) ?? 0) ?? [];

		if (/inset/.test(value)) return arbitrary(value);
		const [, y = 0, blur = 0] = lengths;
		const step = nearest(SHADOWS, ([, sy, sb]) => Math.abs(sy - y) + Math.abs(sb - blur), SNAP_PX);

		return step ? step[0] : arbitrary(value);
	};

	return {
		color,
		spacing,
		size,
		maxWidth,
		fontSize,
		radius: radiusClass,
		shadow,
		arbitrary: arbitraryValues,
	};
}
