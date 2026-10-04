import type { RPCSchema } from "electrobun";
import type {
	CanvasDoc,
	ChatMessage,
	Device,
	FileChange,
	GenerateScreensParams,
	GenerateScreensResult,
	GenerationStep,
	Project,
	ProjectSummary,
} from "./types";

/**
 * Contract between the main process (`bun`) and the webview (`webview`).
 * `bun.requests` are handled in src/bun, `webview.messages` are pushed to the UI.
 * Projects are identified by their absolute folder path.
 */
export type RabiscoRPC = {
	bun: RPCSchema<{
		requests: {
			/** Recent project folders, most recent first. Migrates legacy JSON projects on first call. */
			listRecents: { params: {}; response: ProjectSummary[] };
			/** Shows the native folder picker. */
			pickProjectFolder: { params: {}; response: string | null };
			/** Opens any folder as a project (creating `rabisco.json` if needed), adds it to recents and starts watching it. */
			openProject: { params: { path: string }; response: Project };
			/** Stops watching the folder. */
			closeProject: { params: { path: string }; response: { ok: true } };
			/** Creates `<name>.rabisco/` in the default projects directory. */
			createProject: { params: { name: string; device: Device }; response: Project };
			saveCanvas: { params: { path: string; canvas: CanvasDoc }; response: { ok: true } };
			writeFiles: { params: { path: string; changes: FileChange[] }; response: { ok: true } };
			appendMessages: { params: { path: string; messages: ChatMessage[] }; response: { ok: true } };
			/** Forgets the folder without touching it. */
			removeRecent: { params: { path: string }; response: { ok: true } };
			/** Moves the folder to the trash and forgets it. */
			deleteProject: { params: { path: string }; response: { ok: true } };
			revealProject: { params: { path: string }; response: { ok: true } };
			generateScreens: { params: GenerateScreensParams; response: GenerateScreensResult };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			generationStep: GenerationStep;
			/** Files changed on disk outside Rabisco (external editor, git). Writes made through `writeFiles` are not echoed. */
			filesChanged: { path: string; changes: FileChange[] };
		};
	}>;
};
