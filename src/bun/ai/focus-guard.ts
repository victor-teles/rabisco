/**
 * Point and prompt guard: after a focused edit, finds what changed in the file
 * outside the focused element. It never fails the generation; the result is a
 * note under the reply, and undo reverts the whole edit.
 *
 * A line diff (LCS over non-blank lines, trailing spaces ignored) of the file
 * before and after. Allowed outside the element:
 * - import lines, added or removed;
 * - new top-level declarations: a run of added lines whose first line starts a
 *   declaration at column 0 (`function Hero…`, `const items = …`, `type …`),
 *   e.g. a helper component the element now uses.
 * Everything else outside the element is reported: changed, added or removed lines.
 * When one changed run of lines covers the element and lines next to it, those
 * outside lines count one for one; lines only added right next to the element
 * count as part of it (a new sibling is a fair way to change an element).
 */

import type { ElementFocus } from "../../shared/ai/contract";
import type { FileChange, ProjectFiles } from "../../shared/types";

/** Above this many cells, the diff is skipped (two ~2000-line files after trimming common ends) */
const MAX_CELLS = 4_000_000;

const DECLARATION = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|const|let|var|type|interface|class|enum)\b/;

type Line = { no: number; text: string; isImport: boolean };

/** Non-blank lines, with whether they belong to an import statement (top-level, possibly multi-line) */
function linesOf(source: string): Line[] {
	const lines: Line[] = [];
	let inImport = false;
	source.split("\n").forEach((raw, index) => {
		const text = raw.trimEnd();

		if (!text.trim()) return;
		const starts = /^import\b/.test(text);
		const isImport = inImport || starts;

		if (starts) inImport = true;

		if (inImport && (/\bfrom\s*["'][^"']*["']\s*;?$/.test(text) || /^import\s+["'][^"']*["']\s*;?$/.test(text)))
			inImport = false;
		lines.push({ no: index + 1, text, isImport });
	});

	return lines;
}

type Op = { kind: "same"; a: number; b: number } | { kind: "del"; a: number } | { kind: "add"; b: number };

/** Edit script from `a` to `b` (indices), common ends trimmed before the LCS table; `null` when too large */
function diff(a: Line[], b: Line[]): Op[] | null {
	let head = 0;

	while (head < a.length && head < b.length && a[head]!.text === b[head]!.text) head++;
	let tail = 0;

	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail]!.text === b[b.length - 1 - tail]!.text
	)
		tail++;
	const n = a.length - head - tail;
	const m = b.length - head - tail;

	if ((n + 1) * (m + 1) > MAX_CELLS) return null;

	// table[i][j]: LCS length of a[head+i…] and b[head+j…]
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);

	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] =
				a[head + i]!.text === b[head + j]!.text
					? table[(i + 1) * width + j + 1]! + 1
					: Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
		}
	}

	const ops: Op[] = [];

	for (let k = 0; k < head; k++) ops.push({ kind: "same", a: k, b: k });
	let i = 0;
	let j = 0;

	while (i < n || j < m) {
		if (i < n && j < m && a[head + i]!.text === b[head + j]!.text) {
			ops.push({ kind: "same", a: head + i, b: head + j });
			i++;
			j++;
		} else if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
			ops.push({ kind: "add", b: head + j++ });
		} else ops.push({ kind: "del", a: head + i++ });
	}

	for (let k = 0; k < tail; k++) ops.push({ kind: "same", a: head + n + k, b: head + m + k });

	return ops;
}

/**
 * Lines of `after` (1-based) that changed outside the focused element of
 * `before`. A removed line counts as the line that now follows it. `null` when
 * the files are too large to compare.
 */
export function changesOutside(
	before: string,
	after: string,
	focus: Pick<ElementFocus, "startLine" | "endLine">,
): number[] | null {
	const a = linesOf(before);
	const b = linesOf(after);
	const ops = diff(a, b);

	if (!ops) return null;
	// The element as indices into `a`; insertions between its neighbours are inside it
	const inElement = (index: number) => a[index]!.no >= focus.startLine && a[index]!.no <= focus.endLine;
	const indices = a.map((_, index) => index).filter(inElement);
	const first = indices[0] ?? -1;
	const last = indices.at(-1) ?? -1;

	const outside = new Set<number>();
	let prevA = -1;

	for (let k = 0; k < ops.length; k++) {
		const op = ops[k]!;

		if (op.kind === "same") {
			prevA = op.a;
			continue;
		}

		// A run of added and removed lines, up to the next kept line
		let end = k;

		while (end + 1 < ops.length && ops[end + 1]!.kind !== "same") end++;
		const run = ops.slice(k, end + 1);
		const following = ops[end + 1];
		// The run stops at a kept line or at the end
		const next = following?.kind === "same" ? following : undefined;
		const added = run.flatMap((o) => (o.kind === "add" ? [b[o.b]!] : []));
		const removed = run.flatMap((o) => (o.kind === "del" ? [o.a] : []));
		// A removed line shows where its replacement is, or else at the line that now follows it
		const at = added[0]?.no ?? (next ? b[next.b]!.no : (b.at(-1)?.no ?? 1));
		const inside = first !== -1 && prevA >= first - 1 && (next ? next.a : a.length) <= last + 1;

		if (inside || removed.some(inElement)) {
			// The run rewrites the element, maybe with lines next to it: those count line for line
			const above = removed.filter((index) => index < first && !a[index]!.isImport).length;
			const below = removed.filter((index) => index > last && !a[index]!.isImport).length;
			const edges = [...added.slice(0, above), ...added.slice(Math.max(above, added.length - below))];

			for (const line of edges) if (!line.isImport) outside.add(line.no);

			if (above + below > edges.length) outside.add(at);
		} else {
			const declaration = DECLARATION.test(added.find((line) => !line.isImport)?.text ?? "");

			for (const line of added) if (!line.isImport && !declaration) outside.add(line.no);

			if (removed.some((index) => !a[index]!.isImport)) outside.add(at);
		}

		k = end;
	}

	return [...outside].sort((x, y) => x - y);
}

/** `[3, 4, 5, 9]` → `"lines 3–5, 9"` */
export function lineRanges(lines: number[]): string {
	const ranges: string[] = [];

	for (let i = 0; i < lines.length;) {
		let j = i;

		while (j + 1 < lines.length && lines[j + 1] === lines[j]! + 1) j++;
		ranges.push(i === j ? `${lines[i]}` : `${lines[i]}–${lines[j]}`);
		i = j + 1;
	}

	return `${lines.length === 1 ? "line" : "lines"} ${ranges.join(", ")}`;
}

/** Notes for the reply when a focused edit changed its file outside the element; empty when it stayed inside. */
export function focusNotes(
	focus: ElementFocus | undefined,
	projectFiles: ProjectFiles,
	changes: FileChange[],
): string[] {
	const before = focus ? projectFiles[focus.file] : undefined;
	const change = focus && changes.find((c) => c.path === focus.file);

	if (!focus || before === undefined || !change) return [];

	if (change.content === null) return [`Note: this deleted ${focus.file}, not just ${focus.label}. Undo reverts it.`];
	const lines = changesOutside(before, change.content, focus);

	if (!lines?.length) return [];

	return [
		`Note: this also changed ${focus.file} outside ${focus.label} (${lineRanges(lines)}). Undo reverts the whole edit.`,
	];
}
