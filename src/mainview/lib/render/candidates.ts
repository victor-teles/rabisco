/** A cheap superset: Tailwind ignores tokens that are not classes. */
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
