import { removeUnusedImports } from "../jsx/imports";
import { setAttribute } from "../jsx/transforms";
import { findElement, flatten, parseFile, type JsxElement, type JsxExpression } from "../jsx/tree";
import type { ComponentExport } from "./api";
import { componentElements } from "./variant-edit";

// A slot is content each usage fills in: `children`, or a prop typed `ReactNode`.

export type ComponentSlot = { name: string; optional: boolean };

export type SlotElement = { name: string; start: number };

export type SlotFill =
	| { kind: "empty" }
	| { kind: "text"; text: string }
	| { kind: "elements"; elements: SlotElement[] }
	/** An expression without elements, like `{label}` */
	| { kind: "code"; text: string };

export type SlotUsage = { path: string; start: number; line: number; fills: Record<string, SlotFill> };

export type SlotCounts = Record<SlotFill["kind"], number>;

const EMPTY: SlotFill = { kind: "empty" };

const STRING = /^\s*(["'`])([^"'`$]*)\1\s*$/;

const NOTHING = /^\s*(?:null|undefined|false)?\s*$/;

const slotElement = (element: JsxElement): SlotElement => ({ name: element.name ?? "Fragment", start: element.start });

/** `children` first, then the `ReactNode` props in declaration order */
export function componentSlots(component: ComponentExport): ComponentSlot[] {
	const slots: ComponentSlot[] = [];
	const children = component.props.find((prop) => prop.name === "children");

	if (component.acceptsChildren || children?.type.kind === "node")
		slots.push({ name: "children", optional: children?.optional ?? true });

	for (const prop of component.props)
		if (prop.type.kind === "node" && prop.name !== "children") slots.push({ name: prop.name, optional: prop.optional });

	return slots;
}

function expressionFill(expression: JsxExpression): SlotFill {
	if (expression.elements.length) return { kind: "elements", elements: expression.elements.map(slotElement) };

	if (expression.empty || NOTHING.test(expression.text)) return EMPTY;
	const literal = STRING.exec(expression.text);

	if (literal) return literal[2] ? { kind: "text", text: literal[2] } : EMPTY;

	return { kind: "code", text: expression.text.trim() };
}

function childrenFill(element: JsxElement): SlotFill {
	const elements: SlotElement[] = [];
	let text = "";
	let code: string | null = null;

	for (const child of element.children) {
		if (child.kind === "element") {
			elements.push(slotElement(child));
			continue;
		}

		if (child.kind === "text") {
			text += child.value;
			continue;
		}

		const fill = expressionFill(child);

		if (fill.kind === "elements") elements.push(...fill.elements);
		else if (fill.kind === "text") text += fill.text;
		else if (fill.kind === "code") code ??= fill.text;
	}

	if (elements.length) return { kind: "elements", elements };

	if (code !== null) return { kind: "code", text: code };

	return text.trim() ? { kind: "text", text: text.trim() } : EMPTY;
}

/** What one usage puts in a slot */
export function slotFill(element: JsxElement, slot: string): SlotFill {
	if (slot === "children") return childrenFill(element);
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === slot);

	if (attribute?.kind !== "attribute") return EMPTY;
	const { value } = attribute;

	if (!value) return { kind: "code", text: "true" };

	if (value.kind === "string") return value.value ? { kind: "text", text: value.value } : EMPTY;

	return expressionFill(value);
}

/** Every usage of the component, with what it puts in each slot */
export function slotUsages(
	files: Record<string, string>,
	componentPath: string,
	component: ComponentExport,
): SlotUsage[] {
	const slots = componentSlots(component);

	return componentElements(files, componentPath, component.name).map(({ path, source, element }) => {
		const fills: Record<string, SlotFill> = {};

		for (const slot of slots) fills[slot.name] = slotFill(element, slot.name);

		return { path, start: element.start, line: source.slice(0, element.start).split("\n").length, fills };
	});
}

export function slotCounts(usages: SlotUsage[], slot: string): SlotCounts {
	const counts: SlotCounts = { empty: 0, text: 0, elements: 0, code: 0 };

	for (const usage of usages) counts[usage.fills[slot]?.kind ?? "empty"] += 1;

	return counts;
}

/** Element names inside the slot, so their imports can go when they are no longer used */
function contentNames(element: JsxElement, slot: string): string[] {
	const roots: JsxElement[] = [];

	if (slot === "children") {
		for (const child of element.children)
			if (child.kind === "element") roots.push(child);
			else if (child.kind === "expression") roots.push(...child.elements);
	} else {
		for (const attribute of element.attributes)
			if (attribute.kind === "attribute" && attribute.name === slot && attribute.value?.kind === "expression")
				roots.push(...attribute.value.elements);
	}

	return flatten(roots).flatMap((found) => (found.name && !found.intrinsic ? [found.name.split(".")[0]!] : []));
}

/** Empties one usage's slot: children go (the tag self-closes), a prop is removed, and imports only it used go too */
export function clearSlot(source: string, start: number, slot: string): string | null {
	const element = findElement(parseFile(source).roots, start);

	if (!element || element.name === null) return null;
	const names = contentNames(element, slot);
	let next: string | null;

	if (slot !== "children") next = setAttribute(source, start, slot, null);
	else if (element.selfClosing || element.closingStart === null) next = source;
	else next = `${source.slice(0, element.openingEnd - 1).trimEnd()} />${source.slice(element.end)}`;

	return next === null ? null : removeUnusedImports(next, names);
}
