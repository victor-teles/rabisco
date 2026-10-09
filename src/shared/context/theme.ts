// Decision record: docs/decisions/0009-theme-read-from-design-md.md

import { contextBody } from "./body";
import {
	changedTokenCount,
	designTokensOf,
	orderedTokenNames,
	parseDesignTokens,
	type DesignTokens,
	type ParsedDesignTokens,
} from "./tokens";

/** The theme screens render with; `source` is the DESIGN.md it was read from (missing in older projects) */
export type AppliedTheme = DesignTokens & { source?: string };

/** cyrb53: fast and stable, not cryptographic */
function hash(text: string) {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;

	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}

	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Identifies DESIGN.md's content; comments and blank-line edits don't count. `undefined` for an untouched template. */
export function designSourceOf(markdown: string | undefined): string | undefined {
	const body = contextBody(markdown);

	return body === undefined ? undefined : hash(body);
}

export const hasTokens = (tokens: DesignTokens) =>
	Object.keys(tokens.light).length > 0 || Object.keys(tokens.dark).length > 0;

export type ThemeUpdate =
	/** DESIGN.md lists tokens (or has no content): they apply as they are, without AI */
	| { kind: "tokens"; tokens: DesignTokens; count: number; source?: string }
	/** DESIGN.md changed and lists no tokens: the theme has to be read with AI */
	| { kind: "read"; source: string };

/** `null` when the applied theme is up to date with DESIGN.md */
export function themeUpdateOf(applied: AppliedTheme, design: string | undefined): ThemeUpdate | null {
	const source = designSourceOf(design);
	const tokens = designTokensOf(design);

	if (source === undefined || hasTokens(tokens)) {
		const count = changedTokenCount(applied, tokens);

		return count ? { kind: "tokens", tokens, count, source } : null;
	}

	return applied.source === source ? null : { kind: "read", source };
}

/** Models wrap the block in fences, skip the heading or the bullets, or write CSS; all of it is fine. */
export function parseThemeReply(reply: string): ParsedDesignTokens {
	const text = reply
		.split(/\r?\n/)
		.filter((line) => !/^\s*(?:`{3,}|~{3,})/.test(line))
		.map((line) => (/^\s*`?(?:--)?[a-z][\w-]*`?\s*:/i.test(line) ? `- ${line.trim()}` : line))
		.join("\n");

	const headed = /^#{1,6}\s+(?:design\s+)?tokens\s*#*\s*$/im.test(text);

	return parseDesignTokens(headed ? text : `## Tokens\n${text}`);
}

export type TokenChange = { name: string; dark: boolean; value: string | undefined };

/** In token order (`orderedTokenNames`), light first; `value` is the new one, `undefined` when removed */
export function tokenChanges(from: DesignTokens, to: DesignTokens): TokenChange[] {
	const diff = (a: Record<string, string>, b: Record<string, string>, dark: boolean) =>
		orderedTokenNames(a, b).flatMap((name) => (a[name] === b[name] ? [] : [{ name, dark, value: b[name] }]));

	return [...diff(from.light, to.light, false), ...diff(from.dark, to.dark, true)];
}

/** The `## Tokens` block `parseThemeReply` reads */
export function tokenBlock(tokens: DesignTokens): string {
	const lines = (values: Record<string, string>) =>
		orderedTokenNames(values).map((name) => `- ${name}: ${values[name]}`);

	const dark = lines(tokens.dark);

	return [`## Tokens`, "", ...lines(tokens.light), ...(dark.length ? ["", "### Dark", "", ...dark] : []), ""].join(
		"\n",
	);
}
