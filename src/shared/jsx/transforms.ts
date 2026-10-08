// Each edit returns `null` when the file does not parse or no element starts at the offset.

import { isNumber } from "../guards";
import { attrValue, dedent, indentAt, indentUnit, lineEnd, lineStart, reindent, startsLine } from "./text";
import { findElement, flatten, parseFile, type JsxElement } from "./tree";

/** Value is the element's start offset in the original source. */
export const LOC_ATTRIBUTE = "data-rabisco-loc";

function elementIn(source: string, start: number): JsxElement | null {
	const parsed = parseFile(source);

	return parsed.ok ? findElement(parsed, start) : null;
}

const splice = (source: string, from: number, to: number, text: string) =>
	source.slice(0, from) + text + source.slice(to);

/** The children that render something, in source order: elements, non-empty expressions and visible text (trimmed). */
export function childSlots(parent: JsxElement): { start: number; end: number }[] {
	return parent.children.flatMap((child) => {
		if (child.kind === "element") return [{ start: child.start, end: child.end }];

		if (child.kind === "expression") return child.empty ? [] : [{ start: child.start, end: child.end }];

		if (!child.value) return [];

		// A lone space between inline elements renders, but has nothing to trim to
		if (!child.raw.trim()) return [{ start: child.start, end: child.end }];

		const lead = child.raw.length - child.raw.trimStart().length;
		const trail = child.raw.length - child.raw.trimEnd().length;

		return [{ start: child.start + lead, end: child.end - trail }];
	});
}

/** `child` goes between `before` and `after` at `at`; `start` is where its first non-blank character lands. */
function place(source: string, at: number, before: string, child: string, after: string) {
	const lead = child.length - child.trimStart().length;

	return { source: splice(source, at, at, before + child + after), start: at + before.length + lead };
}

/** Inserts `snippet` as child slot `index` of the element at `parentStart` (past the end appends; a self-closing parent gets a closing tag). `start` is the inserted element's offset in the result. */
export function insertAt(
	source: string,
	parentStart: number,
	index: number,
	snippet: string,
): { source: string; start: number } | null {
	const parent = elementIn(source, parentStart);

	if (!parent || !snippet.trim()) return null;
	const unit = indentUnit(source);
	const parentIndent = indentAt(source, parent.start);
	const child = reindent(snippet, parentIndent + unit, unit);

	if (parent.selfClosing) {
		// `<div className="x" />` → `<div className="x">…</div>`
		const slash = source.lastIndexOf("/", parent.end - 1);
		let from = slash;

		while (from > parent.nameEnd && /\s/.test(source[from - 1]!)) from--;
		const closing = `\n${parentIndent}</${parent.name ?? ""}>`;

		return place(splice(source, from, parent.end, ""), from, ">\n", child, closing);
	}

	const slot = childSlots(parent)[Math.max(0, index)];

	if (slot) {
		if (startsLine(source, slot.start)) {
			// On its own line: the child goes on the line above, indented like it
			const at = lineStart(source, slot.start);

			return place(source, at, "", reindent(snippet, indentAt(source, slot.start), unit), "\n");
		}

		// Inline siblings (`<div><A /><B /></div>`, `Hi <b>there</b>`): stay inline when it fits on one line
		if (!child.includes("\n")) return place(source, slot.start, "", child.trimStart(), "");

		return place(source, slot.start, "\n", child, `\n${parentIndent}${unit}`);
	}

	const closing = parent.closingStart!;

	if (startsLine(source, closing) && lineStart(source, closing) > parent.openingEnd) {
		// Closing tag on its own line: the child goes on the line above it
		return place(source, lineStart(source, closing), "", child, "\n");
	}

	// `<p>Hi</p>`, `<div></div>`: break the closing tag onto its own line
	const before = source.slice(parent.openingEnd, closing);
	const trimmedEnd = before.trim() ? closing - (before.length - before.trimEnd().length) : parent.openingEnd;

	return place(splice(source, trimmedEnd, closing, ""), trimmedEnd, "\n", child, `\n${parentIndent}`);
}

/** As the last child; a self-closing parent gets a closing tag. */
export const insertChild = (source: string, parentStart: number, snippet: string): string | null =>
	insertAt(source, parentStart, Infinity, snippet)?.source ?? null;

