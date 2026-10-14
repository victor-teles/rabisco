import { validateToken } from "../../context/tokens";
import { isFiniteNumber, isString } from "../../guards";
import { MAX_CAPTURED_NODES, TEXT_TAG, type CapturedNode, type CapturedTree } from "../captured-tree";
import { isKiwiList, isKiwiRecord, type KiwiRecord, type KiwiValue } from "./kiwi";

export type FigmaToken = { name: string; value: string };

export type FigmaImport = { screens: CapturedTree[]; tokens: FigmaToken[]; placeholders: number };

type Context = { variables: Map<string, string>; tokens: Map<string, string>; nodes: number; placeholders: number };

type Tree = { node: KiwiRecord; children: Tree[] };

const SCREEN_TYPES = new Set(["FRAME", "SYMBOL", "INSTANCE", "SECTION", "COMPONENT", "COMPONENT_SET"]);

const SKIPPED_TYPES = new Set([
	"DOCUMENT",
	"CANVAS",
	"VARIABLE",
	"VARIABLE_SET",
	"SLICE",
	"STICKY",
	"CONNECTOR",
	"WIDGET",
]);

const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON"]);

const SEMANTIC_TAGS: [RegExp, string][] = [
	[/^button\b/i, "button"],
	[/^(nav|navbar|navigation)\b/i, "nav"],
	[/^header\b/i, "header"],
	[/^footer\b/i, "footer"],
	[/^input\b/i, "label"],
];

const JUSTIFY = new Map([
	["MIN", "flex-start"],
	["CENTER", "center"],
	["MAX", "flex-end"],
	["SPACE_BETWEEN", "space-between"],
	["SPACE_EVENLY", "space-between"],
]);

const ALIGN = new Map([
	["MIN", "flex-start"],
	["CENTER", "center"],
	["MAX", "flex-end"],
	["BASELINE", "baseline"],
]);

const TEXT_ALIGN = new Map([
	["CENTER", "center"],
	["RIGHT", "right"],
	["JUSTIFIED", "justify"],
]);

const TEXT_CASE = new Map([
	["UPPER", "uppercase"],
	["LOWER", "lowercase"],
	["TITLE", "capitalize"],
]);

const DECORATION = new Map([
	["UNDERLINE", "underline"],
	["STRIKETHROUGH", "line-through"],
]);

const WEIGHTS: [RegExp, number][] = [
	[/thin|hairline/, 100],
	[/extra\s*light|ultra\s*light/, 200],
	[/light/, 300],
	[/medium/, 500],
	[/semi\s*bold|demi\s*bold/, 600],
	[/extra\s*bold|ultra\s*bold/, 800],
	[/black|heavy/, 900],
	[/bold/, 700],
];

const CORNERS = [
	["rectangleTopLeftCornerRadius", "border-top-left-radius", "RECTANGLE_TOP_LEFT_CORNER_RADIUS"],
	["rectangleTopRightCornerRadius", "border-top-right-radius", "RECTANGLE_TOP_RIGHT_CORNER_RADIUS"],
	["rectangleBottomRightCornerRadius", "border-bottom-right-radius", "RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS"],
	["rectangleBottomLeftCornerRadius", "border-bottom-left-radius", "RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS"],
] as const;

const SIDES = [
	["Top", "top"],
	["Right", "right"],
	["Bottom", "bottom"],
	["Left", "left"],
] as const;

type VariableBinding = { properties: string[]; namespace: string };

const VARIABLE_FIELDS = new Map<string, VariableBinding>([
	["STACK_SPACING", { properties: ["row-gap", "column-gap"], namespace: "spacing" }],
	["STACK_PADDING_LEFT", { properties: ["padding-left"], namespace: "spacing" }],
	["STACK_PADDING_TOP", { properties: ["padding-top"], namespace: "spacing" }],
	["STACK_PADDING_RIGHT", { properties: ["padding-right"], namespace: "spacing" }],
	["STACK_PADDING_BOTTOM", { properties: ["padding-bottom"], namespace: "spacing" }],
	["CORNER_RADIUS", { properties: CORNERS.map(([, property]) => property), namespace: "radius" }],
	...CORNERS.map(([, property, field]): [string, VariableBinding] => [
		field,
		{ properties: [property], namespace: "radius" },
	]),
	["FONT_SIZE", { properties: ["font-size"], namespace: "text" }],
]);

