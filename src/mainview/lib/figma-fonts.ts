/// <reference types="vite/client" />
import latinExt400 from "@fontsource/inter/files/inter-latin-ext-400-normal.woff?url";
import latinExt500 from "@fontsource/inter/files/inter-latin-ext-500-normal.woff?url";
import latinExt600 from "@fontsource/inter/files/inter-latin-ext-600-normal.woff?url";
import latinExt700 from "@fontsource/inter/files/inter-latin-ext-700-normal.woff?url";
import latin400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import latin500 from "@fontsource/inter/files/inter-latin-500-normal.woff?url";
import latin600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import latin700 from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import type { FontFile } from "../../shared/export/figma/font";
import symbols400 from "./fonts/inter-symbols-400-normal.woff?url";
import symbols500 from "./fonts/inter-symbols-500-normal.woff?url";
import symbols600 from "./fonts/inter-symbols-600-normal.woff?url";
import symbols700 from "./fonts/inter-symbols-700-normal.woff?url";

const LATIN =
	"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

const LATIN_EXT =
	"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const SYMBOLS = "U+2190-21FF, U+2200-22FF, U+2300-23FF, U+25A0-25FF, U+2600-26FF, U+2700-27BF";

const FILES = [
	{ weight: 400, unicodeRange: LATIN, url: latin400 },
	{ weight: 500, unicodeRange: LATIN, url: latin500 },
	{ weight: 600, unicodeRange: LATIN, url: latin600 },
	{ weight: 700, unicodeRange: LATIN, url: latin700 },
	{ weight: 400, unicodeRange: LATIN_EXT, url: latinExt400 },
	{ weight: 500, unicodeRange: LATIN_EXT, url: latinExt500 },
	{ weight: 600, unicodeRange: LATIN_EXT, url: latinExt600 },
	{ weight: 700, unicodeRange: LATIN_EXT, url: latinExt700 },
	{ weight: 400, unicodeRange: SYMBOLS, url: symbols400 },
	{ weight: 500, unicodeRange: SYMBOLS, url: symbols500 },
	{ weight: 600, unicodeRange: SYMBOLS, url: symbols600 },
	{ weight: 700, unicodeRange: SYMBOLS, url: symbols700 },
];

let loading: Promise<FontFile[]> | null = null;

async function load(): Promise<FontFile[]> {
	return Promise.all(
		FILES.map(async ({ weight, unicodeRange, url }) => {
			const response = await fetch(url);

			if (!response.ok) throw new Error("Couldn't load the fonts for Figma");

			return { weight, unicodeRange, bytes: new Uint8Array(await response.arrayBuffer()) };
		}),
	);
}

export function figmaFonts(): Promise<FontFile[]> {
	loading ??= load().catch((error) => {
		loading = null;
		throw error;
	});

	return loading;
}
