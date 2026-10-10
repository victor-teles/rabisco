import { ApplicationMenu, BrowserView, BrowserWindow, PATHS, Updater, Utils } from "electrobun/main";
import { existsSync } from "fs";
import { join } from "path";
import type { RabiscoRPC } from "../shared/rpc";
import { assertSnapshot } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";
import { createSecretStore } from "./ai/keychain";
import { IMAGE_EXTENSIONS } from "./assets";
import { createAiService } from "./ai/service";
import { freeExportDir, writeExportFiles } from "./export";
import { createGit } from "./git";
import { findContextFiles } from "./import-context";
import { createShareService, readScreenRuntime } from "./share";
import { createProjectStore } from "./store";

const DEV_SERVER_URL = "http://localhost:5173";

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

	// The built UI can't tell the channel apart; development-only tools read it from the hash
	return `views://mainview/index.html${channel === "dev" ? "#channel=dev" : ""}`;
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
	onAssetsChanged: (path, changes) => {
		try {
			mainWindow.webview.rpc?.send.assetsChanged({ path, changes });
		} catch (error) {
			console.warn("Could not push assetsChanged:", error);
		}
	},
});

const channel = await Updater.localInfo.channel();

/** Copied into the bundle by `build.copy` in electrobun.config.ts */
const claudeExecutable = join(
	PATHS.RESOURCES_FOLDER,
	"app/bin",
	process.platform === "win32" ? "claude.exe" : "claude",
);

const ai = createAiService({
	userDataDir: Utils.paths.userData,
	claudeExecutable: existsSync(claudeExecutable) ? claudeExecutable : undefined,
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

/** App bundle first, then the source tree (development) */
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

/** System Settings › Desktop & Dock › "Double-click a window's title bar to". Read each time, so a change applies at once */
function titleBarAction(): "zoom" | "minimize" | "none" {
	if (process.platform !== "darwin") return "zoom";

	const value = Bun.spawnSync(["defaults", "read", "-g", "AppleActionOnDoubleClick"]).stdout.toString().trim();

	if (value === "Minimize") return "minimize";

	if (value === "None") return "none";

	return "zoom";
}

function titleBarDoubleClick() {
	const action = titleBarAction();

	if (action === "minimize") mainWindow.minimize();
	else if (action === "zoom") {
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	}
}

const rpc = BrowserView.defineRPC<RabiscoRPC>({
	// Agentic providers can run for minutes
	maxRequestTime: 15 * 60_000,
	handlers: {
		requests: {
			listRecents: () => store.listRecents(),
			loadCover: ({ path }) => store.loadCover(path),
			pickProjectFolder: () => store.pickProjectFolder(),
			openProject: ({ path }) => store.openProject(path),
			// A share link lives while its project is open
			closeProject: ({ path }) => (store.closeProject(path), shares.stop(path), ok),
			createProject: ({ name, device, style }) => store.createProject(name, device, style),
			saveCanvas: ({ path, canvas }) => (store.saveCanvas(path, canvas), ok),
			writeFiles: ({ path, changes }) => (store.writeFiles(path, changes), ok),
			appendMessages: ({ path, chatId, messages }) => (store.appendMessages(path, chatId, messages), ok),
			openChat: ({ path, chatId }) => store.openChat(path, chatId),
			deleteChat: ({ path, chatId }) => (store.deleteChat(path, chatId), ok),
			pickImage: async ({ path }) => {
				const [file] = (
					await Utils.openFileDialog({
						startingFolder: Utils.paths.pictures,
						allowedFileTypes: IMAGE_EXTENSIONS.join(","),
						canChooseFiles: true,
						canChooseDirectory: false,
						allowsMultipleSelection: false,
					})
				).filter(Boolean);

				return file ? { src: store.importImage(path, file) } : null;
			},
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
			listCommands: ({ model, projectPath }) => ai.listCommands(model, projectPath),
			openExternal: ({ url }) => (openExternal(url), ok),
			titleBarDoubleClick: () => (titleBarDoubleClick(), ok),
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

// WKWebView only gets ⌘C, ⌘V, ⌘Z and the other text shortcuts through these menu roles
ApplicationMenu.setApplicationMenu([
	{
		label: "Rabisco",
		submenu: [{ role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { role: "quit" }],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "divider" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
	{
		label: "Window",
		submenu: [
			{ role: "minimize" },
			{ role: "zoom" },
			{ role: "toggleFullScreen" },
			{ type: "divider" },
			{ role: "close" },
		],
	},
]);

const mainWindow = new BrowserWindow({
	title: "Rabisco",
	url: await getMainViewUrl(),
	titleBarStyle: "hiddenInset",
	frame: { width: 1440, height: 900, x: 120, y: 80 },
	rpc,
});
