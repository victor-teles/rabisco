import { parse } from "sucrase/dist/esm/parser";
import { formatTokenType } from "sucrase/dist/esm/parser/tokenizer/types";

export type Tok = {
	/** Sucrase's token label: `name`, `string`, `{`, `=>`, `jsxText`… */
	type: string;
	text: string;
	start: number;
	end: number;
	/** Preceded by a line break */
	nl: boolean;
};

export function tokenize(source: string): Tok[] | null {
	try {
		const { tokens } = parse(source, true, true, false);
		const out: Tok[] = [];
		let prevEnd = 0;

		for (const token of tokens) {
			const type = formatTokenType(token.type);

			if (type === "eof") break;
			out.push({
				type,
				text: source.slice(token.start, token.end),
				start: token.start,
				end: token.end,
				nl: source.slice(prevEnd, token.start).includes("\n"),
			});
			prevEnd = token.end;
		}

		return out;
	} catch {
		return null;
	}
}

const OPEN = new Set(["(", "[", "{", "${"]);

const CLOSE = new Set([")", "]", "}"]);

export const isOpen = (tok: Tok | undefined) => !!tok && OPEN.has(tok.type);

export const isClose = (tok: Tok | undefined) => !!tok && CLOSE.has(tok.type);

/** The last index when unbalanced */
export function matching(toks: Tok[], open: number): number {
	let depth = 0;

	for (let i = open; i < toks.length; i++) {
		if (OPEN.has(toks[i]!.type)) depth++;
		else if (CLOSE.has(toks[i]!.type) && --depth === 0) return i;
	}

	return toks.length - 1;
}

export function angleDelta(tok: Tok): number {
	if (tok.text === "<") return 1;

	if (/^>+$/.test(tok.text)) return -tok.text.length;

	return 0;
}

/** Splits at top level (with `angles`, also outside type arguments); empty parts are dropped. */
export function splitTop(toks: Tok[], from: number, to: number, separators: string[], angles = true): Tok[][] {
	const parts: Tok[][] = [];
	let current: Tok[] = [];
	let angle = 0;

	for (let i = from; i < to; i++) {
		const tok = toks[i]!;

		if (isOpen(tok)) {
			const end = Math.min(matching(toks, i), to - 1);
			current.push(...toks.slice(i, end + 1));
			i = end;
			continue;
		}

		if (angles) angle = Math.max(0, angle + angleDelta(tok));

		if (angle === 0 && separators.includes(tok.text) && !(angles && angleDelta(tok) !== 0)) {
			if (current.length) parts.push(current);
			current = [];
			continue;
		}

		current.push(tok);
	}

	if (current.length) parts.push(current);

	return parts;
}

/** Whitespace collapsed */
export function textOf(source: string, toks: Tok[]): string {
	if (!toks.length) return "";

	return source
		.slice(toks[0]!.start, toks[toks.length - 1]!.end)
		.replace(/\s+/g, " ")
		.trim();
}

const ESCAPES = new Map([
	["n", "\n"],
	["t", "\t"],
]);

export function unquote(text: string): string {
	const body = text.slice(1, -1);

	return body.replace(/\\(.)/g, (_, c: string) => ESCAPES.get(c) ?? c);
}
