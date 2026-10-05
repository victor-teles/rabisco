/**
 * Image export, inside the frame: reads the rendered screen into a `Scene`
 * (`src/shared/export/scene.ts`), a list of boxes, text lines, images and SVG
 * shapes with their computed styles. The host turns it into SVG; `raster.ts`
 * paints it to a canvas for PNG and PDF.
 *
 * Supported: backgrounds (colors, linear gradients, images), borders, radii,
 * outer box shadows and rings, opacity, overflow clipping, text (with
 * `bg-clip-text` gradients, letter spacing, decorations, text-transform),
 * images with object-fit, form field values and placeholders, inline SVG
 * icons, and stacking by z-index among siblings. Not supported: CSS
 * transforms other than translation, filters, masks, inset shadows,
 * pseudo-elements (`::before`/`::after`) and text-overflow ellipses.
 */
import { isVisible, parseColor, type Rgba } from "../../shared/export/color";
import {
	fitRadii,
	parseBoxShadow,
	parseLinearGradient,
	rectPath,
	splitTopLevel,
	type Box,
	type Matrix,
	type Paint,
	type Radii,
	type RoundedRect,
	type Scene,
	type SceneLink,
	type SceneOp,
} from "../../shared/export/scene";
import { LINK_TO_ATTRIBUTE } from "../lib/render/protocol";
import { boxOf, hostElements, rootFiber, textProp, type Fiber } from "./inspect";

const SKIPPED = new Set(["script", "style", "link", "meta", "template", "noscript", "head", "title"]);

/** The render error overlay (`errors.ts`) is not part of the screen */
const OVERLAY_ID = "rabisco-error";

const PLACEHOLDER: Rgba = { r: 228, g: 228, b: 231, a: 1 };

