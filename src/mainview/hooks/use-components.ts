import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { componentInsertion, hitStarts, insertDrop, libraryInsertion, parseDragItem, type Insertion } from "@/lib/component-drop";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import type { FrameHit } from "@/lib/render/protocol";
import { projectComponents, type ProjectComponent } from "../../shared/components/usages";
import { LIBRARY } from "../../shared/components/library";
import { extractSuggestion, findDuplicates, parseJsx, type DuplicateGroup } from "../../shared/jsx";
import { isComponentFile } from "../../shared/project";
import type { ProjectFiles } from "../../shared/types";
import type { ChangeOptions, ProjectState } from "./use-project";

/** A drop from the components panel onto the canvas: the frame under the pointer and the screen elements there. */
export type ComponentDrop = { file: string | null; data: string; hit: FrameHit | null };

type Options = {
	projectPath: string;
	files: ProjectFiles;
	selection: string[];
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	undo: () => void;
	/** A generation or the interview runs: drops and extractions wait, suggestions hold still */
	busy: boolean;
	/** The Components tab is open, so its suggestions count as seen */
	open: boolean;
};

const MAX_REMEMBERED = 200;

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

/** Duplicate-structure suggestions the user hasn't dismissed, remembered per project. */
function useSuggestions(projectPath: string, files: ProjectFiles, busy: boolean, open: boolean) {
	const dismissedKey = `rabisco:suggestions:dismissed:${projectPath}`;
	const seenKey = `rabisco:suggestions:seen:${projectPath}`;
	const [dismissed, setDismissed] = useState(() => readKeys(dismissedKey));
	const [seen, setSeen] = useState(() => readKeys(seenKey));
	// Cheap and cached per file, but there's no point recomputing while a generation lands files
	const held = useRef<DuplicateGroup[]>([]);
	const all = useMemo(() => {
		if (!busy) held.current = findDuplicates(files);
		return held.current;
	}, [files, busy]);
	const suggestions = useMemo(() => all.filter((group) => !dismissed.has(group.key)), [all, dismissed]);
	const unseen = suggestions.filter((group) => !seen.has(group.key)).length;

	useEffect(() => {
		if (!open || !unseen) return;
		const next = new Set([...seen, ...suggestions.map((group) => group.key)]);
		setSeen(next);
		writeKeys(seenKey, next);
	}, [open, unseen, seen, suggestions, seenKey]);

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

	return { suggestions, unseen, dismiss };
}

/** The display name of a component file: its first export, or the file name. */
export function componentName(component: ProjectComponent | undefined, path: string) {
	return component?.exports[0]?.name ?? path.replace(/^components\//, "").replace(/\.tsx$/, "");
}

/**
 * The editor side of the components panel: project components, duplicate
 * suggestions and "Make component" from them, drops from the panel onto
 * screens, and the selected component. Every change is one undo step.
 */
export function useComponents({ projectPath, files, selection, stateRef, change, undo, busy, open }: Options) {
	const components = useMemo(() => projectComponents(files), [files]);
	const { suggestions, unseen, dismiss } = useSuggestions(projectPath, files, busy, open);

	const selectedPath = selection.length === 1 && isComponentFile(selection[0]!) && selection[0]! in files ? selection[0]! : null;
	const selectedComponent = selectedPath
		? { path: selectedPath, name: componentName(components.find((c) => c.path === selectedPath), selectedPath) }
		: null;

	/** Undo for a toast: only while the change it reports is still the latest step. */
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

	/** "Make component" on a suggestion: returns why it failed, or null. */
	const makeComponent = useCallback(
		(group: DuplicateGroup, name: string): string | null => {
			const current = stateRef.current;
			if (!current) return "The project isn't open.";
			if (busy) return "Wait for the generation to finish.";
			if (!group.occurrences.length) return "Nothing to extract.";
			const result = extractSuggestion(current.files, group, name);
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
		[stateRef, busy, change, undoAction],
	);

	const drop = useCallback(
		({ file, data, hit }: ComponentDrop) => {
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
			// The offsets index the source the frame rendered: when the file changed since (or the
			// newer version failed to load), they point elsewhere, so the drop goes to the root
			const next = insertDrop(source, hitStarts(hit, file, source), insertion);
			if (next === null) {
				const description = parseJsx(source).ok
					? "Its default export doesn't return an element to add it to."
					: "The screen has a syntax error. Fix it in the Code tab first.";
				toast.error(`Couldn't add ${name} to ${frame.name}`, { description });
				return;
			}
			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: next } }), { select: [file] });
			toast(`Added ${name} to ${frame.name}`, { action: undoAction() });
		},
		[stateRef, busy, change, undoAction],
	);

	return { components, suggestions, unseenSuggestions: unseen, dismissSuggestion: dismiss, makeComponent, drop, selectedComponent };
}
