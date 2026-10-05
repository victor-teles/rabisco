import { childElements, findElement, parseJsx, readImports, type JsxElement, type JsxTree } from "../../shared/jsx";
import { resolveModule } from "../../shared/jsx/modules";
import { isComponentFile } from "../../shared/project";

export type OutlineContext = { kind: "map" | "conditional" | "expression" } | { kind: "prop"; name: string };

export type OutlineKind = "intrinsic" | "component" | "fragment";

export type ComponentRef =
	| { source: "project"; path: string; exportName: string }
	| { source: "ui"; module: string; exportName: string }
	| { source: "other"; module: string | null; exportName: string };

export type OutlineNode = {
	/** Index path through `childElements`; stable across edits that don't add or remove siblings. */
	key: string;
	start: number;
	end: number;
	label: string;
	kind: OutlineKind;
	hint: string;
	context: OutlineContext | null;
	component: ComponentRef | null;
	depth: number;
	children: OutlineNode[];
};

export type Outline = { ok: boolean; error: string | null; roots: OutlineNode[] };

const HINT_LENGTH = 36;

const truncate = (text: string, max = HINT_LENGTH) =>
	text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function stringAttribute(element: JsxElement, name: string): string | null {
	const attribute = element.attributes.find((a) => a.kind === "attribute" && a.name === name);

	if (attribute?.kind !== "attribute" || !attribute.value) return null;

	if (attribute.value.kind === "string") return attribute.value.value;
	const literal = /^\s*(["'`])([^"'`]*)\1\s*$/.exec(attribute.value.text);

	return literal ? literal[2]! : null;
}

function directText(element: JsxElement): string {
	return element.children
		.filter((child) => child.kind === "text")
		.map((child) => child.value)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

export function hintOf(element: JsxElement): string {
	const text = directText(element);

	if (text) return `“${truncate(text)}”`;
	const className = stringAttribute(element, "className") ?? stringAttribute(element, "class");

	if (className?.trim()) {
		const tokens = className.trim().split(/\s+/);

		return truncate(tokens.slice(0, 2).join(" ") + (tokens.length > 2 ? " …" : ""));
	}

	if (!element.intrinsic && element.name) {
		for (const attribute of element.attributes) {
			if (attribute.kind !== "attribute" || attribute.name === "key") continue;
			const value = stringAttribute(element, attribute.name);

			if (value) return truncate(`${attribute.name}="${value}"`);
		}
	}

	return "";
}

export function contextOf(element: JsxElement): OutlineContext | null {
	const container = element.container;

	if (!container) return null;
	const prop = element.parent?.attributes.find((a) => a.kind === "attribute" && a.value === container);

	if (prop?.kind === "attribute") return { kind: "prop", name: prop.name };
	const before = container.text.slice(0, Math.max(0, element.start - container.start - 1));

	if (/\.(map|flatMap)\s*\(/.test(before)) return { kind: "map" };

	if (/&&|\|\||\?\?|\?[^.]|:\s*$/.test(before)) return { kind: "conditional" };

	return { kind: "expression" };
}

export function importedComponents(source: string): Map<string, { module: string; imported: string }> {
	const map = new Map<string, { module: string; imported: string }>();

	for (const decl of readImports(source)) {
		if (decl.typeOnly) continue;

		if (decl.defaultName) map.set(decl.defaultName, { module: decl.module, imported: "default" });

		for (const specifier of decl.named)
			if (!specifier.type) map.set(specifier.local, { module: decl.module, imported: specifier.imported });
	}

	return map;
}

export function componentRef(
	path: string,
	name: string,
	imports: Map<string, { module: string; imported: string }>,
): ComponentRef {
	const local = name.split(".")[0]!;
	const found = imports.get(local);

	if (!found || name.includes(".")) return { source: "other", module: found?.module ?? null, exportName: name };
	const ui = /^@\/components\/ui\/([a-z0-9-]+)$/.exec(found.module);

	if (ui) return { source: "ui", module: ui[1]!, exportName: found.imported };
	const resolved = `${resolveModule(path, found.module)}.tsx`;

	if (found.module.startsWith(".") && isComponentFile(resolved))
		return { source: "project", path: resolved, exportName: found.imported };

	return { source: "other", module: found.module, exportName: found.imported };
}

export function buildOutline(path: string, source: string): Outline {
	const tree = parseJsx(source);

	if (!tree.ok) return { ok: false, error: tree.error, roots: [] };
	const imports = importedComponents(source);

	const build = (element: JsxElement, key: string): OutlineNode => {
		const kind: OutlineKind = element.name === null ? "fragment" : element.intrinsic ? "intrinsic" : "component";

		return {
			key,
			start: element.start,
			end: element.end,
			label: element.name ?? "Fragment",
			kind,
			hint: hintOf(element),
			context: contextOf(element),
			component: kind === "component" ? componentRef(path, element.name!, imports) : null,
			depth: element.depth,
			children: childElements(element).map((child, i) => build(child, `${key}.${i}`)),
		};
	};

	return { ok: true, error: null, roots: tree.roots.map((root, i) => build(root, String(i))) };
}

export function visibleRows(roots: OutlineNode[], collapsed: ReadonlySet<string>): OutlineNode[] {
	const rows: OutlineNode[] = [];

	const visit = (node: OutlineNode) => {
		rows.push(node);

		if (!collapsed.has(node.key)) node.children.forEach(visit);
	};

	roots.forEach(visit);

	return rows;
}

/** Ancestors are outermost first. */
export function findNode(roots: OutlineNode[], start: number): { node: OutlineNode; ancestors: OutlineNode[] } | null {
	const search = (
		nodes: OutlineNode[],
		ancestors: OutlineNode[],
	): { node: OutlineNode; ancestors: OutlineNode[] } | null => {
		for (const node of nodes) {
			if (start < node.start || start >= node.end) continue;

			if (node.start === start) return { node, ancestors };
			const found = search(node.children, [...ancestors, node]);

			if (found) return found;
		}

		return null;
	};

	return search(roots, []);
}

export function pathOf(tree: JsxTree, start: number): number[] | null {
	const element = findElement(tree, start);

	if (!element) return null;
	const path: number[] = [];

	for (let at: JsxElement = element; ;) {
		const parent: JsxElement | null = at.parent;
		const siblings = parent ? childElements(parent) : tree.roots;
		path.unshift(siblings.indexOf(at));

		if (!parent) break;
		at = parent;
	}

	return path;
}

export function atPath(tree: JsxTree, path: number[]): JsxElement | null {
	let list = tree.roots;
	let found: JsxElement | null = null;

	for (const index of path) {
		found = list[index] ?? null;

		if (!found) return null;
		list = childElements(found);
	}

	return found;
}

const sameName = (a: JsxElement | null, b: JsxElement | null) => !!a && !!b && a.name === b.name;

/** Shifts the offset for edits outside the element; otherwise re-finds it by tree position. */
export function remapStart(prev: string, next: string, start: number): number | null {
	if (prev === next) return start;
	const before = parseJsx(prev);
	const element = findElement(before, start);

	if (!element) return null;
	const after = parseJsx(next);

	if (!after.ok) return null;

	let prefix = 0;
	const limit = Math.min(prev.length, next.length);

	while (prefix < limit && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
	let suffix = 0;

	while (
		suffix < limit - prefix &&
		prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
	)
		suffix++;
	const changedEnd = prev.length - suffix;

	let candidate: number | null = null;

	if (prefix > element.start) candidate = element.start;
	else if (element.start >= changedEnd) candidate = element.start + next.length - prev.length;

	if (candidate !== null && sameName(element, findElement(after, candidate))) return candidate;

	const path = pathOf(before, start);
	const moved = path ? atPath(after, path) : null;

	return sameName(element, moved) ? moved!.start : null;
}
