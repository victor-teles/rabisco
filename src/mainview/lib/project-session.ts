import {
	applyAssetWrites,
	applyFileChanges,
	canRedo,
	canUndo,
	commit,
	createHistory,
	diffAssets,
	diffFiles,
	nextSnapshot,
	rebase,
	rebaseAssets,
	redo,
	seal,
	undo,
	type History,
	type Snapshot,
} from "@/lib/history";
import { rebaseCanvas } from "@/lib/canvas-rebase";
import type { RabiscoApi } from "@/lib/rpc";
import { packHistory, resumeHistory, unpackHistory } from "@/lib/saved-history";
import { onOpenPage } from "@/lib/pages";
import { sameSelection } from "@/lib/selection";
import { type SessionVersion, withVersion } from "@/lib/versions";
import type { AssetChange, AssetDigests, AssetWrite, ProjectAssets } from "../../shared/assets";
import { type ChatSummary, newChatId, withAppended, withMoreMessages } from "../../shared/chats";
import { detachComments } from "../../shared/comments";
import { openPage } from "../../shared/pages";
import { appliedTheme, isComponentFile, reconcileFrames } from "../../shared/project";
import { alternatesOf } from "../../shared/variations";
import type { CanvasDoc, ChatMessage, Device, FileChange, Project, ProjectFiles } from "../../shared/types";

const SAVE_DELAY_MS = 400;

const WRITE_DELAY_MS = 300;

const HISTORY_DELAY_MS = 2000;

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
	versions: SessionVersion[];
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
	| "openProject"
	| "writeFiles"
	| "saveCanvas"
	| "appendMessages"
	| "openChat"
	| "deleteChat"
	| "readHistory"
	| "writeHistory"
	| "writeAssets"
	| "backupProject"
>;

export type SessionOptions = {
	path: string;
	api: ProjectApi;
	onSaveError: (cause: unknown) => void;
	onBackup?: (dir: string) => void;
	writeDelay?: number;
	saveDelay?: number;
	historyDelay?: number;
};

export type Reloaded = { files: ProjectFiles; assets: ProjectAssets; hadHistory: boolean; backup: string | null };

type Steps = { history: History; versions: SessionVersion[] };

export type ProjectSession = ReturnType<typeof createProjectSession>;

