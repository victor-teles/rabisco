import { deflateSync } from "fflate";
import { MAX_FIGMA_BYTES } from "../../import/figma/clipboard";
import { base64, encodeMessage, encodeSchema, figKiwi } from "./kiwi-writer";
import { EXPORT_SCHEMA, FIG_KIWI_VERSION } from "./schema";
import { screensToFigma, type FigmaScreen } from "./to-figma";

export type FigmaClipboardCopy = {
	html: string;
	copied: number;
	fixed: number;
};

const SESSION = 1;

let schema: Uint8Array | null = null;

function encode(screens: FigmaScreen[], pasteID: number) {
	const copy = screensToFigma(screens);

	const message = encodeMessage(EXPORT_SCHEMA, "Message", {
		type: "NODE_CHANGES",
		sessionID: SESSION,
		nodeChanges: copy.nodeChanges,
		blobs: copy.blobs.map((bytes) => ({ bytes })),
		pasteID,
		pasteFileKey: "rabisco",
		isCut: false,
	});

	return { message, fixed: copy.fixed };
}

export function figmaClipboard(
	screens: FigmaScreen[],
	pasteID = Math.floor(Math.random() * 2 ** 31),
): FigmaClipboardCopy {
	schema ??= deflateSync(encodeSchema(EXPORT_SCHEMA));
	let count = screens.length;
	let encoded = encode(screens, pasteID);

	while (count > 1 && encoded.message.length > MAX_FIGMA_BYTES) {
		count--;
		encoded = encode(screens.slice(0, count), pasteID);
	}

	if (encoded.message.length > MAX_FIGMA_BYTES) throw new Error("This screen is too large to copy to Figma");
	const buffer = figKiwi(schema, deflateSync(encoded.message), FIG_KIWI_VERSION);
	const meta = base64(new TextEncoder().encode(JSON.stringify({ fileKey: "rabisco", pasteID, dataType: "scene" })));

	const html = [
		'<meta charset="utf-8"><span data-metadata="<!--(figmeta)',
		meta,
		'(/figmeta)-->"></span><span data-buffer="<!--(figma)',
		base64(buffer),
		'(/figma)-->"></span><span style="white-space:pre-wrap;"></span>',
	].join("");

	return { html, copied: count, fixed: encoded.fixed };
}
