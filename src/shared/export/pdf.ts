/**
 * A small PDF 1.4 writer for the flow export: pages with JPEG images
 * (embedded as-is with DCTDecode), Helvetica text, rectangles, link
 * annotations between pages and an outline. No dependencies, no compression
 * of its own: the images are already JPEG.
 *
 * Coordinates are points with the origin at the top left of the page (the
 * writer flips them to PDF's bottom-left origin).
 */

/** RGB, channels 0–1. */
export type PdfColor = [number, number, number];

/** A baseline JPEG, and its size in pixels. */
export type PdfImage = { jpeg: Uint8Array; width: number; height: number };

export type PdfRect = { x: number; y: number; width: number; height: number };

export type PdfDraw =
	/** `image` indexes `PdfDocument.images`; an image used on several pages is stored once */
	| ({ type: "image"; image: number; clip?: PdfRect } & PdfRect)
	/** `y` is the baseline */
	| { type: "text"; text: string; x: number; y: number; size: number; bold?: boolean; color?: PdfColor }
	| ({ type: "rect"; fill?: PdfColor; stroke?: PdfColor; lineWidth?: number } & PdfRect);

/** A clickable area that goes to page `page` (an index into `pages`). */
export type PdfLink = PdfRect & { page: number };

export type PdfPage = { width: number; height: number; draw: PdfDraw[]; links?: PdfLink[] };

export type PdfDocument = {
	title?: string;
	images: PdfImage[];
	pages: PdfPage[];
	/** Bookmarks, in order */
	outline?: { title: string; page: number }[];
};

/** Points per CSS pixel: at 100% zoom a page shows the screen at its CSS size. */
export const PT_PER_PX = 0.75;

const n = (value: number) => String(Math.round(value * 1000) / 1000);

/** Unicode code points WinAnsiEncoding places in 0x80–0x9F */
const WIN_ANSI = new Map([
	[0x20ac, 0x80],
	[0x201a, 0x82],
	[0x0192, 0x83],
	[0x201e, 0x84],
	[0x2026, 0x85],
	[0x2020, 0x86],
	[0x2021, 0x87],
	[0x02c6, 0x88],
	[0x2030, 0x89],
	[0x0160, 0x8a],
	[0x2039, 0x8b],
	[0x0152, 0x8c],
	[0x017d, 0x8e],
	[0x2018, 0x91],
	[0x2019, 0x92],
	[0x201c, 0x93],
	[0x201d, 0x94],
	[0x2022, 0x95],
	[0x2013, 0x96],
	[0x2014, 0x97],
	[0x02dc, 0x98],
	[0x2122, 0x99],
	[0x0161, 0x9a],
	[0x203a, 0x9b],
	[0x0153, 0x9c],
	[0x017e, 0x9e],
	[0x0178, 0x9f],
]);

/** `text` as a PDF literal string in WinAnsiEncoding (one char per byte); unmappable characters become `?`. */
export function pdfString(text: string): string {
	let out = "(";

	for (const char of text.normalize("NFC")) {
		const code = char.codePointAt(0)!;
		const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : (WIN_ANSI.get(code) ?? 0x3f);

		if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
		else if (byte < 0x20) out += " ";
		else out += String.fromCharCode(byte);
	}

	return `${out})`;
}

/** `text` as a UTF-16BE hex string with a byte order mark, for metadata and bookmarks. */
export function pdfTextString(text: string): string {
	let hex = "FEFF";

	for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();

	return `<${hex}>`;
}

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

const color = ([r, g, b]: PdfColor) => `${n(r)} ${n(g)} ${n(b)}`;

function contentStream(page: PdfPage): string {
	const flip = (y: number, height = 0) => page.height - y - height;
	const ops: string[] = [];

	for (const item of page.draw) {
		if (item.type === "image") {
			ops.push("q");

			if (item.clip)
				ops.push(
					`${n(item.clip.x)} ${n(flip(item.clip.y, item.clip.height))} ${n(item.clip.width)} ${n(item.clip.height)} re W n`,
				);
			ops.push(
				`${n(item.width)} 0 0 ${n(item.height)} ${n(item.x)} ${n(flip(item.y, item.height))} cm /Im${item.image} Do`,
				"Q",
			);
		} else if (item.type === "text") {
			ops.push(
				`BT /${item.bold ? "F2" : "F1"} ${n(item.size)} Tf ${color(item.color ?? [0, 0, 0])} rg ${n(item.x)} ${n(flip(item.y))} Td ${pdfString(item.text)} Tj ET`,
			);
		} else {
			if (!item.fill && !item.stroke) continue;
			const parts = ["q"];

			if (item.fill) parts.push(`${color(item.fill)} rg`);

			if (item.stroke) parts.push(`${color(item.stroke)} RG ${n(item.lineWidth ?? 1)} w`);
			parts.push(
				`${n(item.x)} ${n(flip(item.y, item.height))} ${n(item.width)} ${n(item.height)} re`,
				item.fill && item.stroke ? "B" : item.fill ? "f" : "S",
				"Q",
			);
			ops.push(parts.join(" "));
		}
	}

	return ops.join("\n");
}

