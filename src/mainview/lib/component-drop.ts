import type { ComponentExport } from "../../shared/components/api";
import type { LibraryImport, LibraryItem } from "../../shared/components/library";
import { sampleProps, type PreviewValue } from "../../shared/components/preview";
import { addImport, componentSpecifier, findElement, insertChild, type JsxElement } from "../../shared/jsx";
import { attrValue, childText } from "../../shared/jsx/text";
import { isNumber, isString } from "../../shared/guards";
import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { parseFile, type ParsedFile, type Token } from "../../shared/jsx/tree";
import { sourceVersion, type FrameHit } from "./render/protocol";

export const COMPONENT_MIME = "application/x-rabisco-component";

export type DragItem = { kind: "component"; path: string; name: string } | { kind: "library"; id: string };

// WebKit hides custom drag types from `dragover` on non-http origins (`views://`),
// so the canvas reads the active drag from here instead of `dataTransfer`.
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
	subscribe: (listener: () => void) => {
		dragListeners.add(listener);

		return () => void dragListeners.delete(listener);
	},
};

function isDragItem(item: unknown): item is DragItem {
	if (typeof item !== "object" || item === null || !("kind" in item)) return false;

	if (item.kind === "component")
		return "path" in item && "name" in item && typeof item.path === "string" && typeof item.name === "string";

	return item.kind === "library" && "id" in item && typeof item.id === "string";
}

export function parseDragItem(data: string): DragItem | null {
	try {
		const item: unknown = JSON.parse(data);

		if (isDragItem(item)) return item;
	} catch {
		// Not ours
	}

	return null;
}

export type Insertion = { snippet: string; imports: LibraryImport[] };

const isIconValue = (value: PreviewValue | undefined): value is { icon: string } =>
	typeof value === "object" && !Array.isArray(value);

function attribute(name: string, value: PreviewValue, icons: Set<string>): string | null {
	if (isString(value)) return `${name}=${attrValue(value)}`;

	if (isNumber(value)) return `${name}={${value}}`;

	if (value === true) return name;

	if (value === false) return `${name}={false}`;

	if (Array.isArray(value)) return `${name}={${JSON.stringify(value)}}`;
	icons.add(value.icon);

	return `${name}={${value.icon}}`;
}

export function componentInsertion(path: string, component: ComponentExport): Insertion {
	const icons = new Set<string>();
	const { children, ...props } = sampleProps(component);
	const attrs = Object.entries(props).flatMap(([name, value]) => attribute(name, value, icons) ?? []);
	const open = `${component.name}${attrs.map((a) => ` ${a}`).join("")}`;
	let inner: string | null = null;

	if (isString(children)) inner = childText(children);
	else if (isNumber(children)) inner = `{${children}}`;
	else if (isIconValue(children)) {
		icons.add(children.icon);
		inner = `<${children.icon} />`;
	}

	const snippet = inner === null ? `<${open} />` : `<${open}>${inner}</${component.name}>`;
	const imports: LibraryImport[] = [{ from: componentSpecifier(path), names: [component.name] }];

	if (icons.size) imports.push({ from: "lucide-react", names: [...icons] });

	return { snippet, imports };
}

export const libraryInsertion = (item: LibraryItem): Insertion => ({ snippet: item.snippet, imports: item.imports });

/** Text, inline, list, table and SVG elements pass the drop to their parent. */
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

function jsxAt(parsed: ParsedFile, i: number): JsxElement | null {
	const { tokens } = parsed;

	while (tokens[i]?.type === tt.parenL) i++;

	if (tokens[i]?.type !== tt.jsxTagStart) return null;

	return parsed.roots.find((root) => root.start === tokens[i]!.start) ?? null;
}

/** Last top-level `return` (or arrow body) of the function at token `i`; unwraps one `memo(...)`-style call. */
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
	} else if (
		tokens[i]?.type === tt.name &&
		tokens[i + 1]?.type === tt.parenL &&
		tokens[i + 2]?.type !== tt.parenR &&
		text(i) !== "async" &&
		text(i) !== "function"
	) {
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

		while (k < tokens.length && tokens[k]!.type !== tt.arrow && (tokens[k]!.isType || tokens[k]!.type === tt.colon))
			k++;

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

function defaultExport(parsed: ParsedFile): number | null {
	const { tokens, source } = parsed;
	const text = (k: number) => source.slice(tokens[k]!.start, tokens[k]!.end);
	const at = tokens.findIndex((token, k) => token.type === tt._export && tokens[k + 1]?.type === tt._default);

	if (at < 0) return null;
	const value = at + 2;
	const isName = tokens[value]?.type === tt.name && text(value) !== "async" && text(value) !== "function";

	if (!isName || tokens[value + 1]?.type === tt.parenL) return value;
	const name = text(value);

	for (let k = 0; k < tokens.length; k++) {
		if (
			k === value ||
			tokens[k]!.type !== tt.name ||
			tokens[k]!.identifierRole !== TOP_LEVEL_DECLARATION ||
			text(k) !== name
		)
			continue;

		if (tokens[k - 1]?.type === tt._function) return k - 1 - (tokens[k - 2] && text(k - 2) === "async" ? 1 : 0);
		let eq = k + 1;

		while (eq < tokens.length && (tokens[eq]!.isType || tokens[eq]!.type === tt.colon)) eq++;

		if (tokens[eq]?.type === tt.eq) return eq + 1;
	}

	return null;
}

// Sucrase's IdentifierRole.TopLevelDeclaration
const TOP_LEVEL_DECLARATION = 2;

function renderedRoot(parsed: ParsedFile): JsxElement | null {
	if (!parsed.ok) return null;
	const at = defaultExport(parsed);

	return at === null ? null : returnedJsx(parsed, at);
}

const isInside = (element: JsxElement, ancestor: JsxElement) => {
	for (let node: JsxElement | null = element; node; node = node.parent) if (node === ancestor) return true;

	return false;
};

/** Skips elements inside expressions (`.map`, `{open && …}`), where an insert would repeat or hide the drop. */
export function dropParent(source: string, start: number): number | null {
	const parsed = parseFile(source);
	const root = renderedRoot(parsed);
	const hit = root ? findElement(parsed, start) : null;

	if (!root || !hit || !isInside(hit, root)) return null;
	let target: JsxElement | null = hit;

	for (let node: JsxElement | null = hit; node && node !== root; node = node.parent)
		if (node.container) target = node.parent;

	while (target && !isContainer(target)) target = target.parent;

	return target?.start ?? null;
}

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

/** `null` when the frame rendered another version of `file`, whose offsets would point at the wrong elements. */
export function hitStarts(hit: FrameHit | null, file: string, source: string): number[] | null {
	return hit && hit.path === file && hit.version === sourceVersion(source) ? hit.starts : null;
}

/** `at` is innermost-first; the first start that accepts a drop wins, else the screen root. */
export function insertDrop(source: string, at: number | readonly number[] | null, insertion: Insertion): string | null {
	const candidates = at === null ? [] : [at].flat();
	let parent: number | null = null;

	for (const start of candidates) if ((parent = dropParent(source, start)) !== null) break;
	parent ??= screenRoot(source);

	if (parent === null) return null;
	let next = insertChild(source, parent, insertion.snippet);

	if (next === null) return null;

	for (const { from, names } of insertion.imports) next = addImport(next, from, names);

	return next;
}
