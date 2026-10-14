import {
	INHERITED_PROPERTIES,
	TEXT_TAG,
	type CapturedBox,
	type CapturedNode,
	type CapturedTree,
	type CssValues,
} from "../../import/captured-tree";
import { ROOT_INHERITED } from "../../import/capture-script";
import { parseColor, type Rgba } from "../color";
import { parseBoxShadow, parseLinearGradient, splitTopLevel } from "../scene";
import type { FigmaEffect, FigmaPaint, Guid, NodeFields, TextFields } from "./node-change";
import { svgVectors } from "./vector";

export type FigmaImage = { hash: Uint8Array; bytes: Uint8Array; width: number; height: number };

export type FigmaScreen = {
	name: string;
	x: number;
	y: number;
	tree: CapturedTree;
	images: ReadonlyMap<string, FigmaImage>;
};

export type FigmaCopy = { nodeChanges: NodeFields[]; blobs: Uint8Array[]; fixed: number };

type Axis = "x" | "y";

type Side = "top" | "right" | "bottom" | "left";

type Insets = Record<Side, number>;

type Layer = {
	type: "FRAME" | "TEXT" | "VECTOR" | "RECTANGLE";
	name: string;
	box: CapturedBox;
	props: NodeFields;
	children: Layer[];
	positioned: { horizontal: string; vertical: string } | null;
	component?: boolean;
	margin?: Insets;
	alignSelf?: string;
	grow?: boolean;
};

type Context = {
	images: ReadonlyMap<string, FigmaImage>;
	imageBlobs: Map<string, number>;
	blobs: Uint8Array[];
	fixed: number;
};

type Inherited = Record<string, string>;

type Layout = {
	mode: "HORIZONTAL" | "VERTICAL";
	spacing: number;
	counterSpacing: number;
	wrap: boolean;
	padding: Insets;
	justify: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
	align: "MIN" | "CENTER" | "MAX" | "BASELINE";
	primaryHug: boolean;
	counterHug: boolean;
	grow: boolean[];
	stretch: boolean[];
};

const TOLERANCE = 1.5;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const INHERITED = new Set<string>(INHERITED_PROPERTIES);

const GENERIC_FONTS = new Set([
	"ui-sans-serif",
	"ui-serif",
	"ui-monospace",
	"ui-rounded",
	"system-ui",
	"sans-serif",
	"serif",
	"monospace",
	"cursive",
	"fantasy",
	"-apple-system",
	"blinkmacsystemfont",
	"segoe ui",
	"apple color emoji",
	"segoe ui emoji",
	"segoe ui symbol",
	"noto color emoji",
	"helvetica neue",
	"arial",
]);

const WEIGHT_STYLES = new Map([
	[100, "Thin"],
	[200, "Extra Light"],
	[300, "Light"],
	[400, "Regular"],
	[500, "Medium"],
	[600, "Semi Bold"],
	[700, "Bold"],
	[800, "Extra Bold"],
	[900, "Black"],
]);

const TAG_NAMES = new Map([
	["nav", "nav"],
	["header", "header"],
	["footer", "footer"],
	["main", "main"],
	["section", "section"],
	["aside", "aside"],
	["article", "article"],
	["form", "form"],
	["ul", "list"],
	["ol", "list"],
	["li", "item"],
	["table", "table"],
	["tr", "row"],
	["td", "cell"],
	["th", "cell"],
	["label", "label"],
	["button", "button"],
	["a", "link"],
	["input", "input"],
	["textarea", "textarea"],
	["select", "select"],
	["h1", "heading"],
	["h2", "heading"],
	["h3", "heading"],
	["h4", "heading"],
	["h5", "heading"],
	["h6", "heading"],
	["p", "paragraph"],
	["img", "image"],
	["hr", "divider"],
	["figure", "figure"],
	["blockquote", "quote"],
	["dialog", "dialog"],
]);

const LABELED = new Set(["button", "link", "heading", "item", "label"]);

const JUSTIFY = new Map<string, Layout["justify"]>([
	["center", "CENTER"],
	["flex-end", "MAX"],
	["end", "MAX"],
	["right", "MAX"],
	["space-between", "SPACE_BETWEEN"],
]);

const ALIGN = new Map<string, Layout["align"]>([
	["center", "CENTER"],
	["flex-end", "MAX"],
	["end", "MAX"],
	["self-end", "MAX"],
	["baseline", "BASELINE"],
	["first baseline", "BASELINE"],
]);

const TEXT_ALIGN = new Map([
	["center", "CENTER"],
	["right", "RIGHT"],
	["end", "RIGHT"],
	["justify", "JUSTIFIED"],
]);

const TEXT_CASE = new Map([
	["uppercase", "UPPER"],
	["lowercase", "LOWER"],
	["capitalize", "TITLE"],
]);

const PLACEHOLDER: Rgba = { r: 228, g: 228, b: 231, a: 1 };

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

const px = (value: string | undefined) => parseFloat(value ?? "") || 0;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

const end = (box: CapturedBox, axis: Axis) => (axis === "x" ? box.x + box.width : box.y + box.height);

const size = (box: CapturedBox, axis: Axis) => (axis === "x" ? box.width : box.height);

const figmaColor = ({ r, g, b }: Rgba) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });

const solid = (color: Rgba): FigmaPaint => ({
	type: "SOLID",
	color: figmaColor(color),
	opacity: color.a,
	visible: true,
	blendMode: "NORMAL",
});

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function insetsOf(styles: CssValues, prefix: string, suffix = ""): Insets {
	return {
		top: px(styles[`${prefix}top${suffix}`]),
		right: px(styles[`${prefix}right${suffix}`]),
		bottom: px(styles[`${prefix}bottom${suffix}`]),
		left: px(styles[`${prefix}left${suffix}`]),
	};
}

const borderOf = (styles: CssValues) => insetsOf(styles, "border-", "-width");