const num = (record: KiwiRecord | undefined, key: string) => {
	const value = record?.[key];

	return isFiniteNumber(value) ? value : undefined;
};

const str = (record: KiwiRecord | undefined, key: string) => {
	const value = record?.[key];

	return isString(value) ? value : undefined;
};

const rec = (record: KiwiRecord | undefined, key: string) => {
	const value = record?.[key];

	return isKiwiRecord(value) ? value : undefined;
};

const records = (value: KiwiValue | undefined): KiwiRecord[] => (isKiwiList(value) ? value.filter(isKiwiRecord) : []);

const guidKey = (guid: KiwiRecord | undefined) =>
	guid ? `${num(guid, "sessionID") ?? 0}:${num(guid, "localID") ?? 0}` : "";

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

function rgba(color: KiwiRecord | undefined, opacity = 1) {
	const alpha = Math.round((num(color, "a") ?? 1) * opacity * 1000) / 1000;
	const rgb = `${channel(num(color, "r") ?? 0)}, ${channel(num(color, "g") ?? 0)}, ${channel(num(color, "b") ?? 0)}`;

	return alpha >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`;
}

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const NAMESPACE_PREFIXES = new Map([
	["color", /^colou?rs?-/],
	["spacing", /^(spacing|space)-/],
	["radius", /^(radius|radii|corner-radius)-/],
	["text", /^(text|font-size)-/],
]);

const tokenName = (namespace: string, name: string) =>
	`${namespace}-${name.replace(NAMESPACE_PREFIXES.get(namespace) ?? /^$/, "") || name}`;

const isVisible = (record: KiwiRecord) => record.visible !== false;

function bindVariable(
	context: Context,
	node: CapturedNode,
	properties: string[],
	data: KiwiRecord | undefined,
	namespace: string,
) {
	const alias = rec(rec(data, "value"), "alias");
	const name = context.variables.get(guidKey(rec(alias, "guid"))) ?? context.variables.get(str(alias, "key") ?? "");

	if (!name || !slug(name)) return;
	const token = tokenName(namespace, slug(name));
	const value = node.styles[properties[0] ?? ""];

	if (value === undefined || validateToken(token, value)) return;

	for (const property of properties) {
		if (node.styles[property] === undefined) continue;
		node.tokens ??= {};
		node.tokens[property] = token;
	}

	if (!context.tokens.has(token)) context.tokens.set(token, value);
}

const firstVisible = (paints: KiwiRecord[]) => paints.find((paint) => isVisible(paint));

function gradient(paint: KiwiRecord) {
	const stops = records(paint.stops).map((stop) => {
		const position = Math.round((num(stop, "position") ?? 0) * 100);

		return `${rgba(rec(stop, "color"), num(paint, "opacity") ?? 1)} ${position}%`;
	});

	if (stops.length < 2) return null;
	const matrix = rec(paint, "transform");
	const a = num(matrix, "m00") ?? 1;
	const b = num(matrix, "m01") ?? 0;
	const c = num(matrix, "m10") ?? 0;
	const d = num(matrix, "m11") ?? 1;
	const det = a * d - b * c || 1;
	const dx = d / det;
	const dy = -c / det;
	const angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);

	return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

function applyFill(context: Context, node: CapturedNode, figma: KiwiRecord, property: string) {
	const paint = firstVisible(records(figma.fillPaints));

	if (!paint) return null;
	const type = str(paint, "type");

	if (type === "SOLID") {
		node.styles[property] = rgba(rec(paint, "color"), num(paint, "opacity") ?? 1);
		bindVariable(context, node, [property], rec(paint, "colorVar"), "color");
	} else if (type === "GRADIENT_LINEAR" && property === "background-color") {
		const image = gradient(paint);

		if (image) node.styles["background-image"] = image;
	}

	return type ?? null;
}

function applyStroke(context: Context, node: CapturedNode, figma: KiwiRecord) {
	const paint = firstVisible(records(figma.strokePaints));

	if (str(paint, "type") !== "SOLID" || !paint) return;
	const color = rgba(rec(paint, "color"), num(paint, "opacity") ?? 1);
	const weight = num(figma, "strokeWeight") ?? 1;
	const independent = figma.borderStrokeWeightsIndependent === true;
	const colors: string[] = [];

	for (const [side, css] of SIDES) {
		const sideWeight = independent ? (num(figma, `border${side}Weight`) ?? weight) : weight;

		if (sideWeight <= 0) continue;
		node.styles[`border-${css}-width`] = px(sideWeight);
		node.styles[`border-${css}-style`] = "solid";
		node.styles[`border-${css}-color`] = color;
		colors.push(`border-${css}-color`);
	}

	bindVariable(context, node, colors, rec(paint, "colorVar"), "color");
}

function applyCorners(node: CapturedNode, figma: KiwiRecord) {
	if (str(figma, "type") === "ELLIPSE") {
		for (const [, property] of CORNERS) node.styles[property] = "9999px";

		return;
	}

	const radius = num(figma, "cornerRadius") ?? 0;
	const independent = figma.rectangleCornerRadiiIndependent === true;

	for (const [key, property] of CORNERS) {
		const corner = independent ? (num(figma, key) ?? radius) : radius;

		if (corner > 0) node.styles[property] = px(corner);
	}
}

function applyEffects(node: CapturedNode, figma: KiwiRecord) {
	const shadows = records(figma.effects).flatMap((effect) => {
		const type = str(effect, "type");

		if (!isVisible(effect) || (type !== "DROP_SHADOW" && type !== "INNER_SHADOW")) return [];
		const offset = rec(effect, "offset");

		const parts = [
			px(num(offset, "x") ?? 0),
			px(num(offset, "y") ?? 0),
			px(num(effect, "radius") ?? 0),
			px(num(effect, "spread") ?? 0),
			rgba(rec(effect, "color")),
		].join(" ");

		return [type === "INNER_SHADOW" ? `inset ${parts}` : parts];
	});

	if (shadows.length) node.styles["box-shadow"] = shadows.join(", ");
}

function applyAutoLayout(node: CapturedNode, figma: KiwiRecord) {
	const mode = str(figma, "stackMode");

	if (mode !== "HORIZONTAL" && mode !== "VERTICAL") return false;
	const row = mode === "HORIZONTAL";
	const legacy = num(figma, "stackPadding") ?? 0;
	const left = num(figma, "stackHorizontalPadding") ?? legacy;
	const top = num(figma, "stackVerticalPadding") ?? legacy;

	const padding = {
		"padding-top": top,
		"padding-right": num(figma, "stackPaddingRight") ?? left,
		"padding-bottom": num(figma, "stackPaddingBottom") ?? top,
		"padding-left": left,
	};

	const justify = str(figma, "stackPrimaryAlignItems") ?? str(figma, "stackJustify") ?? "MIN";
	const align = str(figma, "stackCounterAlignItems") ?? str(figma, "stackCounterAlign") ?? "MIN";
	const spacing = num(figma, "stackSpacing") ?? 0;
	const wrap = str(figma, "stackWrap") === "WRAP";

	node.styles.display = "flex";
	node.styles["flex-direction"] = row ? "row" : "column";
	node.styles["justify-content"] = JUSTIFY.get(justify) ?? "flex-start";
	node.styles["align-items"] = ALIGN.get(align) ?? "flex-start";

	if (wrap) node.styles["flex-wrap"] = "wrap";

	if (spacing > 0 && justify !== "SPACE_BETWEEN") node.styles[row ? "column-gap" : "row-gap"] = px(spacing);
	const counter = num(figma, "stackCounterSpacing") ?? 0;

	if (wrap && counter > 0) node.styles[row ? "row-gap" : "column-gap"] = px(counter);

	for (const [property, value] of Object.entries(padding)) if (value > 0) node.styles[property] = px(value);

	return true;
}

function applyText(context: Context, node: CapturedNode, figma: KiwiRecord) {
	const font = rec(figma, "fontName");
	const family = str(font, "family");
	const style = (str(font, "style") ?? "").toLowerCase();
	const size = num(figma, "fontSize") ?? 16;
	const lineHeight = rec(figma, "lineHeight");
	const letterSpacing = rec(figma, "letterSpacing");

	if (family) node.styles["font-family"] = `"${family.replace(/["\\]/g, "")}"`;
	node.styles["font-size"] = px(size);
	node.styles["font-weight"] = String(WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400);

	if (style.includes("italic")) node.styles["font-style"] = "italic";
	const lineValue = num(lineHeight, "value");
	const lineUnits = str(lineHeight, "units");

	if (lineValue !== undefined && !(lineUnits === "PERCENT" && lineValue === 100)) {
		node.styles["line-height"] = px(
			lineUnits === "PIXELS" ? lineValue : lineUnits === "PERCENT" ? (size * lineValue) / 100 : size * lineValue,
		);
	}

	const spacingValue = num(letterSpacing, "value") ?? 0;

	if (spacingValue !== 0) {
		node.styles["letter-spacing"] = px(
			str(letterSpacing, "units") === "PERCENT" ? (size * spacingValue) / 100 : spacingValue,
		);
	}

	const align = TEXT_ALIGN.get(str(figma, "textAlignHorizontal") ?? "");
	const textCase = TEXT_CASE.get(str(figma, "textCase") ?? "");
	const decoration = DECORATION.get(str(figma, "textDecoration") ?? "");

	if (align) node.styles["text-align"] = align;

	if (textCase) node.styles["text-transform"] = textCase;

	if (decoration) node.styles["text-decoration-line"] = decoration;
	applyFill(context, node, figma, "color");
}

