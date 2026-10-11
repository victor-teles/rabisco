// Decision 0007. Only string literals count: an expression is code, not a link.

import { isString } from "../guards";
import type { Json } from "../json";
import { setAttribute } from "../jsx/transforms";
import { findElement, flatten, parseFile, type JsxElement } from "../jsx/tree";
import { isComponentFile, isScreenFile } from "../project";
import type { FileChange, ProjectFiles } from "../types";
import {
	defaultOverlayTransition,
	LINK_MODE_ATTRIBUTE,
	LINK_TRANSITION_ATTRIBUTE,
	parseOverlayMode,
	parseTransition,
	type LinkTransition,
	type OverlayMode,
} from "./transitions";

export const LINK_ATTRIBUTE = "data-link-to";

export const BACK = "back";

export type ElementRef = { file: string; start: number };

/** `to` as written */
export type ProjectLink = ElementRef & { to: string };

export type ResolvedLink = { kind: "screen"; file: string } | { kind: "back" } | { kind: "broken"; to: string };

/** `{"…"}`, `{'…'}` or `` {`…`} `` without interpolation */
function stringLiteral(text: string): string | undefined {
	const trimmed = text.trim();
	const match = /^(["'`])([\s\S]*)\1$/.exec(trimmed);

	if (!match) return undefined;
	const [, quote, body] = match;

	if (quote === "`") return body!.includes("${") || body!.includes("`") ? undefined : body;

	if (quote === '"') {
		try {
			const value: Json = JSON.parse(trimmed);

			return isString(value) ? value : undefined;
		} catch {
			return undefined;
		}
	}

	return body!.includes("'") || body!.includes("\\") ? undefined : body;
}

function literalAttribute(element: JsxElement, name: string): string | null {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === name);

	if (attribute?.kind !== "attribute" || !attribute.value) return null;
	const value = attribute.value.kind === "string" ? attribute.value.value : stringLiteral(attribute.value.text);

	return value?.trim() ? value.trim() : null;
}

export function linkOfElement(element: JsxElement): string | null {
	return literalAttribute(element, LINK_ATTRIBUTE);
}

export type LinkSettings = { transition: LinkTransition | null; mode: OverlayMode | null };

export function linkSettingsOfElement(element: JsxElement): LinkSettings {
	return {
		transition: parseTransition(literalAttribute(element, LINK_TRANSITION_ATTRIBUTE)),
		mode: parseOverlayMode(literalAttribute(element, LINK_MODE_ATTRIBUTE)),
	};
}

export const effectiveTransition = (settings: LinkSettings): LinkTransition =>
	settings.transition ?? (settings.mode ? defaultOverlayTransition(settings.mode) : "instant");

export type LinkEdit = { to?: string | null; transition?: LinkTransition; mode?: OverlayMode | null };

const isDefaultTransition = (transition: LinkTransition, mode: OverlayMode | null) =>
	transition === effectiveTransition({ transition: null, mode });

export function editLink(source: string, start: number, edit: LinkEdit): string | null {
	let next: string | null = source;

	if (edit.to !== undefined) {
		next = setLink(next, start, edit.to);
		const plain = edit.to === null || !edit.to.trim() || edit.to.trim().toLowerCase() === BACK;

		if (plain && next !== null) next = setAttribute(next, start, LINK_TRANSITION_ATTRIBUTE, null);

		if (plain && next !== null) next = setAttribute(next, start, LINK_MODE_ATTRIBUTE, null);
	}

	if (edit.mode !== undefined && next !== null) next = setAttribute(next, start, LINK_MODE_ATTRIBUTE, edit.mode);

	if (edit.transition !== undefined && next !== null) {
		const parsed = parseFile(next);
		const element = parsed.ok ? findElement(parsed, start) : null;
		const mode = edit.mode === undefined ? (element ? linkSettingsOfElement(element).mode : null) : edit.mode;
		const value = isDefaultTransition(edit.transition, mode) ? null : edit.transition;

		next = setAttribute(next, start, LINK_TRANSITION_ATTRIBUTE, value);
	}

	return next;
}

/** Read-only in the inspector */
export function hasExpressionLink(element: JsxElement): boolean {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === LINK_ATTRIBUTE);

	return attribute?.kind === "attribute" && attribute.value?.kind === "expression" && linkOfElement(element) === null;
}

export function readLink(files: ProjectFiles, ref: ElementRef): string | null {
	const source = files[ref.file];

	if (source === undefined) return null;
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, ref.start) : null;

	return element ? linkOfElement(element) : null;
}

