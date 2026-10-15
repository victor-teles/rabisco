// One screen as a static page: the markup the frame rendered and a stylesheet with just its classes.

import { assetKey, type ProjectAssets } from "../assets";
import { isModeSlug, SCHEME, type ResolvedMode } from "../modes";
import type { ExportFile } from "../types";

export type HtmlScreenInput = {
	title: string;
	/** `#root`'s inner HTML, with project images at their `/images/a.png` paths */
	markup: string;
	css: string;
	assets?: ProjectAssets;
	/** The frame set it on its own `<html>`, which `markup` leaves out */
	mode?: ResolvedMode;
};

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** After a quote, `(`, a space or a comma: where `src`, `srcset` and `url()` values start */
const atValueStart = (key: string) => new RegExp(`(["'(\\s,]|&quot;)${escapeRegExp(key)}(?=[\\s"'),?#&]|$)`, "g");

/** `/images/a.png` becomes `images/a.png`, so the page also works opened from disk */
function relativeImages(text: string, keys: string[]) {
	return keys.reduce((out, key) => out.replace(atValueStart(key), `$1${key.slice(1)}`), text);
}

export function modeAttributes(mode: ResolvedMode | undefined) {
	const attributes = mode?.[SCHEME] === "dark" ? [' class="dark"'] : [];

	for (const [group, option] of Object.entries(mode ?? {})) {
		if (group !== SCHEME && isModeSlug(group) && isModeSlug(option)) attributes.push(` data-mode-${group}="${option}"`);
	}

	return attributes.join("");
}

const page = (title: string, markup: string, mode: ResolvedMode | undefined) => `<!doctype html>
<html lang="en"${modeAttributes(mode)}>
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${escapeHtml(title)}</title>
		<link rel="stylesheet" href="styles.css" />
		<style>html,body,#root{height:100%;margin:0}</style>
	</head>
	<body>
		<div id="root">${markup}</div>
	</body>
</html>
`;

export function htmlScreen(input: HtmlScreenInput): ExportFile[] {
	const images = new Map<string, string>();

	for (const [src, content] of Object.entries(input.assets ?? {})) {
		const key = assetKey(src);

		if (key && (atValueStart(key).test(input.markup) || atValueStart(key).test(input.css))) images.set(key, content);
	}

	const keys = [...images.keys()].sort();

	return [
		{ path: "index.html", content: page(input.title, relativeImages(input.markup, keys), input.mode) },
		{ path: "styles.css", content: relativeImages(input.css, keys) },
		...keys.map((key): ExportFile => ({ path: key.slice(1), content: images.get(key)!, encoding: "base64" })),
	];
}
