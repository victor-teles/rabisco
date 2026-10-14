const MAX_COLORS = 256;

const MAX_CODE = 4096;

const EPOCH_LIMIT = 1 << 18;

const BIN_BITS = 5;

const BINS = 1 << (BIN_BITS * 3);

class ByteWriter {
	#bytes = new Uint8Array(1 << 16);
	#length = 0;

	#reserve(extra: number) {
		if (this.#length + extra <= this.#bytes.length) return;
		const grown = new Uint8Array(Math.max(this.#bytes.length * 2, this.#length + extra));
		grown.set(this.#bytes.subarray(0, this.#length));
		this.#bytes = grown;
	}

	byte(value: number) {
		this.#reserve(1);
		this.#bytes[this.#length++] = value & 0xff;
	}

	short(value: number) {
		this.byte(value);
		this.byte(value >> 8);
	}

	ascii(text: string) {
		for (const char of text) this.byte(char.charCodeAt(0));
	}

	write(bytes: Uint8Array) {
		this.#reserve(bytes.length);
		this.#bytes.set(bytes, this.#length);
		this.#length += bytes.length;
	}

	result() {
		return this.#bytes.slice(0, this.#length);
	}
}

export type Palette = { colors: Uint8Array; indexes: Uint8Array };

const binOf = (r: number, g: number, b: number) =>
	((r >> (8 - BIN_BITS)) << (BIN_BITS * 2)) | ((g >> (8 - BIN_BITS)) << BIN_BITS) | (b >> (8 - BIN_BITS));

function exactPalette(pixels: Uint8ClampedArray) {
	const index = new Map<number, number>();
	const indexes = new Uint8Array(pixels.length / 4);

	for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
		const rgb = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
		let found = index.get(rgb);

		if (found === undefined) {
			if (index.size === MAX_COLORS) return null;
			found = index.size;
			index.set(rgb, found);
		}

		indexes[p] = found;
	}

	const colors = new Uint8Array(index.size * 3);

	for (const [rgb, at] of index) {
		colors[at * 3] = rgb >> 16;
		colors[at * 3 + 1] = (rgb >> 8) & 0xff;
		colors[at * 3 + 2] = rgb & 0xff;
	}

	return { colors, indexes };
}

type Box = { bins: number[]; count: number; spread: number; channel: number };

function boxOf(bins: number[], counts: Uint32Array, sums: Float64Array): Box {
	const low = [255, 255, 255];
	const high = [0, 0, 0];
	let count = 0;

	for (const bin of bins) {
		count += counts[bin]!;

		for (let c = 0; c < 3; c++) {
			const mean = sums[bin * 3 + c]! / counts[bin]!;
			low[c] = Math.min(low[c]!, mean);
			high[c] = Math.max(high[c]!, mean);
		}
	}

	const spans = [0, 1, 2].map((c) => high[c]! - low[c]!);
	const channel = spans.indexOf(Math.max(...spans));

	return { bins, count, spread: bins.length > 1 ? spans[channel]! * Math.sqrt(count) : 0, channel };
}

function split(box: Box, counts: Uint32Array, sums: Float64Array): [Box, Box] {
	const mean = (bin: number) => sums[bin * 3 + box.channel]! / counts[bin]!;
	const sorted = [...box.bins].sort((a, b) => mean(a) - mean(b));
	let seen = 0;
	let cut = 1;

	for (; cut < sorted.length - 1; cut++) {
		seen += counts[sorted[cut - 1]!]!;

		if (seen * 2 >= box.count) break;
	}

	return [boxOf(sorted.slice(0, cut), counts, sums), boxOf(sorted.slice(cut), counts, sums)];
}

function medianCutPalette(pixels: Uint8ClampedArray): Palette {
	const counts = new Uint32Array(BINS);
	const sums = new Float64Array(BINS * 3);
	const binned = new Uint16Array(pixels.length / 4);

	for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
		const bin = binOf(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
		binned[p] = bin;
		counts[bin]!++;
		sums[bin * 3] += pixels[i]!;
		sums[bin * 3 + 1] += pixels[i + 1]!;
		sums[bin * 3 + 2] += pixels[i + 2]!;
	}

	const used: number[] = [];

	for (let bin = 0; bin < BINS; bin++) if (counts[bin]) used.push(bin);
	const boxes = [boxOf(used, counts, sums)];

	while (boxes.length < MAX_COLORS) {
		let widest = 0;

		for (let i = 1; i < boxes.length; i++) if (boxes[i]!.spread > boxes[widest]!.spread) widest = i;

		if (!boxes[widest]!.spread) break;
		boxes.splice(widest, 1, ...split(boxes[widest]!, counts, sums));
	}

	const colors = new Uint8Array(boxes.length * 3);
	const paletteOf = new Uint8Array(BINS);

	boxes.forEach((box, at) => {
		const total = [0, 0, 0];

		for (const bin of box.bins) {
			for (let c = 0; c < 3; c++) total[c]! += sums[bin * 3 + c]!;
			paletteOf[bin] = at;
		}

		for (let c = 0; c < 3; c++) colors[at * 3 + c] = Math.round(total[c]! / box.count);
	});

	const indexes = new Uint8Array(binned.length);

	for (let p = 0; p < binned.length; p++) indexes[p] = paletteOf[binned[p]!]!;

	return { colors, indexes };
}

export const quantize = (pixels: Uint8ClampedArray): Palette => exactPalette(pixels) ?? medianCutPalette(pixels);

const tableBits = (colors: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, colors))));

