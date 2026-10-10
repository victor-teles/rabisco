import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import {
	componentInsertion,
	dropTarget,
	insertDrop,
	libraryInsertion,
	parseDragItem,
	type Insertion,
} from "@/lib/component-drop";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import { sourceVersion } from "@/lib/render/protocol";
import { projectComponents, type ProjectComponent } from "../../shared/components/usages";
import { LIBRARY } from "../../shared/components/library";
import { extractSuggestion, findDuplicates, parseJsx, type DuplicateGroup } from "../../shared/jsx";
import { isComponentFile } from "../../shared/project";
import type { ProjectFiles } from "../../shared/types";
import type { ChangeOptions, ProjectState } from "./use-project";

/** `version` is the source the canvas placed the drop in; a drop placed in another version goes to the end of the screen */
export type ComponentDrop = {
	file: string | null;
	data: string;
	target: { parent: number; index: number; version: string } | null;
};

type Options = {
	projectPath: string;
	files: ProjectFiles;
	selection: string[];
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	undo: () => void;
	busy: boolean;
	open: boolean;
	/** After a drop, with the added element's offset in the new source */
	onInserted?: (element: { file: string; start: number }) => void;
};

const MAX_REMEMBERED = 200;

/** The duplicate scan and catalog parse every file, so they wait for a pause in typing. */
const SCAN_DELAY_MS = 500;

function useSettled<T>(value: T, delayMs: number): T {
	const [settled, setSettled] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setSettled(() => value), delayMs);

		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return settled;
}

function readKeys(key: string): Set<string> {
	try {
		const value = JSON.parse(localStorage.getItem(key) ?? "[]");

		return new Set(Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : []);
	} catch {
		return new Set();
	}
}

function writeKeys(key: string, keys: Set<string>) {
	try {
		localStorage.setItem(key, JSON.stringify([...keys].slice(-MAX_REMEMBERED)));
	} catch {
		// Storage full or unavailable: suggestions just come back next time
	}
}

function useSuggestions(projectPath: string, files: ProjectFiles, busy: boolean, open: boolean) {
	const dismissedKey = `rabisco:suggestions:dismissed:${projectPath}`;
	const seenKey = `rabisco:suggestions:seen:${projectPath}`;
	const [dismissed, setDismissed] = useState(() => readKeys(dismissedKey));
	const [seen, setSeen] = useState(() => readKeys(seenKey));

	const [found, setFound] = useState<{ files: ProjectFiles | null; groups: DuplicateGroup[] }>(() =>
		busy ? { files: null, groups: [] } : { files, groups: findDuplicates(files) },
	);

	if (!busy && found.files !== files) setFound({ files, groups: findDuplicates(files) });
	const scanned = found.files;

	const all = found.groups;

	const suggestions = useMemo(() => all.filter((group) => !dismissed.has(group.key)), [all, dismissed]);
	const unseen = suggestions.filter((group) => !seen.has(group.key)).length;

	if (open && unseen) setSeen(new Set([...seen, ...suggestions.map((group) => group.key)]));

	useEffect(() => {
		if (open) writeKeys(seenKey, seen);
	}, [open, seen, seenKey]);

	const dismiss = useCallback(
		(key: string) => {
			setDismissed((current) => {
				const next = new Set(current).add(key);
				writeKeys(dismissedKey, next);

				return next;
			});
		},
		[dismissedKey],
	);

	return { suggestions, unseen, dismiss, scanned };
}

