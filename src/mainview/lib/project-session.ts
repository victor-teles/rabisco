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
import type { RabiscoApi } from "@/lib/rpc";
import { sameSelection } from "@/lib/selection";
import type { AssetChange, ProjectAssets } from "../../shared/assets";
import { type ChatSummary, newChatId, withAppended, withMoreMessages } from "../../shared/chats";
import { detachComments } from "../../shared/comments";
import { appliedTheme, isComponentFile, reconcileFrames } from "../../shared/project";
import { alternatesOf } from "../../shared/variations";
import type { CanvasDoc, ChatMessage, Device, FileChange, Project, ProjectFiles } from "../../shared/types";

const SAVE_DELAY_MS = 400;

const WRITE_DELAY_MS = 300;

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

export type SessionView = { state: ProjectState | null; error: string | null };

export type ProjectApi = Pick<
	RabiscoApi,
	"openProject" | "writeFiles" | "saveCanvas" | "appendMessages" | "openChat" | "deleteChat"
>;

export type SessionOptions = {
	path: string;
	api: ProjectApi;
	onSaveError: (cause: unknown) => void;
	writeDelay?: number;
	saveDelay?: number;
};

export type Reloaded = { files: ProjectFiles; assets: ProjectAssets; hadHistory: boolean };

export type ProjectSession = ReturnType<typeof createProjectSession>;

