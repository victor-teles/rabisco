import { useCallback, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { toast } from "sonner";
import type { Action } from "@/lib/actions";
import type { Snapshot } from "@/lib/history";
import { removeImage } from "@/lib/moodboard";
import { encodeBase64, projectAssets } from "@/lib/render/assets";
import { api } from "@/lib/rpc";
import type { Attachment } from "../../shared/ai/contract";
import { fitImage, MOODBOARD_EXTENSIONS, moodboardReferences } from "../../shared/moodboard";
import type { CanvasImage, Frame } from "../../shared/types";
import type { ChangeOptions, ProjectState } from "./use-project";

type Point = { x: number; y: number };

type Rect = { x: number; y: number; width: number; height: number };

type Options = {
	projectPath: string;
	stateRef: RefObject<ProjectState | null>;
	images?: CanvasImage[];
	frames: Frame[];
	targets: string[];
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	screensSelected: boolean;
	sectionSelected: boolean;
	setSelection: (selection: string[]) => void;
	reveal: (rects: Rect[]) => void;
};

const NO_IMAGES: CanvasImage[] = [];

const GAP = 40;

const subscribeAssets = (listener: () => void) => projectAssets.subscribe(listener);

const isMoodboardType = (type: string): type is Attachment["mediaType"] => type in MOODBOARD_EXTENSIONS;

export const isMoodboardFile = (file: File) => isMoodboardType(file.type);

const patchImage = (snapshot: Snapshot, id: string, patch: Partial<Omit<CanvasImage, "id">>): Snapshot => ({
	...snapshot,
	images: (snapshot.images ?? NO_IMAGES).map((image) => (image.id === id ? { ...image, ...patch } : image)),
});

async function naturalSize(file: File) {
	const bitmap = await createImageBitmap(file);
	const size = fitImage(bitmap.width, bitmap.height);
	bitmap.close();

	return size;
}

function besideEverything(frames: Frame[], images: CanvasImage[]): Point {
	const rects: Rect[] = [...frames, ...images];

	if (!rects.length) return { x: 0, y: 0 };

	return {
		x: Math.max(...rects.map((rect) => rect.x + rect.width)) + GAP * 2,
		y: Math.min(...rects.map((rect) => rect.y)),
	};
}

async function readClipboardImages(): Promise<File[]> {
	const items = await navigator.clipboard.read().catch(() => []);
	const files: File[] = [];

	for (const item of items) {
		const type = item.types.find(isMoodboardType);

		if (!type) continue;
		const blob = await item.getType(type);
		files.push(new File([blob], `pasted.${MOODBOARD_EXTENSIONS[type]}`, { type }));
	}

	return files;
}

export function useMoodboard({
	projectPath,
	stateRef,
	images = NO_IMAGES,
	frames,
	targets,
	change,
	screensSelected,
	sectionSelected,
	setSelection,
	reveal,
}: Options) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const current = selectedId ? images.find((image) => image.id === selectedId) : undefined;

	if (selectedId && !current) setSelectedId(null);

	const othersSelected = screensSelected || sectionSelected;
	const [hadOthers, setHadOthers] = useState(othersSelected);

	if (hadOthers !== othersSelected) {
		setHadOthers(othersSelected);

		if (othersSelected) setSelectedId(null);
	}

	const loaded = useSyncExternalStore(subscribeAssets, () => projectAssets.srcs());
	const shown = useMemo(() => images.filter((image) => loaded.has(image.src)), [images, loaded]);

	const referenced = useMemo(() => moodboardReferences(shown, frames, targets), [shown, frames, targets]);

	const select = useCallback(
		(id: string | null) => {
			setSelectedId(id);

			if (id) setSelection([]);
		},
		[setSelection],
	);

	const add = useCallback(
		async (files: File[], at?: Point) => {
			const accepted = files.filter(isMoodboardFile);

			if (!accepted.length) {
				if (files.length) toast("Only PNG, JPEG, WebP and GIF images go on the moodboard");

				return false;
			}

			const state = stateRef.current;

			if (!state) return false;
			const placed: Omit<CanvasImage, "x" | "y">[] = [];

			for (const file of accepted) {
				try {
					const mediaType = isMoodboardType(file.type) ? file.type : "image/png";
					const data = await encodeBase64(file);
					const size = await naturalSize(file);
					const { src } = await api.addMoodboardImage({ path: projectPath, name: file.name, mediaType, data });
					projectAssets.apply([{ src, data }]);
					placed.push({ id: crypto.randomUUID(), src, name: file.name, ...size });
				} catch (reason) {
					toast.error(`Couldn't add ${file.name} to the moodboard`, { description: String(reason) });
				}
			}

			const row = placed.reduce((width, image) => width + image.width + GAP, -GAP);
			const tallest = Math.max(0, ...placed.map((image) => image.height));

			const start = at
				? { x: at.x - row / 2, y: at.y - tallest / 2 }
				: besideEverything(state.canvas.frames, state.canvas.images ?? NO_IMAGES);

			let x = Math.round(start.x);

			const added = placed.map((image) => {
				const next = { ...image, x, y: Math.round(start.y) };
				x += image.width + GAP;

				return next;
			});

			if (!added.length) return false;
			change((snapshot) => ({ ...snapshot, images: [...(snapshot.images ?? NO_IMAGES), ...added] }), { select: [] });
			setSelectedId(added.at(-1)!.id);

			if (!at) reveal(added);

			return true;
		},
		[stateRef, projectPath, change, reveal],
	);

	const paste = useCallback(
		async (at: Point | null) => {
			const files = await readClipboardImages();

			return files.length > 0 && add(files, at ?? undefined);
		},
		[add],
	);

	const pick = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = Object.keys(MOODBOARD_EXTENSIONS).join(",");
		input.onchange = () => void add(Array.from(input.files ?? []));
		input.click();
	}, [add]);

	const remove = useCallback((id: string) => change((snapshot) => removeImage(snapshot, id)), [change]);

	const move = useCallback(
		(id: string, dx: number, dy: number, dragId: string) =>
			change(
				(snapshot) => {
					const image = snapshot.images?.find((each) => each.id === id);

					return image ? patchImage(snapshot, id, { x: image.x + dx, y: image.y + dy }) : snapshot;
				},
				{ coalesce: `image:${dragId}` },
			),
		[change],
	);

	const resize = useCallback(
		(id: string, rect: Rect) => change((snapshot) => patchImage(snapshot, id, rect)),
		[change],
	);

	const actions: Action[] = [
		{
			id: "add-moodboard-image",
			label: "Add image to moodboard…",
			group: "Insert",
			enabled: true,
			run: pick,
		},
		{
			id: "delete-moodboard-image",
			label: "Delete image",
			group: "Arrange",
			chords: [{ key: "Backspace" }, { key: "Delete" }],
			enabled: current !== undefined,
			destructive: true,
			run: () => current && remove(current.id),
		},
		{
			id: "clear-moodboard-image",
			label: "Clear image selection",
			group: "Edit",
			chords: [{ key: "Escape" }],
			enabled: current !== undefined,
			hidden: true,
			run: () => select(null),
		},
	];

	return {
		images,
		referenced,
		selectedId: current ? current.id : null,
		actions,
		select,
		add,
		paste,
		remove,
		move,
		resize,
	};
}

export async function referenceAttachments(images: CanvasImage[]): Promise<Attachment[]> {
	const attachments: Attachment[] = [];

	for (const image of images) {
		const blob = projectAssets.get(image.src);

		if (!blob || !isMoodboardType(blob.type)) continue;
		attachments.push({ name: image.name, mediaType: blob.type, data: await encodeBase64(blob), source: "moodboard" });
	}

	return attachments;
}