function paddingOf(styles: CssValues): Insets {
	const padding = insetsOf(styles, "padding-");
	const border = borderOf(styles);

	return {
		top: padding.top + border.top,
		right: padding.right + border.right,
		bottom: padding.bottom + border.bottom,
		left: padding.left + border.left,
	};
}

const clips = (styles: CssValues) =>
	[styles["overflow-x"], styles["overflow-y"]].some((value) => !!value && value !== "visible");

function hasVisuals(node: CapturedNode) {
	const { styles } = node;
	const background = parseColor(styles["background-color"] ?? "");
	const padding = insetsOf(styles, "padding-");
	const border = borderOf(styles);

	return (
		(!!background && background.a > 0) ||
		!!styles["background-image"] ||
		!!styles["box-shadow"] ||
		SIDES.some((side) => padding[side] > 0 || border[side] > 0) ||
		px(styles.opacity || "1") < 1 ||
		clips(styles)
	);
}

const isPositioned = (node: CapturedNode) => node.styles.position === "absolute" || node.styles.position === "fixed";

function isInlineText(node: CapturedNode): boolean {
	if (node.tag === TEXT_TAG || node.tag === "br") return true;

	if ((node.styles.display ?? "inline") !== "inline" || node.tag === "svg" || node.tag === "img") return false;

	return !isPositioned(node) && !hasVisuals(node) && node.children.every(isInlineText);
}

function textOf(node: CapturedNode): string {
	if (node.tag === TEXT_TAG) return node.text ?? "";

	return node.children.map(textOf).join(" ");
}

function inheritedOf(node: CapturedNode, parent: Inherited): Inherited {
	const own = Object.entries(node.styles).filter(([property]) => INHERITED.has(property));

	return own.length ? { ...parent, ...Object.fromEntries(own) } : parent;
}

