import type { RPCSchema } from "electrobun";
import type { ProviderConfig, ProviderSettings, ProviderStatus, ProviderType } from "./ai/settings";
import type { GitStatus, GitSyncResult } from "./git";
import type { ShareSnapshot, ShareStatus } from "./share/snapshot";
import type {
	CanvasDoc,
	ChatMessage,
	ContextFileName,
	Device,
	ExportFile,
	FileChange,
	GenerateParams,
	GenerateResult,
	GenerationEventMessage,
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
			/** Runs one generation with the provider of `params.model`. Events stream through `generationEvent`. */
			generate: { params: GenerateParams; response: GenerateResult };
			/** Aborts a running generation; `generate` then resolves with `aborted`. */
			stopGeneration: { params: { generationId: string }; response: { ok: true } };

			/** Configured providers with their health and models. `refresh` re-checks health and models. */
			listProviders: {
				params: { refresh?: boolean };
				response: { settings: ProviderSettings; statuses: ProviderStatus[] };
			};
			/** Adds a provider. `apiKey` goes to the OS keychain. */
			addProvider: {
				params: { type: ProviderType; label?: string; baseUrl?: string; binPath?: string; apiKey?: string };
				response: ProviderStatus;
			};
			/** `apiKey: null` removes the stored key; omit it to keep the current one. */
			updateProvider: {
				params: {
					id: string;
					patch: Partial<Pick<ProviderConfig, "label" | "enabled" | "baseUrl" | "binPath" | "defaultModel">>;
					apiKey?: string | null;
				};
				response: ProviderStatus;
			};
			removeProvider: { params: { id: string }; response: { ok: true } };
			/** Checks health and lists models again for one provider. */
			testProvider: { params: { id: string }; response: ProviderStatus };
			setDefaultModel: { params: { model: string }; response: { ok: true } };
			openExternal: { params: { url: string }; response: { ok: true } };
			/**
			 * Finds PRODUCT.md and DESIGN.md in another folder (an existing repository) and returns
			 * their content. Nothing is written: the editor applies them as one undoable step.
			 */
			importContext: {
				params: { from: string };
				response: {
					files: {
						path: ContextFileName;
						content: string;
						/** Path inside `from` where it was found */ source: string;
					}[];
				};
			};

			// Phase 7: export and handoff
			/** Native folder picker for exports; `null` when cancelled. */
			pickExportFolder: { params: {}; response: string | null };
			/**
			 * Writes `files` into `<dir>/<name>` (`-2`, `-3`… when taken), or straight into `dir`
			 * when `name` is omitted. Paths can't leave the folder. `reveal` shows it in Finder.
			 * Returns the folder written to.
			 */
			writeExport: {
				params: { dir: string; name?: string; files: ExportFile[]; reveal?: boolean };
				response: { dir: string };
			};

			// Share a read-only link and export the viewer (decision 0008)
			/** Starts sharing the project at a random link on the local network, or updates what the link shows. */
			sharePublish: { params: { path: string; snapshot: ShareSnapshot }; response: ShareStatus };
			/** The project's share link; `null` when it isn't shared. */
			shareStatus: { params: { path: string }; response: ShareStatus | null };
			/** Stops sharing: the link stops working. */
			shareStop: { params: { path: string }; response: { ok: true } };
			/** Writes the read-only viewer as a static site into `<dir>/<name>` (`-2`… when taken). */
			exportViewer: {
				params: { dir: string; name: string; snapshot: ShareSnapshot; reveal?: boolean };
				response: { dir: string };
			};

			// Sync to a git repository (decision 0008)
			gitStatus: { params: { path: string }; response: GitStatus };
			/** `git init`, a .gitignore and a first commit. */
			gitInit: { params: { path: string; name: string }; response: GitStatus };
			/** Adds or changes the remote sync pushes to. */
			gitSetRemote: { params: { path: string; url: string }; response: GitStatus };
			/** Commits the project folder, rebases onto the remote and pushes. Never forces. */
			gitSync: { params: { path: string }; response: GitSyncResult };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			generationEvent: GenerationEventMessage;
			/** Files changed on disk outside Rabisco (external editor, git). Writes made through `writeFiles` are not echoed. */
			filesChanged: { path: string; changes: FileChange[] };
		};
	}>;
};
