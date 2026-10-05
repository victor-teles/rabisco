// Not `<foreignObject>`: WebKit taints any canvas that draws an SVG containing one, and design tools
// don't read it. Coordinates are CSS pixels from the top left of the screen's document.

import { isVisible, mixOklab, parseColor, toCss, toHex, type Rgba } from "./color";

export type { Rgba } from "./color";

export type Box = { x: number; y: number; width: number; height: number };

/** Top left, top right, bottom right, bottom left */
export type Radii = [number, number, number, number];

export type RoundedRect = Box & { radii: Radii };

export type GradientStop = { offset: number; color: Rgba };

export type Paint =
	| { kind: "color"; color: Rgba }
	| { kind: "linear"; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] };

export type TextFont = { family: string; size: number; weight: string; style: string };

/** `[a, b, c, d, e, f]`, as in SVG and canvas */
export type Matrix = [number, number, number, number, number, number];

export type SceneOp =
	| { type: "fill"; rect: RoundedRect; paint: Paint }
	/** Drawn outside `rect` only */
	| { type: "shadow"; rect: RoundedRect; color: Rgba; offsetX: number; offsetY: number; blur: number; spread: number }
	| {
			type: "border";
			rect: RoundedRect;
			widths: [number, number, number, number];
			colors: [Rgba, Rgba, Rgba, Rgba];
			style: "solid" | "dashed" | "dotted";
	  }
	/** `y` is the baseline, `width` the rendered width */
	| {
			type: "text";
			x: number;
			y: number;
			width: number;
			text: string;
			font: TextFont;
			paint: Paint;
			letterSpacing: number;
			decoration?: { line: "underline" | "line-through" | "overline"; color: Rgba; thickness: number };
	  }
	/** `src` is a data URL */
	| { type: "image"; x: number; y: number; width: number; height: number; src: string }
	/** `d` is in the shape's user space, `transform` maps it to the document */
	| {
			type: "path";
			d: string;
			transform: Matrix;
			fill?: { color: Rgba; rule: "nonzero" | "evenodd" };
			stroke?: { color: Rgba; width: number; cap: string; join: string; miterLimit: number; dash: number[] };
	  }
	| { type: "group"; opacity: number; clip: RoundedRect | null; ops: SceneOp[] };

export type SceneLink = { to: string; box: Box };

export type Scene = { width: number; height: number; background: Rgba | null; ops: SceneOp[]; links: SceneLink[] };

/** At most 2 decimals, no trailing zeros */
export const num = (n: number) => String(Math.round(n * 100) / 100);

const mapRadii = ([tl, tr, br, bl]: Radii, f: (r: number) => number): Radii => [f(tl), f(tr), f(br), f(bl)];

/** Like CSS: overlapping corners scale down together so adjacent radii never exceed their side. */
export function fitRadii(width: number, height: number, radii: Radii): Radii {
	const [tl, tr, br, bl] = mapRadii(radii, (r) => Math.max(0, Number.isFinite(r) ? r : 0));
	const ratio = (side: number, sum: number) => (sum > 0 ? side / sum : Number.POSITIVE_INFINITY);
	const f = Math.min(1, ratio(width, tl + tr), ratio(width, bl + br), ratio(height, tl + bl), ratio(height, tr + br));

	return [tl * f, tr * f, br * f, bl * f];
}

export const hasRadius = (radii: Radii) => radii.some((r) => r > 0);

/** Grows by `by` (shrinks when negative); radii follow, never below 0. */
export function inset(rect: RoundedRect, by: number): RoundedRect {
	const width = Math.max(0, rect.width - by * 2);
	const height = Math.max(0, rect.height - by * 2);

	return {
		x: rect.x + by,
		y: rect.y + by,
		width,
		height,
		radii: fitRadii(
			width,
			height,
			mapRadii(rect.radii, (r) => (r > 0 ? Math.max(0, r - by) : 0)),
		),
	};
}

/** Also valid for canvas `Path2D` */
export function rectPath({ x, y, width: w, height: h, radii }: RoundedRect): string {
	const [tl, tr, br, bl] = fitRadii(w, h, radii);

	if (!hasRadius([tl, tr, br, bl])) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
	const arc = (r: number, dx: number, dy: number) => (r > 0 ? `a${num(r)} ${num(r)} 0 0 1 ${num(dx)} ${num(dy)}` : "");

	return (
		`M${num(x + tl)} ${num(y)}` +
		`h${num(w - tl - tr)}${arc(tr, tr, tr)}` +
		`v${num(h - tr - br)}${arc(br, -br, br)}` +
		`h${num(-(w - br - bl))}${arc(bl, -bl, -bl)}` +
		`v${num(-(h - bl - tl))}${arc(tl, tl, -tl)}Z`
	);
}

