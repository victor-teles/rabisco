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

/** Projects are identified by their absolute folder path. */
export type RabiscoRPC = {
	bun: RPCSchema<{
		requests: {
			/** Most recent first. Migrates legacy JSON projects on first call. */
			listRecents: { params: {}; response: ProjectSummary[] };
			pickProjectFolder: { params: {}; response: string | null };
			/** Creates `rabisco.json` if needed, adds to recents and starts watching. */
			openProject: { params: { path: string }; response: Project };
			closeProject: { params: { path: string }; response: { ok: true } };
			/** In the default projects directory */
			createProject: { params: { name: string; device: Device }; response: Project };
			saveCanvas: { params: { path: string; canvas: CanvasDoc }; response: { ok: true } };
			writeFiles: { params: { path: string; changes: FileChange[] }; response: { ok: true } };
			appendMessages: { params: { path: string; messages: ChatMessage[] }; response: { ok: true } };
			removeRecent: { params: { path: string }; response: { ok: true } };
			/** Moves the folder to the trash */
			deleteProject: { params: { path: string }; response: { ok: true } };
			revealProject: { params: { path: string }; response: { ok: true } };
			/** Events stream through `generationEvent`. */
			generate: { params: GenerateParams; response: GenerateResult };
			/** `generate` then resolves with `aborted`. */
			stopGeneration: { params: { generationId: string }; response: { ok: true } };

			listProviders: {
				params: { refresh?: boolean };
				response: { settings: ProviderSettings; statuses: ProviderStatus[] };
			};
			/** `apiKey` goes to the OS keychain. */
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
			testProvider: { params: { id: string }; response: ProviderStatus };
			setDefaultModel: { params: { model: string }; response: { ok: true } };
			openExternal: { params: { url: string }; response: { ok: true } };
			/** Writes nothing: the editor applies the result as one undoable step. */
			importContext: {
				params: { from: string };
				response: {
					files: {
						path: ContextFileName;
						content: string;
						/** Path inside `from` */ source: string;
					}[];
				};
			};

			pickExportFolder: { params: {}; response: string | null };
			/** Into `<dir>/<name>` (`-2`… when taken), or `dir` without `name`. Paths can't leave the folder. */
			writeExport: {
				params: { dir: string; name?: string; files: ExportFile[]; reveal?: boolean };
				response: { dir: string };
			};

			/** Random link on the local network; republishing updates what it shows. */
			sharePublish: { params: { path: string; snapshot: ShareSnapshot }; response: ShareStatus };
			shareStatus: { params: { path: string }; response: ShareStatus | null };
			shareStop: { params: { path: string }; response: { ok: true } };
			/** Into `<dir>/<name>` (`-2`… when taken) */
			exportViewer: {
				params: { dir: string; name: string; snapshot: ShareSnapshot; reveal?: boolean };
				response: { dir: string };
			};

			gitStatus: { params: { path: string }; response: GitStatus };
			gitInit: { params: { path: string; name: string }; response: GitStatus };
			gitSetRemote: { params: { path: string; url: string }; response: GitStatus };
			/** Commit, rebase onto the remote, push. Never forces. */
			gitSync: { params: { path: string }; response: GitSyncResult };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			generationEvent: GenerationEventMessage;
			/** Outside Rabisco only: writes made through `writeFiles` are not echoed. */
			filesChanged: { path: string; changes: FileChange[] };
		};
	}>;
};
