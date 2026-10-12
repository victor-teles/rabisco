import { tokenKind, tokenUtility } from "../context/tokens";
import { TEXT_TAG, type CapturedNode, type CapturedTree } from "./captured-tree";
import { arbitrary, createMatcher, FONT_LINE_HEIGHTS, px, type Matcher } from "./style-classes";

export type ImportedScreen = {
	source: string;
	name: string;
	width: number;
	height: number;
	untokened: { colors: number; radii: number };
};

type FontCategory = "sans" | "serif" | "mono";

type Inherited = {
	color: string;
	fontSize: number;
	fontClass: string;
	lineHeight: string;
	family: FontCategory;
	listStyle: string;
	svg: boolean;
};

const BLOCK_TAGS = new Set([
	"div",
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"nav",
	"header",
	"footer",
	"main",
	"section",
	"article",
	"aside",
	"form",
	"figure",
	"figcaption",
	"blockquote",
	"pre",
	"dl",
	"dt",
	"dd",
	"address",
	"hr",
	"body",
	"img",
	"svg",
	"video",
	"canvas",
]);

const DEFAULT_DISPLAY = new Map(
	Object.entries({
		li: "list-item",
		table: "table",
		thead: "table-header-group",
		tbody: "table-row-group",
		tfoot: "table-footer-group",
		tr: "table-row",
		td: "table-cell",
		th: "table-cell",
		button: "inline-block",
		input: "inline-block",
		textarea: "inline-block",
		select: "inline-block",
	}),
);

const KEPT_TAGS = new Set([
	...BLOCK_TAGS,
	...DEFAULT_DISPLAY.keys(),
	"span",
	"a",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"small",
	"code",
	"kbd",
	"mark",
	"sup",
	"sub",
	"time",
	"label",
	"option",
	"br",
	"caption",
]);

const VOID_TAGS = new Set(["img", "input", "br", "hr"]);

const DISPLAY_CLASSES = new Map(
	Object.entries({
		block: "block",
		"inline-block": "inline-block",
		inline: "inline",
		flex: "flex",
		"inline-flex": "inline-flex",
		grid: "grid",
		"inline-grid": "inline-grid",
		"list-item": "list-item",
		"flow-root": "flow-root",
		table: "table",
		"table-row": "table-row",
		"table-cell": "table-cell",
	}),
);

const JUSTIFY = new Map(
	Object.entries({
		"flex-start": "start",
		start: "start",
		center: "center",
		"flex-end": "end",
		end: "end",
		"space-between": "between",
		"space-around": "around",
		"space-evenly": "evenly",
	}),
);

const ALIGN = new Map(
	Object.entries({
		"flex-start": "start",
		start: "start",
		center: "center",
		"flex-end": "end",
		end: "end",
		baseline: "baseline",
		stretch: "stretch",
	}),
);

const WEIGHTS = new Map(
	Object.entries({
		"100": "thin",
		"200": "extralight",
		"300": "light",
		"400": "normal",
		"500": "medium",
		"600": "semibold",
		"700": "bold",
		"800": "extrabold",
		"900": "black",
	}),
);

const LEADING: [string, number][] = [
	["none", 1],
	["tight", 1.25],
	["snug", 1.375],
	["normal", 1.5],
	["relaxed", 1.625],
	["loose", 2],
];

const TRACKING: [string, number][] = [
	["tighter", -0.05],
	["tight", -0.025],
	["normal", 0],
	["wide", 0.025],
	["wider", 0.05],
	["widest", 0.1],
];

const SIDES = ["top", "right", "bottom", "left"] as const;

const TOKEN_PREFIX = new Map(
	Object.entries({
		color: "text",
		"background-color": "bg",
		"border-top-color": "border",
		"border-right-color": "border",
		"border-bottom-color": "border",
		"border-left-color": "border",
		"font-size": "text",
		"font-family": "font",
		"row-gap": "gap-y",
		"column-gap": "gap-x",
		"padding-top": "pt",
		"padding-right": "pr",
		"padding-bottom": "pb",
		"padding-left": "pl",
		"border-top-left-radius": "rounded-tl",
		"border-top-right-radius": "rounded-tr",
		"border-bottom-right-radius": "rounded-br",
		"border-bottom-left-radius": "rounded-bl",
	}),
);

