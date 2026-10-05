import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChangeOptions, ProjectState } from "@/hooks/use-project";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import { atPath, pathOf, remapStart } from "@/lib/outline";
import { setChildrenText, writeProp, type Literal } from "@/lib/props";
import { isMakeComponent } from "@/views/editor/shortcuts";
import { extractComponent, findElement, parseJsx, removeElement } from "../../shared/jsx";
import type { PropSpec } from "../../shared/components/api";
import type { ProjectFiles } from "../../shared/types";

/** The element selected in the structure outline: its file and start offset. */
export type StructureNode = { file: string; start: number };

type Tracked = StructureNode & { source: string };

type Options = {
	files: ProjectFiles;
	/** The one file the inspector shows (a screen or a component), or null */
	file: string | null;
	stateRef: React.RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	/** Brings the Code tab forward, where the outline lives */
	onShowCode: () => void;
	/**
	 * A generation or interview is running. Its result is built from the files
	 * as they were when it started, so edits made meanwhile would be lost:
	 * they are refused until it ends.
	 */
	busy?: boolean;
};

const BUSY_MESSAGE = "Wait for the generation to finish";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Made StatCard · replaced 4 in 3 files" */
export function madeComponentMessage(exportName: string, replaced: { path: string; count: number }[]) {
	const total = replaced.reduce((sum, item) => sum + item.count, 0);

	return total > 1
		? `Made ${exportName} · replaced ${total} in ${plural(replaced.length, "file")}`
		: `Made ${exportName}`;
}

/**
 * The structure outline's selection and the edits made from it: "Make
 * component", prop controls and the code editor. The selection follows its
 * element through edits (by offset, then by tree position) and clears when
 * the element is gone or another file is shown.
 */
export function useStructure({ files, file, stateRef, change, onShowCode, busy = false }: Options) {
	const [tracked, setTracked] = useState<Tracked | null>(null);
	const [naming, setNaming] = useState(false);
	// Read in callbacks, so a generation that starts mid-burst refuses the next keystroke
	const busyRef = useRef(busy);

	useLayoutEffect(() => {
		busyRef.current = busy;
	}, [busy]);

	// Follow the element through edits; adjusting state while rendering avoids a frame with stale offsets
	let node: Tracked | null = tracked;

	if (tracked) {
		const source = files[tracked.file];

		if (tracked.file !== file || source === undefined) node = null;
		else if (source !== tracked.source && parseJsx(source).ok) {
			const start = remapStart(tracked.source, source, tracked.start);
			node = start === null ? null : { file: tracked.file, start, source };
		}

		if (node !== tracked) setTracked(node);
	}

	if ((!node || busy) && naming) setNaming(false);

	const select = useCallback(
		(next: StructureNode | null) => {
			const source = next ? stateRef.current?.files[next.file] : undefined;
			setTracked(next && source !== undefined ? { ...next, source } : null);

			if (!next) setNaming(false);
		},
		[stateRef],
	);

	/** Edits one file through the undo history; `step` coalesces a typing burst. */
	const editFile = useCallback(
		(path: string, edit: (source: string) => string | null, step?: string) => {
			if (busyRef.current) return;
			change(
				(snapshot) => {
					const source = snapshot.files[path];
					const next = source === undefined ? null : edit(source);

					return next === null || next === source
						? snapshot
						: { ...snapshot, files: { ...snapshot.files, [path]: next } };
				},
				{ coalesce: step },
			);
		},
		[change],
	);

	/** Replaces a file's source; without `step`, the edit is an undo step of its own. */
	const editCode = useCallback(
		(path: string, text: string, step?: string) => editFile(path, () => text, step),
		[editFile],
	);

	const setProp = useCallback(
		(target: StructureNode, name: string, value: Literal | null, spec?: PropSpec, step?: string) =>
			editFile(target.file, (source) => writeProp(source, target.start, name, value, spec), step),
		[editFile],
	);

	const setChildren = useCallback(
		(target: StructureNode, text: string, step?: string) =>
			editFile(target.file, (source) => setChildrenText(source, target.start, text), step),
		[editFile],
	);

	/** Deletes the selected element from its file (one undo step) and selects its parent. */
	const removeNode = useCallback(() => {
		const source = node ? stateRef.current?.files[node.file] : undefined;

		if (!node || source === undefined) return;

		if (busyRef.current) {
			toast(BUSY_MESSAGE);

			return;
		}

		const next = removeElement(source, node.start);

		if (next === null || next === source) return;
		const parent = findElement(parseJsx(source), node.start)?.parent ?? null;
		change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [node.file]: next } }));
		// The parent starts before the element, so its offset doesn't move
		setTracked(parent && parent.name !== null ? { file: node.file, start: parent.start, source: next } : null);
	}, [node, stateRef, change]);

	/** Extracts the selected element into components/*.tsx and replaces its repeats, as one undo step. */
	const makeComponent = useCallback(
		(name: string) => {
			const current = stateRef.current;

			if (!current || !node) return false;

			if (busyRef.current) {
				toast(BUSY_MESSAGE);

				return false;
			}

			const result = extractComponent({ files: current.files, path: node.file, start: node.start, name });

			if (!result.ok) {
				toast(result.reason);

				return false;
			}

			const before = current.files[node.file]!;
			change((snapshot) => ({ ...snapshot, files: applyFileChanges(snapshot.files, result.changes) }));
			toast(madeComponentMessage(result.exportName, result.replaced));
			// The usage sits where the element was: same place in the tree
			const after = result.changes.find((c) => c.path === node.file)?.content ?? before;
			const path = pathOf(parseJsx(before), node.start);
			const usage = path ? atPath(parseJsx(after), path) : null;
			setTracked(
				usage && usage.name === result.exportName ? { file: node.file, start: usage.start, source: after } : null,
			);
			setNaming(false);

			return true;
		},
		[stateRef, node, change],
	);

	// ⌥⌘K, Figma's create-component shortcut, from anywhere in the editor
	const shortcut = useEffectEvent((event: KeyboardEvent) => {
		if (!isMakeComponent(event) || event.defaultPrevented) return;
		event.preventDefault();
		onShowCode();

		if (busyRef.current) toast(BUSY_MESSAGE);
		else if (node) setNaming(true);
		else
			toast("Select an element in Structure first", {
				description: "The Code tab shows the structure of the selected screen.",
			});
	});

	useEffect(() => {
		const listener = (event: KeyboardEvent) => shortcut(event);
		window.addEventListener("keydown", listener);

		return () => window.removeEventListener("keydown", listener);
	}, []);

	const nodeFile = node?.file ?? null;
	const nodeStart = node?.start ?? -1;

	const selected = useMemo<StructureNode | null>(
		() => (nodeFile === null ? null : { file: nodeFile, start: nodeStart }),
		[nodeFile, nodeStart],
	);

	return { node: selected, select, busy, naming, setNaming, makeComponent, removeNode, editCode, setProp, setChildren };
}

export type Structure = ReturnType<typeof useStructure>;
