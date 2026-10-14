import { unzlibSync } from "fflate";

export type FontPoint = { x: number; y: number; onCurve: boolean };

export type Contour = FontPoint[];

export type Font = {
	unitsPerEm: number;
	ascender: number;
	descender: number;
	glyphOf: (codepoint: number) => number | null;
	advanceOf: (glyph: number) => number;
	contoursOf: (glyph: number) => Contour[] | null;
};

type Table = { offset: number; length: number };

const WOFF = 0x774f4646;

const MAX_TABLE_BYTES = 4 * 1024 * 1024;

const MAX_COMPOSITE_DEPTH = 8;

const MAX_POINTS = 10_000;

const ON_CURVE = 0x01;

const X_SHORT = 0x02;

const Y_SHORT = 0x04;

const REPEAT = 0x08;

const X_SAME = 0x10;

const Y_SAME = 0x20;

const ARGS_ARE_WORDS = 0x0001;

const ARGS_ARE_XY = 0x0002;

const HAS_SCALE = 0x0008;

const MORE_COMPONENTS = 0x0020;

const HAS_XY_SCALE = 0x0040;

const HAS_TWO_BY_TWO = 0x0080;

class Reader {
	readonly view: DataView;

	constructor(readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	fits(offset: number, length: number) {
		return Number.isInteger(offset) && offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
	}

	u8(offset: number) {
		return this.view.getUint8(offset);
	}

	u16(offset: number) {
		return this.view.getUint16(offset);
	}

	i16(offset: number) {
		return this.view.getInt16(offset);
	}

	u32(offset: number) {
		return this.view.getUint32(offset);
	}

	f2dot14(offset: number) {
		return this.view.getInt16(offset) / 16384;
	}
}

function woffTables(file: Reader): Map<string, Reader> | null {
	if (!file.fits(0, 44)) return null;
	const count = file.u16(12);
	const tables = new Map<string, Reader>();

	if (!file.fits(44, count * 20)) return null;

	for (let i = 0; i < count; i++) {
		const entry = 44 + i * 20;
		const tag = String.fromCharCode(file.u8(entry), file.u8(entry + 1), file.u8(entry + 2), file.u8(entry + 3));
		const offset = file.u32(entry + 4);
		const compressed = file.u32(entry + 8);
		const length = file.u32(entry + 12);

		if (!file.fits(offset, compressed) || length > MAX_TABLE_BYTES) return null;
		const data = file.bytes.subarray(offset, offset + compressed);
		const table = compressed < length ? unzlibSync(data, { out: new Uint8Array(length) }) : data;

		if (table.length !== length) return null;
		tables.set(tag, new Reader(table));
	}

	return tables;
}

function sfntTables(file: Reader): Map<string, Reader> | null {
	if (!file.fits(0, 12)) return null;
	const count = file.u16(4);
	const tables = new Map<string, Reader>();

	if (!file.fits(12, count * 16)) return null;

	for (let i = 0; i < count; i++) {
		const entry = 12 + i * 16;
		const tag = String.fromCharCode(file.u8(entry), file.u8(entry + 1), file.u8(entry + 2), file.u8(entry + 3));
		const table: Table = { offset: file.u32(entry + 8), length: file.u32(entry + 12) };

		if (!file.fits(table.offset, table.length)) return null;
		tables.set(tag, new Reader(file.bytes.subarray(table.offset, table.offset + table.length)));
	}

	return tables;
}

function format4(cmap: Reader, at: number): Map<number, number> | null {
	if (!cmap.fits(at, 14)) return null;
	const segments = cmap.u16(at + 6) / 2;
	const ends = at + 14;
	const starts = ends + segments * 2 + 2;
	const deltas = starts + segments * 2;
	const ranges = deltas + segments * 2;

	if (!cmap.fits(ends, segments * 8 + 2)) return null;
	const glyphs = new Map<number, number>();

	for (let i = 0; i < segments; i++) {
		const end = cmap.u16(ends + i * 2);
		const start = cmap.u16(starts + i * 2);
		const delta = cmap.i16(deltas + i * 2);
		const range = cmap.u16(ranges + i * 2);

		for (let code = start; code <= end && code !== 0xffff; code++) {
			let glyph: number;

			if (range === 0) glyph = (code + delta) & 0xffff;
			else {
				const offset = ranges + i * 2 + range + (code - start) * 2;

				if (!cmap.fits(offset, 2)) continue;
				const raw = cmap.u16(offset);

				glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
			}

			if (glyph) glyphs.set(code, glyph);
		}
	}

	return glyphs;
}

function format12(cmap: Reader, at: number): Map<number, number> | null {
	if (!cmap.fits(at, 16)) return null;
	const groups = cmap.u32(at + 12);

	if (!cmap.fits(at + 16, groups * 12)) return null;
	const glyphs = new Map<number, number>();

	for (let i = 0; i < groups; i++) {
		const entry = at + 16 + i * 12;
		const start = cmap.u32(entry);
		const end = Math.min(cmap.u32(entry + 4), start + 0xffff);
		const first = cmap.u32(entry + 8);

		for (let code = start; code <= end; code++) glyphs.set(code, first + code - start);
	}

	return glyphs;
}

function readCmap(cmap: Reader): Map<number, number> | null {
	if (!cmap.fits(0, 4)) return null;
	const count = cmap.u16(2);
	let best: Map<number, number> | null = null;

	for (let i = 0; i < count; i++) {
		const record = 4 + i * 8;

		if (!cmap.fits(record, 8)) return best;
		const platform = cmap.u16(record);
		const offset = cmap.u32(record + 4);

		if ((platform !== 0 && platform !== 3) || !cmap.fits(offset, 2)) continue;
		const format = cmap.u16(offset);

		if (format === 12) return format12(cmap, offset) ?? best;

		if (format === 4) best ??= format4(cmap, offset);
	}

	return best;
}

function simpleContours(glyf: Reader, at: number, count: number): Contour[] | null {
	const ends: number[] = [];

	if (!glyf.fits(at + 10, count * 2 + 2)) return null;

	for (let i = 0; i < count; i++) ends.push(glyf.u16(at + 10 + i * 2));
	const points = (ends[ends.length - 1] ?? -1) + 1;

	if (points > MAX_POINTS) return null;
	let offset = at + 10 + count * 2;

	offset += 2 + glyf.u16(offset);
	const flags: number[] = [];

	while (flags.length < points) {
		if (!glyf.fits(offset, 1)) return null;
		const flag = glyf.u8(offset++);

		flags.push(flag);

		if (flag & REPEAT) {
			if (!glyf.fits(offset, 1)) return null;

			for (let repeat = glyf.u8(offset++); repeat > 0 && flags.length < points; repeat--) flags.push(flag);
		}
	}

	const coordinates = (short: number, same: number) => {
		const values: number[] = [];
		let value = 0;

		for (const flag of flags) {
			if (flag & short) {
				if (!glyf.fits(offset, 1)) return null;
				const delta = glyf.u8(offset++);

				value += flag & same ? delta : -delta;
			} else if (!(flag & same)) {
				if (!glyf.fits(offset, 2)) return null;
				value += glyf.i16(offset);
				offset += 2;
			}

			values.push(value);
		}

		return values;
	};

	const xs = coordinates(X_SHORT, X_SAME);
	const ys = xs && coordinates(Y_SHORT, Y_SAME);

	if (!xs || !ys) return null;
	const contours: Contour[] = [];
	let start = 0;

	for (const end of ends) {
		if (end < start || end >= points) return null;
		const contour: Contour = [];

		for (let i = start; i <= end; i++) contour.push({ x: xs[i]!, y: ys[i]!, onCurve: !!(flags[i]! & ON_CURVE) });
		contours.push(contour);
		start = end + 1;
	}

	return contours;
}

type Glyphs = { glyf: Reader; loca: number[] };

function compositeContours(glyphs: Glyphs, at: number, depth: number): Contour[] | null {
	const { glyf } = glyphs;
	const contours: Contour[] = [];
	let offset = at + 10;
	let flags = MORE_COMPONENTS;

	while (flags & MORE_COMPONENTS) {
		if (!glyf.fits(offset, 4)) return null;
		flags = glyf.u16(offset);
		const component = glyf.u16(offset + 2);

		offset += 4;
		const words = flags & ARGS_ARE_WORDS;

		if (!glyf.fits(offset, words ? 4 : 2)) return null;
		const dx = words ? glyf.i16(offset) : (glyf.u8(offset) << 24) >> 24;
		const dy = words ? glyf.i16(offset + 2) : (glyf.u8(offset + 1) << 24) >> 24;

		offset += words ? 4 : 2;
		let [a, b, c, d] = [1, 0, 0, 1];

		if (flags & HAS_SCALE) {
			if (!glyf.fits(offset, 2)) return null;
			a = d = glyf.f2dot14(offset);
			offset += 2;
		} else if (flags & HAS_XY_SCALE) {
			if (!glyf.fits(offset, 4)) return null;
			a = glyf.f2dot14(offset);
			d = glyf.f2dot14(offset + 2);
			offset += 4;
		} else if (flags & HAS_TWO_BY_TWO) {
			if (!glyf.fits(offset, 8)) return null;
			a = glyf.f2dot14(offset);
			b = glyf.f2dot14(offset + 2);
			c = glyf.f2dot14(offset + 4);
			d = glyf.f2dot14(offset + 6);
			offset += 8;
		}

		if (!(flags & ARGS_ARE_XY)) return null;
		const parts = glyphContours(glyphs, component, depth + 1);

		if (!parts) return null;

		for (const contour of parts)
			contours.push(contour.map((p) => ({ x: a * p.x + c * p.y + dx, y: b * p.x + d * p.y + dy, onCurve: p.onCurve })));
	}

	return contours;
}

function glyphContours(glyphs: Glyphs, glyph: number, depth = 0): Contour[] | null {
	const { glyf, loca } = glyphs;

	if (depth > MAX_COMPOSITE_DEPTH || glyph < 0 || glyph + 1 >= loca.length) return null;
	const start = loca[glyph]!;
	const end = loca[glyph + 1]!;

	if (end === start) return [];

	if (end < start || !glyf.fits(start, Math.max(10, end - start))) return null;
	const count = glyf.i16(start);

	return count >= 0 ? simpleContours(glyf, start, count) : compositeContours(glyphs, start, depth);
}

export function readFont(bytes: Uint8Array): Font | null {
	try {
		const file = new Reader(bytes);

		if (!file.fits(0, 4)) return null;
		const tables = file.u32(0) === WOFF ? woffTables(file) : sfntTables(file);

		const [head, hhea, maxp, hmtx, cmap, locaTable, glyf] = [
			"head",
			"hhea",
			"maxp",
			"hmtx",
			"cmap",
			"loca",
			"glyf",
		].map((tag) => tables?.get(tag));

		if (!head || !hhea || !maxp || !hmtx || !cmap || !locaTable || !glyf) return null;

		if (!head.fits(0, 54) || !hhea.fits(0, 36) || !maxp.fits(0, 6)) return null;
		const unitsPerEm = head.u16(18);
		const longLoca = head.i16(50) === 1;
		const glyphCount = maxp.u16(4);
		const metrics = hhea.u16(34);
		const loca: number[] = [];

		if (!unitsPerEm || !locaTable.fits(0, (glyphCount + 1) * (longLoca ? 4 : 2))) return null;

		for (let i = 0; i <= glyphCount; i++) loca.push(longLoca ? locaTable.u32(i * 4) : locaTable.u16(i * 2) * 2);
		const characters = readCmap(cmap);

		if (!characters || !metrics || !hmtx.fits(0, metrics * 4)) return null;

		return {
			unitsPerEm,
			ascender: hhea.i16(4),
			descender: hhea.i16(6),
			glyphOf: (codepoint) => characters.get(codepoint) ?? null,
			advanceOf: (glyph) => hmtx.u16(Math.min(glyph, metrics - 1) * 4),
			contoursOf: (glyph) => {
				try {
					return glyphContours({ glyf, loca }, glyph);
				} catch {
					return null;
				}
			},
		};
	} catch {
		return null;
	}
}

const MOVE = 1;

const LINE = 2;

const QUAD = 3;

const CLOSE = 0;

export function glyphCommands(contours: Contour[], unitsPerEm: number): Uint8Array {
	const commands: number[] = [CLOSE];
	const values: number[] = [];

	const emit = (command: number, ...points: { x: number; y: number }[]) => {
		commands.push(command);

		for (const point of points) values.push(point.x / unitsPerEm, point.y / unitsPerEm);
	};

	const mid = (a: FontPoint, b: FontPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	for (const contour of contours) {
		if (contour.length < 2) continue;
		const firstOn = contour.findIndex((point) => point.onCurve);
		const points = firstOn < 0 ? contour : [...contour.slice(firstOn), ...contour.slice(0, firstOn)];
		const start = firstOn < 0 ? mid(points[0]!, points[1]!) : points[0]!;
		let control: FontPoint | null = null;

		emit(MOVE, start);

		for (const point of [...points.slice(firstOn < 0 ? 0 : 1), points[0]!]) {
			if (point.onCurve) {
				if (control) emit(QUAD, control, point);
				else emit(LINE, point);
				control = null;
			} else {
				if (control) emit(QUAD, control, mid(control, point));
				control = point;
			}
		}

		if (control) emit(QUAD, control, start);
		emit(CLOSE);
	}

	const sizes = new Map([
		[CLOSE, 0],
		[MOVE, 2],
		[LINE, 2],
		[QUAD, 4],
	]);

	const bytes = new Uint8Array(commands.length + values.length * 4);
	const view = new DataView(bytes.buffer);
	let offset = 0;
	let value = 0;

	for (const command of commands) {
		view.setUint8(offset++, command);

		for (let i = 0; i < (sizes.get(command) ?? 0); i++) {
			view.setFloat32(offset, values[value++]!, true);
			offset += 4;
		}
	}

	return bytes;
}

export type FontFile = { weight: number; unicodeRange: string; bytes: Uint8Array };

export type GlyphOutline = { commands: Uint8Array | null; advance: number };

export type FontSet = {
	ascent: number;
	descent: number;
	outline: (codepoint: number, weight: number) => GlyphOutline | null;
};

export function fontSet(files: FontFile[]): FontSet | null {
	const byWeight = new Map<number, Font[]>();

	for (const file of files) {
		const font = readFont(file.bytes);

		if (!font) continue;
		const fonts = byWeight.get(file.weight) ?? [];

		fonts.push(font);
		byWeight.set(file.weight, fonts);
	}

	const first = [...byWeight.values()][0]?.[0];

	if (!first) return null;
	const weights = [...byWeight.keys()];
	const cache = new Map<string, GlyphOutline | null>();

	const nearest = (weight: number) =>
		weights.reduce((best, candidate) => (Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best));

	const read = (codepoint: number, weight: number): GlyphOutline | null => {
		for (const font of byWeight.get(weight) ?? []) {
			const glyph = font.glyphOf(codepoint);

			if (glyph === null) continue;
			const contours = font.contoursOf(glyph);

			if (!contours) return null;

			return {
				commands: contours.length ? glyphCommands(contours, font.unitsPerEm) : null,
				advance: font.advanceOf(glyph) / font.unitsPerEm,
			};
		}

		return null;
	};

	return {
		ascent: first.ascender / first.unitsPerEm,
		descent: -first.descender / first.unitsPerEm,
		outline: (codepoint, weight) => {
			const key = `${nearest(weight)}:${codepoint}`;

			if (!cache.has(key)) cache.set(key, read(codepoint, nearest(weight)));

			return cache.get(key) ?? null;
		},
	};
}
