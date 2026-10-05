/**
 * Point and prompt: one JSX element a prompt is about. The webview builds the
 * focus from the selected element; the main process checks it against the file
 * on disk, the prompt shows its source, and the guard reports changes made
 * outside it (`src/bun/ai/focus-guard.ts`).
 */

import { findElement, parseFile, type JsxElement } from "../jsx/tree";
import type { ProjectFiles } from "../types";
import type { ElementFocus } from "./contract";

/** Longest text a label quotes */
const LABEL_TEXT = 24;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** 1-based line of `offset` in `source` */
export const lineAt = (source: string, offset: number) => {
	let line = 1;

	for (let i = source.indexOf("\n"); i !== -1 && i < offset; i = source.indexOf("\n", i + 1)) line++;

	return line;
};

function stringAttribute(element: JsxElement, name: string) {
	const attribute = element.attributes.find((a) => a.kind === "attribute" && a.name === name);

	return attribute?.kind === "attribute" && attribute.value?.kind === "string" ? attribute.value.value.trim() : "";
}

/**
 * A short, readable name for an element: `<Button> “Get started”`,
 * `<section#pricing>`, `<h1> “Welcome back”`, `<>` for a fragment.
 */
export function elementLabel(element: JsxElement): string {
	if (element.name === null) return "<>";
	const id = element.intrinsic ? stringAttribute(element, "id") : "";
	const tag = `<${element.name}${id ? `#${id}` : ""}>`;

	const text = element.children
		.filter((child) => child.kind === "text")
		.map((child) => child.value)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

	return text ? `${tag} “${truncate(text, LABEL_TEXT)}”` : tag;
}

/** The focus for the element that starts at `start` in `source`, or `null` when the file doesn't parse or no element starts there. */
export function elementFocus(source: string, file: string, start: number): ElementFocus | null {
	const parsed = parseFile(source);

	if (!parsed.ok) return null;
	const element = findElement(parsed, start);

	if (!element) return null;

	return {
		file,
		start: element.start,
		end: element.end,
		startLine: lineAt(source, element.start),
		endLine: lineAt(source, element.end - 1),
		snippet: source.slice(element.start, element.end),
		label: elementLabel(element),
	};
}

/** The focus for a selected element (`{ file, start }`) in `files`, or `null` when it's gone. */
export function focusOf(
	files: ProjectFiles,
	node: { file: string; start: number } | null | undefined,
): ElementFocus | null {
	const source = node ? files[node.file] : undefined;

	return node && source !== undefined ? elementFocus(source, node.file, node.start) : null;
}

/**
 * `focus` checked against the file as it is now: the same element at the same
 * offset, or else the one place its snippet still appears (the file changed
 * above it). `null` when it can't be found; the request is then a plain edit.
 */
export function resolveFocus(focus: ElementFocus | undefined, files: ProjectFiles): ElementFocus | null {
	const source = focus ? files[focus.file] : undefined;

	if (!focus || source === undefined || !focus.snippet) return null;
	const at = source.slice(focus.start, focus.end) === focus.snippet ? focus.start : source.indexOf(focus.snippet);

	if (at === -1 || (at !== focus.start && source.indexOf(focus.snippet, at + 1) !== -1)) return null;
	const found = elementFocus(source, focus.file, at);

	return found && found.snippet === focus.snippet ? found : null;
}

/** The chat message for a focused prompt, e.g. `<Button> “Get started” in Welcome: make it bigger`. It ends with the prompt. */
export const focusNote = (label: string, where: string, prompt: string) => `${label} in ${where}: ${prompt}`;
