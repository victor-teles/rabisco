/**
 * Copy as code (Phase 7): a screen or component exactly as the canvas renders it,
 * optionally with the project files it imports, as one paste.
 */

import { isRelative, resolveRelative } from "../../mainview/lib/render/resolve";
import type { ProjectFiles } from "../types";

/**
 * `import … from "x"`, `import "x"` and `export … from "x"` at the start of a line: the specifier is
 * group 2. Import clauses never hold `(`, `<` or `=`, which keeps code like `export default function`
 * followed by `from "…"` in JSX text from matching.
 */
const SPECIFIER = /^[ \t]*(?:import|export)\s*(?:type\s+)?(?:[^'";()<>=]*?\sfrom\s*)?(['"])([^'"\n]+)\1/gm;

/** Module specifiers a source imports or re-exports, in order, without duplicates. */
export function importSpecifiers(source: string): string[] {
	return [...new Set([...source.matchAll(SPECIFIER)].map((match) => match[2]!))];
}

/**
 * Project files `path` imports through relative imports, directly or not, in
 * first-import order, without `path` itself. Imports that match no file are skipped.
 */
export function localDependencies(files: ProjectFiles, path: string): string[] {
	const exists = (file: string) => Object.hasOwn(files, file);
	const seen = new Set([path]);
	const order: string[] = [];

	const visit = (from: string) => {
		for (const specifier of importSpecifiers(files[from] ?? "")) {
			if (!isRelative(specifier)) continue;
			const resolved = resolveRelative(from, specifier, exists);

			if (!resolved || seen.has(resolved)) continue;
			seen.add(resolved);
			order.push(resolved);
			visit(resolved);
		}
	};

	visit(path);

	return order;
}

/**
 * The code to copy for `path`: its source as is, or with `withComponents` the
 * source and every project file it imports, each headed by a `// <path>` comment.
 */
export function codeToCopy(files: ProjectFiles, path: string, withComponents = false): string {
	const source = files[path];

	if (source === undefined) throw new Error(`${path} doesn't exist`);

	if (!withComponents) return source;

	return [path, ...localDependencies(files, path)].map((file) => `// ${file}\n${files[file]!.trimEnd()}\n`).join("\n");
}
