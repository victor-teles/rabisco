/**
 * Dropping a component on a screen: the JSX and imports to insert, and where
 * in the screen's source they go. Pure source-to-source logic; the canvas finds
 * the element under the pointer (FrameHost.hitTest) and the editor applies it.
 */

import type { ComponentExport } from "../../shared/components/api";
import type { LibraryImport, LibraryItem } from "../../shared/components/library";
import { sampleProps, type PreviewValue } from "../../shared/components/preview";
import { addImport, componentSpecifier, findElement, insertChild, type JsxElement } from "../../shared/jsx";
import { attrValue, childText } from "../../shared/jsx/text";
import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { parseFile, type ParsedFile, type Token } from "../../shared/jsx/tree";
import { sourceVersion, type FrameHit } from "./render/protocol";

/** The drag data type for items dragged out of the components panel. */
export const COMPONENT_MIME = "application/x-rabisco-component";

/** What the components panel drags: a project component export, or a library item. */
export type DragItem = { kind: "component"; path: string; name: string } | { kind: "library"; id: string };

/**
 * The item being dragged out of the components panel, as `parseDragItem` reads it.
 * WebKit hides custom drag types from `dragover` on non-http origins (the app runs
 * on `views://`), so the canvas reads the drag from here, not from `dataTransfer`.
 */
let activeDrag: string | null = null;
const dragListeners = new Set<() => void>();
const setDrag = (next: string | null) => {
	if (next === activeDrag) return;
	activeDrag = next;
	for (const listener of dragListeners) listener();
};

export const componentDrag = {
	start: (item: DragItem) => setDrag(JSON.stringify(item)),
	end: () => setDrag(null),
	current: () => activeDrag,
	/** For `useSyncExternalStore` */
	subscribe: (listener: () => void) => {
		dragListeners.add(listener);
		return () => void dragListeners.delete(listener);
	},
};

export function parseDragItem(data: string): DragItem | null {
	try {
		const item = JSON.parse(data) as DragItem;
		if (item?.kind === "component" && typeof item.path === "string" && typeof item.name === "string") return item;
		if (item?.kind === "library" && typeof item.id === "string") return item;
	} catch {
		// Not ours
	}
	return null;
}

/** JSX and imports to insert. */
export type Insertion = { snippet: string; imports: LibraryImport[] };

function attribute(name: string, value: PreviewValue, icons: Set<string>): string | null {
	if (typeof value === "string") return `${name}=${attrValue(value)}`;
	if (typeof value === "number") return `${name}={${value}}`;
	if (typeof value === "boolean") return value ? name : `${name}={false}`;
	if (Array.isArray(value)) return `${name}={${JSON.stringify(value)}}`;
	icons.add(value.icon);
	return `${name}={${value.icon}}`;
}

/**
 * `<StatCard label="Label" value={42} />` for a project component: its sample
 * props (required props and variants) written as readable JSX, with children
 * when it takes them, and the imports that needs.
 */
export function componentInsertion(path: string, component: ComponentExport): Insertion {
	const icons = new Set<string>();
	const { children, ...props } = sampleProps(component);
	const attrs = Object.entries(props).flatMap(([name, value]) => attribute(name, value, icons) ?? []);
	const open = `${component.name}${attrs.map((a) => ` ${a}`).join("")}`;
	let inner: string | null = null;
	if (typeof children === "string") inner = childText(children);
	else if (typeof children === "number") inner = `{${children}}`;
	else if (children && typeof children === "object" && !Array.isArray(children)) {
		icons.add(children.icon);
		inner = `<${children.icon} />`;
	}
	const snippet = inner === null ? `<${open} />` : `<${open}>${inner}</${component.name}>`;
	const imports: LibraryImport[] = [{ from: componentSpecifier(path), names: [component.name] }];
	if (icons.size) imports.push({ from: "lucide-react", names: [...icons] });
	return { snippet, imports };
}

export const libraryInsertion = (item: LibraryItem): Insertion => ({ snippet: item.snippet, imports: item.imports });

/** DOM elements a dropped block can go into. Text, inline, list, table and SVG elements pass the drop to their parent. */
const CONTAINERS = new Set([
	"div",
	"section",
	"main",
	"header",
	"footer",
	"nav",
	"aside",
	"article",
	"form",
	"fieldset",
	"li",
	"dd",
	"td",
	"th",
	"figure",
	"details",
	"dialog",
	"body",
]);

