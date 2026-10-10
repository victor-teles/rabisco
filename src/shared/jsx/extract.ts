import { isComponentFile, isScreenFile, toKebab } from "../project";
import type { FileChange } from "../types";
import { addImport, readImports, removeUnusedImports, type ImportDecl } from "./imports";
import { componentExporting, componentSpecifier, projectComponentNames, resolveModule, rewriteModule } from "./modules";
import { slotPropNames } from "./naming";
import { declaredNames, freeIdentifiers, inferType } from "./scope";
import { structureKey, slotsOf, subtreeSize, type Slot } from "./structure";
import { attrValue, dedent, indentAt, indentUnit, reindent, toPascal, toSentence } from "./text";
import { findElement, flatten, parseFile, type JsxAttribute, type JsxElement, type ParsedFile } from "./tree";

export type ExtractInput = {
	files: Record<string, string>;
	path: string;
	start: number;
	/** `Stat card`, `stat-card` or `StatCard` */
	name: string;
	/** Replace only these instead of every equivalent subtree; the selection is always replaced. */
	occurrences?: readonly { path: string; start: number }[];
};

/** `slot` props come from text or strings that differ between occurrences. */
export type ExtractedProp = { name: string; type: string; source: "slot" | "identifier" };

export type ExtractResult =
	| {
			ok: true;
			componentPath: string;
			exportName: string;
			props: ExtractedProp[];
			/** The new component file first */
			changes: FileChange[];
			replaced: { path: string; count: number }[];
	  }
	| { ok: false; reason: string };

type Binding =
	| { kind: "import"; decl: ImportDecl; imported: string }
	| { kind: "prop"; tag: boolean }
	| { kind: "global" };

type Occurrence = {
	path: string;
	file: ParsedFile;
	element: JsxElement;
	key: JsxAttribute | null;
	slots: Slot[];
	bindings: Map<string, Binding>;
};

const keyOf = (element: JsxElement) =>
	element.attributes.find((a) => a.kind === "attribute" && a.name === "key") ?? null;

/** Per file: `findDuplicates` asks for many subtrees of the same file. */
const fileFacts = new WeakMap<ParsedFile, { imports: ImportDecl[]; declared: ReturnType<typeof declaredNames> }>();

function factsOf(file: ParsedFile) {
	let facts = fileFacts.get(file);

	if (!facts) {
		facts = { imports: readImports(file), declared: declaredNames(file) };
		fileFacts.set(file, facts);
	}

	return facts;
}

type BindingsResult = { ok: true; bindings: Map<string, Binding> } | { ok: false; reason: string };

function bindingsOf(path: string, file: ParsedFile, element: JsxElement): BindingsResult {
	const key = keyOf(element);
	const free = freeIdentifiers(file, element, key ? [key] : []);

	const {
		imports,
		declared: { all, topLevel },
	} = factsOf(file);

	const bindings = new Map<string, Binding>();

	for (const { name, tag } of free) {
		const decl = imports.find(
			(d) => d.defaultName === name || d.namespace === name || d.named.some((s) => s.local === name),
		);

		if (decl) {
			const imported =
				decl.defaultName === name
					? "default"
					: decl.namespace === name
						? "*"
						: decl.named.find((s) => s.local === name)!.imported;

			bindings.set(name, { kind: "import", decl, imported });
		} else if (all.has(name)) {
			if (tag && topLevel.has(name))
				return { ok: false, reason: `It uses <${name}>, which is defined in ${path}. Make that a component first.` };
			bindings.set(name, { kind: "prop", tag });
		} else bindings.set(name, { kind: "global" });
	}

	return { ok: true, bindings };
}

/** Equal for subtrees that can share a component; imports compared by resolved module. */
function bindingSignature(path: string, bindings: Map<string, Binding>) {
	return [...bindings]
		.map(([name, binding]) =>
			binding.kind === "import"
				? `${name}:${resolveModule(path, binding.decl.module)}:${binding.imported}`
				: `${name}:${binding.kind}`,
		)
		.sort()
		.join("|");
}

const sameBindings = (a: Occurrence, b: Occurrence) =>
	bindingSignature(a.path, a.bindings) === bindingSignature(b.path, b.bindings);

/** `findDuplicates` groups by this too, so a suggestion lists exactly what extraction replaces. */
export function extractionSignature(path: string, file: ParsedFile, element: JsxElement): string | null {
	const result = bindingsOf(path, file, element);

	return result.ok ? bindingSignature(path, result.bindings) : null;
}

const sourceFiles = (files: Record<string, string>) =>
	Object.keys(files)
		.filter((path) => isScreenFile(path) || isComponentFile(path))
		.sort();

