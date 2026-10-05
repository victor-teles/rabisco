/**
 * Prototype links (decision 0007): an element links to another screen with a
 * `data-link-to` attribute in its TSX, e.g. `data-link-to="screens/settings.tsx"`,
 * or `data-link-to="back"` to go back. Play mode follows them; the canvas draws
 * them. Only string literals count: an expression is code, not a link.
 */

import { setAttribute } from "../jsx/transforms";
import { findElement, flatten, parseFile, type JsxElement } from "../jsx/tree";
import { isComponentFile, isScreenFile } from "../project";
import type { FileChange, ProjectFiles } from "../types";

/** The attribute that holds an element's link. */
export const LINK_ATTRIBUTE = "data-link-to";

/** The link target that goes back to the previous screen. */
export const BACK = "back";

/** An element of a file, by its start offset in the current source. */
export type ElementRef = { file: string; start: number };

/** One link in a project: the element at `start` of `file` links to `to`, as written. */
export type ProjectLink = ElementRef & { to: string };

/** What a link's value points to: a screen file of the project, "back", or nothing that exists. */
export type ResolvedLink = { kind: "screen"; file: string } | { kind: "back" } | { kind: "broken"; to: string };

/** The value of a `{"…"}`, `{'…'}` or `` {`…`} `` expression without interpolation; `undefined` for anything else. */
function stringLiteral(text: string): string | undefined {
	const trimmed = text.trim();
	const match = /^(["'`])([\s\S]*)\1$/.exec(trimmed);
	if (!match) return undefined;
	const [, quote, body] = match;
	if (quote === "`") return body!.includes("${") || body!.includes("`") ? undefined : body;
	if (quote === '"') {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return undefined;
		}
	}
	return body!.includes("'") || body!.includes("\\") ? undefined : body;
}

/**
 * The link written on `element`: the string value of its last `data-link-to`.
 * `null` when it has none, or when the value is an expression (`{target}`).
 */
export function linkOfElement(element: JsxElement): string | null {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === LINK_ATTRIBUTE);
	if (attribute?.kind !== "attribute" || !attribute.value) return null;
	const value = attribute.value.kind === "string" ? attribute.value.value : stringLiteral(attribute.value.text);
	return value?.trim() ? value.trim() : null;
}

/** Whether `element` has a `data-link-to` whose value is code rather than a string (read-only in the inspector). */
export function hasExpressionLink(element: JsxElement): boolean {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === LINK_ATTRIBUTE);
	return attribute?.kind === "attribute" && attribute.value?.kind === "expression" && linkOfElement(element) === null;
}

/** The link of the element at `ref`, as written; `null` when it has none, or the file or element is gone. */
export function readLink(files: ProjectFiles, ref: ElementRef): string | null {
	const source = files[ref.file];
	if (source === undefined) return null;
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, ref.start) : null;
	return element ? linkOfElement(element) : null;
}

/**
 * Links the element at `start` to `to` (a screen path or `"back"`), or removes
 * its link when `to` is `null`. Returns the new source, or `null` when the
 * file doesn't parse or has no element there. Formatting follows `setAttribute`.
 */
export function setLink(source: string, start: number, to: string | null): string | null {
	return setAttribute(source, start, LINK_ATTRIBUTE, to === null || !to.trim() ? null : to.trim());
}

/** Files that can hold links: screens, and components (a link in a component applies wherever it renders). */
const canLink = (path: string) => isScreenFile(path) || isComponentFile(path);

/**
 * Every literal link of the project, by file (sorted) then source order.
 * Files that don't parse, and expression values, are skipped.
 */
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

/**
 * The screen path a link value names, forgiving what people and models write:
 * `./settings.tsx`, `/screens/settings.tsx`, `settings` and `screens/settings`
 * all mean `screens/settings.tsx`.
 */
export function normalizeTarget(to: string): string {
	let path = to.trim().replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
	if (!path.includes("/")) path = `screens/${path}`;
	if (!path.endsWith(".tsx")) path = `${path}.tsx`;
	return path;
}

/**
 * Where a link goes: `"back"`, an existing screen file of `files`, or broken
 * (the screen was deleted or renamed, or the value names no screen).
 */
export function resolveLink(to: string, files: ProjectFiles): ResolvedLink {
	if (to.trim().toLowerCase() === BACK) return { kind: "back" };
	const file = normalizeTarget(to);
	return isScreenFile(file) && files[file] !== undefined ? { kind: "screen", file } : { kind: "broken", to };
}

/**
 * Points every link to `from` at `to` instead, for a screen that was renamed.
 * Returns the files to write (none when nothing linked to `from`).
 */
export function retargetLinks(files: ProjectFiles, from: string, to: string): FileChange[] {
	const changes: FileChange[] = [];
	const byFile = new Map<string, ProjectLink[]>();
	for (const link of listLinks(files)) {
		if (link.to.trim().toLowerCase() !== BACK && normalizeTarget(link.to) === from) byFile.set(link.file, [...(byFile.get(link.file) ?? []), link]);
	}
	for (const [file, links] of byFile) {
		// Last first, so earlier offsets stay valid
		let source = files[file]!;
		for (const link of [...links].reverse()) source = setLink(source, link.start, to) ?? source;
		if (source !== files[file]) changes.push({ path: file, content: source });
	}
	return changes;
}
