export type EditBlock = { search: string; replace: string };

export type EditResult = { ok: true; content: string } | { ok: false; reason: string };

const SEARCH_LINE = /^<{5,}\s*SEARCH\s*$/;

const DIVIDER_LINE = /^={5,}\s*$/;

const REPLACE_LINE = /^>{5,}\s*REPLACE\s*$/;

export function parseEditBlocks(body: string): EditBlock[] | null {
	const blocks: EditBlock[] = [];
	let search: string[] | null = null;
	let replace: string[] | null = null;

	for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
		const marker = line.trim();

		if (search === null) {
			if (SEARCH_LINE.test(marker)) search = [];
		} else if (replace === null) {
			if (DIVIDER_LINE.test(marker)) replace = [];
			else search.push(line);
		} else if (REPLACE_LINE.test(marker)) {
			blocks.push({ search: search.join("\n"), replace: replace.join("\n") });
			search = null;
			replace = null;
		} else {
			replace.push(line);
		}
	}

	return search === null && blocks.length ? blocks : null;
}

function occurrences(content: string, search: string): number[] {
	const found: number[] = [];

	for (let at = content.indexOf(search); at !== -1; at = content.indexOf(search, at + search.length)) found.push(at);

	return found;
}

const indentOf = (line: string) => line.slice(0, line.length - line.trimStart().length);

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end && !lines[start]!.trim()) start++;

	while (end > start && !lines[end - 1]!.trim()) end--;

	return lines.slice(start, end);
}

function applyLoose(content: string, block: EditBlock): EditResult {
	const lines = content.split("\n");
	const search = trimBlankEdges(block.search.split("\n"));
	const wanted = search.map((line) => line.trim());
	const starts: number[] = [];

	for (let i = 0; i + wanted.length <= lines.length; i++) {
		if (wanted.every((line, j) => lines[i + j]!.trim() === line)) starts.push(i);
	}

	if (starts.length !== 1) {
		return { ok: false, reason: starts.length ? `matches ${starts.length} places` : "doesn't match the file" };
	}

	const start = starts[0]!;
	const from = indentOf(search[0]!);
	const to = indentOf(lines[start]!);

	const replacement = trimBlankEdges(block.replace.split("\n")).map((line) =>
		line.startsWith(from) ? to + line.slice(from.length) : line,
	);

	lines.splice(start, search.length, ...replacement);

	return { ok: true, content: lines.join("\n") };
}

function applyBlock(content: string, block: EditBlock): EditResult {
	if (!block.search.trim()) return { ok: false, reason: "has an empty SEARCH" };
	const exact = occurrences(content, block.search);

	if (exact.length === 1) {
		const at = exact[0]!;

		return { ok: true, content: content.slice(0, at) + block.replace + content.slice(at + block.search.length) };
	}

	if (exact.length > 1) return { ok: false, reason: `matches ${exact.length} places` };

	return applyLoose(content, block);
}

export function applyEditBlocks(content: string, blocks: readonly EditBlock[]): EditResult {
	let current = content;

	for (const [index, block] of blocks.entries()) {
		const result = applyBlock(current, block);

		if (!result.ok) return { ok: false, reason: `SEARCH block ${index + 1} ${result.reason}` };
		current = result.content;
	}

	return { ok: true, content: current };
}