export function componentName(component: ProjectComponent | undefined, path: string) {
	return component?.exports[0]?.name ?? path.replace(/^components\//, "").replace(/\.tsx$/, "");
}

export function useComponents({
	projectPath,
	files,
	selection,
	stateRef,
	change,
	undo,
	busy,
	open,
	onInserted,
}: Options) {
	const insertedRef = useRef(onInserted);

	useLayoutEffect(() => {
		insertedRef.current = onInserted;
	});

	const settled = useSettled(files, SCAN_DELAY_MS);
	const components = useMemo(() => projectComponents(settled), [settled]);
	const { suggestions, unseen, dismiss, scanned } = useSuggestions(projectPath, settled, busy, open);

	const selectedPath =
		selection.length === 1 && isComponentFile(selection[0]!) && selection[0]! in files ? selection[0]! : null;

	const selectedComponent = selectedPath
		? {
				path: selectedPath,
				name: componentName(
					components.find((c) => c.path === selectedPath),
					selectedPath,
				),
			}
		: null;

	/** Only undoes while the toast's change is still the latest step. */
	const undoAction = useCallback(() => {
		const after = stateRef.current?.history.present;

		return {
			label: "Undo",
			onClick: () => {
				if (stateRef.current?.history.present === after) undo();
				else toast("Something else changed since; use ⌘Z to step back");
			},
		};
	}, [stateRef, undo]);

	const makeComponent = useCallback(
		(group: DuplicateGroup, name: string): string | null => {
			const current = stateRef.current;

			if (!current) return "The project isn't open.";

			if (busy) return "Wait for the generation to finish.";

			// The scan may lag the files by a keystroke or two, so stale offsets are found again
			const fresh = scanned === current.files ? group : findDuplicates(current.files).find((g) => g.key === group.key);

			if (!fresh?.occurrences.length) return "Nothing to extract.";
			const result = extractSuggestion(current.files, fresh, name);

			if (!result.ok) return result.reason;
			change((snapshot) => ({ ...snapshot, files: applyFileChanges(snapshot.files, result.changes) }), {
				select: [result.componentPath],
			});
			const count = result.replaced.reduce((sum, r) => sum + r.count, 0);
			const fileCount = result.replaced.length;
			toast.success(`Made ${result.exportName}`, {
				description: `Replaced ${count} ${count === 1 ? "copy" : "copies"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}.`,
				action: undoAction(),
			});

			return null;
		},
		[stateRef, busy, scanned, change, undoAction],
	);

	const drop = useCallback(
		({ file, data, target }: ComponentDrop) => {
			const item = parseDragItem(data);
			const current = stateRef.current;

			if (!item || !current) return;

			if (!file) {
				toast("Drop it on a screen to add it");

				return;
			}

			if (busy) {
				toast("Wait for the generation to finish");

				return;
			}

			const source = current.files[file];
			const frame = current.canvas.frames.find((f) => f.file === file);

			if (source === undefined || !frame) return;
			let insertion: Insertion | null = null;
			let name = "";

			if (item.kind === "component") {
				const component = projectComponents(current.files)
					.find((c) => c.path === item.path)
					?.exports.find((e) => e.name === item.name);

				if (component) insertion = componentInsertion(item.path, component);
				name = item.name;
			} else {
				const entry = LIBRARY.find((i) => i.id === item.id);

				if (entry) insertion = libraryInsertion(entry);
				name = entry?.title ?? "";
			}

			if (!insertion) {
				toast.error(`${name || "That component"} is gone`);

				return;
			}

			// Offsets placed in another version point at the wrong elements: append to the screen instead
			const placed = target?.version === sourceVersion(source) ? target : null;
			const fallback = placed ? null : dropTarget(source, null);
			const at = placed ?? (fallback && { parent: fallback.parent, index: fallback.slots.length });
			const next = at && insertDrop(source, at.parent, at.index, insertion);

			if (next === null) {
				const description = parseJsx(source).ok
					? "Its default export doesn't return an element to add it to."
					: "The screen has a syntax error. Fix it in the Code tab first.";

				toast.error(`Couldn't add ${name} to ${frame.name}`, { description });

				return;
			}

			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: next.source } }), { select: [file] });
			insertedRef.current?.({ file, start: next.start });
			toast(`Added ${name} to ${frame.name}`, { action: undoAction() });
		},
		[stateRef, busy, change, undoAction],
	);

	return {
		components,
		suggestions,
		unseenSuggestions: unseen,
		dismissSuggestion: dismiss,
		makeComponent,
		drop,
		selectedComponent,
	};
}
