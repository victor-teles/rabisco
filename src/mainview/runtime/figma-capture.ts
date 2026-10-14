import { CAPTURE_BODY } from "../../shared/import/capture-script";
import type { FrameImage } from "../lib/render/protocol";
import { frameAssets } from "./assets";
import { externals } from "./externals";
import { componentNameOf, type ComponentNaming, type FiberType } from "./inspect";
import { settle } from "./snapshot";

type CapturedJson = {
	tag: string;
	name?: string;
	attrs?: Record<string, string>;
	styles: Record<string, string>;
	children: CapturedJson[];
};

type Annotate = (element: Element, node: CapturedJson, computed: CSSStyleDeclaration) => void;

const FIGMA_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

const RASTER_SCALE = 2;

const MAX_RASTER_SIDE = 4096;

const URL_PATTERN = /url\(\s*(["']?)(.*?)\1\s*\)/g;

const PAINTED =
	"defs, linearGradient, radialGradient, pattern, filter, mask, clipPath, image, text, use, foreignObject";

const SVG_PAINT = [
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-width",
	"stroke-opacity",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"opacity",
	"stop-color",
	"stop-opacity",
	"color",
	"mix-blend-mode",
	"filter",
	"display",
	"visibility",
];

function inlinePaint(source: Element, copy: Element) {
	if (copy instanceof SVGElement) {
		const computed = getComputedStyle(source);

		for (const property of SVG_PAINT) copy.style.setProperty(property, computed.getPropertyValue(property));
	}

	for (let i = 0; i < source.children.length; i++) {
		const [from, to] = [source.children[i], copy.children[i]];

		if (from && to) inlinePaint(from, to);
	}
}

function svgUrl(svg: SVGSVGElement, computed: CSSStyleDeclaration) {
	const rect = svg.getBoundingClientRect();
	// SAFETY: cloning an <svg> gives an <svg>
	const clone = svg.cloneNode(true) as SVGSVGElement;

	inlinePaint(svg, clone);
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	clone.setAttribute("width", String(rect.width));
	clone.setAttribute("height", String(rect.height));
	clone.style.color = computed.color;

	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}

// SAFETY: CAPTURE_BODY is our own script from `capture-script.ts`, not screen code
const capture = new Function("annotate", CAPTURE_BODY) as (annotate: Annotate) => string;

async function bytesOf(url: string): Promise<Blob | null> {
	try {
		return frameAssets.blob(url) ?? (await (await fetch(url, { mode: "cors", credentials: "omit" })).blob());
	} catch {
		return null;
	}
}

async function rasterize(blob: Blob, box: { width: number; height: number }): Promise<Blob | null> {
	const url = URL.createObjectURL(blob);

	try {
		const image = new Image();

		image.src = url;
		await image.decode();
		const width = Math.min(MAX_RASTER_SIDE, Math.ceil((box.width || image.naturalWidth) * RASTER_SCALE));
		const height = Math.min(MAX_RASTER_SIDE, Math.ceil((box.height || image.naturalHeight) * RASTER_SCALE));

		if (!width || !height) return null;
		const canvas = document.createElement("canvas");

		canvas.width = width;
		canvas.height = height;
		canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);

		return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function load(url: string, box: { width: number; height: number }): Promise<FrameImage | null> {
	let blob = await bytesOf(url);

	if (blob && !FIGMA_TYPES.has(blob.type)) blob = await rasterize(blob, box);

	if (!blob) return null;

	try {
		const bitmap = await createImageBitmap(blob);
		const image = { bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height };

		bitmap.close();

		return image;
	} catch {
		return null;
	}
}

const kitNames = new WeakMap<FiberType, string>();

for (const [path, exported] of Object.entries(externals)) {
	if (!path.startsWith("@/components/ui/")) continue;

	for (const [name, value] of Object.entries(exported))
		if (/^[A-Z]/.test(name) && value instanceof Object) kitNames.set(value, name);
}

export async function captureForFigma(stop: ComponentNaming["stop"]) {
	const naming: ComponentNaming = { stop, known: (type) => (type instanceof Object ? kitNames.get(type) : undefined) };

	await settle();
	const keys = new Map<string, { key: string; box: { width: number; height: number } }>();

	const keyOf = (url: string, element: Element) => {
		const known = keys.get(url);

		if (known) return known.key;
		const rect = element.getBoundingClientRect();
		const key = `#image-${keys.size}`;

		keys.set(url, { key, box: { width: rect.width, height: rect.height } });

		return key;
	};

	const tree = capture((element, node, computed) => {
		const name = componentNameOf(element, naming);

		if (name) node.name = name;

		if (element instanceof SVGSVGElement && element.querySelector(PAINTED)) {
			node.tag = "img";
			node.attrs = { src: keyOf(svgUrl(element, computed), element) };
			node.children = [];
		}

		if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement) {
			const url =
				element instanceof HTMLImageElement ? element.currentSrc || element.src : element.toDataURL("image/png");

			if (url) node.attrs = { ...node.attrs, src: keyOf(url, element) };
		}

		const background = computed.backgroundImage;

		if (background && background.includes("url(")) {
			node.styles["background-image"] = background.replace(
				URL_PATTERN,
				(_, _quote, url: string) => `url("${keyOf(url, element)}")`,
			);
		}
	});

	const images: Record<string, FrameImage> = {};

	await Promise.all(
		[...keys].map(async ([url, { key, box }]) => {
			const image = await load(url, box);

			if (image) images[key] = image;
		}),
	);

	return { tree, images };
}
