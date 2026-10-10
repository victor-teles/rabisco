import { flatten, parseFile, type JsxElement, type JsxExpression, type JsxText } from "./tree";

export type FindOptions = { caseSensitive?: boolean };

export type TextMatch = { at: number; element: number; before: string; text: string; after: string };

export type FileMatches = { file: string; matches: TextMatch[] };

type Literal = { value: string };

type Hit = { at: number; index: number; length: number };

type Node =
	| { kind: "text"; element: JsxElement; text: JsxText; hits: Hit[] }
	| { kind: "literal"; element: JsxElement; expression: JsxExpression; value: string; hits: Hit[] };

const CONTEXT = 24;

const SKIPPED = new Set(["script", "style"]);

function indexesOf(haystack: string, needle: string, options: FindOptions) {
	const found: number[] = [];

	if (!needle) return found;
	const hay = options.caseSensitive ? haystack : haystack.toLowerCase();
	const pin = options.caseSensitive ? needle : needle.toLowerCase();

	for (let i = hay.indexOf(pin); i !== -1; i = hay.indexOf(pin, i + pin.length)) found.push(i);

	return found;
}

function literalOf(expression: JsxExpression): Literal | null {
	const text = expression.text.trim();
	const double = /^"(?:[^"\\\n]|\\.)*"$/.exec(text);

	if (double) {
		try {
			const value: string = JSON.parse(text);

			return { value };
		} catch {
			return null;
		}
	}

	const plain = /^'([^'\\\n]*)'$/.exec(text) ?? /^`([^`\\$]*)`$/.exec(text);

	return plain ? { value: plain[1]! } : null;
}

const renderedAsWritten = (raw: string) => !/[&\r\n]/.test(raw);

const squash = (text: string) => text.replace(/\s+/g, " ");

function nodesOf(source: string, query: string, options: FindOptions): Node[] {
	const file = parseFile(source);

	if (!file.ok || !query) return [];
	const nodes: Node[] = [];

	for (const element of flatten(file)) {
		if (element.intrinsic && element.name && SKIPPED.has(element.name)) continue;

		for (const child of element.children) {
			if (child.kind === "text") {
				const hits = indexesOf(child.raw, query, options).flatMap((index) =>
					renderedAsWritten(child.raw.slice(index, index + query.length))
						? [{ at: child.start + index, index, length: query.length }]
						: [],
				);

				if (hits.length) nodes.push({ kind: "text", element, text: child, hits });
			} else if (child.kind === "expression") {
				const literal = literalOf(child);

				if (!literal) continue;

				const hits = indexesOf(literal.value, query, options).map((index) => ({
					at: child.start + 1 + index,
					index,
					length: query.length,
				}));

				if (hits.length) nodes.push({ kind: "literal", element, expression: child, value: literal.value, hits });
			}
		}
	}

	return nodes.sort((a, b) => a.hits[0]!.at - b.hits[0]!.at);
}

export function findText(source: string, query: string, options: FindOptions = {}): TextMatch[] {
	return nodesOf(source, query, options).flatMap((node) => {
		const text = node.kind === "text" ? node.text.raw : node.value;

		return node.hits.map((hit) => ({
			at: hit.at,
			element: node.element.start,
			before: squash(text.slice(Math.max(0, hit.index - CONTEXT), hit.index)).trimStart(),
			text: text.slice(hit.index, hit.index + hit.length),
			after: squash(text.slice(hit.index + hit.length, hit.index + hit.length + CONTEXT)).trimEnd(),
		}));
	});
}

export function findInFiles(
	files: Record<string, string>,
	paths: readonly string[],
	query: string,
	options: FindOptions = {},
): FileMatches[] {
	return paths.flatMap((file) => {
		const source = files[file];
		const matches = source === undefined ? [] : findText(source, query, options);

		return matches.length ? [{ file, matches }] : [];
	});
}

export const jsxTextOf = (text: string) => text.replace(/[&<>{}]/g, (char) => `&#${char.charCodeAt(0)};`);

type Edit = { start: number; end: number; text: string };

export function replaceText(
	source: string,
	query: string,
	replacement: string,
	options: FindOptions = {},
	only?: ReadonlySet<number>,
): string {
	const edits: Edit[] = [];

	for (const node of nodesOf(source, query, options)) {
		const hits = only ? node.hits.filter((hit) => only.has(hit.at)) : node.hits;

		if (!hits.length) continue;

		if (node.kind === "text") {
			for (const hit of hits) edits.push({ start: hit.at, end: hit.at + hit.length, text: jsxTextOf(replacement) });

			continue;
		}

		let value = node.value;

		for (const hit of [...hits].reverse())
			value = value.slice(0, hit.index) + replacement + value.slice(hit.index + hit.length);
		edits.push({ start: node.expression.start, end: node.expression.end, text: `{${JSON.stringify(value)}}` });
	}

	let next = source;

	for (const edit of edits.sort((a, b) => b.start - a.start))
		next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);

	return next;
}
