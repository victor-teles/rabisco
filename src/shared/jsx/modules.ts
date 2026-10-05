/** Module paths between project files (`screens/*`, `components/*`) and the exports of component files. */

import { isComponentFile } from "../project";
import { readImports } from "./imports";
import type { ParsedFile } from "./tree";

const dirOf = (path: string) => path.split("/").slice(0, -1);

/** A relative specifier resolved to a project path without extension (`../components/card` from `screens/a.tsx` → `components/card`); others as is. */
export function resolveModule(fromPath: string, specifier: string) {
	if (!specifier.startsWith(".")) return specifier;
	const parts = dirOf(fromPath);
	for (const part of specifier.split("/")) {
		if (part === "..") parts.pop();
		else if (part !== ".") parts.push(part);
	}
	return parts.join("/").replace(/\.tsx?$/, "");
}

/** How `toPath` imports what `fromPath` imports as `specifier`. Project components are always `../components/<name>`. */
export function rewriteModule(fromPath: string, specifier: string, toPath: string) {
	const resolved = resolveModule(fromPath, specifier);
	if (resolved === specifier) return specifier;
	if (resolved.startsWith("components/")) return `../${resolved}`;
	const from = dirOf(toPath);
	const to = resolved.split("/");
	let common = 0;
	while (common < from.length && from[common] === to[common]) common++;
	const up = from.length - common;
	return `${up ? "../".repeat(up) : "./"}${to.slice(common).join("/")}`;
}

/** The specifier that screens and components use for a component file: `components/stat-card.tsx` → `../components/stat-card`. */
export const componentSpecifier = (componentPath: string) => `../${componentPath.replace(/\.tsx$/, "")}`;

/** Local names a file imports from project component files. */
export function projectComponentNames(path: string, file: ParsedFile) {
	const names = new Set<string>();
	for (const decl of readImports(file)) {
		if (!isComponentFile(`${resolveModule(path, decl.module)}.tsx`)) continue;
		for (const s of decl.named) names.add(s.local);
		if (decl.defaultName) names.add(decl.defaultName);
	}
	return names;
}

const exportedCache = new Map<string, ReadonlySet<string>>();
const EXPORTED_CACHE_SIZE = 256;

/** Names a file exports (`export function X`, `export const X`, `export { X }`), memoized by content. */
export function exportedNames(source: string): ReadonlySet<string> {
	const hit = exportedCache.get(source);
	if (hit) return hit;
	const names = new Set<string>();
	for (const match of source.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
	for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
		for (const part of match[1]!.split(",")) {
			const name = /([\w$]+)\s*$/.exec(part.trim())?.[1];
			if (name) names.add(name);
		}
	}
	if (exportedCache.size >= EXPORTED_CACHE_SIZE) exportedCache.delete(exportedCache.keys().next().value!);
	exportedCache.set(source, names);
	return names;
}

/** Every name the project's component files export. */
export function componentExports(files: Record<string, string>): Set<string> {
	const names = new Set<string>();
	for (const path in files) if (isComponentFile(path)) for (const name of exportedNames(files[path]!)) names.add(name);
	return names;
}

/** The component file that already exports `name`, if any. */
export function componentExporting(files: Record<string, string>, name: string) {
	return Object.keys(files)
		.sort()
		.find((path) => isComponentFile(path) && exportedNames(files[path]!).has(name));
}
