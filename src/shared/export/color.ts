/**
 * CSS colors as 8-bit sRGB, for image export. Computed styles carry modern
 * color syntax (`oklch()`, `oklab()`, `lab()`, `color(display-p3 …)`) that
 * SVG editors don't read, so the exporter converts every color it writes.
 * Out-of-gamut colors are clipped per channel.
 */

/** sRGB, channels 0–255 (rounded), alpha 0–1. */
export type Rgba = { r: number; g: number; b: number; a: number };

type Vec3 = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const multiply = (m: number[][], [x, y, z]: Vec3): Vec3 => [
	m[0]![0]! * x + m[0]![1]! * y + m[0]![2]! * z,
	m[1]![0]! * x + m[1]![1]! * y + m[1]![2]! * z,
	m[2]![0]! * x + m[2]![1]! * y + m[2]![2]! * z,
];

/** sRGB (and display-p3) transfer function: linear → encoded */
const encode = (c: number) => {
	const sign = c < 0 ? -1 : 1;
	const abs = Math.abs(c);
	return sign * (abs <= 0.0031308 ? 12.92 * abs : 1.055 * abs ** (1 / 2.4) - 0.055);
};
/** encoded → linear */
const decode = (c: number) => {
	const sign = c < 0 ? -1 : 1;
	const abs = Math.abs(c);
	return sign * (abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4);
};