/** Writes `doc` as PDF bytes. Pages need at least one entry; images must be baseline JPEGs. */
export function createPdf(doc: PdfDocument): Uint8Array {
	if (!doc.pages.length) throw new Error("A PDF needs at least one page");
	const chunks: Uint8Array[] = [];
	let length = 0;
	const offsets: number[] = [];

	const push = (bytes: Uint8Array) => {
		chunks.push(bytes);
		length += bytes.length;
	};

	const text = (value: string) => push(latin1(value));

	// Object numbers, decided up front so objects can point at each other
	let next = 1;
	const catalog = next++;
	const pagesRoot = next++;
	const fontRegular = next++;
	const fontBold = next++;
	const info = next++;
	const images = doc.images.map(() => next++);

	const pages = doc.pages.map((page) => ({
		page: next++,
		content: next++,
		links: (page.links ?? []).map(() => next++),
	}));

	const outline = doc.outline?.length ? { root: next++, items: doc.outline.map(() => next++) } : null;

	const object = (id: number, body: string) => {
		offsets[id] = length;
		text(`${id} 0 obj\n${body}\nendobj\n`);
	};

	const stream = (id: number, dict: string, data: Uint8Array) => {
		offsets[id] = length;
		text(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
		push(data);
		text(`\nendstream\nendobj\n`);
	};

	const destination = (page: number) => `[${pages[Math.min(Math.max(0, page), pages.length - 1)]!.page} 0 R /Fit]`;

	text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
	object(
		catalog,
		`<< /Type /Catalog /Pages ${pagesRoot} 0 R${outline ? ` /Outlines ${outline.root} 0 R /PageMode /UseOutlines` : ""} >>`,
	);
	object(pagesRoot, `<< /Type /Pages /Kids [${pages.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${pages.length} >>`);
	object(fontRegular, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	object(fontBold, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
	object(info, `<< /Producer (Rabisco)${doc.title ? ` /Title ${pdfTextString(doc.title)}` : ""} >>`);
	doc.images.forEach((image, i) =>
		stream(
			images[i]!,
			`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
			image.jpeg,
		),
	);
	doc.pages.forEach((page, i) => {
		const ids = pages[i]!;
		const xObjects = doc.images.map((_, j) => `/Im${j} ${images[j]} 0 R`).join(" ");
		object(
			ids.page,
			`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Contents ${ids.content} 0 R ` +
				`/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xObjects ? ` /XObject << ${xObjects} >>` : ""} >>` +
				`${ids.links.length ? ` /Annots [${ids.links.map((id) => `${id} 0 R`).join(" ")}]` : ""} >>`,
		);
		stream(ids.content, "", latin1(contentStream(page)));
		(page.links ?? []).forEach((link, j) => {
			const [x1, y1, x2, y2] = [link.x, page.height - link.y - link.height, link.x + link.width, page.height - link.y];
			object(
				ids.links[j]!,
				`<< /Type /Annot /Subtype /Link /Rect [${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)}] /Border [0 0 0] /Dest ${destination(link.page)} >>`,
			);
		});
	});

	if (outline) {
		const items = doc.outline!;
		object(
			outline.root,
			`<< /Type /Outlines /First ${outline.items[0]} 0 R /Last ${outline.items.at(-1)} 0 R /Count ${items.length} >>`,
		);
		items.forEach((item, i) => {
			const sibling = (j: number, key: string) => (outline.items[j] ? ` /${key} ${outline.items[j]} 0 R` : "");
			object(
				outline.items[i]!,
				`<< /Title ${pdfTextString(item.title)} /Parent ${outline.root} 0 R${sibling(i - 1, "Prev")}${sibling(i + 1, "Next")} /Dest ${destination(item.page)} >>`,
			);
		});
	}

	const xref = length;
	const count = next;
	text(`xref\n0 ${count}\n0000000000 65535 f \n`);

	for (let id = 1; id < count; id++) text(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
	text(`trailer\n<< /Size ${count} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

	const out = new Uint8Array(length);
	let at = 0;

	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}

	return out;
}

/** Width and height of a JPEG, from its first SOF marker; `null` when it isn't one. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let i = 2;

	while (i + 9 < bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1]!;

		if (marker === 0xff) {
			i++;
			continue;
		}

		const size = (bytes[i + 2]! << 8) | bytes[i + 3]!;

		// SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC)
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
		}

		i += 2 + size;
	}

	return null;
}
