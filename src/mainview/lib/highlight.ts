/**
 * A tiny TSX tokenizer for the read-only code view. It only has to look
 * right, not parse: one regex pass, unknown text falls through as "plain".
 */

export type TokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "tag" | "attr" | "punct";

export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set(
	"import export from default function return const let var if else for while do switch case break continue new typeof instanceof in of as type interface extends implements class async await try catch finally throw null undefined true false this void yield satisfies keyof readonly enum".split(
		" ",
	),
);

const PATTERN =
	/(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(<\/?[A-Za-z][\w.]*|\/?>)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$-]*)(?=\s*=\s*["'{])|([A-Za-z_$][\w$]*)|([{}()[\];,.=+\-*/!?:&|<>%^~]+)/g;

export function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let last = 0;
	const push = (kind: TokenKind, text: string) => {
		const prev = tokens.at(-1);
		if (prev && prev.kind === kind) prev.text += text;
		else tokens.push({ kind, text });
	};
	for (const match of source.matchAll(PATTERN)) {
		if (match.index > last) push("plain", source.slice(last, match.index));
		const [text, comment, string, tag, number, attr, word] = match;
		if (comment) push("comment", text);
		else if (string) push("string", text);
		else if (tag) push("tag", text);
		else if (number) push("number", text);
		else if (attr) push("attr", text);
		else if (word) push(KEYWORDS.has(word) ? "keyword" : "plain", text);
		else push("punct", text);
		last = match.index + text.length;
	}
	if (last < source.length) push("plain", source.slice(last));
	return tokens;
}

/** Splits tokens into lines, cutting multi-line tokens (block comments, template strings). */
export function tokenizeLines(source: string): Token[][] {
	const lines: Token[][] = [[]];
	for (const token of tokenize(source)) {
		const parts = token.text.split("\n");
		parts.forEach((part, i) => {
			if (i > 0) lines.push([]);
			if (part) lines.at(-1)!.push({ kind: token.kind, text: part });
		});
	}
	return lines;
}