export function createProjectSession({
	path,
	api,
	onSaveError,
	onBackup,
	writeDelay = WRITE_DELAY_MS,
	saveDelay = SAVE_DELAY_MS,
	historyDelay = HISTORY_DELAY_MS,
}: SessionOptions) {
	let view: SessionView = { state: null, error: null };
	let diskFiles: ProjectFiles = {};
	let savedCanvas: CanvasDoc | null = null;
	let assets: ProjectAssets = {};
	let diskAssets: AssetDigests = {};
	let assetTimer: ReturnType<typeof setTimeout> | undefined;
	let writeTimer: ReturnType<typeof setTimeout> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let historyTimer: ReturnType<typeof setTimeout> | undefined;
	let seenSteps: Steps | null = null;
	let savedSteps: Steps | null = null;
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
		const before = diskFiles;
		diskFiles = current.files;

		try {
			await api.writeFiles({ path, changes });

			return true;
		} catch (cause) {
			if (diskFiles === current.files) diskFiles = before;
			onSaveError(cause);

			return false;
		}
	}

	async function flushAssets(): Promise<boolean> {
		clearTimeout(assetTimer);
		const current = view.state;
		const target = current?.history.present.assets;

		if (closed || !current || !target) return true;
		const writes = diffAssets(diskAssets, target);
		const before = diskAssets;
		diskAssets = target;

		if (!writes.length) return true;

		try {
			const { missing } = await api.writeAssets({ path, writes });

			if (missing.length) lostAssets(missing);

			return true;
		} catch (cause) {
			if (diskAssets === target) diskAssets = before;
			onSaveError(cause);

			return false;
		}
	}

	function lostAssets(missing: string[]) {
		const lost: AssetWrite[] = missing.map((src) => ({ src, digest: null }));
		diskAssets = applyAssetWrites(diskAssets, lost);
		const current = view.state;

		if (current) apply(withHistory(current, rebaseAssets(current.history, lost)));
		onSaveError(new Error(`Couldn't bring back ${missing.join(", ")}: no saved copy is left.`));
	}

	/** Writes pending files too, so a git commit sees both. Both requests go out synchronously. */
	async function flushCanvas(): Promise<boolean> {
		const files = Promise.all([flushFiles(), flushAssets()]).then((saved) => saved.every(Boolean));
		void flushHistory();
		clearTimeout(saveTimer);
		const current = view.state;

		if (closed || !current || current.canvas === savedCanvas) return files;
		const before = savedCanvas;
		savedCanvas = current.canvas;

		const canvas = {
			...current.canvas,
			alternates: alternatesOf(Object.keys(current.files)),
			updatedAt: new Date().toISOString(),
		};

		const saved = api.saveCanvas({ path, canvas }).then(
			() => true,
			(cause) => {
				if (savedCanvas === current.canvas) savedCanvas = before;
				onSaveError(cause);

				return false;
			},
		);

		const [filesSaved, canvasSaved] = await Promise.all([files, saved]);

		return filesSaved && canvasSaved;
	}

	function flushHistory(): Promise<boolean> {
		clearTimeout(historyTimer);
		const current = view.state;

		if (closed || !current || (savedSteps && sameSteps(savedSteps, current))) return Promise.resolve(true);
		const steps = { history: current.history, versions: current.versions };

		savedSteps = steps;

		return api.writeHistory({ path, history: packHistory(steps.history, steps.versions, new Date()) }).then(
			() => true,
			(cause) => {
				if (savedSteps === steps) savedSteps = null;
				onSaveError(cause);

				return false;
			},
		);
	}

	function scheduleHistory(next: Steps) {
		if (closed || (seenSteps && seenSteps.history === next.history && seenSteps.versions === next.versions)) return;
		seenSteps = { history: next.history, versions: next.versions };
		clearTimeout(historyTimer);
		historyTimer = setTimeout(flushHistory, historyDelay);
	}

	function backupOf(state: ProjectState, snapshot: Snapshot): Promise<string | null> {
		const canvas = { ...state.canvas, ...canvasFields(snapshot) };

		return api.backupProject({ path, reason: "reload", files: snapshot.files, canvas }).then(
			({ dir }) => dir,
			(cause) => {
				onSaveError(cause);

				return null;
			},
		);
	}

	function apply(next: ProjectState) {
		publish({ ...view, state: next });

		if (closed) return;
		scheduleHistory(next);

		if (next.files !== diskFiles) {
			clearTimeout(writeTimer);
			writeTimer = setTimeout(flushFiles, writeDelay);
		}

		if (next.history.present.assets && next.history.present.assets !== diskAssets) {
			clearTimeout(assetTimer);
			assetTimer = setTimeout(flushAssets, writeDelay);
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
		diskAssets = project.assetDigests ?? {};

		return openedCanvas(project.canvas, project.files);
	}

	function load() {
		loading ??= Promise.all([api.openProject({ path }), api.readHistory({ path }).catch(() => null)]).then(
			([project, saved]) => {
				if (closed) return;
				const canvas = opened(project);
				const disk = snapshotOf(canvas, project.files, project.assetDigests);
				const restored = saved && unpackHistory(saved);
				const resumed = restored && resumeHistory(restored.history, disk, reconcileWith(canvas));
				const history = resumed ? resumed.history : createHistory(disk);
				const versions = restored ? restored.versions : [];

				const next: ProjectState = {
					path: project.path,
					canvas,
					files: project.files,
					chatId: project.chatId,
					messages: project.messages,
					chats: project.chats,
					history,
					versions,
				};

				seenSteps = { history, versions };
				savedSteps = seenSteps;
				apply(next);

				if (project.backup) onBackup?.(project.backup);

				if (restored && resumed?.dropped)
					void backupOf(next, restored.history.present).then((dir) => dir && onBackup?.(dir));
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
		apply(withHistory(current, rebase(current.history, changes, reconcileWith(current.canvas))));
	}

	function canvasChanged(disk: CanvasDoc) {
		const current = view.state;

		if (closed || !current || !savedCanvas) return;
		const clean = current.canvas === savedCanvas;
		const next = withHistory(current, rebaseCanvas(current.history, savedCanvas, disk, reconcileWith(current.canvas)));
		savedCanvas = clean ? next.canvas : disk;
		apply(next);
	}

	/** Images changed outside Rabisco are folded into history like files (decision 0034) */
	function assetsChanged(changes: AssetChange[]) {
		const next = { ...assets };
		const writes: AssetWrite[] = [];

		for (const { src, data, digest } of changes) {
			if (data === null) {
				delete next[src];
				writes.push({ src, digest: null });
			} else {
				next[src] = data;

				if (digest) writes.push({ src, digest });
			}
		}

		assets = next;

		const external = writes.filter(({ src, digest }) =>
			digest === null ? src in diskAssets : diskAssets[src] !== digest,
		);

		diskAssets = applyAssetWrites(diskAssets, writes);
		const current = view.state;

		if (!closed && current && external.length) apply(withHistory(current, rebaseAssets(current.history, external)));
	}

	function change(recipe: (snapshot: Snapshot) => Snapshot, options: ChangeOptions = {}) {
		const current = view.state;

		if (!current) return;
		const present = current.history.present;
		const next = nextSnapshot(present, onOpenPage(present, recipe(present), openPage(current.canvas)));
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

	/** Not an undo step, as in Figma */
	function setPage(page: string) {
		const current = view.state;

		if (!current || openPage(current.canvas) === page) return;
		apply({ ...current, canvas: { ...current.canvas, page } });
	}

	/** One undo step; pass a `coalesce` key to make a typing burst one step. */
	const setMeta = (patch: { name?: string; device?: Device }, options?: ChangeOptions) =>
		change((snapshot) => {
			const name = patch.name ?? snapshot.name;
			const device = patch.device ?? snapshot.device;

			return name === snapshot.name && device === snapshot.device ? snapshot : { ...snapshot, name, device };
		}, options);

	function addVersion(version: SessionVersion) {
		const current = view.state;

		if (current) publish({ ...view, state: { ...current, versions: withVersion(current.versions, version) } });
	}

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

	/** After a git pull: the files, canvas and images all come back from the folder at once. */
	async function reloadFromDisk(): Promise<Reloaded | null> {
		await Promise.all([flushFiles(), flushAssets()]);
		clearTimeout(saveTimer);
		await flushHistory();
		const project = await api.openProject({ path });
		const current = view.state;

		if (!current) return null;
		const canvas = opened(project);
		const disk = snapshotOf(canvas, project.files, project.assetDigests);
		const resumed = resumeHistory(current.history, disk, reconcileWith(canvas));
		const backup = resumed.dropped ? backupOf(current, current.history.present) : null;

		apply({ ...current, canvas, files: project.files, history: resumed.history });

		if (project.backup) onBackup?.(project.backup);

		return { files: project.files, assets, hadHistory: resumed.dropped, backup: await backup };
	}

	function close() {
		closed = true;
		clearTimeout(writeTimer);
		clearTimeout(assetTimer);
		clearTimeout(saveTimer);
		clearTimeout(historyTimer);
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
		canvasChanged,
		assetsChanged,
		flushFiles,
		flushCanvas,
		flushHistory,
		change,
		endStep,
		undo: undoStep,
		redo: redoStep,
		setSelection,
		setPage,
		setMeta,
		addVersion,
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

function reconcileWith(current: CanvasDoc) {
	return (snapshot: Snapshot): Snapshot => {
		const canvas = reconcileFrames({ ...current, frames: snapshot.frames, selection: [] }, snapshot.files);

		if (canvas.frames === snapshot.frames) return snapshot;

		return {
			...snapshot,
			frames: canvas.frames,
			comments: detachComments(snapshot.comments ?? [], snapshot.frames, canvas.frames),
		};
	};
}

function canvasFields(snapshot: Snapshot) {
	const { frames, comments, theme, name, device, locks, sections, images, annotations, pages } = snapshot;
	const fields: Partial<CanvasDoc> = { frames, comments, theme, locks, sections, images, annotations, pages };

	if (name !== undefined) fields.name = name;

	if (device !== undefined) fields.device = device;

	return fields;
}

const sameSteps = (saved: Steps, current: Steps) =>
	saved.versions === current.versions &&
	saved.history.present === current.history.present &&
	saved.history.past.length === current.history.past.length &&
	saved.history.future.length === current.history.future.length &&
	saved.history.past.at(-1) === current.history.past.at(-1) &&
	saved.history.future[0] === current.history.future[0];

function snapshotOf(canvas: CanvasDoc, files: ProjectFiles, assets?: AssetDigests): Snapshot {
	return {
		assets,
		frames: canvas.frames,
		files,
		comments: canvas.comments ?? [],
		theme: canvas.theme,
		name: canvas.name,
		device: canvas.device,
		locks: canvas.locks,
		sections: canvas.sections,
		images: canvas.images,
		annotations: canvas.annotations,
		pages: canvas.pages,
	};
}

function withHistory(current: ProjectState, history: History, selection?: string[]): ProjectState {
	const { frames, files, comments = current.canvas.comments, theme = current.canvas.theme } = history.present;
	const { name = current.canvas.name, device = current.canvas.device } = history.present;
	const { locks, sections = current.canvas.sections, images = current.canvas.images } = history.present;
	const { annotations, pages } = history.present;

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
		locks === current.canvas.locks &&
		sections === current.canvas.sections &&
		images === current.canvas.images &&
		annotations === current.canvas.annotations &&
		pages === current.canvas.pages &&
		sameSelection(nextSelection, current.canvas.selection)
			? current.canvas
			: {
					...current.canvas,
					frames,
					comments,
					theme,
					name,
					device,
					locks,
					sections,
					images,
					annotations,
					pages,
					selection: nextSelection,
				};

	return { ...current, history, files, canvas };
}
