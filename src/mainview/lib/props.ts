/**
 * Props of a component usage as editable values: reading them from a JSX
 * element and writing a control's change back to the source. Pure, so the
 * inspector, the components panel and tests share it.
 */

import { findElement, parseJsx, setAttribute, type JsxElement } from "../../shared/jsx";
import { childText } from "../../shared/jsx/text";
import type { ComponentExport, PropSpec, PropType } from "../../shared/components/api";
import { cachedComponentApi } from "../../shared/components/usages";
import type { ComponentRef } from "./outline";
import { isBoolean, isNumber } from "../../shared/guards";

export type Literal = string | number | boolean;

/** The control type a literal is edited with when its prop has no type of its own. */
export const literalKind = (value: Literal | undefined): "boolean" | "number" | "string" =>
	isBoolean(value) ? "boolean" : isNumber(value) ? "number" : "string";

/** A prop as written on the element: absent, a literal, or code (`{items.length}`) */
export type PropValue = { kind: "unset" } | { kind: "literal"; value: Literal } | { kind: "expression"; text: string };

export const UNSET: PropValue = { kind: "unset" };

/** The control a prop gets. Code-valued props and types without a control are shown read-only. */
export type ControlKind = "enum" | "boolean" | "string" | "number" | "readonly";

/** Props that are plumbing rather than design: not shown as controls */
const HIDDEN_PROPS = new Set(["asChild", "children", "key", "ref"]);

/**
 * HTML elements that can't have children: React throws on `<input>abc</input>`.
 * `textarea` too, whose text is its value. Mirrors the set in shared/components/api.ts.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
	"input",
	"img",
	"br",
	"hr",
	"area",
	"base",
	"col",
	"embed",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
	"textarea",
]);

/** Whether an intrinsic element (`input`, `div`) can hold children. Components decide for themselves. */
export const isVoidElement = (element: JsxElement) =>
	element.intrinsic && element.name !== null && VOID_ELEMENTS.has(element.name);

/** `"x"`, `'x'`, `3`, `true` inside `{…}` → the literal; anything else is code. */
export function literalOf(text: string): Literal | undefined {
	const code = text.trim();

	if (code === "true") return true;

	if (code === "false") return false;

	if (/^-?\d+(\.\d+)?$/.test(code)) return Number(code);

	if (/^"(?:[^"\\\n]|\\.)*"$/.test(code)) {
		try {
			// SAFETY: the pattern above only matches a double-quoted JSON string literal, which parses to a string
			return JSON.parse(code) as string;
		} catch {
			return undefined;
		}
	}

	const single = /^'([^'\\\n]*)'$/.exec(code) ?? /^`([^`\\$]*)`$/.exec(code);

	return single ? single[1]! : undefined;
}

/** The value of attribute `name` on `element` (the last one wins, like React). A bare attribute is `true`. */
export function readProp(element: JsxElement, name: string): PropValue {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === name);

	if (attribute?.kind !== "attribute") return UNSET;

	if (!attribute.value) return { kind: "literal", value: true };

	if (attribute.value.kind === "string") return { kind: "literal", value: attribute.value.value };
	const literal = literalOf(attribute.value.text);

	return literal === undefined
		? { kind: "expression", text: attribute.value.text.trim() }
		: { kind: "literal", value: literal };
}

/**
 * Children as one editable text: plain text and string literals joined, or
 * null when they hold elements or code. `""` for no children.
 */
export function readChildrenText(element: JsxElement): string | null {
	let text = "";

	for (const child of element.children) {
		if (child.kind === "element") return null;

		if (child.kind === "text") text += child.value;
		else if (!child.empty) {
			const literal = literalOf(child.text);

			if (literal === undefined || isBoolean(literal)) return null;
			text += String(literal);
		}
	}

	return text.trim();
}

/** Which control fits a prop, given what is written now. */
export function controlKind(type: PropType, value: PropValue): ControlKind {
	if (value.kind === "expression") return "readonly";

	switch (type.kind) {
		case "enum":
			return "enum";
		case "boolean":
			return "boolean";
		case "number":
			return "number";
		case "string":
		case "node":
			return "string";
		default:
			// Untyped props written with a literal can still be edited as that literal
			return value.kind === "literal" ? literalKind(value.value) : "readonly";
	}
}

