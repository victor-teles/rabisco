// Decision 0047. A `<Placeholder>` becomes an `<img>` of a generated image, written like a picked one.

import type { ImageAspect, ImageRequest } from "./ai/contract";
import { readImports, removeUnusedImports } from "./jsx/imports";
import { flatten, parseFile, type JsxAttribute, type JsxElement } from "./jsx/tree";
import type { ProjectFiles } from "./types";

export const PLACEHOLDER_MODULE = "@/components/ui/placeholder";

const PLACEHOLDER_PROPS = new Set(["kind", "subject", "seed", "pin", "label"]);

const KIND_SIZES = new Map([
	["photo", "aspect-[4/3] w-full"],
	["illustration", "aspect-[4/3] w-full"],
	["map", "aspect-[4/3] w-full"],
	["avatar", "size-10 shrink-0 rounded-full"],
]);

export type PlaceholderUse = {
	path: string;
	start: number;
	kind: string;
	subject: string | null;
	seed: string | null;
	label: string | null;
	className: string | null;
};

const stringValue = (attribute: JsxAttribute | undefined) =>
	attribute?.kind === "attribute" && attribute.value?.kind === "string" ? attribute.value.value : null;

const attributeNamed = (element: JsxElement, name: string) =>
	element.attributes.find((attribute) => attribute.kind === "attribute" && attribute.name === name);

function placeholderNames(source: string): Set<string> {
	const names = new Set<string>();

	for (const decl of readImports(source))
		if (decl.module === PLACEHOLDER_MODULE)
			for (const specifier of decl.named) if (specifier.imported === "Placeholder") names.add(specifier.local);

	return names;
}

const canGenerate = (kind: string) => KIND_SIZES.has(kind);

export function findPlaceholders(path: string, source: string): PlaceholderUse[] {
	const names = placeholderNames(source);

	if (!names.size) return [];
	const parsed = parseFile(source);
	const uses: PlaceholderUse[] = [];

	for (const element of flatten(parsed)) {
		if (!element.name || !names.has(element.name)) continue;
		const kind = stringValue(attributeNamed(element, "kind")) ?? "photo";

		if (!canGenerate(kind)) continue;

		uses.push({
			path,
			start: element.start,
			kind,
			subject: stringValue(attributeNamed(element, "subject")),
			seed: stringValue(attributeNamed(element, "seed")),
			label: stringValue(attributeNamed(element, "label")),
			className: stringValue(attributeNamed(element, "className")),
		});
	}

	return uses;
}