class CodeWriter {
	#out: ByteWriter;
	#block = new Uint8Array(255);
	#used = 0;
	#bits = 0;
	#pending = 0;

	constructor(out: ByteWriter) {
		this.#out = out;
	}

	#push(byte: number) {
		this.#block[this.#used++] = byte;

		if (this.#used === 255) this.#flushBlock();
	}

	#flushBlock() {
		if (!this.#used) return;
		this.#out.byte(this.#used);
		this.#out.write(this.#block.subarray(0, this.#used));
		this.#used = 0;
	}

	code(value: number, size: number) {
		this.#pending |= value << this.#bits;
		this.#bits += size;

		while (this.#bits >= 8) {
			this.#push(this.#pending & 0xff);
			this.#pending >>>= 8;
			this.#bits -= 8;
		}
	}

	end() {
		if (this.#bits > 0) this.#push(this.#pending & 0xff);
		this.#flushBlock();
		this.#out.byte(0);
	}
}

function lzwEncode(out: ByteWriter, indexes: Uint8Array, minCodeSize: number, table: Int32Array, epoch: number) {
	const clear = 1 << minCodeSize;
	const eoi = clear + 1;
	const codes = new CodeWriter(out);
	let size = minCodeSize + 1;
	let next = eoi + 1;
	let generation = epoch;

	out.byte(minCodeSize);
	codes.code(clear, size);
	let prefix = indexes[0] ?? 0;

	for (let i = 1; i < indexes.length; i++) {
		const k = indexes[i]!;
		const key = (prefix << 8) | k;
		const stored = table[key]!;

		if (stored >>> 12 === generation) {
			prefix = stored & 0xfff;

			continue;
		}

		codes.code(prefix, size);

		if (next === MAX_CODE) {
			codes.code(clear, size);
			size = minCodeSize + 1;
			next = eoi + 1;
			generation++;
		} else {
			if (next >= 1 << size) size++;
			table[key] = (generation << 12) | next++;
		}

		prefix = k;
	}

	codes.code(prefix, size);
	codes.code(eoi, size);
	codes.end();

	return generation + 1;
}

export class GifWriter {
	readonly width: number;
	readonly height: number;
	#out = new ByteWriter();
	#table = new Int32Array(MAX_CODE << 8);
	#epoch = 1;

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.#out.ascii("GIF89a");
		this.#out.short(width);
		this.#out.short(height);
		this.#out.byte(0);
		this.#out.byte(0);
		this.#out.byte(0);
		this.#out.write(Uint8Array.of(0x21, 0xff, 0x0b));
		this.#out.ascii("NETSCAPE2.0");
		this.#out.write(Uint8Array.of(0x03, 0x01, 0x00, 0x00, 0x00));
	}

	add(pixels: Uint8ClampedArray, delay: number) {
		if (pixels.length !== this.width * this.height * 4) throw new Error("The frame doesn't match the GIF's size");
		const { colors, indexes } = quantize(pixels);
		const bits = tableBits(colors.length / 3);
		const out = this.#out;

		out.write(Uint8Array.of(0x21, 0xf9, 0x04, 0x04));
		out.short(Math.max(2, Math.round(delay / 10)));
		out.write(Uint8Array.of(0x00, 0x00));
		out.byte(0x2c);
		out.short(0);
		out.short(0);
		out.short(this.width);
		out.short(this.height);
		out.byte(0x80 | (bits - 1));
		const table = new Uint8Array(3 << bits);
		table.set(colors);
		out.write(table);

		if (this.#epoch > EPOCH_LIMIT) {
			this.#table.fill(0);
			this.#epoch = 1;
		}

		this.#epoch = lzwEncode(out, indexes, Math.max(2, bits), this.#table, this.#epoch);
	}

	finish() {
		this.#out.byte(0x3b);

		return this.#out.result();
	}
}
