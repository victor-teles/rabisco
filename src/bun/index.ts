import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";
import type { RabiscoRPC } from "../shared/rpc";
import { generateScreens } from "./ai/generate";
import { createProjectStore } from "./store";

const DEV_SERVER_URL = "http://localhost:5173";

// Use the Vite dev server when it's running (`hutch run dev:hmr`)
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
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

const ok = { ok: true } as const;

const rpc = BrowserView.defineRPC<RabiscoRPC>({
	// Generation can take a while once a real model is plugged in
	maxRequestTime: 5 * 60_000,
	handlers: {
		requests: {
			listRecents: () => store.listRecents(),
			pickProjectFolder: () => store.pickProjectFolder(),
			openProject: ({ path }) => store.openProject(path),
			closeProject: ({ path }) => (store.closeProject(path), ok),
			createProject: ({ name, device }) => store.createProject(name, device),
			saveCanvas: ({ path, canvas }) => (store.saveCanvas(path, canvas), ok),
			writeFiles: ({ path, changes }) => (store.writeFiles(path, changes), ok),
			appendMessages: ({ path, messages }) => (store.appendMessages(path, messages), ok),
			removeRecent: ({ path }) => (store.removeRecent(path), ok),
			deleteProject: ({ path }) => (store.deleteProject(path), ok),
			revealProject: ({ path }) => (store.revealProject(path), ok),
			generateScreens: (params) =>
				generateScreens(params, (step) => mainWindow.webview.rpc?.send.generationStep(step)),
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
