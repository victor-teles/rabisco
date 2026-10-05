/**
 * "Make component": moves a JSX subtree to `components/<kebab>.tsx` and replaces
 * it, and every structurally equivalent subtree in the project (see shape.ts),
 * with a usage of the new component. Never throws.
 */

import { isComponentFile, isScreenFile, toKebab } from "../project";
import type { FileChange } from "../types";
import { addImport, readImports, removeUnusedImports, type ImportDecl } from "./imports";
import { componentExporting, componentSpecifier, projectComponentNames, resolveModule, rewriteModule } from "./modules";
import { slotPropNames } from "./naming";
import { declaredNames, freeIdentifiers, inferType } from "./scope";
import { shapeKey, slotsOf, subtreeSize, type Slot } from "./shape";
import { attrValue, dedent, indentAt, indentUnit, reindent, toPascal, toSentence } from "./text";
import { findElement, flatten, parseFile, type JsxAttribute, type JsxElement, type ParsedFile } from "./tree";

export type ExtractInput = {
	/** Project files by path (`screens/*.tsx`, `components/*.tsx`, …) */
	files: Record<string, string>;
	/** File of the selected element */
	path: string;
	/** Start offset of the selected element in that file */
	start: number;
	/** What the user called it: `Stat card`, `stat-card` or `StatCard` */
	name: string;
	/**
	 * Replace only these subtrees (e.g. a duplicate suggestion's occurrences) instead
	 * of every equivalent one in the project. The selected element is always replaced.
	 */
	occurrences?: readonly { path: string; start: number }[];
};

/** A prop of the extracted component. `slot` props come from text or strings that differ between occurrences. */
export type ExtractedProp = { name: string; type: string; source: "slot" | "identifier" };

export type ExtractResult =
	| {
			ok: true;
			/** `components/stat-card.tsx` */
			componentPath: string;
			/** `StatCard` */
			exportName: string;
			props: ExtractedProp[];
			/** The new component file first, then every file that now uses it */
			changes: FileChange[];
			/** Occurrences replaced per file, selection included */
			replaced: { path: string; count: number }[];
	  }
	| { ok: false; reason: string };

type Binding = { kind: "import"; decl: ImportDecl; imported: string } | { kind: "prop"; tag: boolean } | { kind: "global" };

type Occurrence = { path: string; file: ParsedFile; element: JsxElement; key: JsxAttribute | null; slots: Slot[]; bindings: Map<string, Binding> };

const keyOf = (element: JsxElement) => element.attributes.find((a) => a.kind === "attribute" && a.name === "key") ?? null;

/** Imports and declared names of a parsed file, computed once per file: `findDuplicates` asks for many subtrees of it. */
const fileFacts = new WeakMap<ParsedFile, { imports: ImportDecl[]; declared: ReturnType<typeof declaredNames> }>();

function factsOf(file: ParsedFile) {
	let facts = fileFacts.get(file);
	if (!facts) {
		facts = { imports: readImports(file), declared: declaredNames(file) };
		fileFacts.set(file, facts);
	}
	return facts;
}

/** How each free identifier of the subtree is bound in its file, or why it can't move. */
function bindingsOf(path: string, file: ParsedFile, element: JsxElement): Map<string, Binding> | string {
	const key = keyOf(element);
	const free = freeIdentifiers(file, element, key ? [key] : []);
	const {
		imports,
		declared: { all, topLevel },
	} = factsOf(file);
	const bindings = new Map<string, Binding>();
	for (const { name, tag } of free) {
		const decl = imports.find((d) => d.defaultName === name || d.namespace === name || d.named.some((s) => s.local === name));
		if (decl) {
			const imported = decl.defaultName === name ? "default" : decl.namespace === name ? "*" : decl.named.find((s) => s.local === name)!.imported;
			bindings.set(name, { kind: "import", decl, imported });
		} else if (all.has(name)) {
			if (tag && topLevel.has(name)) return `It uses <${name}>, which is defined in ${path}. Make that a component first.`;
			bindings.set(name, { kind: "prop", tag });
		} else bindings.set(name, { kind: "global" });
	}
	return bindings;
}

/** The free identifiers and how they are bound (imports by resolved module): equal for subtrees that can share a component. */
function bindingSignature(path: string, bindings: Map<string, Binding>) {
	return [...bindings]
		.map(([name, binding]) => (binding.kind === "import" ? `${name}:${resolveModule(path, binding.decl.module)}:${binding.imported}` : `${name}:${binding.kind}`))
		.sort()
		.join("|");
}