/** `true` writes a bare `name`; `false` and `null` remove it. */
export function setAttribute(
	source: string,
	elementStart: number,
	name: string,
	value: string | number | boolean | null,
): string | null {
	const element = elementIn(source, elementStart);

	if (!element || element.name === null || !/^[A-Za-z_][\w:.-]*$/.test(name)) return null;

	const existing = [...element.attributes]
		.reverse()
		.find((attribute) => attribute.kind === "attribute" && attribute.name === name);

	if (value === false || value === null) {
		if (!existing) return source;

		if (startsLine(source, existing.start) && !source.slice(existing.end, lineEnd(source, existing.end)).trim()) {
			// Alone on its line: drop the line
			return splice(
				source,
				lineStart(source, existing.start),
				Math.min(lineEnd(source, existing.end) + 1, source.length),
				"",
			);
		}

		let from = existing.start;

		while (from > 0 && /[ \t]/.test(source[from - 1]!)) from--;

		if (source[from - 1] === "\n") from = existing.start;

		return splice(source, from, existing.end, "");
	}

	const text =
		value === true
			? name
			: isNumber(value)
				? `${name}={${Number.isFinite(value) ? value : 0}}`
				: `${name}=${attrValue(value)}`;

	if (existing) return splice(source, existing.start, existing.end, text);
	const last = element.attributes[element.attributes.length - 1];

	if (last && startsLine(source, last.start) && lineStart(source, last.start) > lineStart(source, element.start)) {
		// One attribute per line: keep that layout
		return splice(source, last.end, last.end, `\n${indentAt(source, last.start)}${text}`);
	}

	const at = last ? last.end : element.nameEnd;

	return splice(source, at, at, ` ${text}`);
}

/** Keywords after which `(…)` is grouping, not a call: `return (`, `yield (`… */
const GROUPING_KEYWORD = /(?:^|[^\w$.])(?:return|yield|await|case|default|else|do|typeof|void|in|of|throw)$/;

/** Also drops grouping parens that would hold nothing else: `return (<main/>);` → `return null;` */
function replaceRoot(source: string, element: JsxElement): string {
	let from = element.start;
	let to = element.end;
	let open = from;

	while (open > 0 && /\s/.test(source[open - 1]!)) open--;
	let close = to;

	while (close < source.length && /\s/.test(source[close]!)) close++;

	if (source[open - 1] === "(" && source[close] === ")") {
		const before = source.slice(0, open - 1).trimEnd();

		// `f(<div />)` is a call: keep its parens
		if (!/[\w$)\]]$/.test(before) || GROUPING_KEYWORD.test(before)) {
			from = open - 1;
			to = close + 1;
		}
	}

	const text = /[\w$]/.test(source[from - 1] ?? "") ? " null" : "null";

	return splice(source, from, to, text);
}

/** Inside an expression or as a root it becomes `null`; a `{…}` child that held only it is removed. */
export function removeElement(source: string, start: number): string | null {
	const element = elementIn(source, start);

	if (!element) return null;
	const container = element.container;

	if (!element.parent && !container) return replaceRoot(source, element);
	let from = element.start;
	let to = element.end;

	if (container) {
		// A brace-less attribute value (`icon=<Star />`): its container is the element itself
		if (container.start === element.start && container.end === element.end)
			return splice(source, element.start, element.end, "{null}");

		const whole =
			!container.text.slice(0, element.start - container.start - 1).trim() &&
			!container.text.slice(element.end - container.start - 1).trim();

		const isChild = element.parent?.children.includes(container) ?? false;

		if (!whole || !isChild) return splice(source, element.start, element.end, "null");
		from = container.start;
		to = container.end;
	}

	if (startsLine(source, from) && !source.slice(to, lineEnd(source, to)).trim()) {
		const end = lineEnd(source, to);

		return source.slice(0, lineStart(source, from)) + source.slice(Math.min(end + 1, source.length));
	}

	return splice(source, from, to, "");
}

/** A copy goes right after the element, on a line of its own when the element has one. `start` is the copy's offset. */
export function duplicateElement(source: string, start: number): { source: string; start: number } | null {
	const element = elementIn(source, start);

	// A root or an element inside `{…}` has no sibling slot to take the copy
	if (!element?.parent || element.container) return null;
	const gap = startsLine(source, element.start) ? `\n${indentAt(source, element.start)}` : "";
	const copy = gap + source.slice(element.start, element.end);

	return { source: splice(source, element.end, element.end, copy), start: element.end + gap.length };
}

