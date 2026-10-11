import { existsSync } from "fs";
import { join, resolve } from "path";
import type { Attachment } from "../shared/ai/contract";
import type { AssetChange } from "../shared/assets";
import type { BackupReason, SavedHistory } from "../shared/saved-history";
import type { StyleId } from "../shared/context/styles";
import type {
	CanvasDoc,
	ChatMessage,
	Device,
	FileChange,
	Project,
	ProjectFiles,
	ProjectSummary,
	ScreenSource,
} from "../shared/types";
import { AssetTracker, importImage, saveMoodboardImage } from "./assets";
import { migrateLegacyProjects } from "./migrate";
import {
	CANVAS_FILE,
	appendChat,
	assertProjectDir,
	assertProjectFilePath,
	chatPath,
	createProjectFolder,
	loadProject,
	readCanvas,
	readChat,
	writeCanvas,
	writeProjectFiles,
} from "./project-folder";
import {
	forgetRecent,
	missingSummary,
	readCover,
	readRecents,
	sortRecents,
	summarizeFolder,
	touchRecent,
	writeRecents,
} from "./recents";
import { backupProject, deleteSavedHistory, readSavedHistory, writeSavedHistory } from "./saved-history";
import { ProjectWatcher } from "./watcher";

export type StoreOptions = {
	/** New projects go in `<documents>/Rabisco` */
	documentsDir: string;
	/** Holds `recents.json` and legacy `projects/*.json` */
	userDataDir: string;
	moveToTrash: (path: string) => boolean;
	showItemInFolder: (path: string) => void;
	pickFolder: () => Promise<string[]>;
	onFilesChanged: (path: string, changes: FileChange[]) => void;
	onAssetsChanged?: (path: string, changes: AssetChange[]) => void;
	onCanvasChanged?: (path: string, canvas: CanvasDoc) => void;
	watchOptions?: ConstructorParameters<typeof ProjectWatcher>[3];
};