/** `a(b, c), d` → `["a(b, c)", "d"]` */
export function splitTopLevel(value: string, separator = ","): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < value.length; i++) {
		const char = value[i];

		if (char === "(") depth++;
		else if (char === ")") depth--;
		else if (char === separator && depth === 0) {
			parts.push(value.slice(start, i).trim());
			start = i + 1;
		}
	}

	parts.push(value.slice(start).trim());

	return parts.filter(Boolean);
}

type TakenColor = { color: Rgba | null; rest: string };

function takeColor(text: string): TakenColor {
	const fn = /([a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\))/i.exec(text);

	if (fn)
		return { color: parseColor(fn[1]!), rest: (text.slice(0, fn.index) + text.slice(fn.index + fn[1]!.length)).trim() };
	const tokens = text.split(/\s+/);
	const index = tokens.findIndex((t) => t.startsWith("#") || (/^[a-z]+$/i.test(t) && t !== "inset"));

	if (index === -1) return { color: null, rest: text };

	return { color: parseColor(tokens[index]!), rest: tokens.filter((_, i) => i !== index).join(" ") };
}

export type BoxShadow = { color: Rgba; offsetX: number; offsetY: number; blur: number; spread: number; inset: boolean };

/** Layers in CSS order (first on top); invisible layers are dropped. */
export function parseBoxShadow(value: string): BoxShadow[] {
	if (!value || value === "none") return [];
	const shadows: BoxShadow[] = [];

	for (const layer of splitTopLevel(value)) {
		const { color, rest } = takeColor(layer);
		const inset = /\binset\b/.test(rest);

		const lengths = rest
			.replace(/\binset\b/, "")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => parseFloat(t));

		if (!isVisible(color) || lengths.length < 2 || lengths.some(Number.isNaN)) continue;
		const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;

		if (!inset && blur === 0 && spread <= 0 && offsetX === 0 && offsetY === 0) continue;
		shadows.push({ color, offsetX, offsetY, blur: Math.max(0, blur), spread, inset });
	}

	return shadows;
}

const SIDES = new Map(Object.entries({ top: 0, right: 90, bottom: 180, left: 270 }));

/** CSS degrees, clockwise from "to top" */
function gradientAngle(direction: string, width: number, height: number): number | null {
	const angle = /^(-?[\d.]+)(deg|rad|grad|turn)$/.exec(direction);

	if (angle) {
		const value = Number(angle[1]);

		return angle[2] === "rad"
			? (value * 180) / Math.PI
			: angle[2] === "grad"
				? value * 0.9
				: angle[2] === "turn"
					? value * 360
					: value;
	}

	const to = /^to\s+([a-z]+)(?:\s+([a-z]+))?$/.exec(direction);

	if (!to) return null;
	const [a, b] = [to[1]!, to[2]];

	if (!b) return SIDES.get(a) ?? null;
	const vertical = a === "top" || a === "bottom" ? a : b;
	const horizontal = a === "left" || a === "right" ? a : b;
	const corner = (Math.atan2(height, width) * 180) / Math.PI;

	if (vertical === "top") return horizontal === "right" ? corner : 360 - corner;

	return horizontal === "right" ? 180 - corner : 180 + corner;
}

/** Extra stops that approximate OKLab interpolation between two stops */
const OKLAB_STEPS = 6;

