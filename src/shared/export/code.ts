import { isRelative, resolveRelative } from "../../mainview/lib/render/resolve";
import type { ProjectFiles } from "../types";

/** Specifier is group 2. Excluding `(<=` keeps `export default function` + `from "…"` in JSX text from matching. */
const SPECIFIER = /^[ \t]*(?:import|export)\s*(?:type\s+)?(?:[^'";()<>=]*?\sfrom\s*)?(['"])([^'"\n]+)\1/gm;

export function importSpecifiers(source: string): string[] {
	return [...new Set([...source.matchAll(SPECIFIER)].map((match) => match[2]!))];
}

/** Transitive, in first-import order, without `path` itself. */
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

export function codeToCopy(files: ProjectFiles, path: string, withComponents = false): string {
	const source = files[path];

	if (source === undefined) throw new Error(`${path} doesn't exist`);

	if (!withComponents) return source;

	return [path, ...localDependencies(files, path)].map((file) => `// ${file}\n${files[file]!.trimEnd()}\n`).join("\n");
}