function fontFamily(value: string) {
	const families = splitTopLevel(value).map((family) => family.replace(/^["']|["']$/g, "").trim());
	const named = families.find((family) => family && !GENERIC_FONTS.has(family.toLowerCase()));

	if (named) return named;
	const generic = families[0]?.toLowerCase() ?? "";

	return /mono/.test(generic) ? "Roboto Mono" : /serif/.test(generic) && !/sans/.test(generic) ? "Noto Serif" : "Inter";
}

function fontStyle(weight: string, italic: boolean) {
	const rounded = Math.min(900, Math.max(100, Math.round((Number(weight) || 400) / 100) * 100));
	const name = WEIGHT_STYLES.get(rounded) ?? "Regular";

	if (!italic) return name;

	return name === "Regular" ? "Italic" : `${name} Italic`;
}

type TextStyle = {
	family: string;
	style: string;
	size: number;
	color: Rgba;
	decoration: string;
	letterSpacing: number;
	lineHeight: number | null;
};

function textStyleOf(inherited: Inherited, decoration: string): TextStyle {
	const lineHeight = inherited["line-height"] ?? "normal";

	return {
		family: fontFamily(inherited["font-family"] ?? ""),
		style: fontStyle(inherited["font-weight"] ?? "400", /italic|oblique/.test(inherited["font-style"] ?? "")),
		size: px(inherited["font-size"]) || 16,
		color: parseColor(inherited.color ?? "") ?? { r: 0, g: 0, b: 0, a: 1 },
		decoration,
		letterSpacing: px(inherited["letter-spacing"]),
		lineHeight: lineHeight === "normal" ? null : px(lineHeight),
	};
}

const decorationOf = (styles: CssValues, parent: string) => {
	const line = styles["text-decoration-line"] ?? "";

	return /underline/.test(line) ? "UNDERLINE" : /line-through/.test(line) ? "STRIKETHROUGH" : parent;
};

function styleFields(style: TextStyle): TextFields {
	return {
		fontName: { family: style.family, style: style.style, postscript: "" },
		fontSize: style.size,
		fillPaints: [solid(style.color)],
		textDecoration: style.decoration,
		letterSpacing: { value: style.letterSpacing, units: "PIXELS" },
		lineHeight:
			style.lineHeight === null ? { value: 100, units: "PERCENT" } : { value: style.lineHeight, units: "PIXELS" },
	};
}

function overrideOf(base: TextStyle, style: TextStyle, id: number): NodeFields {
	const fields = styleFields(style);
	const baseFields = styleFields(base);

	const changed = <T>(value: T, baseValue: T) =>
		JSON.stringify(value) === JSON.stringify(baseValue) ? undefined : value;

	return {
		styleID: id,
		fontName: changed(fields.fontName, baseFields.fontName),
		fontSize: changed(fields.fontSize, baseFields.fontSize),
		fillPaints: changed(fields.fillPaints, baseFields.fillPaints),
		textDecoration: changed(fields.textDecoration, baseFields.textDecoration),
		letterSpacing: changed(fields.letterSpacing, baseFields.letterSpacing),
		lineHeight: changed(fields.lineHeight, baseFields.lineHeight),
	};
}

type Run = { text: string; style: TextStyle };

function collectRuns(node: CapturedNode, inherited: Inherited, decoration: string, runs: Run[]) {
	if (node.tag === TEXT_TAG) {
		runs.push({ text: node.text ?? "", style: textStyleOf(inherited, decoration) });

		return;
	}

	if (node.tag === "br") {
		runs.push({ text: "\n", style: textStyleOf(inherited, decoration) });

		return;
	}

	const own = inheritedOf(node, inherited);
	const ownDecoration = decorationOf(node.styles, decoration);

	for (const child of node.children) collectRuns(child, own, ownDecoration, runs);
}

function joinRuns(runs: Run[], pre: boolean): Run[] {
	if (pre) return runs.filter((run) => run.text);
	const joined: Run[] = [];
	let previous = "\n";

	for (const run of runs) {
		let text = run.text;

		if (/[ \n]$/.test(previous)) text = text.replace(/^ +/, "");

		if (text === "\n" && joined.length) {
			const last = joined[joined.length - 1]!;

			last.text = last.text.replace(/ +$/, "");
		}

		if (!text) continue;
		joined.push({ text, style: run.style });
		previous = text;
	}

	const last = joined[joined.length - 1];

	if (last) last.text = last.text.replace(/[ ]+$/, "");

	return joined.filter((run) => run.text);
}

function unionBox(boxes: CapturedBox[]): CapturedBox | null {
	if (!boxes.length) return null;
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.width));
	const bottom = Math.max(...boxes.map((box) => box.y + box.height));

	return { x: left, y: top, width: right - left, height: bottom - top };
}

function textBoxes(node: CapturedNode, out: CapturedBox[]) {
	if (node.tag === TEXT_TAG && (node.text ?? "").trim() && (node.box.width || node.box.height)) out.push(node.box);

	for (const child of node.children) textBoxes(child, out);

	return out;
}

const sameStyle = (a: TextStyle, b: TextStyle) => JSON.stringify(a) === JSON.stringify(b);

type TextOptions = { box: CapturedBox; owner: CapturedNode | null; fits: boolean };

function textLayer(
	nodes: CapturedNode[],
	inherited: Inherited,
	decoration: string,
	options: TextOptions,
): Layer | null {
	const pre = (inherited["white-space"] ?? "").startsWith("pre");
	const raw: Run[] = [];

	for (const node of nodes) collectRuns(node, inherited, decoration, raw);
	const runs = joinRuns(raw, pre);

	if (!runs.length) return null;
	const base = textStyleOf(inherited, decoration);
	const styles: TextStyle[] = [];
	const ids: number[] = [];
	let characters = "";

	for (const run of runs) {
		let id = 0;

		if (!sameStyle(run.style, base)) {
			const index = styles.findIndex((style) => sameStyle(style, run.style));

			id = index >= 0 ? index + 1 : styles.push(run.style);
		}

		characters += run.text;

		for (let i = 0; i < run.text.length; i++) ids.push(id);
	}

	const { box, owner } = options;
	const lineHeight = base.lineHeight ?? base.size * 1.2;
	const lines = Math.max(1, Math.round(box.height / lineHeight));
	const ownerStyles = owner?.styles ?? {};
	const clamp = Number(ownerStyles["-webkit-line-clamp"]);
	const ellipsis = ownerStyles["text-overflow"] === "ellipsis";
	const hug = lines === 1 && options.fits && !characters.includes("\n");

	const props: NodeFields = {
		...styleFields(base),
		textAlignHorizontal: TEXT_ALIGN.get(inherited["text-align"] ?? "") ?? "LEFT",
		textAlignVertical: "TOP",
		textAutoResize: hug ? "WIDTH_AND_HEIGHT" : "HEIGHT",
		textCase: TEXT_CASE.get(inherited["text-transform"] ?? "") ?? "ORIGINAL",
		textData: {
			characters,
			characterStyleIDs: styles.length ? ids : undefined,
			styleOverrideTable: styles.length ? styles.map((style, i) => overrideOf(base, style, i + 1)) : undefined,
		},
	};

	if (clamp > 0) {
		props.textTruncation = "ENDING";
		props.maxLines = clamp;
	} else if (ellipsis) {
		props.textTruncation = "ENDING";
		props.maxLines = 1;
		props.textAutoResize = "NONE";
	}

	return {
		type: "TEXT",
		name: shorten(clean(characters), 60) || "Text",
		box,
		props,
		children: [],
		positioned: null,
	};
}

function radiiOf(styles: CssValues, box: CapturedBox): NodeFields {
	const limit = Math.min(box.width, box.height) / 2;

	const corner = (value: string | undefined) => {
		const first = (value ?? "").split(/\s+/)[0] ?? "";
		const radius = first.endsWith("%") ? (parseFloat(first) / 100) * Math.min(box.width, box.height) : px(first);

		return Math.round(Math.min(limit, Math.max(0, radius)) * 100) / 100;
	};

	const [topLeft, topRight, bottomRight, bottomLeft] = [
		corner(styles["border-top-left-radius"]),
		corner(styles["border-top-right-radius"]),
		corner(styles["border-bottom-right-radius"]),
		corner(styles["border-bottom-left-radius"]),
	];

	if (topLeft === topRight && topLeft === bottomRight && topLeft === bottomLeft)
		return topLeft ? { cornerRadius: topLeft } : {};

	return {
		cornerRadius: Math.max(topLeft, topRight, bottomRight, bottomLeft),
		rectangleTopLeftCornerRadius: topLeft,
		rectangleTopRightCornerRadius: topRight,
		rectangleBottomRightCornerRadius: bottomRight,
		rectangleBottomLeftCornerRadius: bottomLeft,
		rectangleCornerRadiiIndependent: true,
	};
}

function strokesOf(styles: CssValues): NodeFields {
	const border = borderOf(styles);
	const drawn = SIDES.filter((side) => border[side] > 0 && styles[`border-${side}-style`] !== "none");

	if (!drawn.length) return {};
	const color = parseColor(styles[`border-${drawn[0]}-color`] ?? "");

	if (!color || color.a === 0) return {};
	const weights = SIDES.map((side) => (drawn.includes(side) ? border[side] : 0));
	const uniform = weights.every((weight) => weight === weights[0]);

	const strokes: NodeFields = {
		strokePaints: [solid(color)],
		strokeAlign: "INSIDE",
		strokeWeight: Math.max(...weights),
	};

	if (!uniform) {
		strokes.borderStrokeWeightsIndependent = true;
		strokes.borderTopWeight = weights[0];
		strokes.borderRightWeight = weights[1];
		strokes.borderBottomWeight = weights[2];
		strokes.borderLeftWeight = weights[3];
	}

	return strokes;
}

function effectsOf(styles: CssValues): FigmaEffect[] {
	return parseBoxShadow(styles["box-shadow"] ?? "")
		.reverse()
		.map((shadow) => ({
			type: shadow.inset ? "INNER_SHADOW" : "DROP_SHADOW",
			color: { ...figmaColor(shadow.color), a: shadow.color.a },
			offset: { x: shadow.offsetX, y: shadow.offsetY },
			radius: shadow.blur,
			spread: shadow.spread,
			visible: true,
			blendMode: "NORMAL",
			showShadowBehindNode: false,
		}));
}

function gradientPaint(value: string, box: CapturedBox): FigmaPaint | null {
	const paint = parseLinearGradient(value, { x: 0, y: 0, width: box.width, height: box.height });

	if (!paint) return null;

	if (paint.kind === "color") return solid(paint.color);
	const vx = paint.x2 - paint.x1;
	const vy = paint.y2 - paint.y1;
	const length = vx * vx + vy * vy;

	if (!length || !box.width || !box.height) return null;
	const [w, h] = [box.width, box.height];

	return {
		type: "GRADIENT_LINEAR",
		opacity: 1,
		visible: true,
		blendMode: "NORMAL",
		stops: paint.stops.map((stop) => ({
			color: { ...figmaColor(stop.color), a: stop.color.a },
			position: stop.offset,
		})),
		transform: {
			m00: (w * vx) / length,
			m01: (h * vy) / length,
			m02: -(paint.x1 * vx + paint.y1 * vy) / length,
			m10: (-w * vy) / length,
			m11: (h * vx) / length,
			m12: 0.5 - (-paint.x1 * vy + paint.y1 * vx) / length,
		},
	};
}

const SCALE_MODES = new Map([
	["cover", "FILL"],
	["contain", "FIT"],
	["scale-down", "FIT"],
	["none", "FIT"],
	["fill", "STRETCH"],
]);

function imagePaint(context: Context, key: string, mode: string): FigmaPaint {
	const image = context.images.get(key);

	if (!image) return solid(PLACEHOLDER);
	let blob = context.imageBlobs.get(key);

	if (blob === undefined) {
		blob = context.blobs.push(image.bytes) - 1;
		context.imageBlobs.set(key, blob);
	}

	return {
		type: "IMAGE",
		opacity: 1,
		visible: true,
		blendMode: "NORMAL",
		transform: IDENTITY,
		image: { hash: image.hash, name: "Image", dataBlob: blob },
		imageScaleMode: mode,
		originalImageWidth: image.width,
		originalImageHeight: image.height,
	};
}

function fillsOf(context: Context, node: CapturedNode): FigmaPaint[] {
	const { styles } = node;
	const fills: FigmaPaint[] = [];
	const background = parseColor(styles["background-color"] ?? "");

	if (background && background.a > 0) fills.push(solid(background));
	const layers = splitTopLevel(styles["background-image"] ?? "").reverse();
	const fit = SCALE_MODES.get(styles["background-size"] ?? "") ?? "FILL";

	for (const layer of layers) {
		const url = /^url\(["']?([^"')]+)["']?\)$/.exec(layer)?.[1];
		const paint = url ? imagePaint(context, url, fit) : gradientPaint(layer, node.box);

		if (paint) fills.push(paint);
	}

	if (node.tag === "img")
		fills.push(
			imagePaint(context, node.attrs?.src ?? "", SCALE_MODES.get(styles["object-fit"] ?? "fill") ?? "STRETCH"),
		);

	return fills;
}

function constraintsOf(styles: CssValues) {
	const set = (side: Side) => !!styles[side] && styles[side] !== "auto";

	const axis = (start: Side, finish: Side) =>
		set(start) && set(finish) ? "STRETCH" : set(finish) && !set(start) ? "MAX" : "MIN";

	return { horizontal: axis("left", "right"), vertical: axis("top", "bottom") };
}

function layoutName(node: CapturedNode) {
	const display = node.styles.display ?? "";

	if (/flex/.test(display)) return (node.styles["flex-direction"] ?? "row").startsWith("column") ? "Column" : "Row";

	if (/grid/.test(display)) return "Grid";

	return "Box";
}

function nameOf(node: CapturedNode) {
	if (node.name) return node.name;
	const label = node.attrs?.["aria-label"] ?? node.attrs?.alt ?? node.attrs?.title;
	const role = node.attrs?.role;
	const tag = TAG_NAMES.get(node.tag) ?? (role && /^[a-z]+$/.test(role) ? role : null);
	const text = shorten(clean(label ?? textOf(node)), 40);

	if (tag && LABELED.has(tag) && text) return `${tag} "${text}"`;

	if (tag) return label ? `${tag} "${shorten(clean(label), 40)}"` : tag;

	return label ? shorten(clean(label), 40) : layoutName(node);
}

function contentBox(box: CapturedBox, padding: Insets): CapturedBox {
	return {
		x: box.x + padding.left,
		y: box.y + padding.top,
		width: Math.max(0, box.width - padding.left - padding.right),
		height: Math.max(0, box.height - padding.top - padding.bottom),
	};
}

function vectorLayer(node: CapturedNode, inherited: Inherited, context: Context): Layer | null {
	const outlines = svgVectors(node, inherited.color ?? "");

	if (!outlines.length) return null;

	const vectors = outlines.map((vector): Layer => {
		const network = context.blobs.push(vector.network) - 1;
		const geometry = vector.geometry ? context.blobs.push(vector.geometry) - 1 : null;
		const { style } = vector;

		const props: NodeFields = {
			vectorData: { vectorNetworkBlob: network, normalizedSize: { x: node.box.width, y: node.box.height } },
			fillPaints: style.fill ? [solid(style.fill)] : [],
			strokePaints: style.stroke ? [solid(style.stroke)] : [],
			strokeWeight: style.strokeWidth,
			strokeAlign: "CENTER",
			strokeCap: style.cap === "round" ? "ROUND" : style.cap === "square" ? "SQUARE" : "NONE",
			strokeJoin: style.join === "round" ? "ROUND" : style.join === "bevel" ? "BEVEL" : "MITER",
		};

		if (geometry !== null)
			props.fillGeometry = [{ windingRule: style.evenOdd ? "ODD" : "NONZERO", commandsBlob: geometry, styleID: 0 }];

		return { type: "VECTOR", name: "Vector", box: node.box, props, children: [], positioned: null };
	});

	const name = node.name ?? node.attrs?.["aria-label"] ?? "Icon";

	if (vectors.length === 1) return { ...vectors[0]!, name, component: !!node.name };

	return {
		type: "FRAME",
		name,
		box: node.box,
		props: { fillPaints: [], frameMaskDisabled: true },
		children: vectors,
		positioned: null,
		component: !!node.name,
	};
}

function inputText(node: CapturedNode, inherited: Inherited): Layer | null {
	const value = node.attrs?.value ?? "";
	const placeholder = node.attrs?.placeholder ?? "";
	const text = value || placeholder;

	if (!text || node.attrs?.type === "checkbox" || node.attrs?.type === "radio") return null;
	const content = contentBox(node.box, paddingOf(node.styles));
	const style = textStyleOf(inherited, "NONE");
	const height = Math.min(content.height, style.lineHeight ?? style.size * 1.2);
	const box = { x: content.x, y: content.y + (content.height - height) / 2, width: content.width, height };

	const layer = textLayer([{ tag: TEXT_TAG, text, box, styles: {}, children: [] }], inherited, "NONE", {
		box,
		owner: null,
		fits: false,
	});

	if (layer && !value) {
		const color = { ...style.color, a: style.color.a * 0.5 };

		layer.props.fillPaints = [solid(color)];
	}

	return layer;
}

type Item = { layer: Layer; node: CapturedNode | null };

function frameProps(context: Context, node: CapturedNode, root: boolean): NodeFields {
	const opacity = px(node.styles.opacity || "1");

	return {
		fillPaints: fillsOf(context, node),
		...strokesOf(node.styles),
		...radiiOf(node.styles, node.box),
		effects: effectsOf(node.styles),
		frameMaskDisabled: !(root || clips(node.styles)),
		opacity: opacity < 1 ? opacity : undefined,
	};
}

function elementLayer(node: CapturedNode, parentInherited: Inherited, context: Context, root = false): Layer | null {
	const inherited = inheritedOf(node, parentInherited);
	const positioned = isPositioned(node) ? constraintsOf(node.styles) : null;
	const decorated = decorationOf(node.styles, "NONE");
	let layer: Layer | null;

	if (node.tag === "svg") layer = vectorLayer(node, inherited, context);
	else if (node.tag === "img") {
		layer = {
			type: "RECTANGLE",
			name: nameOf(node),
			box: node.box,
			props: { ...frameProps(context, node, false), frameMaskDisabled: undefined },
			children: [],
			positioned: null,
		};
	} else {
		const textOnly = node.children.length > 0 && node.children.every(isInlineText);
		const display = node.styles.display ?? "block";
		const container = /flex|grid/.test(display);

		const truncated = node.styles["text-overflow"] === "ellipsis" || Number(node.styles["-webkit-line-clamp"]) > 0;
		const unclipped = truncated ? { ...node, styles: { ...node.styles, "overflow-x": "", "overflow-y": "" } } : node;

		if (textOnly && !root && !hasVisuals(unclipped) && !container) {
			const text = unionBox(textBoxes(node, []));
			const fits = !!text && near(text.width, node.box.width);
			const style = textStyleOf(inherited, decorated);
			const lineHeight = style.lineHeight ?? style.size * 1.2;
			const lines = Math.max(1, Math.round(node.box.height / lineHeight));
			const slack = style.lineHeight === null ? lines * lineHeight * 0.15 : 0;
			const fixedHeight = Math.abs(node.box.height - lines * lineHeight) > Math.max(TOLERANCE, slack);

			layer = textLayer(node.children, inherited, decorated, { box: node.box, owner: node, fits });

			if (layer && fixedHeight && text) {
				layer.props.textAutoResize = "NONE";
				const middle = text.y + text.height / 2 - (node.box.y + node.box.height / 2);

				layer.props.textAlignVertical =
					Math.abs(middle) <= TOLERANCE ? "CENTER" : text.y - node.box.y > TOLERANCE ? "BOTTOM" : "TOP";
			}
		} else {
			layer = frameLayer(node, inherited, decorated, context, root);
		}
	}

	if (!layer) return null;
	layer.positioned = positioned;
	layer.margin = insetsOf(node.styles, "margin-");
	layer.alignSelf = node.styles["align-self"];
	layer.grow = px(node.styles["flex-grow"]) > 0;

	return layer;
}

function childItems(node: CapturedNode, inherited: Inherited, decoration: string, context: Context): Item[] {
	const items: Item[] = [];
	let run: CapturedNode[] = [];

	const flush = () => {
		const box = unionBox(run.flatMap((child) => textBoxes(child, [])));

		if (box) {
			const layer = textLayer(run, inherited, decoration, { box, owner: node, fits: true });

			if (layer) items.push({ layer, node: null });
		}

		run = [];
	};

	for (const child of node.children) {
		if (isInlineText(child)) {
			run.push(child);
			continue;
		}

		flush();
		const layer = elementLayer(child, inherited, context);

		if (layer) items.push({ layer, node: child });
	}

	flush();

	return items;
}

function frameLayer(
	node: CapturedNode,
	inherited: Inherited,
	decoration: string,
	context: Context,
	root: boolean,
): Layer | null {
	const items =
		node.tag === "input" || node.tag === "textarea" || node.tag === "select"
			? []
			: childItems(node, inherited, decoration, context);

	if (node.tag === "input" || node.tag === "textarea" || node.tag === "select") {
		const text = inputText(node, inherited);

		if (text) items.push({ layer: text, node: null });
	}

	const flow = items.filter((item) => !item.layer.positioned);
	const solo = flow[0];

	if (!root && !hasVisuals(node) && !isPositioned(node) && items.length === 1 && solo && !solo.layer.positioned) {
		const { box } = solo.layer;

		if (
			near(box.x, node.box.x) &&
			near(box.y, node.box.y) &&
			near(box.width, node.box.width) &&
			near(box.height, node.box.height)
		) {
			if (node.name && !solo.layer.component && solo.layer.type !== "TEXT") {
				solo.layer.name = node.name;
				solo.layer.component = true;
			}

			return solo.layer;
		}
	}

	const layer: Layer = {
		type: "FRAME",
		name: nameOf(node),
		box: node.box,
		props: frameProps(context, node, root),
		children: items.map((item) => item.layer),
		positioned: null,
		component: !!node.name,
	};

	const toggle = node.tag === "input" && (node.attrs?.type === "checkbox" || node.attrs?.type === "radio");

	if (toggle && !hasVisuals(node)) {
		const checked = node.attrs?.checked === "true";
		const ink = { r: 23, g: 23, b: 23, a: 1 };

		layer.props.strokePaints = [solid({ r: 163, g: 163, b: 163, a: 1 })];
		layer.props.strokeWeight = 1;
		layer.props.strokeAlign = "INSIDE";
		layer.props.cornerRadius = node.attrs?.type === "radio" ? node.box.width / 2 : 3;

		if (checked) layer.props.fillPaints = [solid(ink)];
	}

	const flowLayers = flow.map((item) => item.layer);
	const layout = flowLayers.length ? layoutOf(node, flowLayers) : null;

	if (layout) applyLayout(layer, layout, flowLayers);
	else if (flow.length) context.fixed++;

	return layer;
}

const gapOf = (value: string | undefined) => (value && value !== "normal" ? px(value) : 0);

function flexLayout(node: CapturedNode, children: Layer[]): Layout {
	const direction = node.styles["flex-direction"] ?? "row";
	const row = direction.startsWith("row");
	const padding = paddingOf(node.styles);
	const [primary, counter]: [Axis, Axis] = row ? ["x", "y"] : ["y", "x"];
	const content = contentBox(node.box, padding);
	const alignItems = node.styles["align-items"] ?? "normal";
	const stretchAll = alignItems === "normal" || alignItems === "stretch";
	let justify = JUSTIFY.get(node.styles["justify-content"] ?? "") ?? "MIN";
	const spread = node.styles["justify-content"] === "space-around" || node.styles["justify-content"] === "space-evenly";
	const first = children[0]!;
	const last = children[children.length - 1]!;

	if (spread) {
		const [startSide, endSide]: [Side, Side] = row ? ["left", "right"] : ["top", "bottom"];

		padding[startSide] += first.box[primary] - content[primary];
		padding[endSide] += end(content, primary) - end(last.box, primary);
		justify = children.length > 1 ? "SPACE_BETWEEN" : "CENTER";
	}

	const availCounter = size(content, counter);

	return {
		mode: row ? "HORIZONTAL" : "VERTICAL",
		spacing: gapOf(node.styles[row ? "column-gap" : "row-gap"]),
		counterSpacing: gapOf(node.styles[row ? "row-gap" : "column-gap"]),
		wrap: (node.styles["flex-wrap"] ?? "nowrap").startsWith("wrap"),
		padding,
		justify,
		align: stretchAll ? "MIN" : (ALIGN.get(alignItems) ?? "MIN"),
		primaryHug: false,
		counterHug: false,
		grow: children.map((child) => !!child.grow),
		stretch: children.map(
			(child) => (stretchAll || child.alignSelf === "stretch") && near(size(child.box, counter), availCounter),
		),
	};
}

function blockLayout(node: CapturedNode, children: Layer[]): Layout | null {
	const padding = paddingOf(node.styles);
	const content = contentBox(node.box, padding);
	const gaps: number[] = [];

	for (let i = 1; i < children.length; i++) {
		const gap = children[i]!.box.y - end(children[i - 1]!.box, "y");

		if (gap < -TOLERANCE) return null;
		gaps.push(gap);
	}

	const spacing = gaps[0] ?? 0;

	if (gaps.some((gap) => !near(gap, spacing))) return null;
	const fills = children.map((child) => near(child.box.width, content.width) && near(child.box.x, content.x));
	const alignments = new Set<Layout["align"]>();

	children.forEach((child, i) => {
		if (fills[i]) return;

		if (near(child.box.x, content.x)) alignments.add("MIN");
		else if (near(child.box.x + child.box.width / 2, content.x + content.width / 2)) alignments.add("CENTER");
		else if (near(end(child.box, "x"), end(content, "x"))) alignments.add("MAX");
		else alignments.add("BASELINE");
	});

	if (alignments.size > 1 || alignments.has("BASELINE")) return null;
	const first = children[0]!;
	const last = children[children.length - 1]!;
	const bottom = end(node.box, "y") - end(last.box, "y");
	const lastMargin = last.margin?.bottom ?? 0;

	padding.top = first.box.y - node.box.y;

	if (bottom <= padding.bottom + Math.max(0, lastMargin) + TOLERANCE) padding.bottom = Math.max(0, bottom);

	return {
		mode: "VERTICAL",
		spacing: Math.max(0, Math.round(spacing * 100) / 100),
		counterSpacing: 0,
		wrap: false,
		padding,
		justify: "MIN",
		align: [...alignments][0] ?? "MIN",
		primaryHug: false,
		counterHug: false,
		grow: children.map(() => false),
		stretch: fills,
	};
}

function gridLayout(node: CapturedNode, children: Layer[]): Layout | null {
	const tracks = (node.styles["grid-template-columns"] ?? "")
		.split(/\s+/)
		.flatMap((track) => (track ? [px(track)] : []));

	const padding = paddingOf(node.styles);
	const content = contentBox(node.box, padding);
	const rowGap = gapOf(node.styles["row-gap"]);
	const columnGap = gapOf(node.styles["column-gap"]);

	if (!tracks.length) return null;

	if (tracks.some((track) => !near(track, tracks[0]!))) {
		const oneRow = children.length <= tracks.length && children.every((child, i) => near(child.box.width, tracks[i]!));
		const alignItems = node.styles["align-items"] ?? "normal";
		const stretchAll = alignItems === "normal" || alignItems === "stretch";

		if (!oneRow) return null;

		return {
			mode: "HORIZONTAL",
			spacing: columnGap,
			counterSpacing: 0,
			wrap: false,
			padding,
			justify: "MIN",
			align: stretchAll ? "MIN" : (ALIGN.get(alignItems) ?? "MIN"),
			primaryHug: false,
			counterHug: false,
			grow: children.map(() => false),
			stretch: children.map((child) => stretchAll && near(child.box.height, content.height)),
		};
	}

	if (children.some((child) => !near(child.box.width, tracks[0]!))) return null;
	const single = tracks.length === 1;

	return {
		mode: single ? "VERTICAL" : "HORIZONTAL",
		spacing: single ? rowGap : columnGap,
		counterSpacing: single ? 0 : rowGap,
		wrap: !single,
		padding,
		justify: "MIN",
		align: "MIN",
		primaryHug: false,
		counterHug: false,
		grow: children.map(() => false),
		stretch: children.map((child) => single && near(child.box.width, content.width)),
	};
}

type Placed = { x: number; y: number; width: number; height: number };

function simulate(layout: Layout, frame: CapturedBox, children: Layer[]): (Placed | null)[] {
	const row = layout.mode === "HORIZONTAL";
	const [primary, counter]: [Axis, Axis] = row ? ["x", "y"] : ["y", "x"];
	const { padding } = layout;
	const padStart = row ? padding.left : padding.top;
	const padEnd = row ? padding.right : padding.bottom;
	const counterStart = row ? padding.top : padding.left;
	const counterEnd = row ? padding.bottom : padding.right;
	const avail = size(frame, primary) - padStart - padEnd;
	const availCounter = size(frame, counter) - counterStart - counterEnd;
	const lines: number[][] = [];
	let cursor = 0;

	children.forEach((child, i) => {
		const extent = size(child.box, primary);
		const line = lines[lines.length - 1];

		if (!line || (layout.wrap && line.length && cursor + extent > avail + TOLERANCE)) {
			lines.push([i]);
			cursor = extent + layout.spacing;
		} else {
			line.push(i);
			cursor += extent + layout.spacing;
		}
	});

	const placed: (Placed | null)[] = children.map(() => null);
	let lineStart = counterStart;

	for (const line of lines) {
		const sizes = line.map((i) => size(children[i]!.box, primary));
		const total = sizes.reduce((sum, value) => sum + value, 0);
		const lineCounter = Math.max(...line.map((i) => size(children[i]!.box, counter)));
		const counterRoom = layout.wrap ? lineCounter : availCounter;
		let spacing = layout.spacing;
		let at = padStart;

		if (layout.justify === "SPACE_BETWEEN" && line.length > 1) spacing = (avail - total) / (line.length - 1);
		else if (layout.justify === "CENTER") at += (avail - total - spacing * (line.length - 1)) / 2;
		else if (layout.justify === "MAX") at += avail - total - spacing * (line.length - 1);

		for (const i of line) {
			const child = children[i]!;
			const extent = size(child.box, primary);
			const cross = size(child.box, counter);
			let offset = lineStart;

			if (layout.stretch[i]) offset = lineStart;
			else if (layout.align === "CENTER") offset += (counterRoom - cross) / 2;
			else if (layout.align === "MAX") offset += counterRoom - cross;

			const position = layout.align === "BASELINE" && !layout.stretch[i] ? null : offset;

			placed[i] =
				position === null
					? null
					: row
						? { x: at, y: position, width: extent, height: cross }
						: { x: position, y: at, width: cross, height: extent };
			at = end(child.box, primary) - frame[primary] + spacing;
		}

		lineStart = Math.max(...line.map((i) => end(children[i]!.box, counter) - frame[counter])) + layout.counterSpacing;
	}

	return placed;
}

function fits(layout: Layout, frame: CapturedBox, children: Layer[]) {
	const placed = simulate(layout, frame, children);

	return children.every((child, i) => {
		const at = placed[i];

		if (!at) return true;

		return near(child.box.x - frame.x, at.x) && near(child.box.y - frame.y, at.y);
	});
}

function hugs(layout: Layout, frame: CapturedBox, children: Layer[]) {
	const row = layout.mode === "HORIZONTAL";
	const [primary, counter]: [Axis, Axis] = row ? ["x", "y"] : ["y", "x"];
	const { padding } = layout;
	const pads = (axis: Axis) => (axis === "x" ? padding.left + padding.right : padding.top + padding.bottom);
	const spacing = layout.justify === "SPACE_BETWEEN" ? null : layout.spacing;
	const right = Math.max(...children.map((child) => end(child.box, primary) - frame[primary]));
	const bottom = Math.max(...children.map((child) => end(child.box, counter) - frame[counter]));

	const total =
		children.reduce((sum, child) => sum + size(child.box, primary), 0) + (spacing ?? 0) * (children.length - 1);

	const primaryHug =
		!layout.wrap &&
		spacing !== null &&
		near(size(frame, primary), total + pads(primary)) &&
		near(right + (primary === "x" ? padding.right : padding.bottom), size(frame, primary));

	const counterHug = near(bottom + (counter === "x" ? padding.right : padding.bottom), size(frame, counter));

	return { primaryHug, counterHug };
}

function layoutOf(node: CapturedNode, children: Layer[]): Layout | null {
	const display = node.styles.display ?? "block";
	let layout: Layout | null;

	if (/flex/.test(display)) {
		layout = flexLayout(node, children);

		if ((node.styles["flex-direction"] ?? "").endsWith("-reverse")) children.reverse();
	} else if (/grid/.test(display)) layout = gridLayout(node, children);
	else if (/^(block|list-item|flow-root|inline-block|table-cell)$/.test(display)) layout = blockLayout(node, children);
	else layout = null;

	if (!layout || !fits(layout, node.box, children)) return null;

	return { ...layout, ...hugs(layout, node.box, children) };
}

function applyLayout(layer: Layer, layout: Layout, children: Layer[]) {
	const { padding } = layout;
	const row = layout.mode === "HORIZONTAL";
	const round = (value: number) => Math.round(value * 100) / 100;

	Object.assign(layer.props, {
		stackMode: layout.mode,
		stackSpacing: round(layout.spacing),
		stackCounterSpacing: layout.wrap ? round(layout.counterSpacing) : undefined,
		stackWrap: layout.wrap ? "WRAP" : "NO_WRAP",
		stackHorizontalPadding: round(padding.left),
		stackVerticalPadding: round(padding.top),
		stackPaddingRight: round(padding.right),
		stackPaddingBottom: round(padding.bottom),
		stackPrimaryAlignItems: layout.justify,
		stackCounterAlignItems: layout.align,
		stackPrimarySizing: layout.primaryHug ? "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE" : "FIXED",
		stackCounterSizing: layout.counterHug ? "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE" : "FIXED",
	});

	const ordered = [...children, ...layer.children.filter((child) => child.positioned)];

	layer.children = ordered;
	children.forEach((child, i) => {
		const grow = layout.grow[i] ?? false;
		const stretch = layout.stretch[i] ?? false;

		if (grow) child.props.stackChildPrimaryGrow = 1;

		if (stretch) child.props.stackChildAlignSelf = "STRETCH";
		const fillsWidth = row ? grow : stretch;

		if (fillsWidth && child.type === "TEXT" && child.props.textAutoResize === "WIDTH_AND_HEIGHT")
			child.props.textAutoResize = "HEIGHT";

		if (child.props.stackMode) {
			const fillsPrimary = (child.props.stackMode === "HORIZONTAL") === row ? grow : stretch;
			const fillsCounter = (child.props.stackMode === "HORIZONTAL") === row ? stretch : grow;

			if (fillsPrimary) child.props.stackPrimarySizing = "FIXED";

			if (fillsCounter) child.props.stackCounterSizing = "FIXED";
		}
	});
}

const position = (index: number) =>
	String.fromCharCode(34 + Math.floor(index / 90)) + String.fromCharCode(34 + (index % 90));

type Writer = { changes: NodeFields[]; next: number };

function writeLayer(
	writer: Writer,
	layer: Layer,
	parent: { guid: Guid; box: CapturedBox; autoLayout: boolean },
	index: number,
) {
	const guid = { sessionID: 1, localID: writer.next++ };

	const change: NodeFields = {
		guid,
		phase: "CREATED",
		parentIndex: { guid: parent.guid, position: position(index) },
		type: layer.type,
		name: layer.name,
		visible: true,
		opacity: 1,
		blendMode: "PASS_THROUGH",
		size: { x: layer.box.width, y: layer.box.height },
		transform: { ...IDENTITY, m02: layer.box.x - parent.box.x, m12: layer.box.y - parent.box.y },
		...layer.props,
	};

	if (layer.positioned) {
		change.horizontalConstraint = layer.positioned.horizontal;
		change.verticalConstraint = layer.positioned.vertical;

		if (parent.autoLayout) change.stackPositioning = "ABSOLUTE";
	}

	writer.changes.push(change);
	const autoLayout = !!layer.props.stackMode;

	layer.children.forEach((child, i) => writeLayer(writer, child, { guid, box: layer.box, autoLayout }, i));
}

const sameBox = (a: CapturedBox, b: CapturedBox) =>
	near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);

