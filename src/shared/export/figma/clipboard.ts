import { decompressSync, deflateSync } from "fflate";
import { MAX_FIGMA_BYTES } from "../../import/figma/clipboard";
import { decodeSchema, type KiwiSchema } from "../../import/figma/kiwi";
import { FIG_KIWI_VERSION, FIGMA_SCHEMA_CHUNK } from "./figma-schema";
import type { FontSet } from "./font";
import { base64, encodeKiwiMessage, figKiwi } from "./kiwi-writer";
import { screensToFigma, type FigmaScreen } from "./to-figma";

export type FigmaClipboardCopy = {
	html: string;
	copied: number;
	fixed: number;
	skipped: number;
};

const FILE_KEY = "rabisco";

const PAGE = { sessionID: 0, localID: 1 };

const SCHEMA_CHUNK = Uint8Array.from(atob(FIGMA_SCHEMA_CHUNK), (char) => char.charCodeAt(0));

let schema: KiwiSchema | null = null;

function encode(screens: FigmaScreen[], fonts: FontSet | null, pasteID: number) {
	const copy = screensToFigma(screens, fonts);

	schema ??= decodeSchema(decompressSync(SCHEMA_CHUNK));

	const message = encodeKiwiMessage(schema, "Message", {
		type: "NODE_CHANGES",
		sessionID: 0,
		ackID: 0,
		nodeChanges: copy.nodeChanges,
		blobs: copy.blobs.map((bytes) => ({ bytes })),
		pasteID,
		pasteFileKey: FILE_KEY,
		pasteIsPartiallyOutsideEnclosingFrame: false,
		pastePageId: PAGE,
		isCut: false,
		pasteEditorType: "DESIGN",
		publishedAssetGuids: [],
		clipboardSelectionRegions: [
			{ parent: PAGE, nodes: copy.roots, pasteIsPartiallyOutsideEnclosingFrame: false, focusType: "NONE" },
		],
		pasteAssetType: "UNKNOWN",
		nodeChangeOrder: "GUID",
	});

	return { message, fixed: copy.fixed, skipped: copy.skipped };
}

export function figmaClipboard(
	screens: FigmaScreen[],
	fonts: FontSet | null = null,
	pasteID = Math.floor(Math.random() * 2 ** 31),
): FigmaClipboardCopy {
	let count = screens.length;
	let encoded = encode(screens, fonts, pasteID);

	while (count > 1 && encoded.message.length > MAX_FIGMA_BYTES) {
		count--;
		encoded = encode(screens.slice(0, count), fonts, pasteID);
	}

	if (encoded.message.length > MAX_FIGMA_BYTES) throw new Error("This screen is too large to copy to Figma");
	const buffer = figKiwi(SCHEMA_CHUNK, deflateSync(encoded.message), FIG_KIWI_VERSION);

	const meta = base64(
		new TextEncoder().encode(JSON.stringify({ fileKey: FILE_KEY, pasteID, dataType: "scene", editorType: "design" })),
	);

	const html = [
		'<meta charset="utf-8"><span data-metadata="<!--(figmeta)',
		meta,
		'(/figmeta)-->"></span><span data-buffer="<!--(figma)',
		base64(buffer),
		'(/figma)-->"></span><span style="white-space:pre-wrap;"></span>',
	].join("");

	return { html, copied: count, fixed: encoded.fixed, skipped: encoded.skipped };
}