/** The screen's height: the viewport, or more when content overflows it. */
export function contentHeight() {
	return Math.ceil(Math.max(window.innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for fonts and images, and jumps CSS animations and transitions to their end state. */
export async function settle() {
	for (const img of document.images) if (img.loading === "lazy") img.loading = "eager";
	await Promise.race([document.fonts?.ready, wait(3000)]);
	await Promise.all(
		[...document.images].map((img) => (img.complete ? null : Promise.race([img.decode().catch(() => {}), wait(5000)]))),
	);

	for (const animation of document.getAnimations?.() ?? []) {
		try {
			if (animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY) animation.finish();
		} catch {
			// Infinite or detached: leave it where it is
		}
	}

	await wait(30);
}

// ————— Colors and fonts —————

let probe: CanvasRenderingContext2D | null = null;

const probeContext = () => {
	if (!probe) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		probe = canvas.getContext("2d", { willReadFrequently: true })!;
	}

	return probe;
};

const colors = new Map<string, Rgba | null>();

/** A computed color as sRGB; the browser resolves what `parseColor` doesn't know. */
function color(value: string): Rgba | null {
	if (colors.has(value)) return colors.get(value)!;
	let parsed = parseColor(value);

	if (!parsed && value && value !== "none" && !value.startsWith("url(")) {
		const ctx = probeContext();
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = "rgba(0, 0, 0, 0)";
		ctx.fillStyle = value;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		parsed = { r: r!, g: g!, b: b!, a: Math.round((a! / 255) * 1000) / 1000 };
	}

	colors.set(value, parsed);

	return parsed;
}

export const canvasFont = (font: { style: string; weight: string; size: number; family: string }) =>
	`${font.style} ${font.weight} ${font.size}px ${font.family}`;

const metrics = new Map<string, { ascent: number; descent: number }>();

/** The font's ascent and descent: a text range's box is their sum, centered on the line. */
function fontMetrics(font: string, size: number) {
	let found = metrics.get(font);

	if (!found) {
		const ctx = probeContext();
		ctx.font = font;
		const measured = ctx.measureText("Hg");
		found =
			measured.fontBoundingBoxAscent !== undefined
				? { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent }
				: { ascent: size * 0.93, descent: size * 0.24 };
		metrics.set(font, found);
	}

	return found;
}

function textWidth(font: string, text: string) {
	const ctx = probeContext();
	ctx.font = font;

	return ctx.measureText(text).width;
}

// ————— Images —————

type Loaded = { src: string; width: number; height: number };

const loaded = new Map<string, Promise<Loaded | null>>();

const asDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const { result } = reader;

			// `readAsDataURL` reads to a string
			if (result === null || result instanceof ArrayBuffer) reject(new Error("The image did not read as a data URL"));
			else resolve(result);
		};

		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

/**
 * `url` as a data URL with its natural size. Other origins need CORS (the
 * frame's origin is opaque); `null` when the image can't be read.
 */
function loadImage(url: string): Promise<Loaded | null> {
	let promise = loaded.get(url);

	if (!promise) {
		promise = (async () => {
			try {
				const src = url.startsWith("data:")
					? url
					: await asDataUrl(await (await fetch(url, { mode: "cors", credentials: "omit" })).blob());

				const image = new Image();
				image.src = src;
				await image.decode();

				return image.naturalWidth && image.naturalHeight
					? { src, width: image.naturalWidth, height: image.naturalHeight }
					: null;
			} catch {
				return null;
			}
		})();
		loaded.set(url, promise);
	}

	return promise;
}

/** Where an image of `natural` size goes in `box` for an `object-fit` / `background-size` and position. */
function placeImage(natural: { width: number; height: number }, box: Box, fit: string, position: string): Box {
	const [px = 0.5, py = 0.5] = position
		.split(/\s+/)
		.map((part) => (part.endsWith("%") ? parseFloat(part) / 100 : Number.NaN));

	const at = (size: number, room: number, fraction: number, offset: number) =>
		offset + (room - size) * (Number.isNaN(fraction) ? 0.5 : fraction);

	let scale: number | null = null;

	if (fit === "cover") scale = Math.max(box.width / natural.width, box.height / natural.height);
	else if (fit === "contain") scale = Math.min(box.width / natural.width, box.height / natural.height);
	else if (fit === "none") scale = 1;
	else if (fit === "scale-down") scale = Math.min(1, box.width / natural.width, box.height / natural.height);

	if (scale === null) return box;
	const width = natural.width * scale;
	const height = natural.height * scale;

	return { x: at(width, box.width, px, box.x), y: at(height, box.height, py, box.y), width, height };
}

// ————— Boxes —————

type Sides = [number, number, number, number];

const px = (value: string) => parseFloat(value) || 0;

function radiiOf(style: CSSStyleDeclaration, box: Box): Radii {
	const corner = (value: string) => {
		const first = value.split(/\s+/)[0] ?? "0";

		return first.endsWith("%") ? (parseFloat(first) / 100) * Math.min(box.width, box.height) : px(first);
	};

	return fitRadii(box.width, box.height, [
		corner(style.borderTopLeftRadius),
		corner(style.borderTopRightRadius),
		corner(style.borderBottomRightRadius),
		corner(style.borderBottomLeftRadius),
	]);
}

function borderWidths(style: CSSStyleDeclaration): Sides {
	const side = (width: string, kind: string) => (kind === "none" || kind === "hidden" ? 0 : px(width));

	return [
		side(style.borderTopWidth, style.borderTopStyle),
		side(style.borderRightWidth, style.borderRightStyle),
		side(style.borderBottomWidth, style.borderBottomStyle),
		side(style.borderLeftWidth, style.borderLeftStyle),
	];
}

/** `rect` without `sides` (top, right, bottom, left); inner radii shrink with them. */
function shrink(rect: RoundedRect, [top, right, bottom, left]: Sides): RoundedRect {
	const width = Math.max(0, rect.width - left - right);
	const height = Math.max(0, rect.height - top - bottom);
	const [tl, tr, br, bl] = rect.radii;

	return {
		x: rect.x + left,
		y: rect.y + top,
		width,
		height,
		radii: fitRadii(width, height, [
			Math.max(0, tl - Math.max(top, left)),
			Math.max(0, tr - Math.max(top, right)),
			Math.max(0, br - Math.max(bottom, right)),
			Math.max(0, bl - Math.max(bottom, left)),
		]),
	};
}

const paddings = (style: CSSStyleDeclaration): Sides => [
	px(style.paddingTop),
	px(style.paddingRight),
	px(style.paddingBottom),
	px(style.paddingLeft),
];

const add = (a: Sides, b: Sides): Sides => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

const clipsText = (style: CSSStyleDeclaration) =>
	style.backgroundClip === "text" || style.webkitBackgroundClip === "text";

/** The element's background as one paint: its first gradient, else its color. */
function backgroundPaint(style: CSSStyleDeclaration, box: Box): Paint | null {
	for (const layer of splitTopLevel(style.backgroundImage)) {
		const gradient = parseLinearGradient(layer, box);

		if (gradient) return gradient;
	}

	const fill = color(style.backgroundColor);

	return isVisible(fill) ? { kind: "color", color: fill } : null;
}

/** Visually hidden content (`sr-only`): 1px, clipped away. */
function isScreenReaderOnly(style: CSSStyleDeclaration, rect: DOMRect) {
	if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") return true;

	return style.position === "absolute" && rect.width <= 1 && rect.height <= 1 && style.overflow !== "visible";
}

class SceneBuilder {
	readonly pending: Promise<void>[] = [];
	readonly scrollX = window.scrollX;
	readonly scrollY = window.scrollY;

	box(rect: DOMRect): Box {
		return { x: rect.left + this.scrollX, y: rect.top + this.scrollY, width: rect.width, height: rect.height };
	}

	/** An image, filled in once it loads: the slot keeps paint order. */
	image(url: string, clip: RoundedRect, place: (natural: Loaded) => Box, out: SceneOp[]) {
		const slot: SceneOp & { type: "group" } = { type: "group", opacity: 1, clip: clip, ops: [] };
		out.push(slot);
		this.pending.push(
			loadImage(url).then((image) => {
				if (image) slot.ops.push({ type: "image", ...place(image), src: image.src });
				else slot.ops.push({ type: "fill", rect: clip, paint: { kind: "color", color: PLACEHOLDER } });
			}),
		);
	}

	element(element: Element, out: SceneOp[]) {
		if (SKIPPED.has(element.localName) || element.id === OVERLAY_ID) return;
		const style = getComputedStyle(element);

		if (style.display === "none") return;
		const opacity = parseFloat(style.opacity);

		if (opacity <= 0) return;
		const rect = element.getBoundingClientRect();

		if (isScreenReaderOnly(style, rect)) return;
		const visible = style.visibility === "visible";
		const own: SceneOp[] = [];
		const box = this.box(rect);

		if (element instanceof SVGSVGElement) {
			if (visible) this.svg(element, own);
		} else {
			const borderBox: RoundedRect = { ...box, radii: radiiOf(style, box) };
			const borders = borderWidths(style);

			if (visible) {
				this.decorations(style, borderBox, borders, own);
				this.replaced(element, style, shrink(borderBox, add(borders, paddings(style))), own);
			}

			const children: SceneOp[] = [];
			this.children(element, style, children);
			const clipped = style.overflowX !== "visible" || style.overflowY !== "visible";

			if (clipped && children.length) {
				if (box.width > 0 && box.height > 0)
					own.push({ type: "group", opacity: 1, clip: shrink(borderBox, borders), ops: children });
			} else own.push(...children);
		}

		if (!own.length) return;

		if (opacity < 1) out.push({ type: "group", opacity, clip: null, ops: own });
		else out.push(...own);
	}

	/** Shadows, background and border, in CSS paint order. */
	decorations(style: CSSStyleDeclaration, borderBox: RoundedRect, borders: Sides, out: SceneOp[]) {
		if (borderBox.width <= 0 || borderBox.height <= 0) return;

		// The first shadow is on top
		for (const shadow of parseBoxShadow(style.boxShadow).reverse()) {
			if (!shadow.inset)
				out.push({
					type: "shadow",
					rect: borderBox,
					color: shadow.color,
					offsetX: shadow.offsetX,
					offsetY: shadow.offsetY,
					blur: shadow.blur,
					spread: shadow.spread,
				});
		}

		// `bg-clip-text` backgrounds show through the text instead
		if (!clipsText(style)) {
			const area =
				style.backgroundClip === "padding-box"
					? shrink(borderBox, borders)
					: style.backgroundClip === "content-box"
						? shrink(borderBox, add(borders, paddings(style)))
						: borderBox;

			const fill = color(style.backgroundColor);

			if (isVisible(fill)) out.push({ type: "fill", rect: area, paint: { kind: "color", color: fill } });
			const layers = splitTopLevel(style.backgroundImage === "none" ? "" : style.backgroundImage);

			// The first layer is on top
			for (const layer of layers.reverse()) {
				const gradient = parseLinearGradient(layer, area);

				if (gradient) {
					out.push({ type: "fill", rect: area, paint: gradient });
					continue;
				}

				const url = /^url\(["']?(.*?)["']?\)$/.exec(layer)?.[1];

				if (url) {
					const fit = style.backgroundSize === "contain" ? "contain" : "cover";
					this.image(url, area, (natural) => placeImage(natural, area, fit, style.backgroundPosition), out);
				}
			}
		}

		if (borders.some((w) => w > 0)) {
			const colorOf = (value: string) => color(value) ?? { r: 0, g: 0, b: 0, a: 0 };
			const kind = style.borderTopStyle;
			out.push({
				type: "border",
				rect: borderBox,
				widths: borders,
				colors: [
					colorOf(style.borderTopColor),
					colorOf(style.borderRightColor),
					colorOf(style.borderBottomColor),
					colorOf(style.borderLeftColor),
				],
				style: kind === "dashed" || kind === "dotted" ? kind : "solid",
			});
		}
	}

	/** Images, canvases and the text of form fields. `content` is the content box. */
	replaced(element: Element, style: CSSStyleDeclaration, content: RoundedRect, out: SceneOp[]) {
		if (content.width <= 0 || content.height <= 0) return;

		if (element instanceof HTMLImageElement) {
			const url = element.currentSrc || element.src;

			if (url)
				this.image(url, content, (natural) => placeImage(natural, content, style.objectFit, style.objectPosition), out);
			else out.push({ type: "fill", rect: content, paint: { kind: "color", color: PLACEHOLDER } });
		} else if (element instanceof HTMLCanvasElement) {
			try {
				out.push({ type: "image", ...content, src: element.toDataURL() });
			} catch {
				out.push({ type: "fill", rect: content, paint: { kind: "color", color: PLACEHOLDER } });
			}
		} else if (element instanceof HTMLVideoElement) {
			if (element.poster)
				this.image(
					element.poster,
					content,
					(natural) => placeImage(natural, content, style.objectFit, style.objectPosition),
					out,
				);
			else out.push({ type: "fill", rect: content, paint: { kind: "color", color: PLACEHOLDER } });
		} else if (
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement
		) {
			this.field(element, style, content, out);
		}
	}

	/** A form field's value, or its placeholder, where the browser draws it. */
	field(
		element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
		style: CSSStyleDeclaration,
		content: Box,
		out: SceneOp[],
	) {
		if (
			element instanceof HTMLInputElement &&
			["checkbox", "radio", "range", "color", "file", "hidden", "image"].includes(element.type)
		)
			return;
		let text = element instanceof HTMLSelectElement ? (element.selectedOptions[0]?.text ?? "") : element.value;
		let fill = color(style.color);

		if (element instanceof HTMLInputElement && element.type === "password") text = "•".repeat(text.length);

		if (!text && !(element instanceof HTMLSelectElement) && element.placeholder) {
			text = element.placeholder;
			fill = color(getComputedStyle(element, "::placeholder").color) ?? fill;
		}

		if (!text || !isVisible(fill)) return;

		const font = {
			family: style.fontFamily,
			size: px(style.fontSize),
			weight: style.fontWeight,
			style: style.fontStyle,
		};

		const css = canvasFont(font);
		const { ascent, descent } = fontMetrics(css, font.size);
		const lineHeight = style.lineHeight === "normal" ? font.size * 1.2 : px(style.lineHeight);
		const lines = element instanceof HTMLTextAreaElement ? text.split("\n") : [text.replace(/\n/g, " ")];
		lines.forEach((line, i) => {
			if (!line) return;
			const width = textWidth(css, line);

			const x =
				style.textAlign === "center"
					? content.x + (content.width - width) / 2
					: style.textAlign === "right" || style.textAlign === "end"
						? content.x + content.width - width
						: content.x;

			const y =
				element instanceof HTMLTextAreaElement
					? content.y + i * lineHeight + (lineHeight - ascent - descent) / 2 + ascent
					: content.y + (content.height - ascent - descent) / 2 + ascent;

			out.push({
				type: "text",
				x,
				y,
				width,
				text: line,
				font,
				paint: { kind: "color", color: fill! },
				letterSpacing: px(style.letterSpacing),
			});
		});
	}

	/** Child nodes in paint order: negative z-index, in-flow content, then positioned elements by z-index. */
	children(element: Element, style: CSSStyleDeclaration, out: SceneOp[]) {
		const below: { z: number; ops: SceneOp[] }[] = [];
		const above: { z: number; ops: SceneOp[] }[] = [];
		const flow: SceneOp[] = [];

		for (const node of element.childNodes) {
			if (node instanceof Text) this.text(node, element, style, flow);
			else if (node instanceof Element) {
				const childStyle = getComputedStyle(node);

				if (childStyle.position === "static") {
					this.element(node, flow);
					continue;
				}

				const z = parseInt(childStyle.zIndex, 10) || 0;
				const ops: SceneOp[] = [];
				this.element(node, ops);
				(z < 0 ? below : above).push({ z, ops });
			}
		}

		const sorted = (list: { z: number; ops: SceneOp[] }[]) =>
			list.map((item, i) => ({ ...item, i })).sort((a, b) => a.z - b.z || a.i - b.i);

		for (const item of sorted(below)) out.push(...item.ops);
		out.push(...flow);

		for (const item of sorted(above)) out.push(...item.ops);
	}

	/** The paint of text in `element`: its color, or the gradient behind it with `bg-clip-text`. */
	textPaint(element: Element, style: CSSStyleDeclaration): Paint | null {
		const fill = color(style.webkitTextFillColor || style.color);

		if (isVisible(fill)) return { kind: "color", color: fill };

		for (let node: Element | null = element; node; node = node.parentElement) {
			const nodeStyle = node === element ? style : getComputedStyle(node);

			if (clipsText(nodeStyle)) return backgroundPaint(nodeStyle, this.box(node.getBoundingClientRect()));
		}

		return null;
	}

	/** One text op per rendered line of `node`. */
	text(node: Text, parent: Element, style: CSSStyleDeclaration, out: SceneOp[]) {
		const data = node.data;

		if (style.visibility !== "visible" || !/\S/.test(data)) return;
		const paint = this.textPaint(parent, style);

		if (!paint) return;

		const font = {
			family: style.fontFamily,
			size: px(style.fontSize),
			weight: style.fontWeight,
			style: style.fontStyle,
		};

		const { ascent, descent } = fontMetrics(canvasFont(font), font.size);
		const range = document.createRange();

		type Line = { start: number; end: number; left: number; right: number; top: number; height: number };

		const lines: Line[] = [];

		const piece = (start: number, end: number, rect: DOMRect) => {
			const line = lines.at(-1);

			if (line && Math.abs(rect.top - line.top) < Math.max(1, rect.height / 4) && rect.left >= line.right - 1) {
				line.end = end;
				line.right = Math.max(line.right, rect.right);
			} else lines.push({ start, end, left: rect.left, right: rect.right, top: rect.top, height: rect.height });
		};

		for (const word of data.matchAll(/\S+/g)) {
			const start = word.index!;
			const end = start + word[0].length;
			range.setStart(node, start);
			range.setEnd(node, end);
			const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);

			if (rects.length === 1) piece(start, end, rects[0]!);
			else if (rects.length > 1) {
				// A word broken across lines: one character at a time
				for (let i = start; i < end; i++) {
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);

					if (rect) piece(i, i + 1, rect);
				}
			}
		}

		const preserve = /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace);

		const transform = (text: string) =>
			style.textTransform === "uppercase"
				? text.toUpperCase()
				: style.textTransform === "lowercase"
					? text.toLowerCase()
					: style.textTransform === "capitalize"
						? text.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
						: text;

		const decoration = this.decoration(parent, style, font.size);

		for (const line of lines) {
			const raw = data.slice(line.start, line.end);
			const text = transform(preserve ? raw : raw.replace(/\s+/g, " "));

			const op: Extract<SceneOp, { type: "text" }> = {
				type: "text",
				x: line.left + this.scrollX,
				y: line.top + this.scrollY + (line.height - ascent - descent) / 2 + ascent,
				width: line.right - line.left,
				text,
				font,
				paint,
				letterSpacing: px(style.letterSpacing),
			};

			if (decoration) op.decoration = decoration;
			out.push(op);
		}
	}

	/** Underline, line-through or overline, from the element or its inline ancestors. */
	decoration(element: Element, style: CSSStyleDeclaration, size: number) {
		for (let node: Element | null = element; node; node = node.parentElement) {
			const nodeStyle = node === element ? style : getComputedStyle(node);
			const line = nodeStyle.textDecorationLine;

			const kind = line.includes("underline")
				? "underline"
				: line.includes("line-through")
					? "line-through"
					: line.includes("overline")
						? "overline"
						: null;

			if (kind) {
				const thickness = px(nodeStyle.textDecorationThickness) || Math.max(1, size / 14);

				return {
					line: kind,
					color: color(nodeStyle.textDecorationColor) ?? color(nodeStyle.color)!,
					thickness,
				} as const;
			}

			if (!nodeStyle.display.startsWith("inline")) break;
		}

		return null;
	}

	/** An inline SVG (icons, mostly) as paths in document coordinates. */
	svg(svg: SVGSVGElement, out: SceneOp[]) {
		const skip = new Set([
			"defs",
			"clippath",
			"mask",
			"symbol",
			"marker",
			"pattern",
			"lineargradient",
			"radialgradient",
			"filter",
			"title",
			"desc",
			"metadata",
			"foreignobject",
			"style",
			"script",
		]);

		const visit = (parent: Element, opacity: number) => {
			for (const child of parent.children) {
				if (!(child instanceof SVGElement) || skip.has(child.localName.toLowerCase())) continue;
				const style = getComputedStyle(child);

				if (style.display === "none") continue;
				const own = opacity * parseFloat(style.opacity || "1");

				if (child instanceof SVGGraphicsElement && !(child instanceof SVGGElement) && !(child instanceof SVGSVGElement))
					this.graphic(child, style, own, out);
				else visit(child, own);
			}
		};

		visit(svg, 1);
	}

	/** One SVG shape element (path, rect, circle…) as a path op. */
	graphic(graphic: SVGGraphicsElement, style: CSSStyleDeclaration, opacity: number, out: SceneOp[]) {
		if (style.visibility !== "visible" || opacity <= 0) return;
		const d = graphicPath(graphic);
		const matrix = graphic.getScreenCTM();

		if (!d || !matrix) return;

		const transform: Matrix = [
			matrix.a,
			matrix.b,
			matrix.c,
			matrix.d,
			matrix.e + this.scrollX,
			matrix.f + this.scrollY,
		];

		const paintOf = (value: string, alpha: number) => {
			if (!value || value === "none") return null;
			// Gradients and patterns: fall back to the text color
			const resolved = value.startsWith("url(") ? color(style.color) : color(value);

			return isVisible(resolved) ? { ...resolved, a: Math.round(resolved.a * alpha * opacity * 1000) / 1000 } : null;
		};

		const fill = paintOf(style.fill, parseFloat(style.fillOpacity || "1"));
		const stroke = paintOf(style.stroke, parseFloat(style.strokeOpacity || "1"));
		const strokeWidth = px(style.strokeWidth);

		if (!fill && !(stroke && strokeWidth > 0)) return;
		const op: Extract<SceneOp, { type: "path" }> = { type: "path", d, transform };

		if (fill) op.fill = { color: fill, rule: style.fillRule === "evenodd" ? "evenodd" : "nonzero" };

		if (stroke && strokeWidth > 0) {
			op.stroke = {
				color: stroke,
				width: strokeWidth,
				cap: style.strokeLinecap || "butt",
				join: style.strokeLinejoin || "miter",
				miterLimit: parseFloat(style.strokeMiterlimit) || 4,
				dash:
					style.strokeDasharray && style.strokeDasharray !== "none"
						? style.strokeDasharray.split(/[\s,]+/).map(px)
						: [],
			};
		}

		out.push(op);
	}
}

