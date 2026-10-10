import { useCallback, useRef, type RefObject } from "react";
import { toast } from "sonner";
import { deviceForSize } from "@/lib/device-presets";
import type { Snapshot } from "@/lib/history";
import {
	imageSnippet,
	insertIntoScreen,
	insertSnippet,
	newFrameRect,
	type CanvasInsert,
	type InsertTarget,
	type InsertTool,
} from "@/lib/insert-tools";
import { blankScreen, placeScreens } from "@/lib/new-screens";
import { api, isDesktop } from "@/lib/rpc";
import { parseJsx } from "../../shared/jsx";
import type { Device } from "../../shared/types";
import type { ChangeOptions, ProjectState } from "./use-project";

type Point = { x: number; y: number };

type InsertedElement = { file: string; start: number };

type Options = {
	projectPath: string;
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	busy: boolean;
	device: Device;
	select: (element: InsertedElement) => void;
	editText: (element: InsertedElement) => void;
	pointer: () => Point | null;
	placementAt: (point: Point) => Promise<{ file: string; target: InsertTarget | null } | null>;
	done: () => void;
};

const LABELS: Record<InsertTool, string> = {
	frame: "a frame",
	rectangle: "a rectangle",
	ellipse: "an ellipse",
	text: "text",
};

const FRAME_NAME = "Frame";

export function useInsertTools({
	projectPath,
	stateRef,
	change,
	busy,
	device,
	select,
	editText,
	pointer,
	placementAt,
	done,
}: Options) {
	const pendingText = useRef<{ file: string; start: number; step: string } | null>(null);

	const addToScreen = useCallback(
		(file: string, target: InsertTarget | null, snippet: string, label: string) => {
			const current = stateRef.current;
			const source = current?.files[file];
			const frame = current?.canvas.frames.find((f) => f.file === file);

			if (source === undefined || !frame) return null;

			if (busy) {
				toast("Wait for the generation to finish");

				return null;
			}

			const next = insertIntoScreen(source, target, snippet);

			if (!next) {
				const description = parseJsx(source).ok
					? "Its default export doesn't return an element to add it to."
					: "The screen has a syntax error. Fix it in the Code tab first.";

				toast.error(`Couldn't add ${label} to ${frame.name}`, { description });

				return null;
			}

			const step = `insert:${crypto.randomUUID()}`;
			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: next.source } }), {
				select: [file],
				coalesce: step,
			});
			const element = { file, start: next.start };
			select(element);

			return { element, step };
		},
		[stateRef, busy, change, select],
	);

	const addFrame = useCallback(
		(insert: CanvasInsert) => {
			const current = stateRef.current;

			if (!current) return;
			const rect = newFrameRect(insert, device);
			const size = { width: rect.width, height: rect.height };
			const screen = blankScreen(FRAME_NAME, deviceForSize(size), size);
			const placed = placeScreens(current.files, current.canvas.frames, [screen], rect);

			change(
				(snapshot) => ({
					...snapshot,
					files: { ...snapshot.files, ...placed.files },
					frames: [...snapshot.frames, ...placed.frames],
				}),
				{ select: placed.frames.map((frame) => frame.file) },
			);
		},
		[stateRef, device, change],
	);

	const insert = useCallback(
		(insert: CanvasInsert) => {
			done();

			if (insert.file === null) {
				if (insert.tool === "frame") return addFrame(insert);

				return void toast(`Draw inside a screen to add ${LABELS[insert.tool]}`);
			}

			const added = addToScreen(insert.file, insert.target, insertSnippet(insert), LABELS[insert.tool]);

			if (!added || insert.tool !== "text") return;
			pendingText.current = { ...added.element, step: added.step };
			editText(added.element);
		},
		[done, addFrame, addToScreen, editText],
	);

	const placeImage = useCallback(async () => {
		if (!isDesktop) return void toast("Images need the desktop app");
		const point = pointer();
		const placed = point ? await placementAt(point) : null;
		const selection = stateRef.current?.canvas.selection ?? [];
		const file = placed?.file ?? (selection.length === 1 ? selection[0]! : null);

		if (!file) return void toast("Point at a screen to place an image");
		let picked: { src: string } | null;

		try {
			picked = await api.pickImage({ path: projectPath });
		} catch (error) {
			return void toast.error("Couldn't add the image", {
				description: error instanceof Error ? error.message : String(error),
			});
		}

		if (picked) addToScreen(file, placed?.file === file ? placed.target : null, imageSnippet(picked.src), "the image");
	}, [pointer, placementAt, stateRef, projectPath, addToScreen]);

	const textStep = useCallback((element: InsertedElement) => {
		const pending = pendingText.current;
		pendingText.current = null;

		return pending && pending.file === element.file && pending.start === element.start ? pending.step : undefined;
	}, []);

	return { insert, placeImage, textStep };
}