/** Same free identifiers, bound the same way (imports compared by resolved module). */
const sameBindings = (a: Occurrence, b: Occurrence) => bindingSignature(a.path, a.bindings) === bindingSignature(b.path, b.bindings);

/**
 * How "Make component" sees `element` in `path`: subtrees with the same shape
 * (shape.ts) and the same signature become one component, and an extraction
 * replaces them together. `null` when the element can't be extracted (it uses a
 * component defined in its own file). `findDuplicates` groups by this too, so
 * a suggestion lists exactly what its "Make component" replaces.
 */
export function extractionSignature(path: string, file: ParsedFile, element: JsxElement): string | null {
	const bindings = bindingsOf(path, file, element);
	return typeof bindings === "string" ? null : bindingSignature(path, bindings);
}

const sourceFiles = (files: Record<string, string>) =>
	Object.keys(files)
		.filter((path) => isScreenFile(path) || isComponentFile(path))
		.sort();

/** Import lines for the component file: the bindings it uses, in the order the source file imports them. */
function importLines(occurrence: Occurrence, componentPath: string) {
	const lines: string[] = [];
	for (const decl of readImports(occurrence.file)) {
		const used = [...occurrence.bindings].filter(([, b]) => b.kind === "import" && b.decl.start === decl.start);
		if (!used.length) continue;
		const names = used.map(([local, b]) => ({ local, imported: (b as { imported: string }).imported }));
		const parts: string[] = [];
		const def = names.find((n) => n.imported === "default");
		const ns = names.find((n) => n.imported === "*");
		const named = names.filter((n) => n !== def && n !== ns).map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`));
		if (def) parts.push(def.local);
		if (ns) parts.push(`* as ${ns.local}`);
		if (named.length) parts.push(`{ ${named.join(", ")} }`);
		lines.push(`import ${parts.join(", ")} from "${rewriteModule(occurrence.path, decl.module, componentPath)}";`);
	}
	return lines;
}

/** Every equivalent subtree in the project with the same bindings, the selection first. */
function findOccurrences(files: Record<string, string>, selected: Occurrence) {
	const key = shapeKey(selected.element);
	const size = subtreeSize(selected.element);
	const found: Occurrence[] = [selected];
	for (const path of sourceFiles(files)) {
		const file = parseFile(files[path]!);
		if (!file.ok) continue;
		for (const element of flatten(file)) {
			if (element === selected.element || subtreeSize(element) !== size || shapeKey(element) !== key) continue;
			const bindings = bindingsOf(path, file, element);
			if (typeof bindings === "string") continue;
			const occurrence: Occurrence = { path, file, element, key: keyOf(element), slots: slotsOf(element), bindings };
			if (sameBindings(occurrence, selected)) found.push(occurrence);
		}
	}
	return found;
}

/** Extracts the element at `start` in `path` into a new component, replacing it and its repeats. */
export function extractComponent(input: ExtractInput): ExtractResult {
	try {
		return extract(input);
	} catch (error) {
		return { ok: false, reason: `Couldn't make a component: ${String((error as Error)?.message ?? error)}` };
	}
}