/** On a line of its own the element moves one level in. `start` is the wrapper's offset, which was the element's. */
export function wrapElement(
	source: string,
	start: number,
	tag = "div",
	className?: string,
): { source: string; start: number } | null {
	const element = elementIn(source, start);

	if (!element) return null;
	const text = source.slice(element.start, element.end);
	const opening = className ? `<${tag} className=${attrValue(className)}>` : `<${tag}>`;

	if (!startsLine(source, element.start)) {
		return { source: splice(source, element.start, element.end, `${opening}${text}</${tag}>`), start: element.start };
	}

	const indent = indentAt(source, element.start);
	const unit = indentUnit(source);
	const inner = reindent(dedent(text, indent), indent + unit, unit);

	return {
		source: splice(source, element.start, element.end, `${opening}\n${inner}\n${indent}</${tag}>`),
		start: element.start,
	};
}

/** Figma's auto layout: a vertical flex stack */
export const STACK_CLASSES = "flex flex-col gap-2";

export const wrapInStack = (source: string, start: number) => wrapElement(source, start, "div", STACK_CLASSES);

/** Lines after the first move from indent `from` to `to`; the first starts mid-line wherever it lands. */
function rebase(text: string, from: string, to: string) {
	if (from === to) return text;

	return text
		.split("\n")
		.map((line, i) => (i > 0 && line.startsWith(from) ? to + line.slice(from.length) : line))
		.join("\n");
}

const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);

const isVoid = (element: JsxElement) => element.name !== null && VOID_TAGS.has(element.name);

/** An element that is a plain child, the only kind that has sibling slots to move among */
function movable(source: string, start: number) {
	const element = elementIn(source, start);

	return element?.parent && !element.container ? { element, parent: element.parent } : null;
}

/** Swaps the element with the previous (-1) or next (1) sibling that renders something. `null` at the edges. `start` is the element's new offset. */
export function moveAmongSiblings(
	source: string,
	start: number,
	delta: -1 | 1,
): { source: string; start: number } | null {
	const found = movable(source, start);

	if (!found) return null;
	// A lone space between inline siblings is a slot, but swapping with it moves nothing
	const slots = childSlots(found.parent).filter((slot) => source.slice(slot.start, slot.end).trim());
	const index = slots.findIndex((slot) => slot.start === found.element.start);
	const other = slots[index + delta];

	if (index < 0 || !other) return null;
	const [a, b] = delta < 0 ? [other, slots[index]!] : [slots[index]!, other];
	const indentA = indentAt(source, a.start);
	const indentB = indentAt(source, b.start);
	const intoA = rebase(source.slice(b.start, b.end), indentB, indentA);
	const intoB = rebase(source.slice(a.start, a.end), indentA, indentB);
	const between = source.slice(a.end, b.start);
	const next = source.slice(0, a.start) + intoA + between + intoB + source.slice(b.end);

	return { source: next, start: delta < 0 ? a.start : a.start + intoA.length + between.length };
}

/**
 * Moves the element to child slot `index` of the element at `parentStart`. `index` counts the parent's slots
 * before the move, the element's own included, as `dropTarget` and `dropPlacement` report them: in its own parent,
 * its own index and the one after leave it where it is. `start` is the element's new offset.
 * Refuses roots, elements inside `{…}`, void parents (`<img>`), and moving an element into itself.
 */
export function moveElement(
	source: string,
	start: number,
	parentStart: number,
	index: number,
): { source: string; start: number } | null {
	const found = movable(source, start);
	const parent = elementIn(source, parentStart);

	if (!found || !parent || isVoid(parent)) return null;
	const { element } = found;

	if (parent.start >= element.start && parent.start < element.end) return null;
	const slots = childSlots(parent);
	const at = Math.min(Math.max(0, index), slots.length);
	// The slot of `parent` that holds the element, when `parent` is one of its ancestors
	const holder = slots.findIndex((slot) => element.start >= slot.start && element.start < slot.end);

	if (found.parent === parent && (at === holder || at === holder + 1)) return { source, start };
	const before = holder < 0 ? parent.end <= element.start : at <= holder;
	const code = dedent(source.slice(element.start, element.end), indentAt(source, element.start));
	const inserted = insertAt(source, parent.start, at, code);

	if (!inserted) return null;
	const shift = before ? inserted.source.length - source.length : 0;
	const next = removeElement(inserted.source, element.start + shift);

	if (next === null || !parseFile(next).ok) return null;

	return { source: next, start: before ? inserted.start : inserted.start - (inserted.source.length - next.length) };
}

