import { decompressSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import { isJsonObject, type Json, type JsonObject } from "../../json";
import { decodeMessage, decodeSchema, type KiwiRecord } from "./kiwi";

const META = /\(figmeta\)([A-Za-z0-9+/=\s]*)\(\/figmeta\)/;

const BUFFER = /\(figma\)([A-Za-z0-9+/=\s]*)\(\/figma\)/;

const PRELUDE = "fig-kiwi";

export const MIN_FIG_KIWI_VERSION = 15;

export const MAX_FIG_KIWI_VERSION = 200;

export const MAX_FIGMA_BYTES = 40 * 1024 * 1024;

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export const UNREADABLE_FIGMA = "This Figma copy uses a format Rabisco can't read yet";

export class FigmaFormatError extends Error {}

export type FigmaClipboard = { meta: JsonObject; version: number; message: KiwiRecord };

export const hasFigmaData = (html: string) => BUFFER.test(html);

function base64Bytes(text: string) {
	const binary = atob(text.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return bytes;
}

function parseMeta(html: string): JsonObject {
	const encoded = META.exec(html)?.[1];

	if (!encoded) return {};

	try {
		const parsed: Json = JSON.parse(new TextDecoder().decode(base64Bytes(encoded)));

		return isJsonObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function inflate(chunk: Uint8Array) {
	const zstd = ZSTD_MAGIC.every((byte, i) => chunk[i] === byte);
	const out = zstd ? zstdDecompress(chunk) : decompressSync(chunk);

	if (out.length > MAX_FIGMA_BYTES) throw new FigmaFormatError("This Figma copy is too large to import");

	return out;
}

export function readFigKiwi(bytes: Uint8Array) {
	const prelude = new TextDecoder().decode(bytes.subarray(0, PRELUDE.length));

	if (prelude !== PRELUDE || bytes.length < PRELUDE.length + 4) throw new FigmaFormatError(UNREADABLE_FIGMA);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint32(PRELUDE.length, true);

	if (version < MIN_FIG_KIWI_VERSION || version > MAX_FIG_KIWI_VERSION) throw new FigmaFormatError(UNREADABLE_FIGMA);
	const chunks: Uint8Array[] = [];
	let offset = PRELUDE.length + 4;

	while (offset + 4 <= bytes.length) {
		const size = view.getUint32(offset, true);

		offset += 4;

		if (offset + size > bytes.length) throw new FigmaFormatError(UNREADABLE_FIGMA);
		chunks.push(bytes.subarray(offset, offset + size));
		offset += size;
	}

	const [schema, data] = chunks;

	if (!schema || !data) throw new FigmaFormatError(UNREADABLE_FIGMA);

	return { version, schema, data };
}

export function readFigmaClipboard(html: string): FigmaClipboard {
	const encoded = BUFFER.exec(html)?.[1];

	if (!encoded) throw new FigmaFormatError("The clipboard has no Figma data");

	if (encoded.length > (MAX_FIGMA_BYTES * 4) / 3) throw new FigmaFormatError("This Figma copy is too large to import");

	try {
		const { version, schema, data } = readFigKiwi(base64Bytes(encoded));
		const message = decodeMessage(decodeSchema(inflate(schema)), inflate(data), "Message");

		return { meta: parseMeta(html), version, message };
	} catch (error) {
		if (error instanceof FigmaFormatError) throw error;

		throw new FigmaFormatError(UNREADABLE_FIGMA);
	}
}
