/**
 * Extracts Tailwind class candidates from source text. A cheap superset: Tailwind ignores
 * tokens that are not classes. Tokens are split on whitespace and quotes, and also on code
 * punctuation, so both `w-[calc(100%-2rem)]` and `cn("p-4",` yield their class.
 */
export function extractCandidates(source: string): string[] {
	const set = new Set<string>();
	const add = (token: string) => {
		if (token.length > 1 && token.length < 120 && /^[!-]?[a-z@[*]/.test(token)) set.add(token);
	};
	for (const token of source.split(/[\s"'`]+/)) {
		add(token);
		if (/[{}();,=<>]/.test(token)) for (const part of token.split(/[{}();,=<>]+/)) add(part);
	}
	return [...set];
}
