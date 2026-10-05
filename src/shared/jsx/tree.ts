/**
 * JSX tree of a TSX file with exact source offsets, built on Sucrase's tokenizer
 * (the same parser the renderer compiles with). Never throws: a file that does
 * not parse comes back with `ok: false` and no roots.
 */

import { parse } from "sucrase/dist/esm/parser";
import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { decodeEntities, jsxTextValue } from "./text";

/** A Sucrase token, reduced to what this module reads. */
export type Token = { type: tt; start: number; end: number; identifierRole: number | null; isType: boolean };

/** `"…"` attribute value. `value` is decoded (`&amp;` → `&`), `raw` includes the quotes. */
export type JsxString = { kind: "string"; value: string; raw: string; start: number; end: number };

/** `{…}` as a child or attribute value. `text` is the source between the braces; `start`/`end` include them. */
export type JsxExpression = {
	kind: "expression";
	text: string;
	start: number;
	end: number;
	/** Only comments or nothing between the braces */
	empty: boolean;
	/** JSX elements written inside, e.g. the `<Row />` of `{items.map((i) => <Row />)}` */
	elements: JsxElement[];
};

export type JsxAttribute =
	| { kind: "attribute"; name: string; start: number; end: number; value: JsxString | JsxExpression | null }
	| { kind: "spread"; text: string; start: number; end: number };

/** Text between tags. `value` is what React renders (whitespace collapsed, entities decoded); empty for indentation. */
export type JsxText = { kind: "text"; raw: string; value: string; start: number; end: number };

export type JsxChild = JsxElement | JsxText | JsxExpression;

export type JsxElement = {
	kind: "element";
	/** `div`, `Card`, `Card.Header`; `null` for a fragment */
	name: string | null;
	/** Lowercase tag (`div`, `svg:path`): a DOM element rather than a component */
	intrinsic: boolean;
	/** `<` of the opening tag to the end of the closing tag (or of `/>`) */
	start: number;
	end: number;
	/** End of the tag name (just after `<` for fragments): where new attributes can go */
	nameEnd: number;
	/** End of the opening tag, after its `>` */
	openingEnd: number;
	/** `<` of the closing tag; `null` when self-closing */
	closingStart: number | null;
	selfClosing: boolean;
	attributes: JsxAttribute[];
	children: JsxChild[];
	parent: JsxElement | null;
	depth: number;
	/** The expression it sits in when it is not a plain child: `{open && <X />}`, `.map(…)`, `icon={<Star />}` */
	container: JsxExpression | null;
};

export type JsxTree = { ok: boolean; error: string | null; roots: JsxElement[] };

/** A parsed file: the tree plus Sucrase's tokens, for scope and import analysis. */
export type ParsedFile = JsxTree & { source: string; tokens: Token[] };

const cache = new Map<string, ParsedFile>();

const CACHE_SIZE = 128;

/** Parses a TSX file, memoized by content. Treat the result as read-only. */
export function parseFile(source: string): ParsedFile {
	const hit = cache.get(source);

	if (hit) return hit;
	let parsed: ParsedFile;

	try {
		const tokens: Token[] = parse(source, true, true, false).tokens;
		parsed = { ok: true, error: null, source, tokens, roots: buildTree(source, tokens) };
	} catch (error) {
		parsed = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			source,
			tokens: [],
			roots: [],
		};
	}

	if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
	cache.set(source, parsed);

	return parsed;
}

/** Every top-level JSX root of a file (all functions), with nested elements, texts and expressions. */
export function parseJsx(source: string): JsxTree {
	const { ok, error, roots } = parseFile(source);

	return { ok, error, roots };
}

