// Equivalent subtrees may differ only in text children and string attribute values (their slots).

import { hashString } from "./hash";
import { jsxTextValue } from "./text";
import type { JsxElement, JsxText } from "./tree";

/** `start`/`end` cover the text (trimmed) or the attribute's quoted value. */
export type Slot =
	| { kind: "text"; element: JsxElement; value: string; start: number; end: number }
	| { kind: "attribute"; element: JsxElement; name: string; value: string; raw: string; start: number; end: number };

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

const FIXED_STRING_ATTRIBUTES = new Set(["className", "class"]);

const keys = new WeakMap<JsxElement, string>();

const counts = new WeakMap<JsxElement, number>();

function serialize(element: JsxElement, root: boolean) {
	let out = `<${element.name ?? ""}`;

	for (const attribute of element.attributes) {
		if (attribute.kind === "spread") out += ` {${norm(attribute.text)}}`;
		else if (root && attribute.name === "key") continue;
		else if (!attribute.value) out += ` ${attribute.name}`;
		else if (attribute.value.kind === "string")
			out += FIXED_STRING_ATTRIBUTES.has(attribute.name)
				? ` ${attribute.name}=${JSON.stringify(norm(attribute.value.value))}`
				: ` ${attribute.name}=S`;
		else out += ` ${attribute.name}={${norm(attribute.value.text)}}`;
	}

	out += ">";

	for (const child of element.children) {
		if (child.kind === "element") out += `(${structureKey(child, false)})`;
		else if (child.kind === "text") out += !child.value ? "" : child.value.trim() ? "T" : "W";
		else if (!child.empty) out += `{${norm(child.text)}}`;
	}

	return out;
}

/** The root's `key` is ignored, since a list item's key stays at the call site. */
export function structureKey(element: JsxElement, root = true): string {
	if (root) return hashString(serialize(element, true));
	let key = keys.get(element);

	if (key === undefined) {
		key = hashString(serialize(element, false));
		keys.set(element, key);
	}

	return key;
}

/** Includes itself and elements inside expressions; memoized */
export function subtreeSize(element: JsxElement): number {
	let count = counts.get(element);

	if (count !== undefined) return count;
	count = 1;

	for (const attribute of element.attributes)
		if (attribute.kind === "attribute" && attribute.value?.kind === "expression")
			for (const e of attribute.value.elements) count += subtreeSize(e);

	for (const child of element.children) {
		if (child.kind === "element") count += subtreeSize(child);
		else if (child.kind === "expression") for (const e of child.elements) count += subtreeSize(e);
	}

	counts.set(element, count);

	return count;
}

function textCore(text: JsxText) {
	const lead = text.raw.length - text.raw.trimStart().length;
	const trail = text.raw.length - text.raw.trimEnd().length;

	return { start: text.start + lead, end: text.end - trail };
}

/** Same order for every equivalent subtree; the root's `key` is not a slot. */
export function slotsOf(element: JsxElement, root = true): Slot[] {
	const slots: Slot[] = [];

	for (const attribute of element.attributes) {
		if (
			attribute.kind !== "attribute" ||
			attribute.value?.kind !== "string" ||
			FIXED_STRING_ATTRIBUTES.has(attribute.name)
		)
			continue;

		if (root && attribute.name === "key") continue;
		const { value, raw, start, end } = attribute.value;
		slots.push({ kind: "attribute", element, name: attribute.name, value, raw, start, end });
	}

	for (const child of element.children) {
		if (child.kind === "element") slots.push(...slotsOf(child, false));
		else if (child.kind === "text" && child.value.trim()) {
			const { start, end } = textCore(child);
			slots.push({
				kind: "text",
				element,
				value: jsxTextValue(child.raw.slice(start - child.start, end - child.start)),
				start,
				end,
			});
		}
	}

	return slots;
}
