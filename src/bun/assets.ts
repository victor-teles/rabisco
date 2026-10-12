import { createHash } from "crypto";
import {
	copyFileSync,
	type Dirent,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "fs";
import { basename, extname, join } from "path";
import type { Attachment } from "../shared/ai/contract";
import { assetKey, PUBLIC_DIR, type AssetChange, type AssetDigests, type ProjectAssets } from "../shared/assets";
import { MOODBOARD_EXTENSIONS, MOODBOARD_PREFIX } from "../shared/moodboard";
import { assertProjectDir } from "./project-folder";

/** Vite serves `public/` at the root, so the exported app finds `/images/…` as written */
export const IMAGES_DIR = "public/images";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"];

/** `My Photo (1).PNG` → `my-photo-1` */
export function slug(name: string) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "image"
	);
}

const sameBytes = (a: string, b: string) => readFileSync(a).equals(readFileSync(b));

/**
 * Copies an image into `<project>/public/images/` and returns the `src` screens use (`/images/logo.png`).
 * The same file picked twice is copied once; another file with the same name gets `-2`, `-3`…
 */
export function importImage(projectDir: string, file: string): string {
	assertProjectDir(projectDir);
	const extension = extname(file).slice(1).toLowerCase();

	if (!IMAGE_EXTENSIONS.includes(extension))
		throw new Error(`Not an image Rabisco can use: ${basename(file)}. Pick a ${IMAGE_EXTENSIONS.join(", ")} file.`);
	const dir = join(projectDir, IMAGES_DIR);
	const base = slug(basename(file, extname(file)));
	mkdirSync(dir, { recursive: true });

	for (let n = 1; ; n++) {
		const name = `${base}${n === 1 ? "" : `-${n}`}.${extension}`;
		const target = join(dir, name);

		if (existsSync(target) && !sameBytes(target, file)) continue;

		if (!existsSync(target)) copyFileSync(file, target);

		return `/images/${name}`;
	}
}

export function saveMoodboardImage(
	projectDir: string,
	name: string,
	mediaType: Attachment["mediaType"],
	data: string,
): string {
	assertProjectDir(projectDir);
	const bytes = Buffer.from(data, "base64");

	if (bytes.length > MAX_ASSET_BYTES) throw new Error(`${name} is over ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
	const dir = join(projectDir, PUBLIC_DIR, MOODBOARD_PREFIX);
	const base = slug(basename(name, extname(name)));
	const extension = MOODBOARD_EXTENSIONS[mediaType];
	mkdirSync(dir, { recursive: true });

	for (let n = 1; ; n++) {
		const file = `${base}${n === 1 ? "" : `-${n}`}.${extension}`;
		const target = join(dir, file);

		if (existsSync(target) && !readFileSync(target).equals(bytes)) continue;

		if (!existsSync(target)) writeFileSync(target, bytes);

		return `${MOODBOARD_PREFIX}${file}`;
	}
}

/** Bigger files stay out of frames: their bytes cross RPC as base64 */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

function readEntries(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

/** Size and mtime by `src`. Symlinks and dot files are skipped, so nothing outside `public/` is read */
export function listAssets(projectDir: string): Map<string, string> {
	const listed = new Map<string, string>();

	const walk = (dir: string, prefix: string) => {
		for (const entry of readEntries(dir)) {
			if (entry.name.startsWith(".")) continue;
			const path = join(dir, entry.name);

			if (entry.isDirectory()) {
				walk(path, `${prefix}${entry.name}/`);
				continue;
			}

			const key = entry.isFile() ? assetKey(`${prefix}${entry.name}`) : null;

			if (!key) continue;

			try {
				const { size, mtimeMs } = statSync(path);

				if (size <= MAX_ASSET_BYTES) listed.set(key, `${size}:${mtimeMs}`);
				else console.warn(`Skipped ${path}: images over ${MAX_ASSET_BYTES / 1024 / 1024} MB don't load on the canvas`);
			} catch {
				// Removed while listing
			}
		}
	};

	walk(join(projectDir, PUBLIC_DIR), "");

	return listed;
}

export const assetDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 32);

function readAsset(projectDir: string, src: string): Buffer | null {
	try {
		return readFileSync(join(projectDir, PUBLIC_DIR, src));
	} catch {
		return null;
	}
}

/** Remembers what the webview has, so a change sends only the files that changed */
export class AssetTracker {
	#known = new Map<string, string>();
	#digests: AssetDigests = {};

	constructor(readonly dir: string) {}

	digests(): AssetDigests {
		return this.#digests;
	}

	load(): ProjectAssets {
		this.#known = listAssets(this.dir);
		this.#digests = {};
		const assets: ProjectAssets = {};

		for (const src of this.#known.keys()) {
			const bytes = readAsset(this.dir, src);

			if (bytes === null) this.#known.delete(src);
			else {
				assets[src] = bytes.toString("base64");
				this.#digests[src] = assetDigest(bytes);
			}
		}

		return assets;
	}

	changes(): AssetChange[] {
		const listed = listAssets(this.dir);
		const changes: AssetChange[] = [];
		const digests = { ...this.#digests };

		for (const [src, signature] of listed) {
			if (this.#known.get(src) === signature) continue;
			const bytes = readAsset(this.dir, src);

			if (bytes === null) listed.delete(src);
			else {
				const digest = assetDigest(bytes);
				digests[src] = digest;
				changes.push({ src, data: bytes.toString("base64"), digest });
			}
		}

		for (const src of this.#known.keys()) {
			if (listed.has(src)) continue;
			delete digests[src];
			changes.push({ src, data: null });
		}

		this.#known = listed;
		this.#digests = digests;

		return changes;
	}
}