/** Gradients `in oklab`/`in oklch` gain intermediate stops so sRGB renderers match. */
export function parseLinearGradient(value: string, box: Box): Paint | null {
	const match = /^(repeating-)?linear-gradient\((.*)\)$/s.exec(value.trim());

	if (!match || match[1]) return null;
	const parts = splitTopLevel(match[2]!);
	let angle = 180;
	let oklab = false;
	const first = parts[0]!.trim();
	const space = /\bin\s+([a-z-]+)(?:\s+[a-z]+\s+hue)?/.exec(first);
	const direction = first.replace(/\bin\s+[a-z-]+(?:\s+[a-z]+\s+hue)?/, "").trim();

	if (space || /^(to\s|-?[\d.]+(deg|rad|grad|turn)$)/.test(direction)) {
		parts.shift();
		oklab = !!space && /^ok(lab|lch)$/.test(space[1]!);

		if (direction) {
			const parsed = gradientAngle(direction, box.width, box.height);

			if (parsed === null) return null;
			angle = parsed;
		}
	}

	const radians = (angle * Math.PI) / 180;
	const [dx, dy] = [Math.sin(radians), -Math.cos(radians)];
	const length = Math.abs(box.width * dx) + Math.abs(box.height * dy);
	const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

	// Stops: a color and zero, one or two positions; lone lengths are hints (ignored)
	const raw: { color: Rgba; offset: number | null }[] = [];

	for (const part of parts) {
		const { color, rest } = takeColor(part);

		if (!color) continue;

		const positions = rest
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => (t.endsWith("%") ? parseFloat(t) / 100 : length ? parseFloat(t) / length : 0));

		if (!positions.length) raw.push({ color, offset: null });

		for (const offset of positions.slice(0, 2)) raw.push({ color, offset: Number.isNaN(offset) ? null : offset });
	}

	if (!raw.length) return null;

	if (raw.length === 1) return { kind: "color", color: raw[0]!.color };
	raw[0]!.offset ??= 0;
	raw[raw.length - 1]!.offset ??= 1;

	// Missing positions spread evenly; positions never go backwards
	for (let i = 1; i < raw.length; i++) {
		if (raw[i]!.offset === null) {
			let j = i;

			while (raw[j]!.offset === null) j++;
			const [from, to] = [raw[i - 1]!.offset!, raw[j]!.offset!];

			for (let k = i; k < j; k++) raw[k]!.offset = from + ((to - from) * (k - i + 1)) / (j - i + 1);
		}

		raw[i]!.offset = Math.max(raw[i]!.offset!, raw[i - 1]!.offset!);
	}

	let stops: GradientStop[] = raw.map(({ color, offset }) => ({ color, offset: offset! }));

	if (oklab) {
		const expanded: GradientStop[] = [stops[0]!];

		for (let i = 1; i < stops.length; i++) {
			const [a, b] = [stops[i - 1]!, stops[i]!];

			for (let s = 1; s < OKLAB_STEPS && b.offset > a.offset; s++) {
				const t = s / OKLAB_STEPS;
				expanded.push({ offset: a.offset + (b.offset - a.offset) * t, color: mixOklab(a.color, b.color, t) });
			}

			expanded.push(b);
		}

		stops = expanded;
	}

	const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

	return {
		kind: "linear",
		x1: round(cx - (dx * length) / 2),
		y1: round(cy - (dy * length) / 2),
		x2: round(cx + (dx * length) / 2),
		y2: round(cy + (dy * length) / 2),
		stops,
	};
}

/** For renderers without gradients */
export const paintColor = (paint: Paint): Rgba => (paint.kind === "color" ? paint.color : paint.stops[0]!.color);

export const escapeXml = (text: string) =>
	text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Separate opacity attribute: SVG 1.1 tools don't read rgba. */
function colorAttrs(name: "fill" | "stroke" | "stop-color", color: Rgba) {
	const opacity = name === "stop-color" ? "stop-opacity" : `${name}-opacity`;

	return `${name}="${toHex(color)}"${color.a < 1 ? ` ${opacity}="${num(color.a)}"` : ""}`;
}