function applySize(node: CapturedNode, figma: KiwiRecord, parent: KiwiRecord | null, row: boolean | null) {
	const size = rec(figma, "size");
	const width = num(size, "x") ?? 0;
	const height = num(size, "y") ?? 0;
	const type = str(figma, "type");
	const mode = str(figma, "stackMode");
	const autoLayout = mode === "HORIZONTAL" || mode === "VERTICAL";
	const primaryHug = autoLayout && str(figma, "stackPrimarySizing") !== "FIXED";
	const counterHug = autoLayout && str(figma, "stackCounterSizing") !== "FIXED";
	const resize = str(figma, "textAutoResize");
	let hugWidth = mode === "HORIZONTAL" ? primaryHug : counterHug;
	let hugHeight = mode === "HORIZONTAL" ? counterHug : primaryHug;

	if (type === "TEXT") {
		hugWidth = resize === "WIDTH_AND_HEIGHT";
		hugHeight = resize !== "NONE" && resize !== "TRUNCATE";
	}

	const grows = (num(figma, "stackChildPrimaryGrow") ?? 0) > 0;
	const stretches = str(figma, "stackChildAlignSelf") === "STRETCH";

	if (row !== null && parent) {
		if (grows) {
			node.styles["flex-grow"] = "1";
			node.styles["flex-basis"] = "0px";
		}

		if (stretches) node.styles["align-self"] = "stretch";
		const fillWidth = row ? grows : stretches;
		const fillHeight = row ? stretches : grows;

		if (fillWidth) hugWidth = true;

		if (fillHeight) hugHeight = true;
	}

	if (!hugWidth) node.styles.width = px(width);

	if (!hugHeight) node.styles.height = px(height);

	if (!hugWidth || !hugHeight) node.styles["flex-shrink"] = "0";
}

