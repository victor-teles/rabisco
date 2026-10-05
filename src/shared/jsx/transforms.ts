/**
 * Source-to-source edits of JSX elements, addressed by the element's start
 * offset. Each returns the new source, or `null` when the file does not parse
 * or has no element starting there.
 */

import { attrValue, indentAt, indentUnit, lineEnd, lineStart, reindent, startsLine } from "./text";
import { findElement, flatten, parseFile, type JsxElement } from "./tree";

/** The attribute that maps a DOM node back to its element: the element's start offset in the original source. */
export const LOC_ATTRIBUTE = "data-rabisco-loc";

function elementIn(source: string, start: number): JsxElement | null {
	const parsed = parseFile(source);
	return parsed.ok ? findElement(parsed, start) : null;
}

const splice = (source: string, from: number, to: number, text: string) => source.slice(0, from) + text + source.slice(to);

/**
 * Inserts JSX `snippet` as the last child of the element at `parentStart`,
 * re-indented one level deeper than the parent. A self-closing parent gets a
 * closing tag. Fragments work too.
 */
export function insertChild(source: string, parentStart: number, snippet: string): string | null {
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
		return splice(source, from, parent.end, `>\n${child}\n${parentIndent}</${parent.name ?? ""}>`);
	}
	const closing = parent.closingStart!;
	if (startsLine(source, closing) && lineStart(source, closing) > parent.openingEnd) {
		// Closing tag on its own line: the child goes on the line above it
		const at = lineStart(source, closing);
		return splice(source, at, at, `${child}\n`);
	}
	// `<p>Hi</p>`, `<div></div>`: break the closing tag onto its own line
	const before = source.slice(parent.openingEnd, closing);
	const trimmedEnd = before.trim() ? closing - (before.length - before.trimEnd().length) : parent.openingEnd;
	return splice(source, trimmedEnd, closing, `\n${child}\n${parentIndent}`);
}

/**
 * Sets an attribute: a string becomes `name="…"` (or `name={"…"}` when quotes
 * can't hold it), a number `name={3}`, `true` a bare `name`; `false` and `null`
 * remove it. Replaces the attribute in place, or appends it after the others.
 */
export function setAttribute(source: string, elementStart: number, name: string, value: string | number | boolean | null): string | null {
	const element = elementIn(source, elementStart);
	if (!element || element.name === null || !/^[A-Za-z_][\w:.-]*$/.test(name)) return null;
	const existing = [...element.attributes].reverse().find((attribute) => attribute.kind === "attribute" && attribute.name === name);
	if (value === false || value === null) {
		if (!existing) return source;
		if (startsLine(source, existing.start) && !source.slice(existing.end, lineEnd(source, existing.end)).trim()) {
			// Alone on its line: drop the line
			return splice(source, lineStart(source, existing.start), Math.min(lineEnd(source, existing.end) + 1, source.length), "");
		}
		let from = existing.start;
		while (from > 0 && /[ \t]/.test(source[from - 1]!)) from--;
		if (source[from - 1] === "\n") from = existing.start;
		return splice(source, from, existing.end, "");
	}
	const text = value === true ? name : typeof value === "number" ? `${name}={${Number.isFinite(value) ? value : 0}}` : `${name}=${attrValue(value)}`;
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

/**
 * Replaces a JSX root (no parent element, no container) with `null`, along with
 * grouping parens that would hold nothing else: `return (\n<main/>\n);` →
 * `return null;`, `() => (<div />)` → `() => null`, `const x = <div />;` → `const x = null;`.
 */
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

/**
 * Removes the element. Lines it leaves empty go too. Inside an expression it
 * becomes `null` (`{open && null}`, `icon={null}`), and a `{…}` child that held
 * only it is removed. A root (what a function returns, or a `const`) becomes `null`.
 */
export function removeElement(source: string, start: number): string | null {
	const element = elementIn(source, start);
	if (!element) return null;
	const container = element.container;
	if (!element.parent && !container) return replaceRoot(source, element);
	let from = element.start;
	let to = element.end;
	if (container) {
		// A brace-less attribute value (`icon=<Star />`): its container is the element itself
		if (container.start === element.start && container.end === element.end) return splice(source, element.start, element.end, "{null}");
		const whole = !container.text.slice(0, element.start - container.start - 1).trim() && !container.text.slice(element.end - container.start - 1).trim();
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

/** `screens/home.tsx:120` → `{ path, start }`; a bare offset (`120`) has no path. `null` when malformed. */
export function parseLocation(value: string | null | undefined): { path: string | null; start: number } | null {
	if (!value) return null;
	const colon = value.lastIndexOf(":");
	const start = Number(colon < 0 ? value : value.slice(colon + 1));
	if (!Number.isInteger(start) || start < 0) return null;
	return { path: colon < 0 ? null : value.slice(0, colon), start };
}

/** Fragments take no props besides `key`, so they get no location. */
const isFragment = (element: JsxElement) => element.name === null || element.name === "Fragment" || element.name.endsWith(".Fragment");

/**
 * Adds `data-rabisco-loc="<start>"` to every element but fragments, right
 * after its tag name, with the start offset in `source`. DOM elements carry it
 * as an attribute; component elements receive it as a prop, which the screen
 * runtime reads from React's tree, so a component usage maps back to its JSX
 * even when the component doesn't pass the prop on. With `path`, the value is
 * `<path>:<start>`, so a node maps back to its file too (see `parseLocation`).
 * Positions only move within their line, so compile errors keep their line
 * numbers. Returns the source unchanged when it does not parse.
 */
export function injectLocations(source: string, path?: string): string {
	const parsed = parseFile(source);
	if (!parsed.ok) return source;
	const targets = flatten(parsed).filter((element) => !isFragment(element) && !element.attributes.some((a) => a.kind === "attribute" && a.name === LOC_ATTRIBUTE));
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
