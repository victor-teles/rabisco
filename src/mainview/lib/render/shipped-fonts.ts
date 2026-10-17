import { encodeBase64 } from "./assets";
import type { ShareFont } from "../../../shared/share/snapshot";

export type ShippedFont = { weight: number; unicodeRange: string; file: Blob };

/** The Inter files the app ships (decision 0049), once loaded; every `FrameHost` posts them to its frame. */
export class ShippedFonts {
	#fonts: readonly ShippedFont[] | null = null;
	#listeners = new Set<() => void>();

	get fonts() {
		return this.#fonts;
	}

	set(fonts: readonly ShippedFont[] | null) {
		this.#fonts = fonts;

		for (const listener of this.#listeners) listener();
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);

		return () => void this.#listeners.delete(listener);
	}

	/** For the share viewer, which has no Blobs to post */
	async dataUrls(): Promise<ShareFont[]> {
		const fonts: ShareFont[] = [];

		for (const { weight, unicodeRange, file } of this.#fonts ?? [])
			fonts.push({ weight, unicodeRange, file: `data:font/woff;base64,${await encodeBase64(file)}` });

		return fonts;
	}
}

export const shippedFonts = new ShippedFonts();

/** A font stack that names Inter, not a family that only starts with it like "Inter Tight" */
export const usesShippedFont = (css: string) => /(?:font-family|--font-[\w-]+)\s*:[^;{}]*\bInter\b(?![ \w])/.test(css);
