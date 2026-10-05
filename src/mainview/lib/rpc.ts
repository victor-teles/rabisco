import { Electroview } from "electrobun/view";
import { normalizeComments } from "../../shared/comments";
import { CONTEXT_TEMPLATES } from "../../shared/context/templates";
import { emptyCanvas, isProjectFile, reconcileFrames, summarizeProject } from "../../shared/project";
import type { RabiscoRPC } from "../../shared/rpc";
import type {
	CanvasDoc,
	ChatMessage,
	FileChange,
	GenerationEventMessage,
	Project,
	ProjectFiles,
} from "../../shared/types";
import { createBrowserGenerator } from "./browser-generate";

type Requests = RabiscoRPC["bun"]["requests"];

/** Promise-based view of every request the main process handles. */
export type RabiscoApi = {
	[K in keyof Requests]: (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;
};

export type FilesChanged = RabiscoRPC["webview"]["messages"]["filesChanged"];

function listenerSet<T>() {
	const listeners = new Set<(value: T) => void>();

	return {
		add(listener: (value: T) => void) {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		},
		emit: (value: T) => listeners.forEach((listener) => listener(value)),
	};
}

const generationEvents = listenerSet<GenerationEventMessage>();

const fileChanges = listenerSet<FilesChanged>();

/** Events of running generations. Returns an unsubscribe function. */
export const onGenerationEvent = generationEvents.add;

/** Files edited on disk outside Rabisco. Returns an unsubscribe function. */
export const onFilesChanged = fileChanges.add;

function createElectrobunApi(): RabiscoApi {
	const rpc = Electroview.defineRPC<RabiscoRPC>({
		// Generations can run for minutes with agentic providers
		maxRequestTime: 15 * 60_000,
		handlers: {
			requests: {},
			messages: { generationEvent: generationEvents.emit, filesChanged: fileChanges.emit },
		},
	});

	new Electroview({ rpc });

	// Every request maps 1:1 to the main-process handler of the same name
	return rpc.request;
}

/**
 * Lets the UI run in a regular browser (`hutch run hmr` + open localhost:5173)
 * by mirroring the main-process handlers on top of localStorage. A project's
 * path is `browser://<uuid>`; there is no folder picker and no file watching.
 */
type Stored = { canvas: CanvasDoc; files: ProjectFiles; messages: ChatMessage[] };

/** Only Rabisco writes these keys: a record with a canvas is a stored project. */
function isStored(value: unknown): value is Stored {
	return typeof value === "object" && value !== null && "canvas" in value && Boolean(value.canvas);
}

function createBrowserApi(): RabiscoApi {
	type Recent = { path: string; openedAt: string };

	const ok = { ok: true } as const;
	const key = (path: string) => `rabisco:project:${path}`;
	const RECENTS = "rabisco:recents";

	const read = (path: string): Stored | null => {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(key(path)) ?? "null");

			return isStored(stored) ? stored : null;
		} catch {
			return null;
		}
	};

	const write = (path: string, stored: Stored) => localStorage.setItem(key(path), JSON.stringify(stored));

	const mustRead = (path: string) => {
		const stored = read(path);

		if (!stored) throw new Error(`Project not found: ${path}`);

		return stored;
	};

	const readRecents = (): Recent[] => {
		try {
			const list = JSON.parse(localStorage.getItem(RECENTS) ?? "[]");

			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	};

	const writeRecents = (list: Recent[]) =>
		localStorage.setItem(RECENTS, JSON.stringify([...list].sort((a, b) => b.openedAt.localeCompare(a.openedAt))));

	const forget = (path: string) => writeRecents(readRecents().filter((r) => r.path !== path));

	async function openProject({ path }: { path: string }): Promise<Project> {
		const stored = mustRead(path);
		// Projects stored before comments existed have none
		const normalized = { ...stored.canvas, comments: normalizeComments(stored.canvas.comments) };
		const canvas = reconcileFrames(normalized, stored.files);

		if (canvas !== normalized) write(path, { ...stored, canvas });
		writeRecents([{ path, openedAt: new Date().toISOString() }, ...readRecents().filter((r) => r.path !== path)]);

		return { path, canvas, files: stored.files, messages: stored.messages };
	}

	function applyChanges(files: ProjectFiles, changes: FileChange[]) {
		const next = { ...files };

		for (const { path, content } of changes) {
			if (!isProjectFile(path))
				throw new Error(
					`Rabisco can only write screens/*.tsx, components/*.tsx, PRODUCT.md and DESIGN.md (got "${path}")`,
				);

			if (content === null) delete next[path];
			else next[path] = content;
		}

		return next;
	}

	const generator = createBrowserGenerator(generationEvents.emit, (path) => mustRead(path).files);

	return {
		async listRecents() {
			return readRecents().map((recent) => {
				const stored = read(recent.path);

				if (!stored) {
					return {
						path: recent.path,
						name: "Missing project",
						device: "mobile",
						updatedAt: recent.openedAt,
						screenCount: 0,
						cover: null,
						missing: true,
					};
				}

				return summarizeProject(recent.path, reconcileFrames(stored.canvas, stored.files), stored.files);
			});
		},
		async pickProjectFolder() {
			return null;
		},
		openProject,
		async closeProject() {
			return ok;
		},
		async createProject({ name, device }) {
			const path = `browser://${crypto.randomUUID()}`;
			// Same starting point as the desktop app: both context files, as templates
			write(path, {
				canvas: emptyCanvas(name.trim() || "Untitled", device),
				files: { ...CONTEXT_TEMPLATES },
				messages: [],
			});

			return openProject({ path });
		},
		async saveCanvas({ path, canvas }) {
			write(path, { ...mustRead(path), canvas: { ...canvas, updatedAt: new Date().toISOString() } });

			return ok;
		},
		async writeFiles({ path, changes }) {
			const stored = mustRead(path);
			write(path, { ...stored, files: applyChanges(stored.files, changes) });

			return ok;
		},
		async appendMessages({ path, messages }) {
			const stored = mustRead(path);
			write(path, { ...stored, messages: [...stored.messages, ...messages] });

			return ok;
		},
		async removeRecent({ path }) {
			forget(path);

			return ok;
		},
		async deleteProject({ path }) {
			localStorage.removeItem(key(path));
			forget(path);

			return ok;
		},
		async revealProject() {
			return ok;
		},
		async openExternal({ url }) {
			window.open(url, "_blank", "noopener");

			return ok;
		},
		async importContext() {
			throw new Error("Import needs the desktop app");
		},
		async pickExportFolder() {
			return "browser://downloads";
		},
		// No file system here: a single file downloads, a folder needs the desktop app
		async writeExport({ dir, files }) {
			const [file] = files;

			if (!file || files.length !== 1) throw new Error("Exporting a folder needs the desktop app");

			const bytes =
				file.encoding === "base64" ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)) : file.content;

			const link = document.createElement("a");
			link.href = URL.createObjectURL(new Blob([bytes]));
			link.download = file.path.split("/").pop()!;
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 1000);

			return { dir };
		},
		// Share links and git need the main process (a server, the git CLI)
		async sharePublish() {
			throw new Error(DESKTOP_ONLY);
		},
		async shareStatus() {
			return null;
		},
		async shareStop() {
			return ok;
		},
		async exportViewer() {
			throw new Error(DESKTOP_ONLY);
		},
		async gitStatus() {
			return { state: "unavailable", error: DESKTOP_ONLY } as const;
		},
		async gitInit() {
			throw new Error(DESKTOP_ONLY);
		},
		async gitSetRemote() {
			throw new Error(DESKTOP_ONLY);
		},
		async gitSync() {
			return { ok: false, error: DESKTOP_ONLY } as const;
		},
		...generator,
	};
}

/** Why sharing and git aren't available in the browser fallback. */
export const DESKTOP_ONLY = "Sharing and git sync need the Rabisco desktop app.";

export const isDesktop = typeof window !== "undefined" && Boolean(window.__electrobun);

export const api: RabiscoApi = isDesktop ? createElectrobunApi() : createBrowserApi();