function screenLayer(root: Layer): Layer {
	const [only] = root.children;

	if (root.children.length !== 1 || !only || only.type !== "FRAME" || only.positioned || !sameBox(only.box, root.box))
		return root;

	return {
		...only,
		box: root.box,
		props: {
			...only.props,
			fillPaints: [...(root.props.fillPaints ?? []), ...(only.props.fillPaints ?? [])],
			frameMaskDisabled: false,
			stackChildAlignSelf: undefined,
			stackChildPrimaryGrow: undefined,
		},
	};
}

export function screensToFigma(screens: FigmaScreen[]): FigmaCopy {
	const document = { sessionID: 0, localID: 0 };
	const canvas = { sessionID: 0, localID: 1 };

	const writer: Writer = {
		changes: [
			{ guid: document, phase: "CREATED", type: "DOCUMENT", name: "Document", visible: true },
			{
				guid: canvas,
				phase: "CREATED",
				parentIndex: { guid: document, position: position(0) },
				type: "CANVAS",
				name: "Page 1",
				visible: true,
			},
		],
		next: 1,
	};

	const context: Context = { images: new Map(), imageBlobs: new Map(), blobs: [], fixed: 0 };

	screens.forEach((screen, i) => {
		context.images = screen.images;
		context.imageBlobs = new Map();
		const { root } = screen.tree;
		const inherited = { ...ROOT_INHERITED, ...root.styles };

		const captured = elementLayer(
			{ ...root, box: { ...root.box, width: screen.tree.width } },
			inherited,
			context,
			true,
		);

		if (!captured) return;
		const layer = screenLayer(captured);

		layer.name = screen.name;

		if (!Array.isArray(layer.props.fillPaints) || !layer.props.fillPaints.length)
			layer.props.fillPaints = [solid({ r: 255, g: 255, b: 255, a: 1 })];
		layer.positioned = null;
		writeLayer(
			writer,
			layer,
			{
				guid: canvas,
				box: { x: root.box.x - screen.x, y: root.box.y - screen.y, width: 0, height: 0 },
				autoLayout: false,
			},
			i,
		);
	});

	return { nodeChanges: writer.changes, blobs: context.blobs, fixed: context.fixed };
}