/** `to: null` removes the link; `null` result when the file doesn't parse or no element is there. */
export function setLink(source: string, start: number, to: string | null): string | null {
	return setAttribute(source, start, LINK_ATTRIBUTE, to === null || !to.trim() ? null : to.trim());
}

/** A link in a component applies wherever it renders. */
const canLink = (path: string) => isScreenFile(path) || isComponentFile(path);

/** By file (sorted) then source order */
export function listLinks(files: ProjectFiles): ProjectLink[] {
	const links: ProjectLink[] = [];

	for (const file of Object.keys(files).filter(canLink).sort()) {
		const source = files[file]!;

		if (!source.includes(LINK_ATTRIBUTE)) continue;
		const parsed = parseFile(source);

		if (!parsed.ok) continue;

		for (const element of flatten(parsed)) {
			const to = linkOfElement(element);

			if (to !== null) links.push({ file, start: element.start, to });
		}
	}

	return links;
}

export function linkStarts(source: string): number[] {
	if (!source.includes(LINK_ATTRIBUTE)) return [];
	const parsed = parseFile(source);

	if (!parsed.ok) return [];

	return flatten(parsed).flatMap((element) => (linkOfElement(element) === null ? [] : [element.start]));
}

/** `./settings.tsx`, `/screens/settings.tsx` and `settings` all mean `screens/settings.tsx`. */
export function normalizeTarget(to: string): string {
	let path = to
		.trim()
		.replace(/\\/g, "/")
		.replace(/^(\.\/|\/)+/, "");

	if (!path.includes("/")) path = `screens/${path}`;

	if (!path.endsWith(".tsx")) path = `${path}.tsx`;

	return path;
}

export function resolveLink(to: string, files: ProjectFiles): ResolvedLink {
	if (to.trim().toLowerCase() === BACK) return { kind: "back" };
	const file = normalizeTarget(to);

	return isScreenFile(file) && files[file] !== undefined ? { kind: "screen", file } : { kind: "broken", to };
}

type AttributeEdit = { start: number; name: string; value: string };

function retargetEdits(element: JsxElement, from: string, to: string): AttributeEdit[] {
	const edits: AttributeEdit[] = [];
	const link = linkOfElement(element);
	const href = literalAttribute(element, "href");

	if (link !== null && link.toLowerCase() !== BACK && normalizeTarget(link) === from)
		edits.push({ start: element.start, name: LINK_ATTRIBUTE, value: to });

	if (href !== null && hrefTarget(href) === from)
		edits.push({ start: element.start, name: "href", value: screenHref(to) });

	return edits;
}

/** For a renamed screen: its `data-link-to` links and the export's `href="#/…"` routes */
export function retargetLinks(files: ProjectFiles, from: string, to: string): FileChange[] {
	const changes: FileChange[] = [];

	for (const file of Object.keys(files).filter(canLink).sort()) {
		const source = files[file]!;

		if (!source.includes(LINK_ATTRIBUTE) && !source.includes("#/")) continue;
		const parsed = parseFile(source);

		if (!parsed.ok) continue;
		const edits = flatten(parsed).flatMap((element) => retargetEdits(element, from, to));
		let next = source;

		// Last first, so earlier offsets stay valid
		for (const edit of edits.sort((a, b) => b.start - a.start))
			next = setAttribute(next, edit.start, edit.name, edit.value) ?? next;

		if (next !== source) changes.push({ path: file, content: next });
	}

	return changes;
}

/** The exported app's hash route for a screen (`src/App.tsx` in the Vite export): `screens/settings.tsx` → `#/settings` */
export const screenHref = (file: string) => `#/${file.replace(/^screens\//, "").replace(/\.tsx$/, "")}`;

function hrefTarget(href: string): string | null {
	const match = /^#\/([\w.-]+)$/.exec(href.trim());

	return match ? `screens/${match[1]}.tsx` : null;
}

/** The screen a `#/settings` href routes to in the export, if it exists */
export function hrefScreen(href: string, files: ProjectFiles): string | null {
	const file = hrefTarget(href);

	return file && isScreenFile(file) && files[file] !== undefined ? file : null;
}

/**
 * Points a link at a screen: `href` gets the export's route and `data-link-to` the screen, so the click
 * navigates in play mode and in the exported app alike.
 */
export function linkHrefToScreen(source: string, start: number, file: string): string | null {
	const withHref = setAttribute(source, start, "href", screenHref(file));

	return withHref === null ? null : setLink(withHref, start, file);
}