/**
 * Replaces the element with its children, one level out. Refused without children, and where the result must be one
 * element (a root, or inside `{…}`) but the children aren't. `start` is the first unwrapped element's offset, or the
 * parent's when only text was unwrapped.
 */
export function unwrapElement(source: string, start: number): { source: string; start: number } | null {
	const element = elementIn(source, start);

	if (!element) return null;
	const slots = childSlots(element).filter((slot) => source.slice(slot.start, slot.end).trim());
	const first = slots[0];
	const last = slots[slots.length - 1];

	if (!first || !last) return null;

	const single =
		slots.length === 1 && element.children.some((child) => child.kind === "element" && child.start === first.start);

	if ((!element.parent || element.container) && !single) return null;
	const indent = indentAt(source, element.start);
	const from = startsLine(source, first.start) ? indentAt(source, first.start) : indent + indentUnit(source);
	const text = rebase(source.slice(first.start, last.end), from, indent);
	const next = splice(source, element.start, element.end, text);
	const parsed = parseFile(next);

	if (!parsed.ok) return null;

	// The earliest start in the unwrapped text is its first top-level element
	const starts = flatten(parsed).flatMap((inner) =>
		inner.start >= element.start && inner.start < element.start + text.length ? [inner.start] : [],
	);

	const selected = starts.length ? Math.min(...starts) : element.parent?.start;

	return selected === undefined ? null : { source: next, start: selected };
}

/** One or more elements, as copied: no screen module, nothing but JSX */
export function isElementCode(text: string) {
	const code = text.trim();

	if (!code.startsWith("<") || /^\s*(?:import|export)\b/m.test(code)) return false;
	const parsed = parseFile(`const pasted = <>\n${code}\n</>;`);

	return parsed.ok && parsed.roots.length === 1 && parsed.roots[0]!.children.some((child) => child.kind === "element");
}

/**
 * Pastes element code as Figma does: into a selected empty container (an intrinsic, non-void tag without children),
 * else right after the selected element; a root or an element inside `{…}` takes it as its last child.
 * `start` is the first pasted element's offset.
 */
export function pasteElement(source: string, start: number, code: string): { source: string; start: number } | null {
	const element = elementIn(source, start);

	if (!element || !isElementCode(code)) return null;
	const empty = element.intrinsic && !isVoid(element) && !childSlots(element).length;
	const found = movable(source, start);
	let result: { source: string; start: number } | null;

	if (found && !empty) {
		const index = childSlots(found.parent).findIndex((slot) => slot.start === element.start);
		result = insertAt(source, found.parent.start, index + 1, code);
	} else if (isVoid(element)) return null;
	else result = insertAt(source, element.start, Infinity, code);

	return result && parseFile(result.source).ok ? result : null;
}

/** `screens/home.tsx:120` → `{ path, start }`; a bare offset (`120`) has no path. */
export function parseLocation(value: string | null | undefined): { path: string | null; start: number } | null {
	if (!value) return null;
	const colon = value.lastIndexOf(":");
	const start = Number(colon < 0 ? value : value.slice(colon + 1));

	if (!Number.isInteger(start) || start < 0) return null;

	return { path: colon < 0 ? null : value.slice(0, colon), start };
}

/** Fragments take no props besides `key`, so they get no location. */
const isFragment = (element: JsxElement) =>
	element.name === null || element.name === "Fragment" || element.name.endsWith(".Fragment");

// Components get it as a prop the runtime reads from React's tree, so it works even if they don't pass it on.
// Insertions stay within their line, so compile errors keep their line numbers.
export function injectLocations(source: string, path?: string): string {
	const parsed = parseFile(source);

	if (!parsed.ok) return source;

	const targets = flatten(parsed).filter(
		(element) =>
			!isFragment(element) && !element.attributes.some((a) => a.kind === "attribute" && a.name === LOC_ATTRIBUTE),
	);

	if (!targets.length) return source;
	targets.sort((a, b) => a.nameEnd - b.nameEnd);
	// Quotes or braces in a path would break the attribute; project paths never have them
	const prefix = path ? `${path.replace(/["{}<>&]/g, "")}:` : "";
	const parts: string[] = [];
	let last = 0;

	for (const element of targets) {
		parts.push(source.slice(last, element.nameEnd), ` ${LOC_ATTRIBUTE}="${prefix}${element.start}"`);
		last = element.nameEnd;
	}

	parts.push(source.slice(last));

	return parts.join("");
}