const ATTRIBUTE_NAMES = new Map(
	Object.entries({
		for: "htmlFor",
		colspan: "colSpan",
		rowspan: "rowSpan",
		value: "defaultValue",
		checked: "defaultChecked",
	}),
);

const MAX_LINE = 120;

const fontCategory = (family: string): FontCategory =>
	/mono|courier|consolas|menlo|monaco|code/i.test(family)
		? "mono"
		: /(^|,)\s*["']?(serif|georgia|times|garamond|playfair|merriweather|lora)/i.test(family) &&
			  !/sans/i.test(family.split(",")[0] ?? "")
			? "serif"
			: "sans";

const sameish = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

export function componentName(title: string): string {
	const words = title
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean)
		.slice(0, 4);

	const name = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("") || "Imported";

	return /^\d/.test(name) ? `Screen${name}` : name;
}

function tagOf(node: CapturedNode, svg: boolean): string {
	if (node.tag === "body") return "div";

	if (svg) return node.tag;

	if (KEPT_TAGS.has(node.tag) || node.tag === "svg") return node.tag;
	const display = node.styles.display ?? "inline";

	return display === "inline" || display === "inline-block" ? "span" : "div";
}

function defaultDisplay(tag: string) {
	return DEFAULT_DISPLAY.get(tag) ?? (BLOCK_TAGS.has(tag) ? "block" : "inline");
}

function boundClass(node: CapturedNode, property: string): string | null {
	const token = node.tokens?.[property];
	const prefix = TOKEN_PREFIX.get(property);

	if (!token || !prefix) return null;
	const kind = tokenKind(token);

	if (property.endsWith("radius") && kind === "radius") return `${prefix}-${tokenUtility(token)}`;

	return kind ? `${prefix}-${tokenUtility(token)}` : null;
}

type Classes = string[];

function sideClasses(classes: Classes, prefix: string, values: Record<(typeof SIDES)[number], string | null>) {
	const [top, right, bottom, left] = SIDES.map((side) => values[side]);

	const write = (suffix: string, value: string | null | undefined) => {
		if (!value || value === "0") return;

		classes.push(value.startsWith("-") ? `-${prefix}${suffix}-${value.slice(1)}` : `${prefix}${suffix}-${value}`);
	};

	if (top === right && right === bottom && bottom === left) return write("", top);

	if (top === bottom && left === right) {
		write("y", top);
		write("x", left);

		return;
	}

	if (left === right) {
		write("t", top);
		write("b", bottom);
		write("x", left);

		return;
	}

	write("t", top);
	write("r", right);
	write("b", bottom);
	write("l", left);
}

