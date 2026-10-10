import { Electroview } from "electrobun/view";
import { normalizeComments } from "../../shared/comments";
import { newChatId, sortChats, summarizeChat } from "../../shared/chats";
import { starterFiles } from "../../shared/context/styles";
import { coverFor, emptyCanvas, isProjectFile, reconcileFrames, summarizeProject } from "../../shared/project";
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

export type RabiscoApi = {
	[K in keyof Requests]: (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;
};

export type FilesChanged = RabiscoRPC["webview"]["messages"]["filesChanged"];

export type AssetsChanged = RabiscoRPC["webview"]["messages"]["assetsChanged"];

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

const assetChanges = listenerSet<AssetsChanged>();

export const onGenerationEvent = generationEvents.add;

export const onFilesChanged = fileChanges.add;

export const onAssetsChanged = assetChanges.add;

function createElectrobunApi(): RabiscoApi {
	const rpc = Electroview.defineRPC<RabiscoRPC>({
		// Generations can run for minutes with agentic providers
		maxRequestTime: 15 * 60_000,
		handlers: {
			requests: {},
			messages: {
				generationEvent: generationEvents.emit,
				filesChanged: fileChanges.emit,
				assetsChanged: assetChanges.emit,
			},
		},
	});

	new Electroview({ rpc });

	return rpc.request;
}

// Browser fallback (`hutch run hmr`): main-process handlers mirrored on localStorage, paths are `browser://<uuid>`.
type Stored = {
	canvas: CanvasDoc;
	files: ProjectFiles;
	/** The one chat of projects stored before sessions */
	messages?: ChatMessage[];
	chats?: Record<string, ChatMessage[]>;
};

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

		const chats = { ...stored.chats };

		const legacy = stored.messages?.[0];

		if (legacy && stored.messages) chats[newChatId(new Date(legacy.createdAt))] = stored.messages;

		if (canvas !== normalized || stored.messages) write(path, { canvas, files: stored.files, chats });
		writeRecents([{ path, openedAt: new Date().toISOString() }, ...readRecents().filter((r) => r.path !== path)]);
		const summaries = sortChats(Object.entries(chats).map(([id, messages]) => summarizeChat(id, messages)));
		const chatId = summaries[0]?.id ?? newChatId();

		return { path, canvas, files: stored.files, chatId, messages: chats[chatId] ?? [], chats: summaries };
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
		async loadCover({ path }) {
			const stored = read(path);

			return stored ? coverFor(reconcileFrames(stored.canvas, stored.files), stored.files) : null;
		},
		async pickProjectFolder() {
			return null;
		},
		openProject,
		async closeProject() {
			return ok;
		},
		async createProject({ name, device, style }) {
			const path = `browser://${crypto.randomUUID()}`;
			write(path, {
				canvas: emptyCanvas(name.trim() || "Untitled", device),
				files: starterFiles(style),
				chats: {},
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
		// Nowhere to copy a file to: the inspector says so
		async pickImage() {
			return null;
		},
		async appendMessages({ path, chatId, messages }) {
			const stored = mustRead(path);
			const chats = { ...stored.chats };
			chats[chatId] = [...(chats[chatId] ?? []), ...messages];
			write(path, { ...stored, chats });

			return ok;
		},
		async openChat({ path, chatId }) {
			return mustRead(path).chats?.[chatId] ?? [];
		},
		async deleteChat({ path, chatId }) {
			const stored = mustRead(path);
			const chats = { ...stored.chats };
			delete chats[chatId];
			write(path, { ...stored, chats });

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
		async listCommands() {
			return [];
		},
		async titleBarDoubleClick() {
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

export const DESKTOP_ONLY = "Sharing and git sync need the Rabisco desktop app.";

export const isDesktop = typeof window !== "undefined" && Boolean(window.__electrobun);

export const api: RabiscoApi = isDesktop ? createElectrobunApi() : createBrowserApi();
