/**
 * "PDF of the flow": the screens in the order a user walks through them, one
 * page each, after an overview page. Prototype links (decision 0007) decide
 * the order, and become clickable areas that jump to the linked page.
 */

import { listLinks, resolveLink } from "../prototype/links";
import type { ProjectFiles } from "../types";
import {
	PT_PER_PX,
	type PdfColor,
	type PdfDocument,
	type PdfDraw,
	type PdfImage,
	type PdfLink,
	type PdfPage,
} from "./pdf";
import type { SceneLink } from "./scene";

/**
 * `screens` (paths, canvas order) in flow order: breadth-first from the first
 * screen along its links, in source order; then the same from the first
 * screen not reached yet, until every screen is in. Links written in
 * component files don't count, as on the canvas.
 */
export function flowOrder(screens: string[], files: ProjectFiles): string[] {
	const included = new Set(screens);
	const targets = new Map<string, string[]>();

	for (const link of listLinks(files)) {
		if (!included.has(link.file)) continue;
		const target = resolveLink(link.to, files);

		if (target.kind !== "screen" || !included.has(target.file) || target.file === link.file) continue;
		const list = targets.get(link.file) ?? [];

		if (!list.includes(target.file)) list.push(target.file);
		targets.set(link.file, list);
	}

	const order: string[] = [];
	const seen = new Set<string>();

	for (const start of screens) {
		if (seen.has(start)) continue;
		const queue = [start];
		seen.add(start);

		while (queue.length) {
			const file = queue.shift()!;
			order.push(file);

			for (const next of targets.get(file) ?? []) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
	}

	return order;
}

/** One rendered screen, in flow order. `image` is its raster at any scale; sizes are CSS pixels. */
export type FlowScreen = {
	file: string;
	name: string;
	width: number;
	height: number;
	image: PdfImage;
	links: SceneLink[];
};

const MARGIN = 40;

const HEADER = 64;

const GAP = 24;

const OVERVIEW_WIDTH = 1200;

const CAPTION = 32;

const INK: PdfColor = [0.09, 0.09, 0.11];

const MUTED: PdfColor = [0.45, 0.45, 0.5];

const LINE: PdfColor = [0.88, 0.88, 0.9];

/** `text` shortened with "…" to about `width` px of Helvetica at `size` px. */
export function fitText(text: string, width: number, size: number): string {
	const max = Math.floor(width / (size * 0.55));

	return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * The flow PDF: an overview page with every screen as a numbered thumbnail
 * (when there is more than one), then a page per screen sized to it, with
 * its name and position as a header. Links to other exported screens are
 * clickable; `back` links aren't, since a page has no history.
 */
export function flowDocument({
	title,
	screens,
	files,
}: {
	title: string;
	screens: FlowScreen[];
	files: ProjectFiles;
}): PdfDocument {
	if (!screens.length) throw new Error("Nothing to export");
	const overview = screens.length > 1;
	const first = overview ? 1 : 0;
	const pageOf = new Map(screens.map((screen, i) => [screen.file, first + i]));
	const images = screens.map((screen) => screen.image);
	const pages: PdfPage[] = [];
	// Layout in CSS pixels, written in points
	const pt = (px: number) => px * PT_PER_PX;

	const rect = (x: number, y: number, width: number, height: number) => ({
		x: pt(x),
		y: pt(y),
		width: pt(width),
		height: pt(height),
	});

	if (overview) {
		const draw: PdfDraw[] = [];
		const links: PdfLink[] = [];
		draw.push({
			type: "text",
			text: fitText(title, OVERVIEW_WIDTH - MARGIN * 2, 28),
			x: pt(MARGIN),
			y: pt(MARGIN + 28),
			size: pt(28),
			bold: true,
			color: INK,
		});
		draw.push({
			type: "text",
			text: `${screens.length} screens, in flow order`,
			x: pt(MARGIN),
			y: pt(MARGIN + 54),
			size: pt(13),
			color: MUTED,
		});
		const narrow = screens.every((s) => s.width < 600);
		const target = narrow ? 200 : 340;
		const inner = OVERVIEW_WIDTH - MARGIN * 2;
		const columns = Math.max(1, Math.floor((inner + GAP) / (target + GAP)));
		const tile = (inner - GAP * (columns - 1)) / columns;
		let y = MARGIN + 88;

		for (let row = 0; row * columns < screens.length; row++) {
			const items = screens.slice(row * columns, row * columns + columns);
			const heights = items.map((s) => Math.min(s.height * (tile / s.width), tile * 2.4));
			items.forEach((screen, i) => {
				const index = row * columns + i;
				const x = MARGIN + i * (tile + GAP);
				const full = screen.height * (tile / screen.width);
				draw.push({ type: "image", image: index, ...rect(x, y, tile, full), clip: rect(x, y, tile, heights[i]!) });
				draw.push({ type: "rect", ...rect(x, y, tile, heights[i]!), stroke: LINE, lineWidth: 0.5 });
				draw.push({
					type: "text",
					text: fitText(`${index + 1}  ${screen.name}`, tile, 12),
					x: pt(x),
					y: pt(y + heights[i]! + 20),
					size: pt(12),
					color: INK,
				});
				links.push({ ...rect(x, y, tile, heights[i]! + CAPTION), page: first + index });
			});
			y += Math.max(...heights) + CAPTION + GAP;
		}

		pages.push({ width: pt(OVERVIEW_WIDTH), height: pt(y - GAP + MARGIN), draw, links });
	}

	screens.forEach((screen, i) => {
		const top = MARGIN + HEADER;
		const width = screen.width + MARGIN * 2;

		const draw: PdfDraw[] = [
			{
				type: "text",
				text: fitText(screen.name, screen.width, 20),
				x: pt(MARGIN),
				y: pt(MARGIN + 20),
				size: pt(20),
				bold: true,
				color: INK,
			},
			{
				type: "text",
				text: fitText(`${i + 1} of ${screens.length}  ·  ${screen.file}`, screen.width, 12),
				x: pt(MARGIN),
				y: pt(MARGIN + 42),
				size: pt(12),
				color: MUTED,
			},
			{ type: "image", image: i, ...rect(MARGIN, top, screen.width, screen.height) },
			{ type: "rect", ...rect(MARGIN, top, screen.width, screen.height), stroke: LINE, lineWidth: 0.5 },
		];

		const links: PdfLink[] = [];

		for (const link of screen.links) {
			const target = resolveLink(link.to, files);
			const page = target.kind === "screen" ? pageOf.get(target.file) : undefined;

			if (page === undefined) continue;
			// Inside the screen only
			const x1 = Math.max(0, link.box.x);
			const y1 = Math.max(0, link.box.y);
			const x2 = Math.min(screen.width, link.box.x + link.box.width);
			const y2 = Math.min(screen.height, link.box.y + link.box.height);

			if (x2 - x1 < 1 || y2 - y1 < 1) continue;
			links.push({ ...rect(MARGIN + x1, top + y1, x2 - x1, y2 - y1), page });
		}

		pages.push({ width: pt(width), height: pt(top + screen.height + MARGIN), draw, links });
	});

	return {
		title,
		images,
		pages,
		outline: [
			...(overview ? [{ title: "Overview", page: 0 }] : []),
			...screens.map((screen, i) => ({ title: screen.name, page: first + i })),
		],
	};
}
