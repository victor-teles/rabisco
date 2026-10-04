import { existsSync } from "fs";
import { join, resolve } from "path";
import type { CanvasDoc, ChatMessage, Device, FileChange, Project, ProjectSummary } from "../shared/types";
import { migrateLegacyProjects } from "./migrate";
import {
	CANVAS_FILE,
	appendChat,
	assertProjectDir,
	assertProjectFilePath,
	createProjectFolder,
	loadProject,
	writeCanvas,
	writeProjectFiles,
} from "./project-folder";
import { forgetRecent, missingSummary, readRecents, sortRecents, summarizeFolder, touchRecent, writeRecents } from "./recents";
import { ProjectWatcher } from "./watcher";

export type StoreOptions = {
	/** `Utils.paths.documents`; new projects go in `<documents>/Rabisco` */
	documentsDir: string;
	/** `Utils.paths.userData`; holds `recents.json` and legacy `projects/*.json` */
	userDataDir: string;
	moveToTrash: (path: string) => boolean;
	showItemInFolder: (path: string) => void;
	/** Native folder picker; returns the chosen paths */
	pickFolder: () => Promise<string[]>;
	onFilesChanged: (path: string, changes: FileChange[]) => void;
	watchOptions?: ConstructorParameters<typeof ProjectWatcher>[3];
};

/** Project folders, recents and file watching, independent of Electrobun so it can be tested. */
export function createProjectStore(options: StoreOptions) {
	const projectsDir = join(options.documentsDir, "Rabisco");
	const recentsFile = join(options.userDataDir, "recents.json");
	const legacyDir = join(options.userDataDir, "projects");
	const watchers = new Map<string, ProjectWatcher>();
	let migrated = false;

	const recents = () => readRecents(recentsFile);
	const normalize = (path: string) => resolve(path).replace(/\/+$/, "");

	/** Writes only go to folders that are Rabisco projects. */
	function assertProject(path: string) {
		assertProjectDir(path);
		if (!existsSync(join(path, CANVAS_FILE))) throw new Error(`${path} is not a Rabisco project (no ${CANVAS_FILE})`);
	}

	function stopWatching(path: string) {
		watchers.get(path)?.close();
		watchers.delete(path);
	}

	function openProject(rawPath: string): Project {
		const path = normalize(rawPath);
		const project = loadProject(path);
		const watcher = watchers.get(path);
		if (watcher) watcher.reset(project.files);
		else
			watchers.set(
				path,
				new ProjectWatcher(path, project.files, (changes) => options.onFilesChanged(path, changes), options.watchOptions),
			);
		writeRecents(recentsFile, touchRecent(recents(), path));
		return project;
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

		async pickProjectFolder(): Promise<string | null> {
			const [path] = (await options.pickFolder()).filter(Boolean);
			return path ?? null;
		},

		openProject,

		closeProject(path: string) {
			stopWatching(normalize(path));
		},

		createProject(name: string, device: Device): Project {
			return openProject(createProjectFolder(projectsDir, name, device));
		},

		saveCanvas(path: string, canvas: CanvasDoc) {
			assertProject(path);
			writeCanvas(path, { ...canvas, updatedAt: new Date().toISOString() });
		},

		writeFiles(path: string, changes: FileChange[]) {
			assertProject(path);
			for (const change of changes) assertProjectFilePath(change.path);
			const watcher = watchers.get(normalize(path));
			for (const change of changes) watcher?.noteWrite(change.path, change.content);
			writeProjectFiles(path, changes);
		},

		appendMessages(path: string, messages: ChatMessage[]) {
			assertProject(path);
			appendChat(path, messages);
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
			writeRecents(recentsFile, forgetRecent(recents(), normalize(path)));
		},

		revealProject(path: string) {
			options.showItemInFolder(path);
		},

		closeAll() {
			for (const path of [...watchers.keys()]) stopWatching(path);
		},
	};
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
