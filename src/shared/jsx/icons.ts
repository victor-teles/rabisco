// Icons in a screen are named imports from an icon pack used as elements: `import { Star } from "lucide-react"` + `<Star />`.

import { ICON_PACKS, iconBase, iconPackOf, type IconPack } from "../icons";
import { addImport, importedNames, readImports, removeUnusedImports } from "./imports";
import { findElement, parseFile } from "./tree";

export const LUCIDE_MODULE = ICON_PACKS.lucide.module;

/** `local` is the name in the JSX, `imported` the pack's export (`Home`, `HomeIcon`, `LucideHome`, `IconHome`) */
export type IconUsage = { pack: IconPack; local: string; imported: string };

/** `null` when the element at `start` isn't an icon imported by name from a pack */
export function iconAt(source: string, start: number): IconUsage | null {
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, start) : null;

	if (!element || element.name === null || element.intrinsic) return null;

	for (const decl of readImports(parsed)) {
		const pack = iconPackOf(decl.module);

		if (!pack || decl.typeOnly) continue;
		const spec = decl.named.find((s) => s.local === element.name && !s.type);

		if (spec) return { pack, local: spec.local, imported: spec.imported };
	}

	return null;
}

const declares = (source: string, name: string) =>
	new RegExp(`(?:^|[^\\w$.])(?:function|const|let|var|class)\\s+${name}(?![\\w$])`).test(source);

/** Lucide and Phosphor export `Heart` and `HeartIcon`; Tabler only `IconHeart` */
const localNames = (pack: IconPack, icon: string) => {
	const base = iconBase(pack, icon);

	return pack === "tabler" ? [icon] : [base, `${base}Icon`];
};

/**
 * The element at `start` becomes `icon` (an export name of `pack`, `Heart`): its tags are renamed, `icon` is
 * imported from the pack and the old icon's import goes when nothing else uses it. `pack` defaults to the old
 * icon's. When another import or declaration already takes the name, the `HeartIcon` alias is used. `null` when
 * it isn't an icon.
 */
export function swapIcon(source: string, start: number, icon: string, pack?: IconPack): string | null {
	const usage = iconAt(source, start);

	if (!usage || !/^[A-Z][\w$]*$/.test(icon)) return null;
	const target = pack ?? usage.pack;

	if (target === usage.pack && iconBase(target, usage.imported) === iconBase(target, icon)) return source;
	const module = ICON_PACKS[target].module;
	const parsed = parseFile(source);
	const element = findElement(parsed, start)!;
	const imports = readImports(parsed);
	const fromPack = imports.find((decl) => decl.module === module && !decl.typeOnly);
	const existing = fromPack?.named.find((s) => !s.type && iconBase(target, s.imported) === iconBase(target, icon));
	const others = importedNames(imports.filter((decl) => decl.module !== module));
	const taken = (name: string) => others.has(name) || declares(source, name);
	const local = existing?.local ?? localNames(target, icon).find((name) => !taken(name));

	if (!local) return null;
	let next = source;

	// Closing tag first, so the opening tag's offsets hold
	if (element.closingStart !== null) {
		const at = next.indexOf(usage.local, element.closingStart);
		next = next.slice(0, at) + local + next.slice(at + usage.local.length);
	}

	const at = next.indexOf(usage.local, element.start);
	next = next.slice(0, at) + local + next.slice(at + usage.local.length);

	if (!existing) next = addImport(next, module, [local]);

	return removeUnusedImports(next, [usage.local]);
}