function layoutClasses(node: CapturedNode, tag: string, match: Matcher, classes: Classes) {
	const { styles } = node;
	const display = styles.display ?? defaultDisplay(tag);

	const displayClass = DISPLAY_CLASSES.get(display);

	if (display !== defaultDisplay(tag) && displayClass) classes.push(displayClass);
	const flex = display.includes("flex");
	const grid = display.includes("grid");

	if (flex) {
		const direction = styles["flex-direction"];

		if (direction === "column") classes.push("flex-col");
		else if (direction === "row-reverse") classes.push("flex-row-reverse");
		else if (direction === "column-reverse") classes.push("flex-col-reverse");

		if (styles["flex-wrap"] === "wrap") classes.push("flex-wrap");
	}

	if (grid) {
		const columns = styles["grid-template-columns"]?.trim().split(/\s+/) ?? [];

		if (columns.length > 1 && columns.every((column) => column === columns[0]))
			classes.push(`grid-cols-${columns.length}`);
		else if (columns.length) classes.push(`grid-cols-${arbitrary(columns.join(" "))}`);
	}

	if (flex || grid) {
		const justify = JUSTIFY.get(styles["justify-content"] ?? "");
		const align = ALIGN.get(styles["align-items"] ?? "");

		if (justify && justify !== "start") classes.push(`justify-${justify}`);

		if (align && align !== "stretch") classes.push(`items-${align}`);
		const row = styles["row-gap"] ? match.spacing(styles["row-gap"]) : null;
		const column = styles["column-gap"] ? match.spacing(styles["column-gap"]) : null;
		const rowBound = boundClass(node, "row-gap");
		const columnBound = boundClass(node, "column-gap");

		if (rowBound || columnBound) {
			if (rowBound) classes.push(rowBound);

			if (columnBound) classes.push(columnBound);
		} else if (row && row === column) {
			if (row !== "0") classes.push(`gap-${row}`);
		} else {
			if (
				row &&
				row !== "0" &&
				(flex ? styles["flex-direction"]?.startsWith("column") || styles["flex-wrap"] === "wrap" : true)
			)
				classes.push(`gap-y-${row}`);

			if (
				column &&
				column !== "0" &&
				(flex ? !styles["flex-direction"]?.startsWith("column") || styles["flex-wrap"] === "wrap" : true)
			)
				classes.push(`gap-x-${column}`);
		}
	}

	const self = ALIGN.get(styles["align-self"] ?? "");

	if (self) classes.push(`self-${self}`);
	const grow = styles["flex-grow"];
	const shrink = styles["flex-shrink"];

	if (grow === "1" && styles["flex-basis"] === "0%") classes.push("flex-1");
	else {
		if (grow && grow !== "0") classes.push(grow === "1" ? "grow" : `grow-${grow}`);

		if (shrink === "0") classes.push("shrink-0");
	}

	const position = styles.position;

	if (position && position !== "static") {
		classes.push(position);

		for (const side of SIDES) {
			const value = styles[side];
			const step = value && value !== "auto" ? match.spacing(value) : null;

			if (step) classes.push(step.startsWith("-") ? `-${side}-${step.slice(1)}` : `${side}-${step}`);
		}
	}

	const z = styles["z-index"];

	if (z && z !== "auto") classes.push(["0", "10", "20", "30", "40", "50"].includes(z) ? `z-${z}` : `z-${arbitrary(z)}`);
	const overflowX = styles["overflow-x"];
	const overflowY = styles["overflow-y"];

	if (overflowX && overflowX === overflowY && overflowX !== "visible") classes.push(`overflow-${overflowX}`);
	else {
		if (overflowX && overflowX !== "visible") classes.push(`overflow-x-${overflowX}`);

		if (overflowY && overflowY !== "visible") classes.push(`overflow-y-${overflowY}`);
	}
}

function sizeClasses(node: CapturedNode, match: Matcher, classes: Classes) {
	const { styles } = node;
	const width = styles.width ? (match.size(styles.width) ?? arbitrary(styles.width)) : null;
	const height = styles.height ? (match.size(styles.height) ?? arbitrary(styles.height)) : null;

	if (width && width === height) classes.push(`size-${width}`);
	else {
		if (width) classes.push(`w-${width}`);

		if (height) classes.push(`h-${height}`);
	}

	const limits: [string, string][] = [
		["min-width", "min-w"],
		["max-width", "max-w"],
		["min-height", "min-h"],
		["max-height", "max-h"],
	];

	for (const [property, prefix] of limits) {
		const value = styles[property];

		if (!value || value === "none" || value === "auto" || value === "0px") continue;
		const step = property === "max-width" ? match.maxWidth(value) : match.size(value);

		classes.push(`${prefix}-${step ?? arbitrary(value)}`);
	}
}

function spacingClasses(node: CapturedNode, match: Matcher, classes: Classes) {
	const { styles } = node;

	const side = (property: string) => {
		const value = styles[property];

		return value ? match.spacing(value) : null;
	};

	sideClasses(classes, "p", {
		top: side("padding-top"),
		right: side("padding-right"),
		bottom: side("padding-bottom"),
		left: side("padding-left"),
	});
	sideClasses(classes, "m", {
		top: side("margin-top"),
		right: side("margin-right"),
		bottom: side("margin-bottom"),
		left: side("margin-left"),
	});
}

function colorClass(node: CapturedNode, property: string, prefix: string, match: Matcher): string | null {
	const bound = boundClass(node, property);

	if (bound) return bound;
	const value = node.styles[property];
	const color = value ? match.color(value) : null;

	return color ? `${prefix}-${color}` : null;
}

