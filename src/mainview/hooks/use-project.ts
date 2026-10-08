import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, onAssetsChanged, onFilesChanged } from "@/lib/rpc";
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
import { projectAssets } from "@/lib/render/assets";
import { projectCandidates } from "@/lib/render/candidates";
import { screenStyles } from "@/lib/render/styles";
import { sameSelection } from "@/lib/selection";
import { type ChatSummary, newChatId, withAppended } from "../../shared/chats";
import { detachComments } from "../../shared/comments";
import { appliedTheme, isComponentFile, reconcileFrames } from "../../shared/project";
import { alternatesOf } from "../../shared/variations";
import type { CanvasDoc, ChatMessage, Device, ProjectFiles } from "../../shared/types";

const SAVE_DELAY_MS = 400;

const WRITE_DELAY_MS = 300;

/** Pending file writes of every open project, so anything that reads the folder can flush them first. */
const pendingWrites = new Set<() => Promise<void>>();

/** Writes the edits still waiting in the debounce; call before the main process reads project files. */
export async function flushProjectFiles() {
	await Promise.all([...pendingWrites].map((flush) => flush()));
}

export type ProjectState = {
	path: string;
	/** `canvas.frames` and `canvas.comments` always mirror `history.present`. */
	canvas: CanvasDoc;
	files: ProjectFiles;
	/** Chat sessions aren't project edits: they stay out of history */
	chatId: string;
	messages: ChatMessage[];
	chats: ChatSummary[];
	history: History;
};

export type ChangeOptions = {
	/** Commits sharing a key coalesce into one undo step (drags, typing bursts). */
	coalesce?: string;
	/** Not part of the undo step. */
	select?: string[];
};