const isContainer = (element: JsxElement) => element.intrinsic && element.name !== null && CONTAINERS.has(element.name);

/** Index of the token closing the bracket opened at `i` (`(`, `{` or `${`). */
function matching(tokens: Token[], i: number): number {
	const open = tokens[i]!.type === tt.parenL ? [tt.parenL] : [tt.braceL, tt.dollarBraceL];
	const close = tokens[i]!.type === tt.parenL ? tt.parenR : tt.braceR;
	let depth = 0;
	for (let j = i; j < tokens.length; j++) {
		if (open.includes(tokens[j]!.type)) depth++;
		else if (tokens[j]!.type === close && --depth === 0) return j;
	}
	return -1;
}

/** The JSX element a value expression starting at token `i` is, when it is only that (in parens or not). */
function jsxAt(parsed: ParsedFile, i: number): JsxElement | null {
	const { tokens } = parsed;
	while (tokens[i]?.type === tt.parenL) i++;
	if (tokens[i]?.type !== tt.jsxTagStart) return null;
	return parsed.roots.find((root) => root.start === tokens[i]!.start) ?? null;
}

/**
 * What the function at token `i` returns at its own top level: the last
 * `return` of its body that isn't inside a nested block or function, or its
 * arrow expression. Handles `function X() {…}`, `async`, arrows and one
 * wrapper call (`memo(function X() {…})`). `null` when that isn't plain JSX.
 */
function returnedJsx(parsed: ParsedFile, i: number): JsxElement | null {
	const { tokens, source } = parsed;
	const text = (k: number) => (tokens[k] ? source.slice(tokens[k]!.start, tokens[k]!.end) : "");
	if (text(i) === "async") i++;
	let body: number;
	// Sucrase tokenizes `function` in an expression as a name
	if (tokens[i]?.type === tt._function || text(i) === "function") {
		while (i < tokens.length && tokens[i]!.type !== tt.parenL) i++;
		const close = matching(tokens, i);
		if (close < 0) return null;
		body = close + 1;
		while (body < tokens.length && tokens[body]!.type !== tt.braceL) body++;
	} else if (tokens[i]?.type === tt.name && tokens[i + 1]?.type === tt.parenL && tokens[i + 2]?.type !== tt.parenR && text(i) !== "async" && text(i) !== "function") {
		// `memo(function X() {…})`, `forwardRef((props, ref) => …)`
		return returnedJsx(parsed, i + 2);
	} else {
		// Arrow: `(…) =>` or `x =>`, maybe with a return type
		let k = i;
		if (tokens[k]?.type === tt.lessThan) while (k < tokens.length && tokens[k]!.type !== tt.parenL) k++;
		if (tokens[k]?.type === tt.parenL) k = matching(tokens, k) + 1;
		else if (tokens[k]?.type === tt.name) k++;
		else return null;
		if (k <= 0) return null;
		while (k < tokens.length && tokens[k]!.type !== tt.arrow && (tokens[k]!.isType || tokens[k]!.type === tt.colon)) k++;
		if (tokens[k]?.type !== tt.arrow) return null;
		if (tokens[k + 1]?.type !== tt.braceL) return jsxAt(parsed, k + 1);
		body = k + 1;
	}
	if (tokens[body]?.type !== tt.braceL) return null;
	const end = matching(tokens, body);
	if (end < 0) return null;
	let depth = 0;
	let last = -1;
	for (let k = body + 1; k < end; k++) {
		const type = tokens[k]!.type;
		if (type === tt.braceL || type === tt.dollarBraceL) depth++;
		else if (type === tt.braceR) depth--;
		else if (type === tt._return && depth === 0) last = k;
	}
	return last < 0 ? null : jsxAt(parsed, last + 1);
}

