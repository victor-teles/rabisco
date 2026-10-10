// Lucide icons in a screen are named imports used as elements: `import { Star } from "lucide-react"` + `<Star />`.

import { addImport, importedNames, readImports, removeUnusedImports } from "./imports";
import { findElement, parseFile } from "./tree";

export const LUCIDE_MODULE = "lucide-react";

/** `local` is the name in the JSX, `imported` the lucide export (`Home`, `HomeIcon`, `LucideHome`) */
export type IconUsage = { local: string; imported: string };

/** `null` when the element at `start` isn't a lucide icon imported by name */
export function iconAt(source: string, start: number): IconUsage | null {
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, start) : null;

	if (!element || element.name === null || element.intrinsic) return null;

	for (const decl of readImports(parsed)) {
		if (decl.module !== LUCIDE_MODULE || decl.typeOnly) continue;
		const spec = decl.named.find((s) => s.local === element.name && !s.type);

		if (spec) return { local: spec.local, imported: spec.imported };
	}

	return null;
}

/** `Star` → `Star`, `StarIcon` and `LucideStar` all name the same icon */
export const iconBase = (name: string) => name.replace(/^Lucide(?=[A-Z0-9])/, "").replace(/(?<=.)Icon$/, "");

const declares = (source: string, name: string) =>
	new RegExp(`(?:^|[^\\w$.])(?:function|const|let|var|class)\\s+${name}(?![\\w$])`).test(source);

/**
 * The element at `start` becomes `icon` (a lucide export name, `Heart`): its tags are renamed, `icon` is
 * imported from lucide-react and the old icon's import goes when nothing else uses it. When another import or
 * declaration already takes the name, the `HeartIcon` alias is used. `null` when it isn't an icon.
 */
export function swapIcon(source: string, start: number, icon: string): string | null {
	const usage = iconAt(source, start);

	if (!usage || !/^[A-Z][\w$]*$/.test(icon)) return null;

	if (iconBase(usage.imported) === iconBase(icon)) return source;
	const parsed = parseFile(source);
	const element = findElement(parsed, start)!;
	const imports = readImports(parsed);
	const fromLucide = imports.find((decl) => decl.module === LUCIDE_MODULE && !decl.typeOnly);
	const existing = fromLucide?.named.find((s) => !s.type && iconBase(s.imported) === iconBase(icon));
	const others = importedNames(imports.filter((decl) => decl.module !== LUCIDE_MODULE));
	const taken = (name: string) => others.has(name) || declares(source, name);
	const base = iconBase(icon);
	const local = existing?.local ?? [base, `${base}Icon`].find((name) => !taken(name));

	if (!local) return null;
	let next = source;

	// Closing tag first, so the opening tag's offsets hold
	if (element.closingStart !== null) {
		const at = next.indexOf(usage.local, element.closingStart);
		next = next.slice(0, at) + local + next.slice(at + usage.local.length);
	}

	const at = next.indexOf(usage.local, element.start);
	next = next.slice(0, at) + local + next.slice(at + usage.local.length);

	if (!existing) next = addImport(next, LUCIDE_MODULE, [local]);

	return removeUnusedImports(next, [usage.local]);
}