export function createProjectStore(options: StoreOptions) {
	const projectsDir = join(options.documentsDir, "Rabisco");
	const recentsFile = join(options.userDataDir, "recents.json");
	const legacyDir = join(options.userDataDir, "projects");
	const watchers = new Map<string, ProjectWatcher>();
	const assetTrackers = new Map<string, AssetTracker>();
	let migrated = false;

	const recents = () => readRecents(recentsFile);
	const normalize = (path: string) => resolve(path).replace(/\/+$/, "");

	function assertProject(path: string) {
		assertProjectDir(path);

		if (!existsSync(join(path, CANVAS_FILE))) throw new Error(`${path} is not a Rabisco project (no ${CANVAS_FILE})`);
	}

	function stopWatching(path: string) {
		watchers.get(path)?.close();
		watchers.delete(path);
		assetTrackers.delete(path);
	}

	function pushCanvas(path: string) {
		try {
			const canvas = readCanvas(path);

			if (canvas) options.onCanvasChanged?.(path, canvas);
		} catch (error) {
			console.warn(`Ignored an unreadable ${CANVAS_FILE} change: ${error instanceof Error ? error.message : error}`);
		}
	}

	function pushAssets(path: string) {
		const changes = assetTrackers.get(path)?.changes() ?? [];

		if (changes.length) options.onAssetsChanged?.(path, changes);
	}

	function openProject(rawPath: string): Project {
		const path = normalize(rawPath);
		const project = loadProject(path, () => backupProject(options.userDataDir, path, "migration"));
		const watcher = watchers.get(path);
		const assets = assetTrackers.get(path) ?? new AssetTracker(path);
		assetTrackers.set(path, assets);

		if (watcher) watcher.reset(project.files);
		else
			watchers.set(
				path,
				new ProjectWatcher(path, project.files, (changes) => options.onFilesChanged(path, changes), {
					...options.watchOptions,
					onAssets: () => pushAssets(path),
					onCanvas: () => pushCanvas(path),
				}),
			);
		writeRecents(recentsFile, touchRecent(recents(), path));

		return { ...project, assets: assets.load() };
	}

	return {
		projectsDir,

		listRecents(): ProjectSummary[] {
			if (!migrated) {
				migrated = true;
				const added = migrateLegacyProjects(legacyDir, projectsDir);

				if (added.length) writeRecents(recentsFile, sortRecents([...recents(), ...added]));
			}

			return sortRecents(recents()).map((entry) => {
				try {
					return summarizeFolder(entry);
				} catch {
					return missingSummary(entry);
				}
			});
		},

		/** Only for recent projects, so the webview can't read other folders through it. */
		loadCover(path: string): ScreenSource | null {
			if (!recents().some((entry) => entry.path === path)) return null;

			try {
				return readCover(path);
			} catch {
				return null;
			}
		},

		async pickProjectFolder(): Promise<string | null> {
			const [path] = (await options.pickFolder()).filter(Boolean);

			return path ?? null;
		},

		openProject,

		closeProject(path: string) {
			stopWatching(normalize(path));
		},

		createProject(name: string, device: Device, style?: StyleId | null): Project {
			return openProject(createProjectFolder(projectsDir, name, device, style));
		},

		saveCanvas(path: string, canvas: CanvasDoc) {
			assertProject(path);
			const text = writeCanvas(path, { ...canvas, updatedAt: new Date().toISOString() });
			watchers.get(normalize(path))?.noteCanvas(text);
		},

		writeFiles(path: string, changes: FileChange[]) {
			assertProject(path);

			for (const change of changes) assertProjectFilePath(change.path);
			const watcher = watchers.get(normalize(path));

			for (const change of changes) watcher?.noteWrite(change.path, change.content);
			writeProjectFiles(path, changes);
		},

		/** Pushes the new image right away instead of waiting for the watcher */
		importImage(path: string, file: string): string {
			assertProject(path);
			const src = importImage(path, file);
			pushAssets(normalize(path));

			return src;
		},

		addMoodboardImage(path: string, name: string, mediaType: Attachment["mediaType"], data: string): string {
			assertProject(path);
			const src = saveMoodboardImage(path, name, mediaType, data);
			pushAssets(normalize(path));

			return src;
		},

		appendMessages(path: string, chatId: string, messages: ChatMessage[]) {
			assertProject(path);
			appendChat(path, chatId, messages);
		},

		openChat(path: string, chatId: string) {
			assertProject(path);

			return readChat(path, chatId);
		},

		/** To the trash, like a project: a chat can hold the only copy of a prompt */
		deleteChat(path: string, chatId: string) {
			assertProject(path);
			const file = chatPath(path, chatId);

			if (existsSync(file) && !options.moveToTrash(file)) throw new Error(`Could not move ${file} to the trash`);
		},

		readHistory(path: string): SavedHistory | null {
			return readSavedHistory(options.userDataDir, normalize(path));
		},

		writeHistory(path: string, history: SavedHistory) {
			assertProject(path);
			writeSavedHistory(options.userDataDir, normalize(path), history);
		},

		backupProject(path: string, reason: BackupReason, files: ProjectFiles, canvas: CanvasDoc) {
			assertProject(path);

			return backupProject(options.userDataDir, normalize(path), reason, { files, canvas });
		},

		removeRecent(path: string) {
			stopWatching(normalize(path));
			writeRecents(recentsFile, forgetRecent(recents(), normalize(path)));
		},

		deleteProject(path: string) {
			stopWatching(normalize(path));

			if (existsSync(path)) {
				assertProject(path);

				if (!options.moveToTrash(path)) throw new Error(`Could not move ${path} to the trash`);
			}

			deleteSavedHistory(options.userDataDir, normalize(path));

			writeRecents(recentsFile, forgetRecent(recents(), normalize(path)));
		},

		revealProject(path: string) {
			options.showItemInFolder(path);
		},

		closeAll() {
			for (const path of watchers.keys()) stopWatching(path);
		},
	};
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