function tagOf(figma: KiwiRecord, image: boolean, hasChildren: boolean) {
	const type = str(figma, "type");

	if (type === "TEXT") return "p";

	if (image && !hasChildren) return "img";
	const name = str(figma, "name") ?? "";

	return SEMANTIC_TAGS.find(([pattern]) => pattern.test(name))?.[1] ?? "div";
}

function convert(
	context: Context,
	tree: Tree,
	parent: KiwiRecord | null,
	origin: { x: number; y: number },
): CapturedNode | null {
	const figma = tree.node;
	const type = str(figma, "type") ?? "";

	if (!isVisible(figma) || SKIPPED_TYPES.has(type) || context.nodes >= MAX_CAPTURED_NODES) return null;
	context.nodes++;
	const transform = rec(figma, "transform");
	const size = rec(figma, "size");
	const x = parent ? origin.x + (num(transform, "m02") ?? 0) : 0;
	const y = parent ? origin.y + (num(transform, "m12") ?? 0) : 0;
	const box = { x, y, width: num(size, "x") ?? 0, height: num(size, "y") ?? 0 };
	const image = records(figma.fillPaints).some((paint) => isVisible(paint) && str(paint, "type") === "IMAGE");
	const children = type === "TEXT" || VECTOR_TYPES.has(type) ? [] : tree.children;
	const node: CapturedNode = { tag: tagOf(figma, image, children.length > 0), box, styles: {}, children: [] };
	const name = str(figma, "name");

	if (name) node.name = name.slice(0, 80);
	const parentMode = parent ? str(parent, "stackMode") : undefined;

	const inFlow =
		(parentMode === "HORIZONTAL" || parentMode === "VERTICAL") && str(figma, "stackPositioning") !== "ABSOLUTE";

	if (parent && !inFlow) {
		node.styles.position = "absolute";
		node.styles.left = px(num(transform, "m02") ?? 0);
		node.styles.top = px(num(transform, "m12") ?? 0);
	}

	if (parent) applySize(node, figma, parent, inFlow ? parentMode === "HORIZONTAL" : null);

	if (type === "TEXT") {
		applyText(context, node, figma);
		const text = str(rec(figma, "textData"), "characters") ?? "";

		if (text.includes("\n")) node.styles["white-space"] = "pre-wrap";
		node.children.push({ tag: TEXT_TAG, text, box, styles: {}, children: [] });

		return node;
	}

	if (node.tag === "img") {
		context.placeholders++;
		node.attrs = { alt: str(figma, "name") ?? "Image" };
	} else if (type === "LINE") {
		const paint = firstVisible(records(figma.strokePaints));

		node.styles.height = px(Math.max(1, num(figma, "strokeWeight") ?? 1));

		if (paint) node.styles["background-color"] = rgba(rec(paint, "color"), num(paint, "opacity") ?? 1);
	} else if (!VECTOR_TYPES.has(type)) {
		applyFill(context, node, figma, "background-color");
		applyStroke(context, node, figma);
	}

	applyCorners(node, figma);
	applyEffects(node, figma);
	const opacity = num(figma, "opacity") ?? 1;

	if (opacity < 1) node.styles.opacity = String(Math.round(opacity * 1000) / 1000);

	if (figma.frameMaskDisabled === false && children.length) {
		node.styles["overflow-x"] = "hidden";
		node.styles["overflow-y"] = "hidden";
	}

	const autoLayout = applyAutoLayout(node, figma);
	let positioned = false;

	for (const child of children) {
		const converted = convert(context, child, figma, { x, y });

		if (!converted) continue;
		positioned ||= converted.styles.position === "absolute";
		node.children.push(converted);
	}

	if (positioned && !node.styles.position) node.styles.position = "relative";

	if (parent && !autoLayout && children.length && !node.styles.height) node.styles.height = px(box.height);

	for (const entry of records(rec(figma, "variableConsumptionMap")?.entries)) {
		const field = VARIABLE_FIELDS.get(str(entry, "variableField") ?? "");

		if (field) bindVariable(context, node, field.properties, rec(entry, "variableData"), field.namespace);
	}

	return node;
}

