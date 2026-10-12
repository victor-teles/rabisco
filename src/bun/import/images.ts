import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import type { CapturedNode, CapturedTree } from "../../shared/import/captured-tree";
import { IMAGES_DIR, MAX_ASSET_BYTES, slug } from "../assets";
import { assertProjectDir } from "../project-folder";

export const IMPORTED_DIR = "imported";

export const MAX_IMPORTED_IMAGES = 40;

const TIMEOUT_MS = 10_000;

const PARALLEL = 6;

const EXTENSIONS = new Map([
	["image/png", "png"],
	["image/jpeg", "jpg"],
	["image/gif", "gif"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/svg+xml", "svg"],
]);

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=\s]+)$/i;

const PRIVATE_HOST =
	/^(?:localhost|.*\.local|.*\.localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[(?:::1?|f[cd][0-9a-f:]*|fe80:[0-9a-f:]*)\])$/i;

function imageUrl(src: string, page: URL): URL | null {
	let url: URL;

	try {
		url = new URL(src, page);
	} catch {
		return null;
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") return null;

	return PRIVATE_HOST.test(url.hostname) && url.hostname !== page.hostname ? null : url;
}

type Image = { bytes: Buffer; extension: string; name: string };

function saveImage(projectDir: string, { bytes, extension, name }: Image): string {
	const dir = join(projectDir, IMAGES_DIR, IMPORTED_DIR);
	const base = slug(basename(name, extname(name)));

	mkdirSync(dir, { recursive: true });

	for (let n = 1; ; n++) {
		const file = `${base}${n === 1 ? "" : `-${n}`}.${extension}`;
		const target = join(dir, file);

		if (existsSync(target) && !readFileSync(target).equals(bytes)) continue;

		if (!existsSync(target)) writeFileSync(target, bytes);

		return `/images/${IMPORTED_DIR}/${file}`;
	}
}

async function download(url: URL, page: URL, fetcher: typeof fetch): Promise<Image | null> {
	try {
		const response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
		const landed = imageUrl(response.url || url.href, page);
		const extension = EXTENSIONS.get((response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase());

		if (!response.ok || !landed || !extension) return null;

		if (Number(response.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES) return null;
		const bytes = Buffer.from(await response.arrayBuffer());

		return bytes.length > MAX_ASSET_BYTES ? null : { bytes, extension, name: basename(url.pathname) || "image" };
	} catch {
		return null;
	}
}

function fromDataUrl(src: string): Image | null {
	const match = DATA_URL.exec(src);

	if (!match) return null;
	const bytes = Buffer.from(match[2]!, "base64");
	const extension = EXTENSIONS.get(match[1]!.toLowerCase());

	return bytes.length > MAX_ASSET_BYTES || !extension ? null : { bytes, extension, name: "image" };
}

function imageNodes(node: CapturedNode, found: CapturedNode[]) {
	if (node.tag === "img" && node.attrs?.src) found.push(node);

	for (const child of node.children) imageNodes(child, found);
}

export async function importCapturedImages(
	projectDir: string,
	tree: CapturedTree,
	pageUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<{ tree: CapturedTree; copied: number; failed: number }> {
	assertProjectDir(projectDir);
	const page = new URL(pageUrl);
	const copy: CapturedTree = structuredClone(tree);
	const nodes: CapturedNode[] = [];

	imageNodes(copy.root, nodes);
	const sources = [...new Set(nodes.map((node) => node.attrs!.src!))];
	const saved = new Map<string, string>();
	const queue = sources.slice(0, MAX_IMPORTED_IMAGES);

	const worker = async () => {
		for (let src = queue.shift(); src !== undefined; src = queue.shift()) {
			const url = src.startsWith("data:") ? null : imageUrl(src, page);
			const image = src.startsWith("data:") ? fromDataUrl(src) : url ? await download(url, page, fetcher) : null;

			if (image) saved.set(src, saveImage(projectDir, image));
		}
	};

	await Promise.all(Array.from({ length: PARALLEL }, worker));

	for (const node of nodes) {
		const attrs = node.attrs!;
		const local = saved.get(attrs.src!);

		if (local) attrs.src = local;
		else delete attrs.src;
	}

	return { tree: copy, copied: saved.size, failed: sources.length - saved.size };
}
