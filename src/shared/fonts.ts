// Decision 0047. A font file's name says its family, weight and style: `public/fonts/brand-sans-700-italic.woff2`.

import { assetKey } from "./assets";

export const FONTS_PREFIX = "/fonts/";

const FORMATS = new Map([
	["woff2", "woff2"],
	["woff", "woff"],
	["ttf", "truetype"],
	["otf", "opentype"],
]);

export type FontStyle = "normal" | "italic";

export type FontFaceFile = {
	src: string;
	slug: string;
	family: string;
	weight: number;
	style: FontStyle;
};

export type FontFamily = { slug: string; family: string; faces: FontFaceFile[] };

const FACE_NAME = /^\/fonts\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*?)(?:-([1-9]00))?(?:-(italic))?\.(woff2|woff|ttf|otf)$/;

const titleCase = (slug: string) =>
	slug
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

export function fontFace(src: string): FontFaceFile | null {
	const key = assetKey(src);
	const match = key ? FACE_NAME.exec(key) : null;

	if (!key || !match) return null;
	const slug = match[1]!;

	return {
		src: key,
		slug,
		family: titleCase(slug),
		weight: Number(match[2] ?? 400),
		style: match[3] ? "italic" : "normal",
	};
}

export const isFontSrc = (src: string) => fontFace(src) !== null;

const WEIGHT_WORDS: [RegExp, number][] = [
	[/^(?:thin|hairline)$/, 100],
	[/^(?:extra|ultra)light$/, 200],
	[/^light$/, 300],
	[/^(?:regular|normal|book|roman)$/, 400],
	[/^medium$/, 500],
	[/^(?:semi|demi)bold$/, 600],
	[/^bold$/, 700],
	[/^(?:extra|ultra)bold$/, 800],
	[/^(?:black|heavy)$/, 900],
];

const STYLE_WORDS = /^(?:italic|oblique)$/;

const JOINED = /(?<![a-z])(extra|ultra|semi|demi)[\s_-]+(light|bold)(?![a-z])/gi;

export function fontFileName(name: string): string | null {
	const dot = name.lastIndexOf(".");
	const extension = name.slice(dot + 1).toLowerCase();

	if (dot < 0 || !FORMATS.has(extension)) return null;

	const words = name
		.slice(0, dot)
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(JOINED, "$1$2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

	let weight = 400;
	let italic = false;
	const family: string[] = [];

	for (const word of words) {
		const named = WEIGHT_WORDS.find(([pattern]) => pattern.test(word))?.[1];
		const numbered = /^[1-9]00$/.test(word) ? Number(word) : undefined;

		if (STYLE_WORDS.test(word)) italic = true;
		else if (named !== undefined || numbered !== undefined) weight = named ?? numbered ?? weight;
		else family.push(word);
	}

	const slug = family.join("-").replace(/^[0-9-]+/, "") || "font";

	return `${slug}${weight === 400 ? "" : `-${weight}`}${italic ? "-italic" : ""}.${extension}`;
}

export function fontFamilies(srcs: Iterable<string>): FontFamily[] {
	const families = new Map<string, FontFamily>();

	for (const src of srcs) {
		const face = fontFace(src);

		if (!face) continue;
		const family = families.get(face.slug) ?? { slug: face.slug, family: face.family, faces: [] };
		family.faces.push(face);
		families.set(face.slug, family);
	}

	const sorted = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));

	for (const family of sorted)
		family.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style) || a.src.localeCompare(b.src));

	return sorted;
}

const WEIGHT_NAMES = new Map([
	[100, "Thin"],
	[200, "Extra Light"],
	[300, "Light"],
	[400, "Regular"],
	[500, "Medium"],
	[600, "Semibold"],
	[700, "Bold"],
	[800, "Extra Bold"],
	[900, "Black"],
]);

export function faceLabel(face: FontFaceFile): string {
	const weight = WEIGHT_NAMES.get(face.weight) ?? String(face.weight);

	if (face.style === "normal") return weight;

	return face.weight === 400 ? "Italic" : `${weight} Italic`;
}

export function fontFaceCss(srcs: Iterable<string>, url: (src: string) => string = (src) => src): string {
	return fontFamilies(srcs)
		.flatMap((family) =>
			family.faces.map((face) => {
				const extension = face.src.slice(face.src.lastIndexOf(".") + 1);

				return `@font-face {\n\tfont-family: "${face.family}";\n\tsrc: url("${url(face.src)}") format("${FORMATS.get(extension)}");\n\tfont-weight: ${face.weight};\n\tfont-style: ${face.style};\n\tfont-display: swap;\n}`;
			}),
		)
		.join("\n");
}

export const fontToken = (family: FontFamily) => ({
	name: `font-${family.slug}`,
	value: `"${family.family}", ui-sans-serif, sans-serif`,
});

export const leadingFamily = (stack: string) =>
	(stack.split(",")[0] ?? "")
		.trim()
		.replace(/^["']|["']$/g, "")
		.toLowerCase();
