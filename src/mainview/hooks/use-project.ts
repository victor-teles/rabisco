import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, onFilesChanged } from "@/lib/rpc";
import {
	applyFileChanges,
	canRedo,
	canUndo,
	commit,
	createHistory,
	diffFiles,
	nextSnapshot,
	rebase,
	redo,
	seal,
	undo,
	type History,
	type Snapshot,
} from "@/lib/history";
import { sameSelection } from "@/lib/selection";
import { detachComments } from "../../shared/comments";
import { isComponentFile, reconcileFrames } from "../../shared/project";
import { alternatesOf } from "../../shared/variations";
import type { CanvasDoc, ChatMessage, Device, ProjectFiles } from "../../shared/types";

const SAVE_DELAY_MS = 400;

export type ProjectState = {
	path: string;
	/** `canvas.frames` and `canvas.comments` always mirror `history.present` */
	canvas: CanvasDoc;
	files: ProjectFiles;
	messages: ChatMessage[];
	history: History;
};

export type ChangeOptions = {
	/** Commits sharing a key coalesce into one undo step (drags, typing bursts) */
	coalesce?: string;
	/** Selection after the change; not part of the undo step */
	select?: string[];
};

/**
 * Opens a project folder and owns its state. Frames, files and comments go through an
 * undo history; selection, name, device and chat do not. Every state change is
 * persisted by diffing against what was last written: canvas saves are
 * debounced, file writes are immediate and only contain changed paths.
 */