export function sceneToSvg(scene: Scene, title?: string): string {
	const defs: string[] = [];
	let nextId = 0;
	const id = (prefix: string) => `${prefix}${++nextId}`;

	const paintAttr = (paint: Paint) => {
		if (paint.kind === "color") return colorAttrs("fill", paint.color);
		const gradient = id("g");

		const stops = paint.stops
			.map((s) => `<stop offset="${num(s.offset)}" ${colorAttrs("stop-color", s.color)}/>`)
			.join("");

		defs.push(
			`<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="${num(paint.x1)}" y1="${num(paint.y1)}" x2="${num(paint.x2)}" y2="${num(paint.y2)}">${stops}</linearGradient>`,
		);

		return `fill="url(#${gradient})"`;
	};

	const rectElement = (rect: RoundedRect, attrs: string) =>
		hasRadius(rect.radii) && new Set(fitRadii(rect.width, rect.height, rect.radii)).size > 1
			? `<path d="${rectPath(rect)}" ${attrs}/>`
			: `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}"${
					hasRadius(rect.radii) ? ` rx="${num(fitRadii(rect.width, rect.height, rect.radii)[0])}"` : ""
				} ${attrs}/>`;

	const write = (op: SceneOp): string => {
		switch (op.type) {
			case "fill":
				return rectElement(op.rect, paintAttr(op.paint));
			case "shadow": {
				const grown = inset({ ...op.rect, x: op.rect.x + op.offsetX, y: op.rect.y + op.offsetY }, -op.spread);
				const margin = op.blur * 2 + Math.abs(op.spread) + Math.abs(op.offsetX) + Math.abs(op.offsetY) + 2;
				const outside = id("c");

				const [x, y, w, h] = [
					op.rect.x - margin,
					op.rect.y - margin,
					op.rect.width + margin * 2,
					op.rect.height + margin * 2,
				];

				defs.push(
					`<clipPath id="${outside}"><path clip-rule="evenodd" d="M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z${rectPath(op.rect)}"/></clipPath>`,
				);
				let filter = "";

				if (op.blur > 0) {
					const blur = id("f");
					defs.push(
						`<filter id="${blur}" filterUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"><feGaussianBlur stdDeviation="${num(op.blur / 2)}"/></filter>`,
					);
					filter = ` filter="url(#${blur})"`;
				}

				return `<g clip-path="url(#${outside})">${rectElement(grown, `${colorAttrs("fill", op.color)}${filter}`)}</g>`;
			}

			case "border": {
				const [top, right, bottom, left] = op.widths;
				const uniform = op.widths.every((w) => w === top) && op.colors.every((c) => toCss(c) === toCss(op.colors[0]));

				if (uniform && top > 0) {
					const dash =
						op.style === "dashed"
							? ` stroke-dasharray="${num(top * 3)} ${num(top * 3)}"`
							: op.style === "dotted"
								? ` stroke-dasharray="${num(top)} ${num(top)}"`
								: "";

					return rectElement(
						inset(op.rect, top / 2),
						`fill="none" ${colorAttrs("stroke", op.colors[0])} stroke-width="${num(top)}"${dash}`,
					);
				}

				const { x, y, width, height } = op.rect;

				const sides: [number, Rgba, Box][] = [
					[top, op.colors[0], { x, y, width, height: top }],
					[right, op.colors[1], { x: x + width - right, y, width: right, height }],
					[bottom, op.colors[2], { x, y: y + height - bottom, width, height: bottom }],
					[left, op.colors[3], { x, y, width: left, height }],
				];

				return sides
					.flatMap(([w, color, box]) =>
						w > 0 && isVisible(color) ? [rectElement({ ...box, radii: [0, 0, 0, 0] }, colorAttrs("fill", color))] : [],
					)
					.join("");
			}

			case "text": {
				const { font } = op;
				const decoration = op.decoration ? ` text-decoration="${op.decoration.line}"` : "";
				const spacing = op.letterSpacing ? ` letter-spacing="${num(op.letterSpacing)}"` : "";

				return (
					`<text x="${num(op.x)}" y="${num(op.y)}" font-family="${escapeXml(font.family)}" font-size="${num(font.size)}"` +
					`${font.weight !== "400" && font.weight !== "normal" ? ` font-weight="${escapeXml(font.weight)}"` : ""}` +
					`${font.style !== "normal" ? ` font-style="${escapeXml(font.style)}"` : ""}${spacing}${decoration} ${paintAttr(op.paint)} xml:space="preserve">${escapeXml(op.text)}</text>`
				);
			}

			case "image":
				return `<image x="${num(op.x)}" y="${num(op.y)}" width="${num(op.width)}" height="${num(op.height)}" preserveAspectRatio="none" xlink:href="${escapeXml(op.src)}"/>`;
			case "path": {
				const attrs = [
					`d="${escapeXml(op.d)}"`,
					`transform="matrix(${op.transform.map(num).join(" ")})"`,
					op.fill ? colorAttrs("fill", op.fill.color) : `fill="none"`,
					op.fill?.rule === "evenodd" ? `fill-rule="evenodd"` : "",
					op.stroke
						? `${colorAttrs("stroke", op.stroke.color)} stroke-width="${num(op.stroke.width)}" stroke-linecap="${op.stroke.cap}" stroke-linejoin="${op.stroke.join}"${
								op.stroke.dash.length ? ` stroke-dasharray="${op.stroke.dash.map(num).join(" ")}"` : ""
							}`
						: "",
				];

				return `<path ${attrs.filter(Boolean).join(" ")}/>`;
			}

			case "group": {
				const inner = op.ops.map(write).join("");

				if (!inner) return "";
				let attrs = "";

				if (op.opacity < 1) attrs += ` opacity="${num(op.opacity)}"`;

				if (op.clip) {
					const clip = id("c");
					defs.push(`<clipPath id="${clip}"><path d="${rectPath(op.clip)}"/></clipPath>`);
					attrs += ` clip-path="url(#${clip})"`;
				}

				return attrs ? `<g${attrs}>${inner}</g>` : inner;
			}
		}
	};

	const body = scene.ops.map(write).join("\n");
	const { width, height } = scene;

	const background = isVisible(scene.background)
		? `<rect width="${num(width)}" height="${num(height)}" ${colorAttrs("fill", scene.background)}/>\n`
		: "";

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">\n` +
		(title ? `<title>${escapeXml(title)}</title>\n` : "") +
		(defs.length ? `<defs>${defs.join("")}</defs>\n` : "") +
		background +
		body +
		`\n</svg>\n`
	);
}