/** The props shown as controls, in declaration order. */
export const visibleProps = (spec: ComponentExport): PropSpec[] =>
	spec.props.filter((prop) => !HIDDEN_PROPS.has(prop.name));

/** Attributes written on the element that the component's API doesn't declare (`className`, DOM props), by name. */
export function extraAttributes(element: JsxElement, spec: ComponentExport | null): string[] {
	const declared = new Set(spec?.props.map((prop) => prop.name) ?? []);
	const names: string[] = [];

	for (const attribute of element.attributes) {
		if (
			attribute.kind !== "attribute" ||
			HIDDEN_PROPS.has(attribute.name) ||
			declared.has(attribute.name) ||
			names.includes(attribute.name)
		)
			continue;
		names.push(attribute.name);
	}

	return names;
}

/** What is effectively in use: the written literal, else the prop's default. */
export function effectiveValue(spec: PropSpec | undefined, value: PropValue): Literal | undefined {
	return value.kind === "literal" ? value.value : value.kind === "unset" ? spec?.default : undefined;
}

/** Replaces the value of attribute `name` on the element at `start` with `{code}`, adding the attribute when missing. */
function setAttributeCode(source: string, start: number, name: string, code: string): string | null {
	const placed = setAttribute(source, start, name, 0);

	if (placed === null) return null;
	const element = findElement(parseJsx(placed), start);
	const attribute = element && [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === name);

	if (attribute?.kind !== "attribute" || !attribute.value) return null;

	return placed.slice(0, attribute.value.start) + `{${code}}` + placed.slice(attribute.value.end);
}

/**
 * Writes a control's value to the element at `start`. Choosing the default
 * removes the attribute, so the code stays as short as it was; `false` is
 * written as `{false}` only when the default is `true`. `null` removes it.
 * Returns the new source, or null when the element is gone.
 */
export function writeProp(
	source: string,
	start: number,
	name: string,
	value: Literal | null,
	spec?: PropSpec,
): string | null {
	if (value !== null && spec?.default !== undefined && value === spec.default)
		return setAttribute(source, start, name, null);

	if (value === false && spec?.default === true) return setAttributeCode(source, start, name, "false");

	if (isNumber(value) && !Number.isFinite(value)) return null;

	return setAttribute(source, start, name, value);
}

/**
 * Sets an element's children to plain `text`, keeping the line layout around
 * them (`<Button>\n  Save\n</Button>` stays on three lines). A self-closing
 * element gets a closing tag. Returns null when the children hold elements or
 * code (they are not one text), the element is void (`<input />`), or it is gone.
 */
export function setChildrenText(source: string, start: number, text: string): string | null {
	const element = findElement(parseJsx(source), start);

	if (!element || element.name === null || isVoidElement(element)) return null;

	if (readChildrenText(element) === null) return null;
	const content = text ? childText(text) : "";

	if (element.selfClosing) {
		if (!content) return source;
		let from = source.lastIndexOf("/", element.end - 1);

		while (from > element.nameEnd && /\s/.test(source[from - 1]!)) from--;

		return `${source.slice(0, from)}>${content}</${element.name}>${source.slice(element.end)}`;
	}

	const inner = source.slice(element.openingEnd, element.closingStart!);
	const lead = inner.trim() ? /^\s*/.exec(inner)![0] : "";
	const trail = inner.trim() ? /\s*$/.exec(inner)![0] : "";

	return (
		source.slice(0, element.openingEnd) + (content ? lead + content + trail : "") + source.slice(element.closingStart!)
	);
}

/**
 * The API of the component a usage refers to: a project component from its
 * file, a shadcn component from its source in `uiSources` (module → source).
 */
export function componentSpec(
	ref: ComponentRef | null,
	files: Record<string, string>,
	uiSources: Record<string, string>,
): ComponentExport | null {
	if (!ref || ref.source === "other") return null;
	const source = ref.source === "project" ? files[ref.path] : uiSources[ref.module];

	if (source === undefined) return null;
	const path = ref.source === "project" ? ref.path : `components/ui/${ref.module}.tsx`;

	return cachedComponentApi(path, source).exports.find((exp) => exp.name === ref.exportName) ?? null;
}