function variablesOf(nodes: KiwiRecord[]) {
	const variables = new Map<string, string>();

	for (const node of nodes) {
		const name = str(node, "name");

		if (str(node, "type") !== "VARIABLE" || !name) continue;
		variables.set(guidKey(rec(node, "guid")), name);
		const key = str(node, "key");

		if (key) variables.set(key, name);
	}

	return variables;
}

function buildTrees(nodes: KiwiRecord[]) {
	const byKey = new Map<string, Tree>();
	const roots: Tree[] = [];

	for (const node of nodes) byKey.set(guidKey(rec(node, "guid")), { node, children: [] });

	const position = (tree: Tree) => str(rec(tree.node, "parentIndex"), "position") ?? "";

	for (const tree of byKey.values()) {
		const parent = byKey.get(guidKey(rec(rec(tree.node, "parentIndex"), "guid")));
		const parentType = parent ? str(parent.node, "type") : undefined;

		if (parent && parent !== tree && parentType !== "DOCUMENT" && parentType !== "CANVAS") parent.children.push(tree);
		else roots.push(tree);
	}

	const order = (a: Tree, b: Tree) => (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0);

	for (const tree of byKey.values()) tree.children.sort(order);

	return roots.sort(order);
}

function wrapLoose(loose: Tree[]): Tree {
	return { node: { type: "FRAME", name: "Imported" }, children: loose };
}

