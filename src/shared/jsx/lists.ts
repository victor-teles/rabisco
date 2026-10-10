import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { DECLARATION } from "./scope";
import { findElement, parseFile, type ParsedFile, type Token } from "./tree";

type Span = { start: number; end: number };

const OPEN = new Set([tt.bracketL, tt.braceL, tt.parenL, tt.dollarBraceL]);

const CLOSE = new Set([tt.bracketR, tt.braceR, tt.parenR]);

const firstTokenAt = (tokens: Token[], offset: number) => tokens.findIndex((token) => token.start >= offset);

function matching(tokens: Token[], open: number) {
	let depth = 0;

	for (let i = open; i < tokens.length; i++) {
		if (OPEN.has(tokens[i]!.type)) depth++;
		else if (CLOSE.has(tokens[i]!.type) && --depth === 0) return i;
	}

	return -1;
}

/** `null` for holes and spreads, where entries and rendered items don't pair up */
function entriesOf(tokens: Token[], open: number): Span[] | null {
	const close = matching(tokens, open);

	if (close < 0) return null;
	const entries: Span[] = [];
	let first = open + 1;
	let depth = 0;

	for (let i = open + 1; i <= close; i++) {
		const type = tokens[i]!.type;

		if (depth === 0 && (type === tt.comma || i === close)) {
			if (first === i) {
				// A trailing comma
				if (i === close && entries.length) break;

				return null;
			}

			if (tokens[first]!.type === tt.ellipsis) return null;
			entries.push({ start: tokens[first]!.start, end: tokens[i - 1]!.end });
			first = i + 1;
		} else if (OPEN.has(type)) depth++;
		else if (CLOSE.has(type)) depth--;
	}

	return entries;
}

const nameAt = (file: ParsedFile, token: Token | undefined) =>
	token?.type === tt.name ? file.source.slice(token.start, token.end) : null;

/** The `[` of `const name = […]`, when that is the name's only declaration in the file */
function arrayDeclaration(file: ParsedFile, name: string) {
	const { tokens } = file;

	const declarations = tokens.flatMap((token, i) =>
		nameAt(file, token) === name && token.identifierRole !== null && DECLARATION.has(token.identifierRole) ? [i] : [],
	);

	if (declarations.length !== 1) return -1;
	const at = declarations[0]!;

	if (tokens[at - 1]?.type !== tt._const) return -1;
	let i = at + 1;

	// `const items: Item[] = […]`
	while (tokens[i]?.isType) i++;

	return tokens[i]?.type === tt.eq && tokens[i + 1]?.type === tt.bracketL ? i + 1 : -1;
}

/**
 * The entries of the array literal the element is rendered from, in order: `{items.map((item) => <Row />)}` with
 * `const items = […]`, or `{[…].map(…)}`. `null` for anything else, like `.filter(…).map(…)`, whose rendered items
 * don't follow the entries one to one.
 */
export function mappedEntries(source: string, start: number): Span[] | null {
	const file = parseFile(source);
	const element = findElement(file, start);
	const container = element?.container;

	if (!element || !container?.elements.includes(element)) return null;
	const { tokens } = file;
	// After the `{`
	const first = firstTokenAt(tokens, container.start) + 1;
	const name = nameAt(file, tokens[first]);
	const array = name === null ? (tokens[first]?.type === tt.bracketL ? first : -1) : arrayDeclaration(file, name);
	const receiverEnd = name === null ? matching(tokens, first) : first;

	if (array < 0 || receiverEnd < 0) return null;
	const dot = tokens[receiverEnd + 1];
	const call = tokens[receiverEnd + 3];

	if (dot?.type !== tt.dot || nameAt(file, tokens[receiverEnd + 2]) !== "map" || call?.type !== tt.parenL) return null;

	return call.start < element.start ? entriesOf(tokens, array) : null;
}

/** Moves entry `from` of the element's array to index `to`. The element's offset doesn't change */
export function moveMappedEntry(source: string, start: number, from: number, to: number): string | null {
	const entries = mappedEntries(source, start);

	if (!entries || from === to || !entries[from] || !entries[to]) return null;
	const texts = entries.map((entry) => source.slice(entry.start, entry.end));
	const [moved] = texts.splice(from, 1);
	texts.splice(to, 0, moved!);
	let next = source;

	for (let i = entries.length - 1; i >= 0; i--)
		next = next.slice(0, entries[i]!.start) + texts[i] + next.slice(entries[i]!.end);

	return parseFile(next).ok ? next : null;
}