/** Path data for an SVG graphic element, in its own user space; `null` for anything else. */
function graphicPath(graphic: SVGGraphicsElement): string | null {
	const n = (v: number) => String(Math.round(v * 1000) / 1000);

	if (graphic instanceof SVGPathElement) return graphic.getAttribute("d");

	if (graphic instanceof SVGRectElement) {
		const [x, y, width, height] = [
			graphic.x.baseVal.value,
			graphic.y.baseVal.value,
			graphic.width.baseVal.value,
			graphic.height.baseVal.value,
		];

		const r = graphic.rx.baseVal.value || graphic.ry.baseVal.value;

		return width > 0 && height > 0 ? rectPath({ x, y, width, height, radii: [r, r, r, r] }) : null;
	}

	if (graphic instanceof SVGCircleElement || graphic instanceof SVGEllipseElement) {
		const cx = graphic.cx.baseVal.value;
		const cy = graphic.cy.baseVal.value;

		const [rx, ry] =
			graphic instanceof SVGCircleElement
				? [graphic.r.baseVal.value, graphic.r.baseVal.value]
				: [graphic.rx.baseVal.value, graphic.ry.baseVal.value];

		if (rx <= 0 || ry <= 0) return null;

		return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0Z`;
	}

	if (graphic instanceof SVGLineElement)
		return `M${n(graphic.x1.baseVal.value)} ${n(graphic.y1.baseVal.value)}L${n(graphic.x2.baseVal.value)} ${n(graphic.y2.baseVal.value)}`;

	if (graphic instanceof SVGPolylineElement || graphic instanceof SVGPolygonElement) {
		const points = [...graphic.points].map((p) => `${n(p.x)} ${n(p.y)}`);

		if (points.length < 2) return null;

		return `M${points.join("L")}${graphic instanceof SVGPolygonElement ? "Z" : ""}`;
	}

	return null;
}

/**
 * Prototype links (decision 0007) and their boxes, read from React's fiber
 * tree so a component that doesn't pass `data-link-to` on still counts.
 * The outermost link wins.
 */
function collectLinks(container: Element, scrollX: number, scrollY: number): SceneLink[] {
	const links: SceneLink[] = [];

	const push = (to: string | null, elements: Element[]) => {
		const link = to?.trim();

		if (!link) return false;
		const box = boxOf(elements);

		if (box) links.push({ to: link, box: { ...box, x: box.x + scrollX, y: box.y + scrollY } });

		return true;
	};

	const root = rootFiber(container);

	if (!root) {
		for (const element of container.querySelectorAll(`[${LINK_TO_ATTRIBUTE}]`))
			push(element.getAttribute(LINK_TO_ATTRIBUTE), [element]);

		return links;
	}

	const visit = (fiber: Fiber | null) => {
		for (let node = fiber; node; node = node.sibling) {
			if (push(textProp(node, LINK_TO_ATTRIBUTE), hostElements(node))) continue;
			visit(node.child);
		}
	};

	visit(root.child);

	return links;
}

/** The rendered screen as a scene, `width` wide (the viewport) and as tall as its content. */
export async function captureScene(container: Element): Promise<Scene> {
	await settle();
	const builder = new SceneBuilder();
	const ops: SceneOp[] = [];

	for (const child of document.body.children) builder.element(child, ops);
	await Promise.all(builder.pending);

	const background =
		[document.body, document.documentElement]
			.map((element) => color(getComputedStyle(element).backgroundColor))
			.find(isVisible) ?? null;

	return {
		width: document.documentElement.clientWidth,
		height: contentHeight(),
		background,
		ops: prune(ops),
		links: collectLinks(container, builder.scrollX, builder.scrollY),
	};
}

/** Drops empty groups, so the SVG has no clutter. */
function prune(ops: SceneOp[]): SceneOp[] {
	return ops.flatMap((op) => {
		if (op.type !== "group") return [op];
		const inner = prune(op.ops);

		if (!inner.length) return [];

		return op.opacity >= 1 && !op.clip ? inner : [{ ...op, ops: inner }];
	});
}