/** In the order the source file imports them */
function importLines(occurrence: Occurrence, componentPath: string) {
	const lines: string[] = [];

	for (const decl of readImports(occurrence.file)) {
		const names = [...occurrence.bindings].flatMap(([local, b]) =>
			b.kind === "import" && b.decl.start === decl.start ? [{ local, imported: b.imported }] : [],
		);

		if (!names.length) continue;
		const parts: string[] = [];
		const def = names.find((n) => n.imported === "default");
		const ns = names.find((n) => n.imported === "*");

		const named = names.flatMap((n) =>
			n === def || n === ns ? [] : [n.imported === n.local ? n.local : `${n.imported} as ${n.local}`],
		);

		if (def) parts.push(def.local);

		if (ns) parts.push(`* as ${ns.local}`);

		if (named.length) parts.push(`{ ${named.join(", ")} }`);
		lines.push(`import ${parts.join(", ")} from "${rewriteModule(occurrence.path, decl.module, componentPath)}";`);
	}

	return lines;
}

/** The selection first */
function findOccurrences(files: Record<string, string>, selected: Occurrence) {
	const key = structureKey(selected.element);
	const size = subtreeSize(selected.element);
	const found: Occurrence[] = [selected];

	for (const path of sourceFiles(files)) {
		const file = parseFile(files[path]!);

		if (!file.ok) continue;

		for (const element of flatten(file)) {
			if (element === selected.element || subtreeSize(element) !== size || structureKey(element) !== key) continue;
			const result = bindingsOf(path, file, element);

			if (!result.ok) continue;

			const occurrence: Occurrence = {
				path,
				file,
				element,
				key: keyOf(element),
				slots: slotsOf(element),
				bindings: result.bindings,
			};

			if (sameBindings(occurrence, selected)) found.push(occurrence);
		}
	}

	return found;
}

export function extractComponent(input: ExtractInput): ExtractResult {
	try {
		return extract(input);
	} catch (error) {
		return {
			ok: false,
			reason: `Couldn't make a component: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function extract({ files, path, start, name, occurrences: only }: ExtractInput): ExtractResult {
	const source = files[path];

	if (source === undefined) return { ok: false, reason: `${path} doesn't exist.` };
	const file = parseFile(source);

	if (!file.ok) return { ok: false, reason: `${path} has a syntax error. Fix it first.` };
	const element = findElement(file, start);

	if (!element) return { ok: false, reason: "Select an element to make a component." };

	if (element.name === null)
		return { ok: false, reason: "A fragment can't become a component. Select an element inside it." };

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

	const result = bindingsOf(path, file, element);

	if (!result.ok) return result;
	const { bindings } = result;
	const selected: Occurrence = { path, file, element, key: keyOf(element), slots: slotsOf(element), bindings };
	let occurrences = findOccurrences(files, selected);

	if (only) {
		const wanted = new Set(only.map((o) => `${o.path}\0${o.start}`));
		occurrences = occurrences.filter((o) => o === selected || wanted.has(`${o.path}\0${o.element.start}`));
	}

	for (const occurrence of occurrences) {
		if (declaredNames(occurrence.file).all.has(exportName))
			return { ok: false, reason: `${occurrence.path} already uses the name ${exportName}.` };
	}

	// Props: slots that differ between occurrences, then outside values the subtree reads
	const varying = selected.slots
		.map((slot, index) => ({ slot, index, values: occurrences.map((o) => o.slots[index]!.value) }))
		.filter(({ values }) => new Set(values).size > 1);

	// Outside values become props; `tag` when used as a JSX tag
	const outside = [...bindings].flatMap(([name, b]) => (b.kind === "prop" ? [{ name, tag: b.tag }] : []));
	const identifiers = outside.map(({ name }) => name);
	const slotNames = slotPropNames(varying, [...bindings.keys(), exportName]);

	const props: ExtractedProp[] = [
		...varying.map((_, i) => ({ name: slotNames[i]!, type: "string", source: "slot" as const })),
		...outside.map(({ name: n, tag }) => {
			const inferred = inferType(file, n, element);

			return { name: n, type: tag && inferred === "any" ? "ElementType" : inferred, source: "identifier" as const };
		}),
	];

	const componentSource = componentFile(
		selected,
		componentPath,
		exportName,
		props,
		varying.map(({ slot }, i) => ({ slot, name: slotNames[i]! })),
	);

	const changes: FileChange[] = [{ path: componentPath, content: componentSource }];
	const replaced: { path: string; count: number }[] = [];
	const byPath = new Map<string, Occurrence[]>();

	for (const occurrence of occurrences)
		byPath.set(occurrence.path, [...(byPath.get(occurrence.path) ?? []), occurrence]);

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
		const moved = [...list[0]!.bindings].flatMap(([n, b]) => (b.kind === "import" ? [n] : []));
		out = removeUnusedImports(out, moved);
		changes.push({ path: filePath, content: out });
		replaced.push({ path: filePath, count: list.length });
	}

	return { ok: true, componentPath, exportName, props, changes, replaced };
}

function componentFile(
	selected: Occurrence,
	componentPath: string,
	exportName: string,
	props: ExtractedProp[],
	slots: { slot: Slot; name: string }[],
) {
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

	for (const edit of edits)
		jsx = jsx.slice(0, edit.from - element.start) + edit.text + jsx.slice(edit.to - element.start);
	jsx = dedent(jsx, indentAt(source, element.start));

	const unit = indentUnit(source);

	const body = jsx.includes("\n")
		? `${unit}return (\n${reindent(jsx, unit + unit, unit)}\n${unit});`
		: `${unit}return ${jsx};`;

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