export function useProject(path: string) {
	const [state, setState] = useState<ProjectState | null>(null);
	// Kept with the path it belongs to, so opening another project starts without one
	const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
	const error = failure?.path === path ? failure.message : null;
	const stateRef = useRef<ProjectState | null>(null);
	// What we believe is on disk, so writes only carry the paths that changed
	const diskFiles = useRef<ProjectFiles>({});
	const savedCanvas = useRef<CanvasDoc | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	const flushCanvas = useCallback(async () => {
		clearTimeout(saveTimer.current);
		const current = stateRef.current;

		if (!current || current.canvas === savedCanvas.current) return;
		savedCanvas.current = current.canvas;

		const canvas = {
			...current.canvas,
			alternates: alternatesOf(Object.keys(current.files)),
			updatedAt: new Date().toISOString(),
		};

		await api.saveCanvas({ path, canvas }).catch(reportSaveError);
	}, [path]);

	/** Swaps in the next state and persists whatever differs from disk. */
	const apply = useCallback(
		(next: ProjectState) => {
			stateRef.current = next;
			setState(next);
			const changes = diffFiles(diskFiles.current, next.files);

			if (changes.length) {
				diskFiles.current = next.files;
				api.writeFiles({ path, changes }).catch(reportSaveError);
			}

			if (next.canvas !== savedCanvas.current) {
				clearTimeout(saveTimer.current);
				saveTimer.current = setTimeout(flushCanvas, SAVE_DELAY_MS);
			}
		},
		[path, flushCanvas],
	);

	useEffect(() => {
		let cancelled = false;
		api
			.openProject({ path })
			.then((project) => {
				if (cancelled) return;
				const canvas = reconcileFrames(project.canvas, project.files);
				diskFiles.current = project.files;
				savedCanvas.current = project.canvas;
				apply({
					path: project.path,
					canvas,
					files: project.files,
					messages: project.messages,
					history: createHistory({ frames: canvas.frames, files: project.files, comments: canvas.comments ?? [] }),
				});
			})
			.catch((reason) => {
				if (!cancelled) setFailure({ path, message: reason instanceof Error ? reason.message : String(reason) });
			});

		// External edits are facts, not steps: they are folded into every
		// snapshot (see `rebase`), so undo/redo never revert them and the
		// stacks stay consistent with the disk.
		const unsubscribe = onFilesChanged((message) => {
			const current = stateRef.current;

			if (cancelled || message.path !== path || !current) return;
			diskFiles.current = applyFileChanges(diskFiles.current, message.changes);

			const reconcile = (snapshot: Snapshot): Snapshot => {
				const canvas = reconcileFrames({ ...current.canvas, frames: snapshot.frames, selection: [] }, snapshot.files);

				if (canvas.frames === snapshot.frames) return snapshot;

				return {
					...snapshot,
					frames: canvas.frames,
					comments: detachComments(snapshot.comments ?? [], snapshot.frames, canvas.frames),
				};
			};

			apply(withHistory(current, rebase(current.history, message.changes, reconcile)));
		});

		return () => {
			cancelled = true;
			unsubscribe();
			flushCanvas();
			api.closeProject({ path }).catch(() => {});
		};
	}, [path, apply, flushCanvas]);

	/** One undoable change to frames, files and/or comments. */
	const change = useCallback(
		(recipe: (snapshot: Snapshot) => Snapshot, options: ChangeOptions = {}) => {
			const current = stateRef.current;

			if (!current) return;
			const next = nextSnapshot(current.history.present, recipe(current.history.present));
			const history = commit(current.history, next, { coalesce: options.coalesce });

			if (history === current.history && !options.select) return;
			apply(withHistory(current, history, options.select));
		},
		[apply],
	);

	/** Closes the current coalescing run (pointer up, input blur). */
	const endStep = useCallback(() => {
		const current = stateRef.current;

		if (current && current.history.coalesceKey !== null) {
			stateRef.current = { ...current, history: seal(current.history) };
			setState(stateRef.current);
		}
	}, []);

	const undoStep = useCallback(() => {
		const current = stateRef.current;

		if (current && canUndo(current.history)) apply(withHistory(current, undo(current.history)));
	}, [apply]);

	const redoStep = useCallback(() => {
		const current = stateRef.current;

		if (current && canRedo(current.history)) apply(withHistory(current, redo(current.history)));
	}, [apply]);

	const setSelection = useCallback(
		(selection: string[]) => {
			const current = stateRef.current;

			if (!current || sameSelection(selection, current.canvas.selection)) return;
			apply(withHistory(current, current.history, selection));
		},
		[apply],
	);

	/** Project-level fields; not undoable. */
	const setMeta = useCallback(
		(patch: { name?: string; device?: Device }) => {
			const current = stateRef.current;

			if (current) apply({ ...current, canvas: { ...current.canvas, ...patch } });
		},
		[apply],
	);

	const addMessages = useCallback(
		(messages: ChatMessage[]) => {
			const current = stateRef.current;

			if (!current || !messages.length) return;
			apply({ ...current, messages: [...current.messages, ...messages] });
			api.appendMessages({ path, messages }).catch(reportSaveError);
		},
		[apply, path],
	);

	/**
	 * Reads `rabisco.json` and the files again after something outside the editor
	 * replaced them (a git pull). The folder watcher doesn't watch the canvas file,
	 * and history starts over, as when the project opens.
	 */
	const reloadFromDisk = useCallback(async () => {
		clearTimeout(saveTimer.current);
		const project = await api.openProject({ path });
		const current = stateRef.current;

		if (!current) return;
		const canvas = reconcileFrames(project.canvas, project.files);
		diskFiles.current = project.files;
		savedCanvas.current = project.canvas;
		apply({
			...current,
			canvas,
			files: project.files,
			history: createHistory({ frames: canvas.frames, files: project.files, comments: canvas.comments ?? [] }),
		});
	}, [path, apply]);

	return {
		project: state,
		error,
		/** Writes a pending canvas save now */
		flushCanvas,
		reloadFromDisk,
		/** Latest state, for callbacks that run after an await */
		stateRef,
		canUndo: state ? canUndo(state.history) : false,
		canRedo: state ? canRedo(state.history) : false,
		change,
		endStep,
		undo: undoStep,
		redo: redoStep,
		setSelection,
		setMeta,
		addMessages,
	};
}

function reportSaveError(cause: unknown) {
	console.error("[rabisco] save failed", cause);
	toast.error("Couldn’t save changes", { id: "save-error", description: String(cause) });
}

/** Rebuilds the derived fields after the history moved. */
function withHistory(current: ProjectState, history: History, selection?: string[]): ProjectState {
	const { frames, files, comments = current.canvas.comments } = history.present;

	// Selection holds frames, plus at most component files (selected in the components panel), while they exist
	const nextSelection = (selection ?? current.canvas.selection).filter(
		(file) => frames.some((f) => f.file === file) || (isComponentFile(file) && file in files),
	);

	const canvas =
		frames === current.canvas.frames &&
		comments === current.canvas.comments &&
		sameSelection(nextSelection, current.canvas.selection)
			? current.canvas
			: { ...current.canvas, frames, comments, selection: nextSelection };

	return { ...current, history, files, canvas };
}
