import { Electroview } from "electrobun/view";
import { GENERATION_STEPS, generateMockScreens } from "../../shared/mock-generator";
import { emptyCanvas, isProjectFile, reconcileFrames, summarizeProject } from "../../shared/project";
import type { RabiscoRPC } from "../../shared/rpc";
import type { CanvasDoc, ChatMessage, FileChange, GenerationStep, Project, ProjectFiles } from "../../shared/types";

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

const steps = listenerSet<GenerationStep>();
const fileChanges = listenerSet<FilesChanged>();

export const onGenerationStep = steps.add;

/** Files edited on disk outside Rabisco. Returns an unsubscribe function. */
export const onFilesChanged = fileChanges.add;

function createElectrobunApi(): RabiscoApi {
	const rpc = Electroview.defineRPC<RabiscoRPC>({
		maxRequestTime: 5 * 60_000,
		handlers: {
			requests: {},
			messages: { generationStep: steps.emit, filesChanged: fileChanges.emit },
		},
	});
	new Electroview({ rpc });
	const r = rpc.request;

	return {
		listRecents: (params) => r.listRecents(params),
		pickProjectFolder: (params) => r.pickProjectFolder(params),
		openProject: (params) => r.openProject(params),
		closeProject: (params) => r.closeProject(params),
		createProject: (params) => r.createProject(params),
		saveCanvas: (params) => r.saveCanvas(params),
		writeFiles: (params) => r.writeFiles(params),
		appendMessages: (params) => r.appendMessages(params),
		removeRecent: (params) => r.removeRecent(params),
		deleteProject: (params) => r.deleteProject(params),
		revealProject: (params) => r.revealProject(params),
		generateScreens: (params) => r.generateScreens(params),
	};
}

/**
 * Lets the UI run in a regular browser (`hutch run hmr` + open localhost:5173)
 * by mirroring the main-process handlers on top of localStorage. A project's
 * path is `browser://<uuid>`; there is no folder picker and no file watching.
 */
function createBrowserApi(): RabiscoApi {
	type Stored = { canvas: CanvasDoc; files: ProjectFiles; messages: ChatMessage[] };
	type Recent = { path: string; openedAt: string };
	const ok = { ok: true } as const;
	const key = (path: string) => `rabisco:project:${path}`;
	const RECENTS = "rabisco:recents";

	const read = (path: string): Stored | null => {
		try {
			const stored = JSON.parse(localStorage.getItem(key(path)) ?? "null");
			return stored?.canvas ? (stored as Stored) : null;
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
	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	async function openProject({ path }: { path: string }): Promise<Project> {
		const stored = mustRead(path);
		const canvas = reconcileFrames(stored.canvas, stored.files);
		if (canvas !== stored.canvas) write(path, { ...stored, canvas });
		writeRecents([{ path, openedAt: new Date().toISOString() }, ...readRecents().filter((r) => r.path !== path)]);
		return { path, canvas, files: stored.files, messages: stored.messages };
	}

	function applyChanges(files: ProjectFiles, changes: FileChange[]) {
		const next = { ...files };
		for (const { path, content } of changes) {
			if (!isProjectFile(path)) throw new Error(`Rabisco can only write screens/*.tsx, components/*.tsx, PRODUCT.md and DESIGN.md (got "${path}")`);
			if (content === null) delete next[path];
			else next[path] = content;
		}
		return next;
	}

	return {
		async listRecents() {
			return readRecents().map((recent) => {
				const stored = read(recent.path);
				if (!stored) {
					return { path: recent.path, name: "Missing project", device: "mobile", updatedAt: recent.openedAt, screenCount: 0, cover: null, missing: true };
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
			write(path, { canvas: emptyCanvas(name.trim() || "Untitled", device), files: {}, messages: [] });
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
		async generateScreens(params) {
			for (const step of GENERATION_STEPS) {
				steps.emit({ generationId: params.generationId, label: step.label });
				await wait(450);
			}
			return generateMockScreens({ prompt: params.prompt, device: params.device, existingFiles: params.existingFiles });
		},
	};
}

export const isDesktop = typeof window !== "undefined" && Boolean(window.__electrobun);

export const api: RabiscoApi = isDesktop ? createElectrobunApi() : createBrowserApi();
