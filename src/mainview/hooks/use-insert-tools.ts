import { useCallback, useRef, type RefObject } from "react";
import { toast } from "sonner";
import type { Snapshot } from "@/lib/history";
import {
	imageSnippet,
	insertIntoScreen,
	insertSnippet,
	type CanvasInsert,
	type InsertTarget,
	type InsertTool,
} from "@/lib/insert-tools";
import { api, isDesktop } from "@/lib/rpc";
import { parseJsx } from "../../shared/jsx";
import type { ChangeOptions, ProjectState } from "./use-project";

type Point = { x: number; y: number };

type InsertedElement = { file: string; start: number };

type Options = {
	projectPath: string;
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	busy: boolean;
	select: (element: InsertedElement) => void;
	editText: (element: InsertedElement) => void;
	pointer: () => Point | null;
	placementAt: (point: Point) => Promise<{ file: string; target: InsertTarget | null } | null>;
	done: () => void;
};

const LABELS: Record<InsertTool, string> = {
	rectangle: "a rectangle",
	ellipse: "an ellipse",
	text: "text",
};

export function useInsertTools({
	projectPath,
	stateRef,
	change,
	busy,
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

	const insert = useCallback(
		(insert: CanvasInsert) => {
			done();

			if (insert.file === null) return void toast(`Draw inside a screen to add ${LABELS[insert.tool]}`);

			const added = addToScreen(insert.file, insert.target, insertSnippet(insert), LABELS[insert.tool]);

			if (!added || insert.tool !== "text") return;
			pendingText.current = { ...added.element, step: added.step };
			editText(added.element);
		},
		[done, addToScreen, editText],
	);

	const insertPath = useCallback(
		(path: { file: string; snippet: string; target: InsertTarget | null } | null) => {
			done();

			if (path) addToScreen(path.file, path.target, path.snippet, "the path");
		},
		[done, addToScreen],
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

	return { insert, insertPath, placeImage, textStep };
}
