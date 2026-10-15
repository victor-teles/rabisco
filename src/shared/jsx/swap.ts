import { addImport, importedNames, readImports, removeUnusedImports } from "./imports";
import { componentSpecifier, resolveModule } from "./modules";
import { lineStart } from "./text";
import { findElement, parseFile, type JsxAttribute } from "./tree";

export type SwapTarget = {
	name: string;
	/** `components/stat-card.tsx` */
	path: string;
	props: string[];
	acceptsChildren: boolean;
	/** Takes the DOM attributes of an element, so `className`, `id` and `on*` carry over */
	extendsElement: boolean;
};

/** `start` is the swapped element's, in `source` */
export type SwapResult = { source: string; start: number; dropped: string[] } | { error: string };

const ALWAYS_KEPT = /^(?:key|ref|data-.*|aria-.*)$/;

const declares = (source: string, name: string) =>
	new RegExp(`(?:^|[^\\w$.])(?:function|const|let|var|class)\\s+${name}(?![\\w$])`).test(source);

const keeps = (attribute: JsxAttribute, target: SwapTarget) =>
	attribute.kind === "spread" ||
	ALWAYS_KEPT.test(attribute.name) ||
	target.props.includes(attribute.name) ||
	target.extendsElement;

/** The whitespace before it too, and its whole line when it stands alone on one */
function attributeSpan(source: string, attribute: JsxAttribute): [number, number] {
	let start = attribute.start;

	while (start > 0 && /\s/.test(source[start - 1]!)) start--;
	const from = lineStart(source, attribute.start);

	if (!source.slice(from, attribute.start).trim() && source[attribute.end] === "\n") return [from, attribute.end + 1];

	return [start, attribute.end];
}

/**
 * The component usage at `start` becomes `target`: its tags are renamed, the props `target` takes are kept and
 * the others dropped, `target` is imported and the old import goes when nothing else uses it. Children go when
 * `target` takes none.
 */
export function swapComponent(source: string, path: string, start: number, target: SwapTarget): SwapResult {
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, start) : null;

	if (!element || element.name === null || element.intrinsic || element.name.includes("."))
		return { error: "Select a component usage to swap" };
	const imports = readImports(parsed);
	const module = componentSpecifier(target.path);
	const targetModule = target.path.replace(/\.tsx?$/, "");

	const existing = imports
		.filter((decl) => !decl.typeOnly && resolveModule(path, decl.module) === targetModule)
		.flatMap((decl) => decl.named.filter((s) => s.imported === target.name && !s.type))[0];

	if (existing?.local === element.name) return { error: `It's already ${target.name}` };
	const others = importedNames(imports.filter((decl) => resolveModule(path, decl.module) !== targetModule));

	if (!existing && target.name === element.name)
		return { error: `This file imports another ${target.name}. Rename one of them first` };

	if (!existing && (others.has(target.name) || declares(source, target.name)))
		return { error: `${target.name} is already a name in this file` };
	const local = existing?.local ?? target.name;
	const old = element.name;
	const nameAt = source.indexOf(old, element.start);
	const kept = element.attributes.filter((attribute) => keeps(attribute, target));
	const selfClose = !target.acceptsChildren && element.closingStart !== null;
	const tagEnd = kept.at(-1)?.end ?? nameAt + old.length;
	const dropped: string[] = [];
	const edits = [{ start: nameAt, end: nameAt + old.length, text: local }];

	if (selfClose) {
		if (source.slice(element.openingEnd, element.closingStart!).trim()) dropped.push("children");
		edits.push({ start: tagEnd, end: element.end, text: " />" });
	} else if (element.closingStart !== null) {
		const at = source.indexOf(old, element.closingStart);
		edits.push({ start: at, end: at + old.length, text: local });
	}

	for (const attribute of element.attributes) {
		if (attribute.kind !== "attribute" || keeps(attribute, target)) continue;
		dropped.push(attribute.name);

		if (selfClose && attribute.start > tagEnd) continue;
		const [from, to] = attributeSpan(source, attribute);
		edits.push({ start: from, end: to, text: "" });
	}

	let next = source;

	for (const edit of edits.sort((a, b) => b.start - a.start))
		next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);

	const swapped = next;

	if (!existing) next = addImport(next, module, [local]);
	next = removeUnusedImports(next, [old]);

	return { source: next, start: element.start + next.length - swapped.length, dropped };
}
