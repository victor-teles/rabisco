import { isFiniteNumber, isString } from "../guards";
import { isJsonArray, isJsonObject, type Json } from "../json";

export const MAX_CAPTURED_NODES = 3000;

export const MAX_CAPTURED_BYTES = 5 * 1024 * 1024;

export const TEXT_TAG = "#text";

export type CssValues = Record<string, string>;

export type CapturedBox = { x: number; y: number; width: number; height: number };

export type CapturedNode = {
	tag: string;
	name?: string;
	text?: string;
	box: CapturedBox;
	styles: CssValues;
	tokens?: CssValues;
	attrs?: CssValues;
	children: CapturedNode[];
};

export type CapturedTree = { title: string; width: number; root: CapturedNode };

export const STYLE_PROPERTIES = [
	"display",
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"z-index",
	"flex-direction",
	"flex-wrap",
	"justify-content",
	"align-items",
	"align-self",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"row-gap",
	"column-gap",
	"grid-template-columns",
	"overflow-x",
	"overflow-y",
	"width",
	"height",
	"min-width",
	"max-width",
	"min-height",
	"max-height",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"background-color",
	"background-image",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"box-shadow",
	"opacity",
	"object-fit",
	"text-decoration-line",
	"background-size",
	"text-overflow",
	"-webkit-line-clamp",
] as const;

export const INHERITED_PROPERTIES = [
	"color",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"line-height",
	"letter-spacing",
	"text-align",
	"text-transform",
	"white-space",
	"list-style-type",
] as const;

const PROPERTIES = new Set<string>([...STYLE_PROPERTIES, ...INHERITED_PROPERTIES]);

const ATTRIBUTES = new Set([
	"href",
	"src",
	"alt",
	"title",
	"type",
	"name",
	"placeholder",
	"value",
	"checked",
	"disabled",
	"for",
	"role",
	"colspan",
	"rowspan",
	"viewbox",
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"fill-rule",
	"clip-rule",
	"d",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"width",
	"height",
	"points",
	"transform",
	"opacity",
	"xmlns",
]);

const TAG = /^(?:#text|[a-z][a-zA-Z0-9-]*)$/;

const NAME = /^[A-Za-z][\w .-]{0,79}$/;

const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "template", "noscript"]);

const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/|data:image\/(?:png|jpe?g|gif|webp|avif);)/i;

const STYLE_VALUE = /^[^<>{}\\;]*$/;

const MAX_TEXT = 10_000;

const MAX_VALUE = 2_000;

export const isSafeUrl = (url: string) => SAFE_URL.test(url.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(url.trim());

function parseBox(json: Json | undefined): CapturedBox | null {
	if (!isJsonObject(json)) return null;
	const { x, y, width, height } = json;

	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;

	return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function parseRecord(json: Json | undefined, keep: (key: string, value: string) => boolean) {
	const record = new Map<string, string>();

	if (isJsonObject(json)) {
		for (const [key, value] of Object.entries(json)) {
			if (isString(value) && value.length <= MAX_VALUE && keep(key, value)) record.set(key, `${value}`);
		}
	}

	return Object.fromEntries(record);
}

const keepStyle = (key: string, value: string) => PROPERTIES.has(key) && STYLE_VALUE.test(value);

const keepToken = (key: string, value: string) => PROPERTIES.has(key) && /^[a-z][a-z0-9-]*$/.test(value);

function keepAttribute(key: string, value: string) {
	if (!ATTRIBUTES.has(key.toLowerCase()) && !/^aria-[a-z]+$/.test(key)) return false;

	return key !== "href" && key !== "src" ? true : isSafeUrl(value);
}

function parseNode(json: Json | undefined, budget: { nodes: number }): CapturedNode | null {
	if (!isJsonObject(json) || budget.nodes >= MAX_CAPTURED_NODES) return null;
	const { tag, name, text, box: rawBox, styles, tokens, attrs, children } = json;

	if (!isString(tag) || !TAG.test(tag) || DROPPED_TAGS.has(tag)) return null;
	const box = parseBox(rawBox);

	if (!box) return null;
	budget.nodes++;

	if (tag === TEXT_TAG)
		return isString(text) ? { tag, text: `${text}`.slice(0, MAX_TEXT), box, styles: {}, children: [] } : null;
	const node: CapturedNode = { tag, box, styles: parseRecord(styles, keepStyle), children: [] };

	if (isString(name) && NAME.test(name)) node.name = `${name}`;
	const bound = parseRecord(tokens, keepToken);
	const attributes = parseRecord(attrs, keepAttribute);

	if (Object.keys(bound).length) node.tokens = bound;

	if (Object.keys(attributes).length) node.attrs = attributes;

	if (isJsonArray(children)) {
		for (const child of children) {
			const parsed = parseNode(child, budget);

			if (parsed) node.children.push(parsed);
		}
	}

	return node;
}

export function parseCapturedTree(text: string): CapturedTree | null {
	if (text.length > MAX_CAPTURED_BYTES) return null;
	let json: Json;

	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		json = JSON.parse(text) as Json;
	} catch {
		return null;
	}

	if (!isJsonObject(json)) return null;
	const { title, width } = json;
	const root = parseNode(json.root, { nodes: 0 });

	if (!root || !isFiniteNumber(width) || width <= 0) return null;

	return { title: isString(title) ? `${title}`.slice(0, 200) : "", width, root };
}