function extract({ files, path, start, name, occurrences: only }: ExtractInput): ExtractResult {
	const source = files[path];
	if (source === undefined) return { ok: false, reason: `${path} doesn't exist.` };
	const file = parseFile(source);
	if (!file.ok) return { ok: false, reason: `${path} has a syntax error. Fix it first.` };
	const element = findElement(file, start);
	if (!element) return { ok: false, reason: "Select an element to make a component." };
	if (element.name === null) return { ok: false, reason: "A fragment can't become a component. Select an element inside it." };
	if (projectComponentNames(path, file).has(element.name.split(".")[0]!) && subtreeSize(element) === 1) {
		return { ok: false, reason: `This is already the ${element.name} component.` };
	}
	const exportName = toPascal(name);
	if (!exportName) return { ok: false, reason: "Give the component a name that starts with a letter." };
	const existing = componentExporting(files, exportName);
	if (existing) return { ok: false, reason: `${existing} already has a component named ${exportName}.` };
	const base = toKebab(toSentence(exportName));
	let componentPath = `components/${base}.tsx`;
	for (let n = 2; componentPath in files; n++) componentPath = `components/${base}-${n}.tsx`;

	const bindings = bindingsOf(path, file, element);
	if (typeof bindings === "string") return { ok: false, reason: bindings };
	const selected: Occurrence = { path, file, element, key: keyOf(element), slots: slotsOf(element), bindings };
	let occurrences = findOccurrences(files, selected);
	if (only) {
		const wanted = new Set(only.map((o) => `${o.path}\0${o.start}`));
		occurrences = occurrences.filter((o) => o === selected || wanted.has(`${o.path}\0${o.element.start}`));
	}
	for (const occurrence of occurrences) {
		if (declaredNames(occurrence.file).all.has(exportName)) return { ok: false, reason: `${occurrence.path} already uses the name ${exportName}.` };
	}

	// Props: slots that differ between occurrences, then outside values the subtree reads
	const varying = selected.slots
		.map((slot, index) => ({ slot, index, values: occurrences.map((o) => o.slots[index]!.value) }))
		.filter(({ values }) => new Set(values).size > 1);
	const identifiers = [...bindings].filter(([, b]) => b.kind === "prop").map(([n]) => n);
	const slotNames = slotPropNames(varying, [...bindings.keys(), exportName]);
	const props: ExtractedProp[] = [
		...varying.map((_, i) => ({ name: slotNames[i]!, type: "string", source: "slot" as const })),
		...identifiers.map((n) => {
			const inferred = inferType(file, n, element);
			const tag = (bindings.get(n) as { tag: boolean }).tag;
			return { name: n, type: tag && inferred === "any" ? "ElementType" : inferred, source: "identifier" as const };
		}),
	];

	const componentSource = componentFile(selected, componentPath, exportName, props, varying.map(({ slot }, i) => ({ slot, name: slotNames[i]! })));

	// Call sites
	const changes: FileChange[] = [{ path: componentPath, content: componentSource }];
	const replaced: { path: string; count: number }[] = [];
	const byPath = new Map<string, Occurrence[]>();
	for (const occurrence of occurrences) byPath.set(occurrence.path, [...(byPath.get(occurrence.path) ?? []), occurrence]);
	for (const [filePath, list] of byPath) {
		let out = files[filePath]!;
		for (const occurrence of [...list].sort((a, b) => b.element.start - a.element.start)) {
			const attrs = [
				occurrence.key ? out.slice(occurrence.key.start, occurrence.key.end) : null,
				...varying.map(({ index }, i) => {
					const slot = occurrence.slots[index]!;
					return `${slotNames[i]}=${slot.kind === "attribute" ? slot.raw : attrValue(slot.value)}`;
				}),
				...identifiers.map((n) => `${n}={${n}}`),
			].filter(Boolean);
			const call = `<${exportName}${attrs.map((a) => ` ${a}`).join("")} />`;
			out = out.slice(0, occurrence.element.start) + call + out.slice(occurrence.element.end);
		}
		out = addImport(out, componentSpecifier(componentPath), [exportName]);
		const moved = [...list[0]!.bindings].filter(([, b]) => b.kind === "import").map(([n]) => n);
		out = removeUnusedImports(out, moved);
		changes.push({ path: filePath, content: out });
		replaced.push({ path: filePath, count: list.length });
	}
	return { ok: true, componentPath, exportName, props, changes, replaced };
}

/** Source of the component file for the selected occurrence. */
function componentFile(selected: Occurrence, componentPath: string, exportName: string, props: ExtractedProp[], slots: { slot: Slot; name: string }[]) {
	const { file, element } = selected;
	const source = file.source;
	const edits: { from: number; to: number; text: string }[] = [];
	if (selected.key) {
		let from = selected.key.start;
		while (from > element.nameEnd && /\s/.test(source[from - 1]!)) from--;
		edits.push({ from, to: selected.key.end, text: "" });
	}
	for (const { slot, name } of slots) edits.push({ from: slot.start, to: slot.end, text: `{${name}}` });
	edits.sort((a, b) => b.from - a.from);
	let jsx = source.slice(element.start, element.end);
	for (const edit of edits) jsx = jsx.slice(0, edit.from - element.start) + edit.text + jsx.slice(edit.to - element.start);
	jsx = dedent(jsx, indentAt(source, element.start));

	const unit = indentUnit(source);
	const body = jsx.includes("\n") ? `${unit}return (\n${reindent(jsx, unit + unit, unit)}\n${unit});` : `${unit}return ${jsx};`;
	const imports = importLines(selected, componentPath);
	if (props.some((p) => p.type === "ElementType")) imports.unshift(`import type { ElementType } from "react";`);
	const parts = imports.length ? [imports.join("\n")] : [];
	let signature = "()";
	if (props.length) {
		const typeName = `${exportName}Props`;
		parts.push(`type ${typeName} = {\n${props.map((p) => `${unit}${p.name}: ${p.type};`).join("\n")}\n};`);
		signature = `({ ${props.map((p) => p.name).join(", ")} }: ${typeName})`;
	}
	parts.push(`export function ${exportName}${signature} {\n${body}\n}`);
	return `${parts.join("\n\n")}\n`;
}
