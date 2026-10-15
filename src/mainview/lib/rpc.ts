import { Electroview } from "electrobun/view";
import { normalizeComments } from "../../shared/comments";
import { newChatId, sortChats, summarizeChat } from "../../shared/chats";
import { agentOpener } from "@/lib/agent-open";
import { brandKitUrl } from "../../shared/context/brand-kit";
import { starterFiles } from "../../shared/context/styles";
import { MOODBOARD_EXTENSIONS, MOODBOARD_PREFIX } from "../../shared/moodboard";
import { coverFor, emptyCanvas, isProjectFile, reconcileFrames, summarizeProject } from "../../shared/project";
import { errorResult, NO_PROJECT, type AgentCall, type ToolResult } from "../../shared/mcp/tools";
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

export type CanvasChanged = RabiscoRPC["webview"]["messages"]["canvasChanged"];

export type ViewerCommented = RabiscoRPC["webview"]["messages"]["viewerComment"];

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

const canvasChanges = listenerSet<CanvasChanged>();

const openRequests = listenerSet<{}>();

const expiredSites = listenerSet<{}>();

const viewerComments = listenerSet<ViewerCommented>();

export const onGenerationEvent = generationEvents.add;

export const onFilesChanged = fileChanges.add;

export const onAssetsChanged = assetChanges.add;

export const onCanvasChanged = canvasChanges.add;

export const onOpenRequested = openRequests.add;

export const onSitesExpired = expiredSites.add;

export const onViewerComment = viewerComments.add;

let saveAll = async () => true;

export function handleSaveAll(handler: () => Promise<boolean>) {
	saveAll = handler;
}

type AgentCallHandler = (call: AgentCall) => Promise<ToolResult>;

let agentCall: AgentCallHandler | null = null;

/** The editor runs coding agents' tools on its project; with none, every call says so */
export function handleAgentCall(handler: AgentCallHandler) {
	agentCall = handler;

	return () => {
		if (agentCall === handler) agentCall = null;
	};
}

async function answerAgent(call: AgentCall) {
	const run = call.tool === "open_project" ? () => agentOpener.open(call.args) : agentCall;

	const result = await (run ?? (async () => errorResult(NO_PROJECT)))(call).catch((error) =>
		errorResult(error instanceof Error ? error.message : String(error)),
	);

	await api
		.agentResult({ callId: call.callId, result })
		.catch((error) => console.warn("Could not answer agentCall:", error));
}

function createElectrobunApi(): RabiscoApi {
	const rpc = Electroview.defineRPC<RabiscoRPC>({
		// Generations can run for minutes with agentic providers
		maxRequestTime: 15 * 60_000,
		handlers: {
			requests: {
				saveAll: () => saveAll().then(() => ({ ok: true }) as const),
			},
			messages: {
				generationEvent: generationEvents.emit,
				filesChanged: fileChanges.emit,
				assetsChanged: assetChanges.emit,
				canvasChanged: canvasChanges.emit,
				agentCall: (call) => void answerAgent(call),
				openRequested: openRequests.emit,
				sitesExpired: expiredSites.emit,
				viewerComment: viewerComments.emit,
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
		takeOpenRequest: async () => ({ path: null }),
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
		// Nowhere to copy a file to: the webview keeps the bytes for the session
		async addMoodboardImage({ mediaType }) {
			return { src: `${MOODBOARD_PREFIX}${crypto.randomUUID()}.${MOODBOARD_EXTENSIONS[mediaType]}` };
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
		async readHistory() {
			return null;
		},
		async writeHistory() {
			return ok;
		},
		async writeAssets() {
			return { missing: [] };
		},
		async backupProject() {
			throw new Error("Backups need the Rabisco desktop app.");
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
		async fetchBrandKit({ url }) {
			const address = brandKitUrl(url);

			if (!address) throw new Error("Enter a web address that starts with https://");
			const response = await fetch(address);

			if (!response.ok) throw new Error(`Couldn't load ${address}: the server answered ${response.status}.`);

			return {
				url: response.url || address,
				text: await response.text(),
				contentType: response.headers.get("content-type") ?? "",
			};
		},
		async captureUrl() {
			throw new Error("Importing a web page needs the Rabisco desktop app.");
		},
		async stopCapture() {
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
		async writeAgentContext() {
			throw new Error(DESKTOP_ONLY);
		},
		async repoInfo() {
			throw new Error(DESKTOP_ONLY);
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
		async publishHosts() {
			return [];
		},
		async publishConnect() {
			throw new Error(DESKTOP_ONLY);
		},
		async publishDisconnect() {
			return [];
		},
		async publishTarget() {
			return null;
		},
		async publishPages() {
			return { state: "unavailable", error: DESKTOP_ONLY } as const;
		},
		async publishSite() {
			throw new Error(DESKTOP_ONLY);
		},
		async unpublishSite() {
			return ok;
		},
		takeExpiredSites: async () => ({ urls: [] }),
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
		async gitCheckpoints() {
			return [];
		},
		async gitCheckpoint() {
			throw new Error(DESKTOP_ONLY);
		},
		async gitReadCheckpoint() {
			throw new Error(DESKTOP_ONLY);
		},
		agentServerStatus: async () => ({ enabled: false, port: null }),
		async setAgentServer() {
			throw new Error(AGENTS_DESKTOP_ONLY);
		},
		async resetAgentAccess() {
			throw new Error(AGENTS_DESKTOP_ONLY);
		},
		agentResult: async () => ok,
		agentClients: async () => [],
		async setUpAgentClient() {
			throw new Error(AGENTS_DESKTOP_ONLY);
		},
		async removeAgentClient() {
			throw new Error(AGENTS_DESKTOP_ONLY);
		},
		...generator,
	};
}

export const DESKTOP_ONLY = "Sharing and git sync need the Rabisco desktop app.";

const AGENTS_DESKTOP_ONLY = "Coding agents need the Rabisco desktop app.";

export const isDesktop = typeof window !== "undefined" && Boolean(window.__electrobun);

export const api: RabiscoApi = isDesktop ? createElectrobunApi() : createBrowserApi();
