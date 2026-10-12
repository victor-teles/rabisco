import type { Snapshot } from "@/lib/history";

export function removeImage(snapshot: Snapshot, id: string): Snapshot {
	const images = (snapshot.images ?? []).filter((image) => image.id !== id);
	const src = snapshot.images?.find((image) => image.id === id)?.src;

	const used = (file: string) =>
		images.some((image) => image.src === file) ||
		Object.values(snapshot.files).some((content) => content.includes(file));

	if (!src || !snapshot.assets || !(src in snapshot.assets) || used(src)) return { ...snapshot, images };
	const assets = { ...snapshot.assets };
	delete assets[src];

	return { ...snapshot, images, assets };
}