function buildTree(source: string, tokens: Token[]): JsxElement[] {
	const is = (i: number, type: tt) => tokens[i]?.type === type;

	/** Index of the `}` matching the `{` (or `${`) at `i` */
	const matchBrace = (i: number) => {
		let depth = 0;

		for (let j = i; j < tokens.length; j++) {
			const type = tokens[j]!.type;

			if (type === tt.braceL || type === tt.dollarBraceL) depth++;
			else if (type === tt.braceR && --depth === 0) return j;
		}

		return tokens.length - 1;
	};

	/** JSX elements that start in tokens [from, to) */
	const scan = (from: number, to: number, parent: JsxElement | null, container: JsxExpression | null) => {
		const found: JsxElement[] = [];

		for (let j = from; j < to;) {
			if (is(j, tt.jsxTagStart) && !is(j + 1, tt.slash)) {
				const [element, next] = parseElement(j, parent, container);
				found.push(element);
				j = next;
			} else j++;
		}

		return found;
	};

	/** `{…}` at `i` as an expression; returns it with the index after its `}` */
	const expression = (i: number, parent: JsxElement): [JsxExpression, number] => {
		const k = matchBrace(i);

		const value: JsxExpression = {
			kind: "expression",
			text: source.slice(tokens[i]!.end, tokens[k]!.start),
			start: tokens[i]!.start,
			end: tokens[k]!.end,
			empty: k === i + 1,
			elements: [],
		};

		value.elements = scan(i + 1, k, parent, value);

		return [value, k + 1];
	};

	/** A dotted or namespaced name at `j`; returns it with the index after it */
	const dottedName = (j: number): [string, number] => {
		const first = j;
		j++;

		while ((is(j, tt.dot) || is(j, tt.colon)) && is(j + 1, tt.jsxName)) j += 2;

		return [source.slice(tokens[first]!.start, tokens[j - 1]!.end), j];
	};

	const parseElement = (
		i: number,
		parent: JsxElement | null,
		container: JsxExpression | null,
	): [JsxElement, number] => {
		const element: JsxElement = {
			kind: "element",
			name: null,
			intrinsic: false,
			start: tokens[i]!.start,
			end: tokens[i]!.end,
			nameEnd: tokens[i]!.end,
			openingEnd: tokens[i]!.end,
			closingStart: null,
			selfClosing: false,
			attributes: [],
			children: [],
			parent,
			depth: parent ? parent.depth + 1 : 0,
			container,
		};

		let j = i + 1;

		if (is(j, tt.jsxName)) {
			[element.name, j] = dottedName(j);
			element.intrinsic = /^[a-z]/.test(element.name);
			element.nameEnd = tokens[j - 1]!.end;
		}

		// Attributes, up to `>` or `/>`
		while (j < tokens.length && !is(j, tt.jsxTagEnd) && !(is(j, tt.slash) && is(j + 1, tt.jsxTagEnd))) {
			if (is(j, tt.braceL)) {
				const k = matchBrace(j);
				const text = source.slice(tokens[j]!.end, tokens[k]!.start).trim();
				element.attributes.push({ kind: "spread", text, start: tokens[j]!.start, end: tokens[k]!.end });
				j = k + 1;
			} else if (is(j, tt.jsxName)) {
				const start = tokens[j]!.start;
				let name: string;
				[name, j] = dottedName(j);
				let value: JsxString | JsxExpression | null = null;

				if (is(j, tt.eq)) {
					j++;

					if (is(j, tt.string)) {
						const raw = source.slice(tokens[j]!.start, tokens[j]!.end);
						value = {
							kind: "string",
							value: decodeEntities(raw.slice(1, -1)),
							raw,
							start: tokens[j]!.start,
							end: tokens[j]!.end,
						};
						j++;
					} else if (is(j, tt.braceL)) {
						[value, j] = expression(j, element);
					} else if (is(j, tt.jsxTagStart)) {
						const [child, next] = parseElement(j, element, null);
						value = {
							kind: "expression",
							text: source.slice(child.start, child.end),
							start: child.start,
							end: child.end,
							empty: false,
							elements: [child],
						};
						child.container = value;
						j = next;
					}
				}

				element.attributes.push({ kind: "attribute", name, start, end: value ? value.end : tokens[j - 1]!.end, value });
			} else j++;
		}

		element.selfClosing = is(j, tt.slash);

		if (element.selfClosing) j++;
		element.openingEnd = element.end = tokens[j]?.end ?? source.length;
		j++;

		if (element.selfClosing) return [element, j];

		// Children, up to the closing tag
		while (j < tokens.length) {
			const token = tokens[j]!;

			if (token.type === tt.jsxText) {
				const raw = source.slice(token.start, token.end);
				element.children.push({ kind: "text", raw, value: jsxTextValue(raw), start: token.start, end: token.end });
				j++;
			} else if (token.type === tt.braceL) {
				let value: JsxExpression;
				[value, j] = expression(j, element);
				element.children.push(value);
			} else if (token.type === tt.jsxTagStart && is(j + 1, tt.slash)) {
				element.closingStart = token.start;

				while (j < tokens.length && !is(j, tt.jsxTagEnd)) j++;
				element.end = tokens[j]?.end ?? source.length;

				return [element, j + 1];
			} else if (token.type === tt.jsxTagStart) {
				let child: JsxElement;
				[child, j] = parseElement(j, element, null);
				element.children.push(child);
			} else if (token.type === tt.eof) break;
			else j++;
		}

		return [element, j];
	};

	return scan(0, tokens.length, null, null);
}

/** JSX elements written inside an attribute value or child expression of `element`, or child elements, in source order. */
export function childElements(element: JsxElement): JsxElement[] {
	const found: JsxElement[] = [];

	for (const attribute of element.attributes)
		if (attribute.kind === "attribute" && attribute.value?.kind === "expression")
			found.push(...attribute.value.elements);

	for (const child of element.children) {
		if (child.kind === "element") found.push(child);
		else if (child.kind === "expression") found.push(...child.elements);
	}

	return found;
}

/** Depth-first, source order, including elements inside expressions. Return `false` from `visit` to skip an element's descendants. */
export function walk(roots: JsxTree | JsxElement[] | JsxElement, visit: (element: JsxElement) => void | boolean) {
	const list = Array.isArray(roots) ? roots : "kind" in roots ? [roots] : roots.roots;

	const step = (element: JsxElement) => {
		if (visit(element) === false) return;

		for (const child of childElements(element)) step(child);
	};

	for (const root of list) step(root);
}

/** Every element, in source order. */
export function flatten(roots: JsxTree | JsxElement[] | JsxElement): JsxElement[] {
	const all: JsxElement[] = [];
	walk(roots, (element) => void all.push(element));

	return all;
}

/** The deepest element whose span contains `offset`, or `null`. */
export function elementAt(tree: JsxTree | JsxElement[], offset: number): JsxElement | null {
	let found: JsxElement | null = null;
	walk(tree, (element) => {
		if (offset < element.start || offset >= element.end) return false;
		found = element;
	});

	return found;
}

/** The element that starts exactly at `start`, or `null`. */
export function findElement(tree: JsxTree | JsxElement[], start: number): JsxElement | null {
	let found: JsxElement | null = null;
	walk(tree, (element) => {
		if (found || start < element.start || start >= element.end) return false;

		if (element.start === start) found = element;
	});

	return found;
}

/** Number of elements in the subtree, itself included. */
export const elementCount = (element: JsxElement) => flatten(element).length;
