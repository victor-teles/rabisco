import { listLinks, resolveLink } from "../../shared/prototype/links";
import type { ProjectFiles } from "../../shared/types";
import { boundsOf, type Rect } from "./align";

export type Edge = { from: string; to: string };

const centerY = (rect: Rect) => rect.y + rect.height / 2;

/** Rows by vertical overlap with the row's first rect, each read left to right */
function rowsOf<T extends Rect>(rects: T[]): T[][] {
	const rows: T[][] = [];

	for (const rect of [...rects].sort((a, b) => centerY(a) - centerY(b) || a.x - b.x)) {
		const row = rows.at(-1);
		const first = row?.[0];

		if (row && first && centerY(rect) < first.y + first.height) row.push(rect);
		else rows.push([rect]);
	}

	return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

/** Figma's Tidy up: the rows and order stay, cells line up in columns, with one gap */
export function tidyUp<T extends Rect>(rects: T[], gap: number): T[] {
	const bounds = boundsOf(rects);

	if (!bounds || rects.length < 2) return rects;
	const rows = rowsOf(rects);
	const columns = Math.max(...rows.map((row) => row.length));

	const widths = Array.from({ length: columns }, (_, column) =>
		Math.max(0, ...rows.map((row) => row[column]?.width ?? 0)),
	);

	const placed = new Map<T, T>();
	let y = bounds.y;

	for (const row of rows) {
		let x = bounds.x;

		row.forEach((rect, column) => {
			placed.set(rect, { ...rect, x, y });
			x += widths[column]! + gap;
		});
		y += Math.max(...row.map((rect) => rect.height)) + gap;
	}

	return rects.map((rect) => placed.get(rect) ?? rect);
}

/** Breadth first from the screens nothing links to; a cycle with no such screen starts at its first in reading order */
function levelsOf(ids: string[], edges: Edge[]): Map<string, number> {
	const out = new Map<string, string[]>(ids.map((id) => [id, []]));
	const incoming = new Map(ids.map((id) => [id, 0]));

	for (const { from, to } of edges) {
		if (from === to || !out.has(from) || !out.has(to) || out.get(from)!.includes(to)) continue;
		out.get(from)!.push(to);
		incoming.set(to, incoming.get(to)! + 1);
	}

	const levels = new Map<string, number>();

	const walk = (starts: string[]) => {
		const queue = starts.filter((id) => !levels.has(id));

		for (const id of queue) levels.set(id, 0);

		while (queue.length) {
			const id = queue.shift()!;

			for (const next of out.get(id)!) {
				if (levels.has(next)) continue;
				levels.set(next, levels.get(id)! + 1);
				queue.push(next);
			}
		}
	};

	walk(ids.filter((id) => incoming.get(id) === 0));

	for (const id of ids) if (!levels.has(id)) walk([id]);

	return levels;
}

export type Flow<T> = { placed: T[]; unlinked: T[] };

/**
 * Linked screens go in columns by their distance from where the flow starts, left to right.
 * Screens with no links go in a row below. Rects keep their size; the top-left of their bounds stays.
 */
export function flowLayout<T extends Rect & { file: string }>(rects: T[], edges: Edge[], gap: number): Flow<T> {
	const bounds = boundsOf(rects);

	if (!bounds) return { placed: rects, unlinked: [] };
	const files = new Set(rects.map((rect) => rect.file));
	const scoped = edges.filter((edge) => edge.from !== edge.to && files.has(edge.from) && files.has(edge.to));
	const linked = new Set(scoped.flatMap((edge) => [edge.from, edge.to]));
	const reading = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

	const levels = levelsOf(
		reading.flatMap((rect) => (linked.has(rect.file) ? [rect.file] : [])),
		scoped,
	);

	const columns: T[][] = [];

	for (const rect of reading) {
		const level = levels.get(rect.file);

		if (level === undefined) continue;
		(columns[level] ??= []).push(rect);
	}

	const rowOf = new Map<string, number>();
	const placed = new Map<T, T>();
	let x = bounds.x;
	let bottom = bounds.y;

	for (const column of columns) {
		const parents = (rect: T) =>
			scoped.flatMap((edge) => (edge.to === rect.file && rowOf.has(edge.from) ? [rowOf.get(edge.from)!] : []));

		const order = column
			.map((rect, index) => {
				const rows = parents(rect);

				return { rect, index, key: rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : Infinity };
			})
			.sort((a, b) => a.key - b.key || a.index - b.index);

		let y = bounds.y;

		order.forEach(({ rect }, row) => {
			rowOf.set(rect.file, row);
			placed.set(rect, { ...rect, x, y });
			y += rect.height + gap;
		});
		bottom = Math.max(bottom, y);
		x += Math.max(...column.map((rect) => rect.width)) + gap * 2;
	}

	const unlinked = reading.filter((rect) => !linked.has(rect.file));
	let rowX = bounds.x;
	const rowY = placed.size ? bottom : bounds.y;

	for (const rect of unlinked) {
		placed.set(rect, { ...rect, x: rowX, y: rowY });
		rowX += rect.width + gap;
	}

	return { placed: rects.map((rect) => placed.get(rect) ?? rect), unlinked };
}

/** Screen to screen links, as the canvas draws them */
export function screenEdges(files: ProjectFiles): Edge[] {
	return listLinks(files).flatMap((link) => {
		const resolved = resolveLink(link.to, files);

		return resolved.kind === "screen" ? [{ from: link.file, to: resolved.file }] : [];
	});
}

/** A screen and its alternates move as one block, so the alternates stay below it */
export function flowFrames<T extends Rect & { file: string }>(
	frames: T[],
	edges: Edge[],
	gap: number,
	groupOf: (file: string) => string,
): Flow<T> {
	const groups = new Map<string, T[]>();

	for (const frame of frames) {
		const key = groupOf(frame.file);
		const members = groups.get(key);

		if (members) members.push(frame);
		else groups.set(key, [frame]);
	}

	const blocks = [...groups].map(([file, members]) => ({ ...boundsOf(members)!, file }));
	const grouped = edges.map((edge) => ({ from: groupOf(edge.from), to: groupOf(edge.to) }));
	const flow = flowLayout(blocks, grouped, gap);
	const moved = new Map<string, { dx: number; dy: number }>();

	flow.placed.forEach((block, index) => {
		const before = blocks[index]!;
		moved.set(block.file, { dx: block.x - before.x, dy: block.y - before.y });
	});

	const unlinked = new Set(flow.unlinked.map((block) => block.file));

	return {
		placed: frames.map((frame) => {
			const { dx, dy } = moved.get(groupOf(frame.file))!;

			return dx || dy ? { ...frame, x: frame.x + dx, y: frame.y + dy } : frame;
		}),
		unlinked: frames.filter((frame) => unlinked.has(groupOf(frame.file))),
	};
}
