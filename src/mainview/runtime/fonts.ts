import { isString } from "../../shared/guards";
import { SHIPPED_FONT_FAMILY, type FrameFont } from "../lib/render/protocol";

let added = false;

/** Faces load only when text needs them, one weight and range at a time; added once, before any project font. */
export function addShippedFonts(fonts: readonly FrameFont[]) {
	if (added) return;
	added = true;

	for (const font of fonts) {
		const url = isString(font.file) ? font.file : URL.createObjectURL(font.file);

		document.fonts.add(
			new FontFace(SHIPPED_FONT_FAMILY, `url("${url}")`, {
				weight: String(font.weight),
				unicodeRange: font.unicodeRange,
				display: "swap",
			}),
		);
	}
}