export function placeholderAspect(use: PlaceholderUse): ImageAspect {
	const classes = use.className ?? KIND_SIZES.get(use.kind) ?? "";

	if (use.kind === "avatar" || /\b(?:aspect-square|aspect-\[1\/1\]|size-\d)/.test(classes)) return "square";

	const ratio = /\baspect-\[(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]/.exec(classes);

	if (ratio) {
		const value = Number(ratio[1]) / Number(ratio[2]);

		return value > 1.1 ? "landscape" : value < 0.9 ? "portrait" : "square";
	}

	return /\baspect-video\b/.test(classes) || !/\baspect-/.test(classes) ? "landscape" : "square";
}

const subjectOf = (use: PlaceholderUse) => [use.subject, use.seed].filter(Boolean).join(", ");

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function placeholderDescription(use: PlaceholderUse): string {
	if (use.label) return use.label;
	const subject = subjectOf(use);

	if (use.kind === "avatar") return subject ? `Portrait of a person, ${subject}` : "Portrait of a person";

	if (use.kind === "map") return subject ? `Map of ${subject}` : "Street map";

	if (!use.subject) return use.seed ? `${capitalize(use.kind)}: ${use.seed}` : `Abstract ${use.kind}`;

	return `${capitalize(use.subject)} ${use.kind}${use.seed ? `: ${use.seed}` : ""}`;
}

const STYLES = new Map([
	["photo", "A realistic, natural-light photograph"],
	["avatar", "A realistic head-and-shoulders portrait photograph on a plain background"],
	["illustration", "A clean, modern flat illustration"],
	["map", "A clean, minimal city street map seen from above, with no labels"],
]);

export type ImageContext = { screen: string; product?: string };

export function placeholderImageRequest(use: PlaceholderUse, context: ImageContext, extra = ""): ImageRequest {
	const product = context.product
		?.trim()
		.split("\n")
		.find((line) => line.trim() && !line.startsWith("#"));

	const prompt = [
		`${STYLES.get(use.kind) ?? STYLES.get("photo")}. Subject: ${use.label ?? (subjectOf(use) || use.kind)}.`,
		`For the "${context.screen}" screen of an app${product ? `: ${product.trim().slice(0, 200)}` : ""}.`,
		extra.trim(),
		"No text, no watermark, no borders.",
	]
		.filter(Boolean)
		.join("\n");

	return { prompt, aspect: placeholderAspect(use) };
}

const utilityOf = (name: string) => name.replace(/-[^-]*$/, "");

function withSize(size: string, classes: string) {
	const used = new Set(classes.split(/\s+/).map(utilityOf));
	const kept = size.split(" ").filter((name) => !used.has(utilityOf(name)));

	return [...kept, classes.trim()].join(" ").trim();
}

const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function imageName(use: PlaceholderUse): string {
	return [use.subject ?? use.kind, use.seed].filter(Boolean).join(" ") || "image";
}

export function replacePlaceholder(source: string, start: number, src: string, alt: string): string | null {
	const element = flatten(parseFile(source)).find((candidate) => candidate.start === start);
	const names = placeholderNames(source);

	if (!element?.name || !names.has(element.name)) return null;
	const kind = stringValue(attributeNamed(element, "kind")) ?? "photo";
	const size = KIND_SIZES.get(kind) ?? "";
	const attributes = [`src="${escapeAttribute(src)}"`, `alt="${escapeAttribute(alt)}"`];
	let className: string | null = `${size} object-cover`;

	for (const attribute of element.attributes) {
		if (attribute.kind === "attribute" && PLACEHOLDER_PROPS.has(attribute.name)) continue;

		if (attribute.kind === "attribute" && attribute.name === "className") {
			className = attribute.value?.kind === "string" ? `${withSize(size, attribute.value.value)} object-cover` : null;

			if (className === null) attributes.push(source.slice(attribute.start, attribute.end));
			continue;
		}

		attributes.push(source.slice(attribute.start, attribute.end));
	}

	if (className !== null) attributes.splice(2, 0, `className="${className.trim()}"`);
	const replaced = `${source.slice(0, element.start)}<img ${attributes.join(" ")} />${source.slice(element.end)}`;

	return removeUnusedImports(replaced, [...names]);
}

export type PlaceholderImage = { use: PlaceholderUse; src: string };

const sameUse = (a: PlaceholderUse, b: PlaceholderUse) =>
	a.kind === b.kind && a.subject === b.subject && a.seed === b.seed && a.label === b.label;

export type PlaceholderReplacement = { files: ProjectFiles; replaced: number };

export function replacePlaceholders(files: ProjectFiles, images: PlaceholderImage[]): PlaceholderReplacement {
	const next: ProjectFiles = { ...files };
	let replaced = 0;

	for (const path of new Set(images.map((image) => image.use.path))) {
		let source = next[path];

		if (source === undefined) continue;
		const current = findPlaceholders(path, source);

		const placed = images
			.filter((image) => image.use.path === path)
			.flatMap((image) => {
				const match =
					current.find((use) => use.start === image.use.start && sameUse(use, image.use)) ??
					current.find((use) => sameUse(use, image.use));

				if (!match) return [];
				current.splice(current.indexOf(match), 1);

				return [{ ...image, use: match }];
			})
			.sort((a, b) => b.use.start - a.use.start);

		for (const image of placed) {
			const updated = replacePlaceholder(source, image.use.start, image.src, placeholderDescription(image.use));

			if (updated === null) continue;
			source = updated;
			replaced++;
		}

		next[path] = source;
	}

	return { files: next, replaced };
}