export function useProject(path: string) {
	const [state, setState] = useState<ProjectState | null>(null);
	const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
	const error = failure?.path === path ? failure.message : null;
	const stateRef = useRef<ProjectState | null>(null);
	const diskFiles = useRef<ProjectFiles>({});
	const savedCanvas = useRef<CanvasDoc | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const writeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	/** `diskFiles` is what the folder holds; the difference to the current files is still unwritten. */
	const flushFiles = useCallback(async () => {
		clearTimeout(writeTimer.current);
		const current = stateRef.current;

		if (!current) return;
		const changes = diffFiles(diskFiles.current, current.files);

		if (!changes.length) return;
		diskFiles.current = current.files;
		await api.writeFiles({ path, changes }).catch(reportSaveError);
	}, [path]);

	/** Writes pending files too, so a git commit sees both. Both requests go out synchronously. */
	const flushCanvas = useCallback(async () => {
		const files = flushFiles();
		clearTimeout(saveTimer.current);
		const current = stateRef.current;

		if (!current || current.canvas === savedCanvas.current) return files;
		savedCanvas.current = current.canvas;

		const canvas = {
			...current.canvas,
			alternates: alternatesOf(Object.keys(current.files)),
			updatedAt: new Date().toISOString(),
		};

		await Promise.all([files, api.saveCanvas({ path, canvas }).catch(reportSaveError)]);
	}, [path, flushFiles]);

	const apply = useCallback(
		(next: ProjectState) => {
			stateRef.current = next;
			setState(next);

			if (next.files !== diskFiles.current) {
				clearTimeout(writeTimer.current);
				writeTimer.current = setTimeout(flushFiles, WRITE_DELAY_MS);
			}

			if (next.canvas !== savedCanvas.current) {
				clearTimeout(saveTimer.current);
				saveTimer.current = setTimeout(flushCanvas, SAVE_DELAY_MS);
			}
		},
		[flushFiles, flushCanvas],
	);

	useEffect(() => {
		let cancelled = false;
		api
			.openProject({ path })
			.then((project) => {
				if (cancelled) return;
				const canvas = openedCanvas(project.canvas, project.files);
				diskFiles.current = project.files;
				savedCanvas.current = project.canvas;
				// One Tailwind build for every screen, before the first frame syncs (decision 0002)
				screenStyles.reset(projectCandidates(project.files));
				projectAssets.reset(project.assets ?? {});
				apply({
					path: project.path,
					canvas,
					files: project.files,
					chatId: project.chatId,
					messages: project.messages,
					chats: project.chats,
					history: createHistory(snapshotOf(canvas, project.files)),
				});
			})
			.catch((reason) => {
				if (!cancelled) setFailure({ path, message: reason instanceof Error ? reason.message : String(reason) });
			});

		pendingWrites.add(flushFiles);

		// External edits are folded into every snapshot (see `rebase`) so undo/redo never reverts them.
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

		// Images aren't project files: they never enter history (decision 0010)
		const unsubscribeAssets = onAssetsChanged((message) => {
			if (!cancelled && message.path === path) projectAssets.apply(message.changes);
		});

		return () => {
			cancelled = true;
			unsubscribe();
			unsubscribeAssets();
			// Covers on the home screen mustn't find this project's images
			projectAssets.reset({});
			pendingWrites.delete(flushFiles);
			// The pending writes go out before closeProject stops the watcher
			void flushCanvas();
			api.closeProject({ path }).catch(() => {});
		};
	}, [path, apply, flushFiles, flushCanvas]);

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

	/** One undo step; pass a `coalesce` key to make a typing burst one step. */
	const setMeta = useCallback(
		(patch: { name?: string; device?: Device }, options?: ChangeOptions) =>
			change((snapshot) => {
				const name = patch.name ?? snapshot.name;
				const device = patch.device ?? snapshot.device;

				return name === snapshot.name && device === snapshot.device ? snapshot : { ...snapshot, name, device };
			}, options),
		[change],
	);

	const addMessages = useCallback(
		(messages: ChatMessage[]) => {
			const current = stateRef.current;

			if (!current || !messages.length) return;
			const all = [...current.messages, ...messages];
			apply({ ...current, messages: all, chats: withAppended(current.chats, current.chatId, all) });
			api.appendMessages({ path, chatId: current.chatId, messages }).catch(reportSaveError);
		},
		[apply, path],
	);

	/** Nothing is written until its first message */
	const newChat = useCallback(() => {
		const current = stateRef.current;

		if (current && current.messages.length) apply({ ...current, chatId: newChatId(), messages: [] });
	}, [apply]);

	const openChat = useCallback(
		async (chatId: string) => {
			if (stateRef.current?.chatId === chatId) return;
			const messages = await api.openChat({ path, chatId });
			const current = stateRef.current;

			if (current) apply({ ...current, chatId, messages });
		},
		[apply, path],
	);

	/** Deleting the open chat leaves an empty one in its place */
	const deleteChat = useCallback(
		async (chatId: string) => {
			await api.deleteChat({ path, chatId });
			const current = stateRef.current;

			if (!current) return;
			const chats = current.chats.filter((chat) => chat.id !== chatId);

			if (current.chatId === chatId) apply({ ...current, chats, chatId: newChatId(), messages: [] });
			else apply({ ...current, chats });
		},
		[apply, path],
	);

	/** The folder watcher doesn't watch the canvas file, so external replacements (git pull) need this. */
	const reloadFromDisk = useCallback(async () => {
		await flushFiles();
		clearTimeout(saveTimer.current);
		const project = await api.openProject({ path });
		const current = stateRef.current;

		if (!current) return;
		const canvas = openedCanvas(project.canvas, project.files);
		diskFiles.current = project.files;
		savedCanvas.current = project.canvas;

		if (canUndo(current.history) || canRedo(current.history))
			toast("Reloaded the project from disk", {
				id: "reloaded-from-disk",
				description: "Undo history starts again from here.",
			});

		screenStyles.add(projectCandidates(project.files));
		projectAssets.reset(project.assets ?? {});
		apply({
			...current,
			canvas,
			files: project.files,
			history: createHistory(snapshotOf(canvas, project.files)),
		});
	}, [path, apply, flushFiles]);

	return {
		project: state,
		error,
		flushCanvas,
		flushFiles,
		reloadFromDisk,
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
		newChat,
		openChat,
		deleteChat,
	};
}

function reportSaveError(cause: unknown) {
	console.error("[rabisco] save failed", cause);
	toast.error("Couldn’t save changes", { id: "save-error", description: String(cause) });
}

/** Older projects get DESIGN.md's tokens as applied, saved with the next canvas write */
function openedCanvas(stored: CanvasDoc, files: ProjectFiles): CanvasDoc {
	const canvas = reconcileFrames(stored, files);

	return canvas.theme ? canvas : { ...canvas, theme: appliedTheme(canvas, files) };
}

function snapshotOf(canvas: CanvasDoc, files: ProjectFiles): Snapshot {
	return {
		frames: canvas.frames,
		files,
		comments: canvas.comments ?? [],
		theme: canvas.theme,
		name: canvas.name,
		device: canvas.device,
	};
}

function withHistory(current: ProjectState, history: History, selection?: string[]): ProjectState {
	const { frames, files, comments = current.canvas.comments, theme = current.canvas.theme } = history.present;
	const { name = current.canvas.name, device = current.canvas.device } = history.present;

	// Selection may also hold component files picked in the components panel
	const nextSelection = (selection ?? current.canvas.selection).filter(
		(file) => frames.some((f) => f.file === file) || (isComponentFile(file) && file in files),
	);

	const canvas =
		frames === current.canvas.frames &&
		comments === current.canvas.comments &&
		theme === current.canvas.theme &&
		name === current.canvas.name &&
		device === current.canvas.device &&
		sameSelection(nextSelection, current.canvas.selection)
			? current.canvas
			: { ...current.canvas, frames, comments, theme, name, device, selection: nextSelection };

	return { ...current, history, files, canvas };
}
