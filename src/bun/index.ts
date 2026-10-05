import { BrowserView, BrowserWindow, PATHS, Updater, Utils } from "electrobun/main";
import { join } from "path";
import type { RabiscoRPC } from "../shared/rpc";
import { assertSnapshot } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";
import { createSecretStore } from "./ai/keychain";
import { createAiService } from "./ai/service";
import { freeExportDir, writeExportFiles } from "./export";
import { createGit } from "./git";
import { findContextFiles } from "./import-context";
import { createShareService, readScreenRuntime } from "./share";
import { createProjectStore } from "./store";

const DEV_SERVER_URL = "http://localhost:5173";

// Use the Vite dev server when it's running (`hutch run dev:hmr`)
async function getMainViewUrl(): Promise<string> {
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);

			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'hutch run dev:hmr' for HMR.");
		}
	}

	return "views://mainview/index.html";
}

const store = createProjectStore({
	documentsDir: Utils.paths.documents,
	userDataDir: Utils.paths.userData,
	moveToTrash: (path) => Utils.moveToTrash(path),
	showItemInFolder: (path) => Utils.showItemInFolder(path),
	pickFolder: () =>
		Utils.openFileDialog({
			startingFolder: Utils.paths.documents,
			canChooseFiles: false,
			canChooseDirectory: true,
			allowsMultipleSelection: false,
		}),
	onFilesChanged: (path, changes) => {
		// The webview may still be loading; it reads fresh files when it opens the project
		try {
			mainWindow.webview.rpc?.send.filesChanged({ path, changes });
		} catch (error) {
			console.warn("Could not push filesChanged:", error);
		}
	},
});

const channel = await Updater.localInfo.channel();

const ai = createAiService({
	userDataDir: Utils.paths.userData,
	secrets: createSecretStore(),
	// The Phase 0 mock generator never ships
	includeMock: channel === "dev",
	send: (message) => {
		try {
			mainWindow.webview.rpc?.send.generationEvent(message);
		} catch (error) {
			console.warn("Could not push generationEvent:", error);
		}
	},
});

const ok = { ok: true } as const;

/** Where the screen runtime is: the app bundle, then the source tree (development) */
const runtimeDirs = () => [
	join(PATHS.VIEWS_FOLDER, "mainview/runtime"),
	join(process.cwd(), "src/mainview/public/runtime"),
];

// Share links serve the same screen runtime the canvas loads (decision 0008)
const shares = createShareService({
	readRuntime: () => readScreenRuntime(runtimeDirs()),
});

const git = createGit();

/** Only web links leave the app */
function openExternal(url: string) {
	if (!/^https?:\/\//.test(url)) throw new Error(`Not a web link: ${url}`);
	Utils.openExternal(url);
}

const rpc = BrowserView.defineRPC<RabiscoRPC>({
	// Agentic providers can run for minutes
	maxRequestTime: 15 * 60_000,
	handlers: {
		requests: {
			listRecents: () => store.listRecents(),
			pickProjectFolder: () => store.pickProjectFolder(),
			openProject: ({ path }) => store.openProject(path),
			// A share link lives while its project is open
			closeProject: ({ path }) => (store.closeProject(path), shares.stop(path), ok),
			createProject: ({ name, device }) => store.createProject(name, device),
			saveCanvas: ({ path, canvas }) => (store.saveCanvas(path, canvas), ok),
			writeFiles: ({ path, changes }) => (store.writeFiles(path, changes), ok),
			appendMessages: ({ path, messages }) => (store.appendMessages(path, messages), ok),
			removeRecent: ({ path }) => (store.removeRecent(path), ok),
			deleteProject: ({ path }) => (store.deleteProject(path), ok),
			revealProject: ({ path }) => (store.revealProject(path), ok),
			importContext: ({ from }) => ({ files: findContextFiles(from) }),
			generate: (params) => ai.generate(params),
			stopGeneration: ({ generationId }) => (ai.stopGeneration(generationId), ok),
			listProviders: ({ refresh }) => ai.listProviders(refresh),
			addProvider: (params) => ai.addProvider(params),
			updateProvider: ({ id, patch, apiKey }) => ai.updateProvider(id, patch, apiKey),
			removeProvider: async ({ id }) => (await ai.removeProvider(id), ok),
			testProvider: ({ id }) => ai.testProvider(id),
			setDefaultModel: async ({ model }) => (await ai.setDefaultModel(model), ok),
			openExternal: ({ url }) => (openExternal(url), ok),
			pickExportFolder: async () =>
				(
					await Utils.openFileDialog({
						startingFolder: Utils.paths.documents,
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					})
				).find(Boolean) ?? null,
			writeExport: ({ dir, name, files, reveal }) => {
				const target = name ? freeExportDir(dir, name) : dir;
				writeExportFiles(target, files);

				if (reveal) Utils.showItemInFolder(target);

				return { dir: target };
			},
			sharePublish: ({ path, snapshot }) => shares.publish(path, snapshot),
			shareStatus: ({ path }) => shares.status(path),
			shareStop: ({ path }) => (shares.stop(path), ok),
			exportViewer: ({ dir, name, snapshot, reveal }) => {
				const target = freeExportDir(dir, name);
				writeExportFiles(target, viewerFiles(assertSnapshot(snapshot), readScreenRuntime(runtimeDirs())));

				if (reveal) Utils.showItemInFolder(target);

				return { dir: target };
			},
			gitStatus: ({ path }) => git.status(path),
			gitInit: ({ path, name }) => git.init(path, name),
			gitSetRemote: ({ path, url }) => git.setRemote(path, url),
			gitSync: ({ path }) => git.sync(path),
		},
		messages: {},
	},
});

const mainWindow = new BrowserWindow({
	title: "Rabisco",
	url: await getMainViewUrl(),
	titleBarStyle: "hiddenInset",
	frame: { width: 1440, height: 900, x: 120, y: 80 },
	rpc,
});