const XYZ_D65_TO_LINEAR_SRGB = [
	[3.2409699419045226, -1.537383177570094, -0.4986107602930034],
	[-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
	[0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_TO_D65 = [
	[0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
	[-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
	[0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const LINEAR_P3_TO_XYZ_D65 = [
	[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
	[0.2289745640697488, 0.6917385218365064, 0.079286914093745],
	[0, 0.04511338185890264, 1.043944368900976],
];

function oklabToLinearSrgb([L, a, b]: Vec3): Vec3 {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function linearSrgbToOklab([r, g, b]: Vec3): Vec3 {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function labToLinearSrgb([L, a, b]: Vec3): Vec3 {
	const kappa = 24389 / 27;
	const epsilon = 216 / 24389;
	const fy = (L + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const x = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
	const y = L > kappa * epsilon ? fy ** 3 : L / kappa;
	const z = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
	const d50: Vec3 = [x * 0.3457 / 0.3585, y, z * (1 - 0.3457 - 0.3585) / 0.3585];
	return multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(D50_TO_D65, d50));
}

const polar = (l: number, c: number, h: number): Vec3 => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

const fromLinear = ([r, g, b]: Vec3, a: number): Rgba => fromEncoded([encode(r), encode(g), encode(b)], a);
const fromEncoded = ([r, g, b]: Vec3, a: number): Rgba => ({
	r: Math.round(clamp01(r) * 255),
	g: Math.round(clamp01(g) * 255),
	b: Math.round(clamp01(b) * 255),
	a: Math.round(clamp01(a) * 1000) / 1000,
});

/** A number, percentage (`percent` = the value of 100%), angle or `none`; NaN when it isn't one. */
function component(token: string | undefined, percent = 1): number {
	if (token === undefined) return Number.NaN;
	if (token === "none") return 0;
	const match = /^(-?[\d.]+(?:e[-+]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(token);
	if (!match) return Number.NaN;
	const value = Number(match[1]);
	switch (match[2]?.toLowerCase()) {
		case "%":
			return (value / 100) * percent;
		case "rad":
			return (value * 180) / Math.PI;
		case "grad":
			return value * 0.9;
		case "turn":
			return value * 360;
		default:
			return value;
	}
}

/** `fn(a b c / d)` or `fn(a, b, c, d)` → channel tokens and the alpha token. */
function args(body: string): { channels: string[]; alpha?: string } {
	const [main, alpha] = body.split("/").map((part) => part.trim());
	const channels = main!.split(/[\s,]+/).filter(Boolean);
	if (alpha !== undefined) return { channels, alpha };
	// Legacy comma syntax carries alpha as a fourth value
	return main!.includes(",") && channels.length === 4 ? { channels: channels.slice(0, 3), alpha: channels[3] } : { channels };
}

const NAMED: Record<string, Rgba> = {
	transparent: { r: 0, g: 0, b: 0, a: 0 },
	black: { r: 0, g: 0, b: 0, a: 1 },
	white: { r: 255, g: 255, b: 255, a: 1 },
	red: { r: 255, g: 0, b: 0, a: 1 },
	green: { r: 0, g: 128, b: 0, a: 1 },
	blue: { r: 0, g: 0, b: 255, a: 1 },
	gray: { r: 128, g: 128, b: 128, a: 1 },
	grey: { r: 128, g: 128, b: 128, a: 1 },
};

function hex(value: string): Rgba | null {
	const digits = value.slice(1);
	if (!/^[\da-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null;
	const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
	const at = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
	return { r: at(0), g: at(1), b: at(2), a: full.length === 8 ? Math.round((at(3) / 255) * 1000) / 1000 : 1 };
}

function hslToRgb(h: number, s: number, l: number): Vec3 {
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [f(0), f(8), f(4)];
}

/**
 * The sRGB value of a CSS color as `getComputedStyle` serializes it: hex,
 * named basics, `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()` and
 * `color()` in srgb, srgb-linear and display-p3. `null` for anything else
 * (`currentcolor`, `color-mix()`, system colors).
 */
export function parseColor(value: string): Rgba | null {
	const text = value.trim().toLowerCase();
	if (text.startsWith("#")) return hex(text);
	if (NAMED[text]) return { ...NAMED[text]! };
	const match = /^([a-z-]+)\((.*)\)$/s.exec(text);
	if (!match) return null;
	const [, fn, body] = match;
	const { channels, alpha: alphaToken } = args(body!);
	const alpha = alphaToken === undefined ? 1 : component(alphaToken, 1);
	if (Number.isNaN(alpha)) return null;

	if (fn === "color") {
		const [space, ...rest] = channels;
		const values = rest.slice(0, 3).map((t) => component(t, 1)) as Vec3;
		if (values.length !== 3 || values.some(Number.isNaN)) return null;
		if (space === "srgb") return fromEncoded(values, alpha);
		if (space === "srgb-linear") return fromLinear(values, alpha);
		if (space === "display-p3") return fromLinear(multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(LINEAR_P3_TO_XYZ_D65, values.map(decode) as Vec3)), alpha);
		return null;
	}
	if (channels.length !== 3) return null;
	const [c0, c1, c2] = channels;
	let rgb: Rgba | null = null;
	switch (fn) {
		case "rgb":
		case "rgba": {
			const v = [component(c0, 255), component(c1, 255), component(c2, 255)];
			if (v.some(Number.isNaN)) return null;
			rgb = fromEncoded(v.map((n) => n / 255) as Vec3, alpha);
			break;
		}
		case "hsl":
		case "hsla": {
			const [h, s, l] = [component(c0), component(c1, 1), component(c2, 1)];
			if ([h, s, l].some(Number.isNaN)) return null;
			// Legacy hsl() takes bare numbers as percentages too
			const pct = (n: number, token: string) => (token.endsWith("%") ? n : n / 100);
			rgb = fromEncoded(hslToRgb(((h % 360) + 360) % 360, pct(s, c1!), pct(l, c2!)), alpha);
			break;
		}
		case "oklab": {
			const v: Vec3 = [component(c0, 1), component(c1, 0.4), component(c2, 0.4)];
			if (v.some(Number.isNaN)) return null;
			rgb = fromLinear(oklabToLinearSrgb(v), alpha);
			break;
		}
		case "oklch": {
			const [l, c, h] = [component(c0, 1), component(c1, 0.4), component(c2)];
			if ([l, c, h].some(Number.isNaN)) return null;
			rgb = fromLinear(oklabToLinearSrgb(polar(l, c, h)), alpha);
			break;
		}
		case "lab": {
			const v: Vec3 = [component(c0, 100), component(c1, 125), component(c2, 125)];
			if (v.some(Number.isNaN)) return null;
			rgb = fromLinear(labToLinearSrgb(v), alpha);
			break;
		}
		case "lch": {
			const [l, c, h] = [component(c0, 100), component(c1, 150), component(c2)];
			if ([l, c, h].some(Number.isNaN)) return null;
			rgb = fromLinear(labToLinearSrgb(polar(l, c, h)), alpha);
			break;
		}
	}
	return rgb;
}

export const isVisible = (color: Rgba | null): color is Rgba => !!color && color.a > 0;

/** `#rrggbb`, ignoring alpha (SVG writes it as a separate opacity). */
export const toHex = ({ r, g, b }: Rgba) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** `rgba(r, g, b, a)`, for canvas. */
export const toCss = ({ r, g, b, a }: Rgba) => `rgba(${r}, ${g}, ${b}, ${a})`;

/**
 * `from` → `to` at `t` (0–1), interpolated in OKLab like CSS gradients
 * written `in oklab` (Tailwind's default); alpha is linear.
 */
export function mixOklab(from: Rgba, to: Rgba, t: number): Rgba {
	const lab = (c: Rgba) => linearSrgbToOklab([decode(c.r / 255), decode(c.g / 255), decode(c.b / 255)]);
	const [a, b] = [lab(from), lab(to)];
	const mixed = a.map((v, i) => v + (b[i]! - v) * t) as Vec3;
	return fromLinear(oklabToLinearSrgb(mixed), from.a + (to.a - from.a) * t);
}