function boundsOf(trees: Tree[]) {
	let right = 0;
	let bottom = 0;

	for (const tree of trees) {
		const transform = rec(tree.node, "transform");
		const size = rec(tree.node, "size");

		right = Math.max(right, (num(transform, "m02") ?? 0) + (num(size, "x") ?? 0));
		bottom = Math.max(bottom, (num(transform, "m12") ?? 0) + (num(size, "y") ?? 0));
	}

	return { x: right, y: bottom };
}

export function figmaToCaptured(message: KiwiRecord): FigmaImport {
	const nodes = records(message.nodeChanges);
	const context: Context = { variables: variablesOf(nodes), tokens: new Map(), nodes: 0, placeholders: 0 };

	const roots = buildTrees(nodes).filter((tree) => {
		const type = str(tree.node, "type") ?? "";

		return isVisible(tree.node) && !SKIPPED_TYPES.has(type);
	});

	const frames = roots.filter((tree) => SCREEN_TYPES.has(str(tree.node, "type") ?? ""));
	const loose = roots.filter((tree) => !SCREEN_TYPES.has(str(tree.node, "type") ?? ""));
	const screens: CapturedTree[] = [];

	if (loose.length) {
		const origin = loose.reduce(
			(min, tree) => ({
				x: Math.min(min.x, num(rec(tree.node, "transform"), "m02") ?? 0),
				y: Math.min(min.y, num(rec(tree.node, "transform"), "m12") ?? 0),
			}),
			{ x: Infinity, y: Infinity },
		);

		const shifted = loose.map((tree) => ({
			node: {
				...tree.node,
				transform: {
					...rec(tree.node, "transform"),
					m02: (num(rec(tree.node, "transform"), "m02") ?? 0) - origin.x,
					m12: (num(rec(tree.node, "transform"), "m12") ?? 0) - origin.y,
				},
			},
			children: tree.children,
		}));

		const wrapper = wrapLoose(shifted);

		wrapper.node = { ...wrapper.node, size: boundsOf(shifted) };
		frames.push(wrapper);
	}

	for (const frame of frames) {
		const root = convert(context, frame, null, { x: 0, y: 0 });

		if (!root) continue;
		screens.push({
			title: str(frame.node, "name") ?? "Imported",
			width: Math.max(1, Math.round(num(rec(frame.node, "size"), "x") ?? 1)),
			root,
		});
	}

	const tokens = [...context.tokens].map(([name, value]) => ({ name, value }));

	return { screens, tokens, placeholders: context.placeholders };
}
