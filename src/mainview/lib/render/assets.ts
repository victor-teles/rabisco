import { assetType, type AssetChange, type ProjectAssets } from "../../../shared/assets";

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return bytes;
}

async function encodeBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";

	// `fromCharCode` takes its bytes as arguments, so long files go in chunks
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

	return btoa(binary);
}

/**
 * The open project's images (decision 0010), held once as Blobs. Posting a Blob to a frame shares its bytes
 * instead of copying them, and `version` lets every `FrameHost` skip the diff when nothing changed.
 */
export class AssetStore {
	#blobs = new Map<string, Blob>();
	#listeners = new Set<() => void>();
	version = 0;

	get size() {
		return this.#blobs.size;
	}

	get(src: string): Blob | undefined {
		return this.#blobs.get(src);
	}

	reset(assets: ProjectAssets) {
		if (this.#blobs.size === 0 && Object.keys(assets).length === 0) return;
		this.#blobs.clear();

		for (const [src, data] of Object.entries(assets)) this.#set(src, data);
		this.#changed();
	}

	apply(changes: AssetChange[]) {
		if (!changes.length) return;

		for (const { src, data } of changes) {
			if (data === null) this.#blobs.delete(src);
			else this.#set(src, data);
		}

		this.#changed();
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);

		return () => void this.#listeners.delete(listener);
	}

	/** What a frame that has `sent` is missing; `null` deletes. Updates `sent`. */
	delta(sent: Map<string, Blob>): Map<string, Blob | null> {
		const delta = new Map<string, Blob | null>();

		for (const [src, blob] of this.#blobs) {
			if (sent.get(src) === blob) continue;
			delta.set(src, blob);
			sent.set(src, blob);
		}

		for (const src of sent.keys()) {
			if (this.#blobs.has(src)) continue;
			delta.set(src, null);
			sent.delete(src);
		}

		return delta;
	}

	/** For exports that write `public/` */
	async base64(): Promise<ProjectAssets> {
		const assets: ProjectAssets = {};

		for (const [src, blob] of this.#blobs) assets[src] = await encodeBase64(blob);

		return assets;
	}

	/** For the share viewer, which has no Blobs to post */
	async dataUrls(): Promise<Record<string, string>> {
		const urls: Record<string, string> = {};

		for (const [src, blob] of this.#blobs) urls[src] = `data:${blob.type};base64,${await encodeBase64(blob)}`;

		return urls;
	}

	#set(src: string, data: string) {
		const type = assetType(src);

		if (type) this.#blobs.set(src, new Blob([decodeBase64(data)], { type }));
	}

	#changed() {
		this.version++;

		for (const listener of this.#listeners) listener();
	}
}

export const projectAssets = new AssetStore();
