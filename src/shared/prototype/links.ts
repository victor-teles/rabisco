// Decision 0007. Only string literals count: an expression is code, not a link.

import { isString } from "../guards";
import type { Json } from "../json";
import { setAttribute } from "../jsx/transforms";
import { findElement, flatten, parseFile, type JsxElement } from "../jsx/tree";
import { isComponentFile, isScreenFile } from "../project";
import type { FileChange, ProjectFiles } from "../types";

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

/** The last `data-link-to` wins; `null` when the value is an expression. */
export function linkOfElement(element: JsxElement): string | null {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === LINK_ATTRIBUTE);

	if (attribute?.kind !== "attribute" || !attribute.value) return null;
	const value = attribute.value.kind === "string" ? attribute.value.value : stringLiteral(attribute.value.text);

	return value?.trim() ? value.trim() : null;
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

/** For a renamed screen */
export function retargetLinks(files: ProjectFiles, from: string, to: string): FileChange[] {
	const changes: FileChange[] = [];
	const byFile = new Map<string, ProjectLink[]>();

	for (const link of listLinks(files)) {
		if (link.to.trim().toLowerCase() !== BACK && normalizeTarget(link.to) === from)
			byFile.set(link.file, [...(byFile.get(link.file) ?? []), link]);
	}

	for (const [file, links] of byFile) {
		// Last first, so earlier offsets stay valid
		let source = files[file]!;

		for (const link of [...links].reverse()) source = setLink(source, link.start, to) ?? source;

		if (source !== files[file]) changes.push({ path: file, content: source });
	}

	return changes;
}