export function createProjectSession({
	path,
	api,
	onSaveError,
	writeDelay = WRITE_DELAY_MS,
	saveDelay = SAVE_DELAY_MS,
}: SessionOptions) {
	let view: SessionView = { state: null, error: null };
	let diskFiles: ProjectFiles = {};
	let savedCanvas: CanvasDoc | null = null;
	let assets: ProjectAssets = {};
	let writeTimer: ReturnType<typeof setTimeout> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let loading: Promise<void> | null = null;
	let closed = false;
	const listeners = new Set<() => void>();

	const ref = {
		get current() {
			return view.state;
		},
	};

	const publish = (next: SessionView) => {
		view = next;

		for (const listener of listeners) listener();
	};

	const state = () => view.state;

	/** `diskFiles` is what the folder holds; the difference to the current files is still unwritten. */
	async function flushFiles(): Promise<boolean> {
		clearTimeout(writeTimer);
		const current = view.state;

		if (closed || !current) return true;
		const changes = diffFiles(diskFiles, current.files);

		if (!changes.length) return true;
		diskFiles = current.files;

		try {
			await api.writeFiles({ path, changes });

			return true;
		} catch (cause) {
			onSaveError(cause);

			return false;
		}
	}

	/** Writes pending files too, so a git commit sees both. Both requests go out synchronously. */
	async function flushCanvas(): Promise<boolean> {
		const files = flushFiles();
		clearTimeout(saveTimer);
		const current = view.state;

		if (closed || !current || current.canvas === savedCanvas) return files;
		savedCanvas = current.canvas;

		const canvas = {
			...current.canvas,
			alternates: alternatesOf(Object.keys(current.files)),
			updatedAt: new Date().toISOString(),
		};

		const saved = api.saveCanvas({ path, canvas }).then(
			() => true,
			(cause) => {
				onSaveError(cause);

				return false;
			},
		);

		const [filesSaved, canvasSaved] = await Promise.all([files, saved]);

		return filesSaved && canvasSaved;
	}

	function apply(next: ProjectState) {
		publish({ ...view, state: next });

		if (closed) return;

		if (next.files !== diskFiles) {
			clearTimeout(writeTimer);
			writeTimer = setTimeout(flushFiles, writeDelay);
		}

		if (next.canvas !== savedCanvas) {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(flushCanvas, saveDelay);
		}
	}

	function opened(project: Project) {
		diskFiles = project.files;
		savedCanvas = project.canvas;
		assets = project.assets ?? {};

		return openedCanvas(project.canvas, project.files);
	}

	function load() {
		loading ??= api.openProject({ path }).then(
			(project) => {
				if (closed) return;
				const canvas = opened(project);

				apply({
					path: project.path,
					canvas,
					files: project.files,
					chatId: project.chatId,
					messages: project.messages,
					chats: project.chats,
					history: createHistory(snapshotOf(canvas, project.files)),
				});
			},
			(reason) => {
				if (!closed) publish({ ...view, error: reason instanceof Error ? reason.message : String(reason) });
			},
		);

		return loading;
	}

	/** External edits are folded into every snapshot (see `rebase`) so undo/redo never reverts them. */
	function filesChanged(changes: FileChange[]) {
		const current = view.state;

		if (closed || !current) return;
		diskFiles = applyFileChanges(diskFiles, changes);

		const reconcile = (snapshot: Snapshot): Snapshot => {
			const canvas = reconcileFrames({ ...current.canvas, frames: snapshot.frames, selection: [] }, snapshot.files);

			if (canvas.frames === snapshot.frames) return snapshot;

			return {
				...snapshot,
				frames: canvas.frames,
				comments: detachComments(snapshot.comments ?? [], snapshot.frames, canvas.frames),
			};
		};

		apply(withHistory(current, rebase(current.history, changes, reconcile)));
	}

	/** Images aren't project files: they never enter history (decision 0010) */
	function assetsChanged(changes: AssetChange[]) {
		const next = { ...assets };

		for (const { src, data } of changes) {
			if (data === null) delete next[src];
			else next[src] = data;
		}

		assets = next;
	}

	function change(recipe: (snapshot: Snapshot) => Snapshot, options: ChangeOptions = {}) {
		const current = view.state;

		if (!current) return;
		const next = nextSnapshot(current.history.present, recipe(current.history.present));
		const history = commit(current.history, next, { coalesce: options.coalesce });

		if (history === current.history && !options.select) return;
		apply(withHistory(current, history, options.select));
	}

	function endStep() {
		const current = view.state;

		if (current && current.history.coalesceKey !== null)
			publish({ ...view, state: { ...current, history: seal(current.history) } });
	}

	function undoStep() {
		const current = view.state;

		if (current && canUndo(current.history)) apply(withHistory(current, undo(current.history)));
	}

	function redoStep() {
		const current = view.state;

		if (current && canRedo(current.history)) apply(withHistory(current, redo(current.history)));
	}

	function setSelection(selection: string[]) {
		const current = view.state;

		if (!current || sameSelection(selection, current.canvas.selection)) return;
		apply(withHistory(current, current.history, selection));
	}

	/** One undo step; pass a `coalesce` key to make a typing burst one step. */
	const setMeta = (patch: { name?: string; device?: Device }, options?: ChangeOptions) =>
		change((snapshot) => {
			const name = patch.name ?? snapshot.name;
			const device = patch.device ?? snapshot.device;

			return name === snapshot.name && device === snapshot.device ? snapshot : { ...snapshot, name, device };
		}, options);

	function addMessages(messages: ChatMessage[], chatId?: string) {
		const current = view.state;

		if (!current || !messages.length) return;
		const target = chatId ?? current.chatId;

		if (target === current.chatId) {
			const all = [...current.messages, ...messages];
			apply({ ...current, messages: all, chats: withAppended(current.chats, target, all) });
		} else apply({ ...current, chats: withMoreMessages(current.chats, target, messages) });

		if (!closed) api.appendMessages({ path, chatId: target, messages }).catch(onSaveError);
	}

	/** Nothing is written until its first message */
	function newChat() {
		const current = view.state;

		if (current && current.messages.length) apply({ ...current, chatId: newChatId(), messages: [] });
	}

	async function openChat(chatId: string) {
		if (view.state?.chatId === chatId) return;
		const messages = await api.openChat({ path, chatId });
		const current = view.state;

		if (current) apply({ ...current, chatId, messages });
	}

	/** Deleting the open chat leaves an empty one in its place */
	async function deleteChat(chatId: string) {
		await api.deleteChat({ path, chatId });
		const current = view.state;

		if (!current) return;
		const chats = current.chats.filter((chat) => chat.id !== chatId);

		if (current.chatId === chatId) apply({ ...current, chats, chatId: newChatId(), messages: [] });
		else apply({ ...current, chats });
	}

	/** The folder watcher doesn't watch the canvas file, so external replacements (git pull) need this. */
	async function reloadFromDisk(): Promise<Reloaded | null> {
		await flushFiles();
		clearTimeout(saveTimer);
		const project = await api.openProject({ path });
		const current = view.state;

		if (!current) return null;
		const canvas = opened(project);
		const hadHistory = canUndo(current.history) || canRedo(current.history);

		apply({
			...current,
			canvas,
			files: project.files,
			history: createHistory(snapshotOf(canvas, project.files)),
		});

		return { files: project.files, assets, hadHistory };
	}

	function close() {
		closed = true;
		clearTimeout(writeTimer);
		clearTimeout(saveTimer);
	}

	return {
		path,
		ref,
		get: () => view,
		state,
		subscribe(listener: () => void) {
			listeners.add(listener);

			return () => void listeners.delete(listener);
		},
		load,
		assets: () => assets,
		filesChanged,
		assetsChanged,
		flushFiles,
		flushCanvas,
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
		reloadFromDisk,
		close,
	};
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