/** Token index of the default-exported value (`export default function…`, `export default () => …`, or the declaration of `export default Name`). */
function defaultExport(parsed: ParsedFile): number | null {
	const { tokens, source } = parsed;
	const text = (k: number) => source.slice(tokens[k]!.start, tokens[k]!.end);
	const at = tokens.findIndex((token, k) => token.type === tt._export && tokens[k + 1]?.type === tt._default);
	if (at < 0) return null;
	const value = at + 2;
	const isName = tokens[value]?.type === tt.name && text(value) !== "async" && text(value) !== "function";
	if (!isName || tokens[value + 1]?.type === tt.parenL) return value;
	// `export default Page;`: find `function Page` or `const Page = …` at the top level
	const name = text(value);
	for (let k = 0; k < tokens.length; k++) {
		if (k === value || tokens[k]!.type !== tt.name || tokens[k]!.identifierRole !== TOP_LEVEL_DECLARATION || text(k) !== name) continue;
		if (tokens[k - 1]?.type === tt._function) return k - 1 - (tokens[k - 2] && text(k - 2) === "async" ? 1 : 0);
		let eq = k + 1;
		while (eq < tokens.length && (tokens[eq]!.isType || tokens[eq]!.type === tt.colon)) eq++;
		if (tokens[eq]?.type === tt.eq) return eq + 1;
	}
	return null;
}

// Sucrase's IdentifierRole.TopLevelDeclaration
const TOP_LEVEL_DECLARATION = 2;

/** The JSX the default export renders at its top level (its main `return`), or `null`. */
function renderedRoot(parsed: ParsedFile): JsxElement | null {
	if (!parsed.ok) return null;
	const at = defaultExport(parsed);
	return at === null ? null : returnedJsx(parsed, at);
}

const isInside = (element: JsxElement, ancestor: JsxElement) => {
	for (let node: JsxElement | null = element; node; node = node.parent) if (node === ancestor) return true;
	return false;
};

/**
 * Where a drop on the element at `start` goes: that element or its nearest
 * container ancestor. Only elements of the JSX the default export returns
 * count: not a local helper component's, nor JSX built before the `return`.
 * Elements inside an expression (`.map(…)`, `{open && …}`, a render prop) are
 * skipped, since inserting there would repeat or hide the drop. `null` when
 * there is none.
 */
export function dropParent(source: string, start: number): number | null {
	const parsed = parseFile(source);
	const root = renderedRoot(parsed);
	const hit = root ? findElement(parsed, start) : null;
	if (!root || !hit || !isInside(hit, root)) return null;
	let target: JsxElement | null = hit;
	for (let node: JsxElement | null = hit; node && node !== root; node = node.parent) if (node.container) target = node.parent;
	while (target && !isContainer(target)) target = target.parent;
	return target?.start ?? null;
}

/**
 * Where a drop goes when nothing better is under the pointer: the outermost
 * element the default export returns, or the first container element inside
 * it when that is a component or a non-container tag. `null` when the file
 * doesn't parse or its default export doesn't return plain JSX.
 */
export function screenRoot(source: string): number | null {
	const root = renderedRoot(parseFile(source));
	if (!root) return null;
	if (root.name === null || isContainer(root)) return root.start;
	const queue: JsxElement[] = [root];
	while (queue.length) {
		for (const child of queue.shift()!.children) {
			if (child.kind !== "element") continue;
			if (isContainer(child)) return child.start;
			queue.push(child);
		}
	}
	return root.selfClosing && !root.intrinsic ? null : root.start;
}

/**
 * The element starts of a frame's hit that index `source`, the current content
 * of `file`. `null` when the hit is for another file, or the frame rendered
 * another version of it (edited since, or a newer version failed to load):
 * its offsets would point at the wrong elements.
 */
export function hitStarts(hit: FrameHit | null, file: string, source: string): number[] | null {
	return hit && hit.path === file && hit.version === sourceVersion(source) ? hit.starts : null;
}

/**
 * The screen's source with `insertion` added as the last child of the
 * container at the drop point, or of the screen's root when there is no usable
 * element there. `at` is the element start under the pointer, or the starts of
 * it and its ancestors, innermost first: the first one that takes a drop wins.
 * `null` when the source doesn't parse or has no root to add to.
 */
export function insertDrop(source: string, at: number | readonly number[] | null, insertion: Insertion): string | null {
	const candidates = at === null ? [] : typeof at === "number" ? [at] : at;
	let parent: number | null = null;
	for (const start of candidates) if ((parent = dropParent(source, start)) !== null) break;
	parent ??= screenRoot(source);
	if (parent === null) return null;
	let next = insertChild(source, parent, insertion.snippet);
	if (next === null) return null;
	for (const { from, names } of insertion.imports) next = addImport(next, from, names);
	return next;
}
