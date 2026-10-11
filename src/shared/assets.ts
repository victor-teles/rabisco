// Decision 0010. Project images live in `public/`, which Vite serves at `/`, so screens write `/images/logo.png`.

/** Base64 bytes by the URL a screen writes (`/images/logo.png` for `public/images/logo.png`) */
export type ProjectAssets = Record<string, string>;

/** `data: null` means the file is gone */
export type AssetChange = { src: string; data: string | null };

export const PUBLIC_DIR = "public";

const ASSET_TYPES = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
	["svg", "image/svg+xml"],
	["avif", "image/avif"],
	["ico", "image/x-icon"],
]);

/** `null` when Rabisco doesn't load files of this kind into frames */
export function assetType(src: string): string | null {
	const extension = /\.([a-z0-9]+)$/i.exec(src)?.[1]?.toLowerCase() ?? "";

	return ASSET_TYPES.get(extension) ?? null;
}

/**
 * The asset a `src` or CSS `url()` points to: `/images/a.png`, `./images/a.png?v=2` and `images/a.png` all give
 * `/images/a.png`. `null` for other origins, `data:` and `blob:` URLs, and paths that leave the root.
 */
export function assetKey(value: string): string | null {
	const path = value.trim().split(/[?#]/, 1)[0] ?? "";

	if (!path || path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
	const key = `/${path.replace(/^(\.\/|\/)+/, "")}`;

	if (key.split("/").some((segment) => segment === ".." || segment === ".")) return null;

	return assetType(key) ? key : null;
}

const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/** Rewrites `url(/images/a.png)` to what `resolve` gives for it; unknown URLs stay as written. */
export function rewriteCssUrls(css: string, resolve: (key: string) => string | undefined): string {
	if (!css.includes("url(")) return css;

	return css.replace(CSS_URL, (match, _quote: string, url: string) => {
		const key = assetKey(url);
		const resolved = key ? resolve(key) : undefined;

		return resolved ? `url("${resolved}")` : match;
	});
}

const SRCSET_SEPARATOR = /[\s,]*/y;

const SRCSET_URL = /\S*?(?=,*(?:\s|$))/y;

const SRCSET_DESCRIPTORS = /[^,]*/y;

export function rewriteSrcset(srcset: string, resolve: (key: string) => string | undefined): string {
	let rewritten = "";
	let at = 0;

	const take = (pattern: RegExp) => {
		pattern.lastIndex = at;
		const taken = pattern.exec(srcset)?.[0] ?? "";
		at += taken.length;

		return taken;
	};

	while (at < srcset.length) {
		rewritten += take(SRCSET_SEPARATOR);

		if (at >= srcset.length) break;
		const url = take(SRCSET_URL);
		const key = assetKey(url);
		rewritten += (key ? resolve(key) : undefined) ?? url;

		if (!srcset.startsWith(",", at)) rewritten += take(SRCSET_DESCRIPTORS);
	}

	return rewritten;
}
