/** Readable names for extracted props and suggested components. */

import type { Slot } from "./structure";
import { flatten, type JsxElement } from "./tree";

const RESERVED = new Set(
	"key ref children props break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(
		" ",
	),
);

const NUMERIC = /^[-+]?[$€£¥]?\s?\d[\d,.\s]*(%|[kKmMbB]|\+)?$/;

const classOf = (element: JsxElement) => {
	const attribute = element.attributes.find(
		(a) => a.kind === "attribute" && (a.name === "className" || a.name === "class"),
	);

	return attribute?.kind === "attribute" && attribute.value
		? attribute.value.kind === "string"
			? attribute.value.value
			: attribute.value.text
		: "";
};

/** `aria-label` → `ariaLabel` */
const camel = (name: string) =>
	name.replace(/[-:.]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase()).replace(/[^\w$]/g, "");

/** A base prop name for a text slot, from its element and the values it takes. */
function textName(element: JsxElement, values: string[]) {
	const name = element.name ?? "";
	const cls = classOf(element);

	if (values.every((value) => NUMERIC.test(value.trim()))) return "value";

	if (/^h[1-6]$|Title$/.test(name) || /\bfont-(semibold|bold|extrabold)\b/.test(cls)) return "title";

	if (/^(button|a|label|Button|Badge|Link)$/.test(name) || /Trigger$|Item$/.test(name)) return "label";
	const long = values.some((value) => value.split(/\s+/).length >= 4);

	if (name.endsWith("Description") || (long && (name === "p" || /\btext-muted-foreground\b/.test(cls))))
		return "description";

	return long ? "text" : "label";
}

/**
 * Prop names for the slots that vary, in order: attribute slots take the
 * attribute's name (`href`, `alt`), text slots a role (`title`, `value`,
 * `description`, `label`). Repeats are numbered (`label`, `label2`), and
 * names in `taken` are avoided.
 */
export function slotPropNames(slots: { slot: Slot; values: string[] }[], taken: Iterable<string> = []) {
	const used = new Set(taken);

	return slots.map(({ slot, values }) => {
		let base = slot.kind === "attribute" ? camel(slot.name) : textName(slot.element, values);

		if (!/^[A-Za-z_$]/.test(base) || RESERVED.has(base)) base = `${base}Text`.replace(/^[^A-Za-z_$]+/, "") || "text";
		let name = base;

		for (let n = 2; used.has(name) || RESERVED.has(name); n++) name = `${base}${n}`;
		used.add(name);

		return name;
	});
}

const CARD_CLASS = /\brounded(-\w+)?\b/;

const SURFACE_CLASS = /\b(border|shadow(-\w+)?|bg-card|bg-muted|ring-1)\b/;

/**
 * A short sentence-case name for a repeated subtree ("Stat card", "List item"),
 * guessed from its tags, classes, icons and text. `icons` are the file's lucide-react imports.
 */
export function suggestName(element: JsxElement, icons: Set<string> = new Set()): string {
	const all = flatten(element);
	const names = new Set(all.map((e) => e.name ?? ""));
	const rootName = element.name ?? "";
	const rootClass = classOf(element);

	const texts = all
		.flatMap((e) => e.children.filter((c) => c.kind === "text").map((c) => c.value.trim()))
		.filter(Boolean);

	const cardLike = /^Card$/.test(rootName) || (CARD_CLASS.test(rootClass) && SURFACE_CLASS.test(rootClass));
	const hasNumber = texts.some((text) => NUMERIC.test(text));
	const hasAvatar = names.has("Avatar") || names.has("img") || names.has("AvatarFallback");
	const hasIcon = [...names].some((name) => icons.has(name));
	const hasHeading = all.some((e) => /^h[1-6]$|Title$/.test(e.name ?? ""));

	if (rootName === "tr") return "Table row";

	if (/^(Button|button)$/.test(rootName)) return "Action button";

	if (rootName === "a" || rootName === "Link") return "Nav link";

	if (/^Badge$/.test(rootName)) return "Tag";

	if (cardLike && hasNumber) return "Stat card";

	if (hasAvatar) return cardLike ? "Profile card" : "Person row";

	if (hasIcon && texts.length >= 2) return cardLike ? "Feature card" : "Feature item";

	if (rootName === "li") return "List item";

	if (hasNumber) return "Stat";

	if (cardLike) return hasHeading ? "Info card" : "Card";

	if (/^(section|header|footer|nav|aside|form)$/.test(rootName)) return rootName[0]!.toUpperCase() + rootName.slice(1);

	if (/\bflex\b/.test(rootClass) && !/\bflex-col\b/.test(rootClass)) return "Item row";

	return "Block";
}
