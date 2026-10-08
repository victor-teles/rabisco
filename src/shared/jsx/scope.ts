import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import type { ParsedFile, Token } from "./tree";

// Sucrase's IdentifierRole values
const ACCESS = new Set([0, 1, 8, 11]);

export const DECLARATION = new Set([2, 3, 4, 5, 6, 7, 9]);

const TOP_LEVEL_DECLARATION = 2;

type Span = { start: number; end: number };

const inside = (token: Token, span: Span) => token.start >= span.start && token.end <= span.end;

export type FreeIdentifier = {
	name: string;
	/** `<Star />`, or the `Card` of `<Card.Header>` */
	tag: boolean;
};

/** In order of first use; type positions and spans in `skip` are ignored. */
export function freeIdentifiers(file: ParsedFile, span: Span, skip: Span[] = []): FreeIdentifier[] {
	const { tokens, source } = file;
	const declared = new Set<string>();
	const used = new Map<string, FreeIdentifier>();
	// Binary search: subtrees are small, files aren't
	let lo = 0;
	let hi = tokens.length;

	while (lo < hi) {
		const mid = (lo + hi) >> 1;

		if (tokens[mid]!.start < span.start) lo = mid + 1;
		else hi = mid;
	}

	for (let i = lo; i < tokens.length; i++) {
		const token = tokens[i]!;

		if (token.end > span.end) break;

		if (token.type !== tt.name && token.type !== tt.jsxName) continue;

		if (token.isType || token.identifierRole === null || skip.some((s) => inside(token, s))) continue;
		const name = source.slice(token.start, token.end);

		if (DECLARATION.has(token.identifierRole)) declared.add(name);
		else if (ACCESS.has(token.identifierRole)) {
			const entry = used.get(name) ?? { name, tag: false };
			entry.tag ||= token.type === tt.jsxName;
			used.set(name, entry);
		}
	}

	return [...used.values()].filter((entry) => !declared.has(entry.name));
}

/** Imports included */
export function declaredNames(file: ParsedFile) {
	const all = new Set<string>();
	const topLevel = new Set<string>();

	for (const token of file.tokens) {
		if (token.type !== tt.name || token.identifierRole === null || !DECLARATION.has(token.identifierRole)) continue;
		const name = file.source.slice(token.start, token.end);
		all.add(name);

		if (token.identifierRole === TOP_LEVEL_DECLARATION) topLevel.add(name);
	}

	return { all, topLevel };
}

/** From annotations, literals, `useState(…)` pairs and `.map` params over a literal array; else `any`. */
export function inferType(file: ParsedFile, name: string, span: Span): string {
	const { tokens, source } = file;
	const text = (i: number) => (tokens[i] ? source.slice(tokens[i]!.start, tokens[i]!.end) : "");
	const type = (i: number) => tokens[i]?.type;

	const literal = (i: number) => {
		const t = type(i);

		if (t === tt.string || t === tt.template || t === tt.backQuote) return "string";

		if (t === tt.num || (t === tt.minus && type(i + 1) === tt.num)) return "number";

		if (t === tt._true || t === tt._false) return "boolean";

		return null;
	};

	/** `{ id: "a", done: false }` → `id: string`, `done: boolean` */
	const objectFields = (open: number) => {
		const fields = new Map<string, string>();
		let depth = 0;

		for (let j = open; j < tokens.length; j++) {
			const t = type(j);

			if (t === tt.braceL || t === tt.bracketL || t === tt.parenL) depth++;
			else if (t === tt.braceR || t === tt.bracketR || t === tt.parenR) {
				if (--depth === 0) break;
			} else if (depth === 1 && type(j + 1) === tt.colon && (type(j - 1) === tt.braceL || type(j - 1) === tt.comma)) {
				fields.set(text(j).replace(/^["']|["']$/g, ""), literal(j + 2) ?? "any");
			}
		}

		return fields;
	};

	/** Of a top-level `const NAME = [ … ]` */
	const itemType = (array: string): { type: string; fields: Map<string, string> } | null => {
		for (let j = 0; j < tokens.length; j++) {
			if (
				tokens[j]!.identifierRole !== TOP_LEVEL_DECLARATION ||
				text(j) !== array ||
				type(j + 1) !== tt.eq ||
				type(j + 2) !== tt.bracketL
			)
				continue;

			if (type(j + 3) !== tt.braceL) {
				const item = literal(j + 3);

				return item ? { type: item, fields: new Map() } : null;
			}

			const fields = objectFields(j + 3);

			return fields.size ? { type: `{ ${[...fields].map(([k, v]) => `${k}: ${v}`).join("; ")} }`, fields } : null;
		}

		return null;
	};

	const stateType = (i: number) => {
		// const [value, setValue] = useState(literal)
		let open = i;

		while (open > 0 && type(open) !== tt.bracketL && i - open < 4) open--;
		let close = i;

		while (close < tokens.length && type(close) !== tt.bracketR && close - i < 4) close++;

		if (type(open) !== tt.bracketL || type(close + 1) !== tt.eq) return null;
		const callee = text(close + 2) === "React" ? close + 4 : close + 2;

		if (text(callee) !== "useState") return null;
		let paren = callee + 1;
		let generic: string | null = null;

		if (type(paren) === tt.lessThan) {
			while (paren < tokens.length && type(paren) !== tt.greaterThan) paren++;
			generic = source.slice(tokens[callee + 1]!.end, tokens[paren]?.start ?? 0).trim();
			paren++;
		}

		const valueType = type(paren) === tt.parenL ? generic || literal(paren + 1) : null;

		if (!valueType) return null;
		const position = tokens.slice(open + 1, i).filter((t) => t.type === tt.comma).length;

		return position === 0 ? valueType : `(value: ${valueType}) => void`;
	};

	const mapParamType = (i: number) => {
		// ITEMS.map((item, index) => …), ITEMS.map(({ label, icon: Icon }) => …)
		let call = i - 1;

		while (
			call > 1 &&
			i - call < 16 &&
			!(type(call) === tt.parenL && text(call - 1) === "map" && type(call - 2) === tt.dot)
		)
			call--;

		if (type(call) !== tt.parenL || text(call - 1) !== "map" || type(call - 2) !== tt.dot) return null;
		let depth = 0;
		let position = 0;
		let destructured = false;

		for (let j = call + 1; j < i; j++) {
			const t = type(j);

			if (t === tt.braceL || t === tt.bracketL) {
				if (depth++ === 0 && position === 0) destructured = t === tt.braceL;
			} else if (t === tt.braceR || t === tt.bracketR) depth--;
			else if (t === tt.comma && depth === 0) position++;
		}

		if (position === 1 && depth === 0) return "number";

		if (position !== 0) return null;
		const item = type(call - 3) === tt.name ? itemType(text(call - 3)) : null;

		if (!item) return null;

		if (!destructured) return item.type;

		return item.fields.get(type(i - 1) === tt.colon ? text(i - 2) : name) ?? null;
	};

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;

		if (
			token.identifierRole === null ||
			!DECLARATION.has(token.identifierRole) ||
			inside(token, span) ||
			text(i) !== name
		)
			continue;

		if (type(i + 1) === tt.colon) {
			// `name: Type`
			let end = i + 2;

			while (end < tokens.length && tokens[end]!.isType) end++;
			const annotation = source.slice(tokens[i + 2]!.start, tokens[end - 1]!.end).trim();

			if (annotation && end > i + 2) return annotation;
		}

		if (type(i + 1) === tt.eq) return literal(i + 2) ?? "any";

		return stateType(i) ?? mapParamType(i) ?? "any";
	}

	return "any";
}