function visualClasses(node: CapturedNode, match: Matcher, classes: Classes) {
	const { styles, box } = node;
	const background = colorClass(node, "background-color", "bg", match);

	if (background && background !== "bg-transparent") classes.push(background);
	const image = styles["background-image"];

	if (image && /gradient\(/.test(image)) classes.push(`bg-${arbitrary(image)}`);

	const widths = SIDES.map((side) =>
		styles[`border-${side}-style`] ? (px(styles[`border-${side}-width`] ?? "") ?? 0) : 0,
	);

	if (widths.some((width) => width > 0)) {
		const widthClass = (width: number) =>
			width === 1 ? "" : [2, 4, 8].includes(width) ? `-${width}` : `-[${width}px]`;

		const [top, right, bottom, left] = widths;

		if (top === right && right === bottom && bottom === left) classes.push(`border${widthClass(top!)}`);
		else
			SIDES.forEach((side, i) => {
				const width = widths[i]!;

				if (width > 0) classes.push(`border-${side[0]}${widthClass(width)}`);
			});
		const sideWithBorder = SIDES[widths.findIndex((width) => width > 0)]!;
		const style = styles[`border-${sideWithBorder}-style`];

		if (style && style !== "solid" && ["dashed", "dotted", "double"].includes(style)) classes.push(`border-${style}`);
		const color = colorClass(node, `border-${sideWithBorder}-color`, "border", match);

		if (color && color !== "border-border") classes.push(color);
	}

	const corners = [
		"border-top-left-radius",
		"border-top-right-radius",
		"border-bottom-right-radius",
		"border-bottom-left-radius",
	];

	const smallest = Math.min(box.width, box.height);

	const radii = corners.map((corner) => {
		const bound = node.tokens?.[corner];

		if (bound && tokenKind(bound) === "radius") return tokenUtility(bound);
		const value = styles[corner];

		return value ? match.radius(value, smallest) : null;
	});

	if (radii.every((radius) => radius === radii[0])) {
		if (radii[0] && radii[0] !== "none") classes.push(radii[0] === "" ? "rounded" : `rounded-${radii[0]}`);
	} else {
		corners.forEach((_, i) => {
			const radius = radii[i];

			if (radius && radius !== "none") classes.push(`rounded-${["tl", "tr", "br", "bl"][i]}-${radius}`);
		});
	}

	const shadow = styles["box-shadow"];

	if (shadow && shadow !== "none") classes.push(`shadow-${match.shadow(shadow)}`);
	const opacity = styles.opacity ? Number(styles.opacity) : 1;

	if (opacity < 1) {
		const percent = Math.round(opacity * 100);
		classes.push(percent % 5 === 0 ? `opacity-${percent}` : `opacity-[${opacity}]`);
	}

	const fit = styles["object-fit"];

	if (fit && fit !== "fill") classes.push(`object-${fit}`);
}

function textClasses(
	node: CapturedNode,
	tag: string,
	match: Matcher,
	inherited: Inherited,
	classes: Classes,
): Inherited {
	const { styles } = node;
	const next = { ...inherited };
	const family = styles["font-family"];

	if (family) {
		const bound = boundClass(node, "font-family");
		next.family = fontCategory(family);

		if (bound) classes.push(bound);
		else if (next.family !== inherited.family) classes.push(`font-${next.family}`);
	}

	const size = styles["font-size"];
	let sizeWritten = false;

	if (size) {
		const bound = boundClass(node, "font-size");
		const step = match.fontSize(size);

		if (step) {
			const name = bound ? bound.slice("text-".length) : step.name;
			next.fontSize = step.px;

			if (name !== inherited.fontClass) {
				classes.push(`text-${name}`);
				next.fontClass = name;
				sizeWritten = true;
			}
		}
	}

	const color = styles.color ? colorClass(node, "color", "text", match) : boundClass(node, "color");

	if (color && color !== inherited.color) {
		classes.push(color);
		next.color = color;
	}

	const weight = styles["font-weight"];

	if (weight) classes.push(`font-${WEIGHTS.get(weight) ?? arbitrary(weight)}`);

	if (styles["font-style"] === "italic") classes.push("italic");
	else if (styles["font-style"] === "normal") classes.push("not-italic");

	const lineHeight = styles["line-height"] ?? (sizeWritten ? inherited.lineHeight : undefined);

	if (lineHeight) {
		next.lineHeight = lineHeight;
		const length = px(lineHeight);
		const ratio = length === null ? Number(lineHeight) : length / next.fontSize;
		const own = FONT_LINE_HEIGHTS.get(next.fontClass);

		if (
			lineHeight !== "normal" &&
			Number.isFinite(ratio) &&
			!(sizeWritten && own !== undefined && sameish(ratio, own))
		) {
			const named = LEADING.find(([, n]) => sameish(n, ratio));

			if (named) classes.push(`leading-${named[0]}`);
			else if (length !== null && Number.isInteger(length / 4)) classes.push(`leading-${length / 4}`);
			else if (length !== null) classes.push(`leading-[${Math.round(length * 100) / 100}px]`);
		}
	}

	const tracking = styles["letter-spacing"];

	if (tracking && tracking !== "normal") {
		const length = px(tracking);

		if (length !== null) {
			const em = length / next.fontSize;
			const named = TRACKING.find(([, n]) => sameish(n, em, 0.006));

			if (!named) classes.push(`tracking-[${Math.round(em * 1000) / 1000}em]`);
			else if (named[0] !== "normal") classes.push(`tracking-${named[0]}`);
		}
	}

	const align = styles["text-align"];

	if (align && align !== "start" && align !== "left") classes.push(`text-${align === "end" ? "right" : align}`);
	const transform = styles["text-transform"];

	if (transform === "uppercase" || transform === "lowercase" || transform === "capitalize") classes.push(transform);
	else if (transform === "none") classes.push("normal-case");

	const decoration = styles["text-decoration-line"];

	if (decoration === "underline") classes.push("underline");
	else if (decoration === "line-through") classes.push("line-through");
	else if (decoration === "overline") classes.push("overline");

	const space = styles["white-space"];

	if (space && space !== "normal") classes.push(`whitespace-${space}`);
	const list = styles["list-style-type"];

	if (list) next.listStyle = list;

	if ((tag === "ul" || tag === "ol") && next.listStyle !== "none") {
		classes.push(next.listStyle === "decimal" ? "list-decimal" : "list-disc");
	}

	return next;
}

function classesOf(node: CapturedNode, tag: string, match: Matcher, inherited: Inherited) {
	const classes: Classes = [];

	layoutClasses(node, tag, match, classes);
	sizeClasses(node, match, classes);
	spacingClasses(node, match, classes);
	visualClasses(node, match, classes);
	const next = textClasses(node, tag, match, inherited, classes);

	return { classes: [...new Set(classes)], inherited: next };
}

const attributeValue = (value: string) => (/["\\\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`);

const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

function attributesOf(node: CapturedNode, tag: string, svg: boolean): string[] {
	const attributes: string[] = [];

	for (const [name, value] of Object.entries(node.attrs ?? {})) {
		if (name === "src" || (tag === "img" && name === "alt")) continue;

		if (svg) {
			attributes.push(
				`${name.startsWith("aria-") || name === "viewBox" ? name : camel(name)}=${attributeValue(value)}`,
			);
			continue;
		}

		if (value === "true" && (name === "checked" || name === "disabled")) {
			attributes.push(ATTRIBUTE_NAMES.get(name) ?? name);
			continue;
		}

		attributes.push(`${ATTRIBUTE_NAMES.get(name) ?? name}=${attributeValue(value)}`);
	}

	return attributes;
}

const isProjectImage = (src: string | undefined) => !!src && /^\/images\/[^"'\\]+$/.test(src);

function escapeText(text: string): string {
	return /[{}<>&\n]/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

type Printer = { lines: string[]; placeholder: boolean };

function isWrapper(node: CapturedNode) {
	return (
		(node.tag === "div" || node.tag === "span") &&
		!Object.keys(node.styles).length &&
		!node.attrs &&
		!node.tokens &&
		node.children.length === 1 &&
		node.children[0]!.tag !== TEXT_TAG
	);
}

function openTag(name: string, parts: string[]) {
	return parts.length ? `<${name} ${parts.join(" ")}` : `<${name}`;
}

function printNode(node: CapturedNode, match: Matcher, inherited: Inherited, depth: number, out: Printer) {
	while (isWrapper(node)) node = node.children[0]!;
	const indent = "\t".repeat(depth);
	const tag = tagOf(node, inherited.svg);
	const classesAndInherited = classesOf(node, tag, match, inherited);
	const { classes } = classesAndInherited;
	const next = { ...classesAndInherited.inherited, svg: inherited.svg || tag === "svg" };
	const className = classes.length ? [`className="${classes.join(" ")}"`] : [];

	if (tag === "img" && !next.svg && !isProjectImage(node.attrs?.src)) {
		out.placeholder = true;
		const label = node.attrs?.alt ? [`label=${attributeValue(node.attrs.alt)}`] : [];
		out.lines.push(`${indent}${openTag("Placeholder", [...label, ...className])} />`);

		return;
	}

	const attributes = attributesOf(node, tag, next.svg);

	if (tag === "img") attributes.unshift(`src="${node.attrs!.src}"`, `alt=${attributeValue(node.attrs?.alt ?? "")}`);
	const open = openTag(tag, [...attributes, ...className]);

	if (VOID_TAGS.has(tag) || !node.children.length) {
		out.lines.push(`${indent}${open} />`);

		return;
	}

	const children = node.children;

	if (children.length === 1 && children[0]!.tag === TEXT_TAG) {
		const text = escapeText(children[0]!.text!.trim());
		const line = `${indent}${open}>${text}</${tag}>`;

		if (line.replace(/\t/g, "    ").length <= MAX_LINE || text.startsWith("{")) {
			out.lines.push(line);

			return;
		}

		out.lines.push(`${indent}${open}>`, `${indent}\t${text}`, `${indent}</${tag}>`);

		return;
	}

	out.lines.push(`${indent}${open}>`);
	const inner = "\t".repeat(depth + 1);

	children.forEach((child, i) => {
		if (child.tag !== TEXT_TAG) {
			printNode(child, match, next, depth + 1, out);

			return;
		}

		const raw = child.text ?? "";
		const text = raw.trim();
		const leading = i > 0 && /^\s/.test(raw);
		const trailing = i < children.length - 1 && /\s$/.test(raw);

		if (leading) out.lines[out.lines.length - 1] += `{" "}`;

		if (text) out.lines.push(`${inner}${escapeText(text)}${trailing ? `{" "}` : ""}`);
	});
	out.lines.push(`${indent}</${tag}>`);
}

const ROOT_INHERITED: Inherited = {
	color: "text-foreground",
	fontSize: 16,
	fontClass: "base",
	lineHeight: "normal",
	family: "sans",
	listStyle: "disc",
	svg: false,
};

export function treeToTsx(tree: CapturedTree, theme: Record<string, string>, title = tree.title): ImportedScreen {
	const match = createMatcher(theme);
	const root = tree.root;
	const out: Printer = { lines: [], placeholder: false };
	const { classes, inherited } = classesOf({ ...root, tag: "body" }, "div", match, ROOT_INHERITED);
	const background = classes.find((cls) => cls.startsWith("bg-")) ?? "bg-background";

	const rootClasses = [
		"min-h-full",
		...classes.filter((cls) => !cls.startsWith("bg-") && cls !== inherited.color),
		background,
		inherited.color,
	];

	out.lines.push(`\t\t<div className="${[...new Set(rootClasses)].join(" ")}">`);

	for (const child of root.children) {
		if (child.tag === TEXT_TAG) {
			const text = child.text?.trim();

			if (text) out.lines.push(`\t\t\t${escapeText(text)}`);
		} else printNode(child, match, inherited, 3, out);
	}

	out.lines.push("\t\t</div>");
	const name = componentName(title);
	const imports = out.placeholder ? `import { Placeholder } from "@/components/ui/placeholder";\n\n` : "";
	const source = `${imports}export default function ${name}() {\n\treturn (\n${out.lines.join("\n")}\n\t);\n}\n`;

	return {
		source,
		name: title.trim() || "Imported",
		width: Math.round(tree.width),
		height: Math.round(root.box.height),
		untokened: { colors: match.arbitrary.colors.size, radii: match.arbitrary.radii.size },
	};
}
