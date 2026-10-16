import type { RPCSchema } from "electrobun";
import type { AssetChange, AssetWrite } from "./assets";
import type { UrlCapture } from "./import/url-capture";
import type { StyleId } from "./context/styles";
import type { KitId } from "./components/starter-kits";
import type { Attachment, ImageAspect, ProviderCommand } from "./ai/contract";
import type { KeyStorage, ProviderConfig, ProviderSettings, ProviderStatus, ProviderType } from "./ai/settings";
import type { CheckpointVersion, GitCheckpoint, GitStatus, GitSyncResult } from "./git";
import type { RepoInfo } from "./export/repo-sync";
import type { LibraryContents, LibrarySummary } from "./libraries";
import type { AgentClientId, AgentClientStatus } from "./mcp/clients";
import type { AgentCall, AgentServerStatus, ToolResult } from "./mcp/tools";
import type { BackupReason, SavedHistory } from "./saved-history";
import type { PagesStatus, PublishHostStatus, PublishParams, PublishTarget, TokenHost } from "./share/publish";
import type { ViewerComment } from "./share/comments";
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
	ImprovePromptParams,
	ImprovePromptResult,
	Project,
	ProjectFiles,
	ProjectSummary,
	ScreenSource,
} from "./types";

/** Projects are identified by their absolute folder path. */
export type RabiscoRPC = {
	bun: RPCSchema<{
		requests: {
			/** Most recent first. Migrates legacy JSON projects on first call. */
			listRecents: { params: {}; response: ProjectSummary[] };
			/** The files of a recent project's cover, read when it shows. */
			loadCover: { params: { path: string }; response: ScreenSource | null };
			pickProjectFolder: { params: {}; response: string | null };
			/** The folder `rabisco open` asked for, once */
			takeOpenRequest: { params: {}; response: { path: string | null } };
			/** Creates `rabisco.json` if needed, adds to recents and starts watching. */
			openProject: { params: { path: string }; response: Project };
			closeProject: { params: { path: string }; response: { ok: true } };
			/** In the default projects directory */
			/** `style` writes that starter DESIGN.md instead of the template; `kit` writes its components */
			createProject: {
				params: { name: string; device: Device; style?: StyleId | null; kit?: KitId | null };
				response: Project;
			};
			saveCanvas: { params: { path: string; canvas: CanvasDoc }; response: { ok: true } };
			writeFiles: { params: { path: string; changes: FileChange[] }; response: { ok: true } };
			/** Creates the chat's file with its first message */
			appendMessages: {
				params: { path: string; chatId: string; messages: ChatMessage[] };
				response: { ok: true };
			};
			openChat: { params: { path: string; chatId: string }; response: ChatMessage[] };
			/** Moves the chat's file to the trash */
			deleteChat: { params: { path: string; chatId: string }; response: { ok: true } };
			readHistory: { params: { path: string }; response: SavedHistory | null };
			writeHistory: { params: { path: string; history: SavedHistory }; response: { ok: true } };
			/** Writes or removes `public/` images from the history's saved copies. `missing` had no copy left */
			writeAssets: { params: { path: string; writes: AssetWrite[] }; response: { missing: string[] } };
			backupProject: {
				params: { path: string; reason: BackupReason; files: ProjectFiles; canvas: CanvasDoc };
				response: { dir: string };
			};
			/** Opens a file dialog and copies the image into `public/images/`; `src` is what a screen writes. `null` when cancelled. */
			pickImage: { params: { path: string }; response: { src: string } | null };
			addMoodboardImage: {
				params: { path: string; name: string; mediaType: Attachment["mediaType"]; data: string };
				response: { src: string };
			};
			addFont: { params: { path: string; name: string; data: string }; response: { src: string } };
			canGenerateImages: { params: {}; response: { ok: boolean } };
			generateImage: {
				params: { path: string; prompt: string; aspect: ImageAspect; name: string };
				response: { src: string; data: string };
			};
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
				response: { settings: ProviderSettings; statuses: ProviderStatus[]; keyStorage: KeyStorage };
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
			setFastModel: { params: { model: string | null }; response: { ok: true } };
			improvePrompt: { params: ImprovePromptParams; response: ImprovePromptResult };
			/** The model's provider commands, for the chat's `/` menu */
			listCommands: { params: { model: string; projectPath: string }; response: ProviderCommand[] };
			openExternal: { params: { url: string }; response: { ok: true } };
			/** Zooms or minimizes the window, as the system setting for a title bar double-click says */
			titleBarDoubleClick: { params: {}; response: { ok: true } };
			/** Writes nothing: the editor applies the result as one undoable step. */
			/** Reads a Design.md, CSS theme or token file from the web. Writes nothing. */
			fetchBrandKit: { params: { url: string }; response: { url: string; text: string; contentType: string } };
			/** Shared libraries (decision 0045): the folders in `Documents/Rabisco/Libraries` and the added ones */
			listLibraries: { params: {}; response: LibrarySummary[] };
			/** Its DESIGN.md and `components/*.tsx`; `null` when this Mac doesn't have it */
			readLibrary: { params: { id: string }; response: LibraryContents | null };
			/** Opens a folder dialog; `null` when cancelled */
			addLibraryFolder: { params: {}; response: LibrarySummary | null };
			/** In `Documents/Rabisco/Libraries`; `files` hold its `rabisco-library.json` */
			createLibrary: { params: { name: string; files: ProjectFiles }; response: LibrarySummary };
			/** Only DESIGN.md and `components/*.tsx`. Not an undo step: other projects read the library */
			writeLibrary: { params: { id: string; changes: FileChange[] }; response: LibrarySummary };
			revealLibrary: { params: { id: string }; response: { ok: true } };
			captureUrl: {
				params: { path: string; url: string; width: number };
				response: { capture: UrlCapture; copied: number; failed: number };
			};
			stopCapture: { params: {}; response: { ok: true } };
			importContext: {
				params: { from: string };
				response: {
					files: {
						path: ContextFileName;
						content: string;
						/** Path inside `from` */ source: string;
					}[];
					tooLarge: string[];
				};
			};

			pickExportFolder: { params: {}; response: string | null };
			/** Into `<dir>/<name>` (`-2`… when taken), or `dir` without `name`. Paths can't leave the folder. */
			writeExport: {
				params: { dir: string; name?: string; files: ExportFile[]; reveal?: boolean };
				response: { dir: string };
			};

			/** Into a new folder in the system's temp folder, for "Copy for agent" screenshots */
			writeAgentContext: { params: { files: ExportFile[] }; response: { dir: string } };
			/** `paths` are repository-relative; the ones that exist come back in `existing` */
			repoInfo: { params: { dir: string; paths: string[] }; response: RepoInfo };

			/** Random link on the local network; republishing updates what it shows. */
			sharePublish: { params: { path: string; snapshot: ShareSnapshot }; response: ShareStatus };
			shareStatus: { params: { path: string }; response: ShareStatus | null };
			shareStop: { params: { path: string }; response: { ok: true } };
			/** Hosts with a token in the keychain (decision 0038) */
			publishHosts: { params: {}; response: PublishHostStatus[] };
			/** Checks the token with the host, then saves it in the keychain */
			publishConnect: { params: { host: TokenHost; token: string }; response: PublishHostStatus[] };
			/** Deletes the token; published sites stay up */
			publishDisconnect: { params: { host: TokenHost }; response: PublishHostStatus[] };
			publishTarget: { params: { path: string }; response: PublishTarget | null };
			/** Whether git sync can publish this project to GitHub Pages (decision 0043) */
			publishPages: { params: { path: string }; response: PagesStatus };
			/** Uploads the website to the project's site, or a new one. The password is never saved. */
			publishSite: { params: PublishParams & { snapshot: ShareSnapshot }; response: PublishTarget };
			/** Deletes the site on the host, or replaces a GitHub Pages site with a notice */
			unpublishSite: { params: { path: string }; response: { ok: true } };
			/** Expired sites the sweep removed since the last call */
			takeExpiredSites: { params: {}; response: { urls: string[] } };
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
			gitCheckpoints: { params: { path: string }; response: GitCheckpoint[] };
			gitCheckpoint: { params: { path: string; name: string }; response: GitCheckpoint };
			gitReadCheckpoint: { params: { path: string; hash: string }; response: CheckpointVersion };

			/** The local MCP server for coding agents (decision 0030) */
			agentServerStatus: { params: {}; response: AgentServerStatus };
			setAgentServer: { params: { enabled: boolean }; response: AgentServerStatus };
			/** Restarts the server with a new port and token */
			resetAgentAccess: { params: {}; response: AgentServerStatus };
			/** The answer to an `agentCall` */
			agentResult: { params: { callId: string; result: ToolResult }; response: { ok: true } };
			/** One-click setup: the `rabisco` server in each client's config, and which clients connected */
			agentClients: { params: {}; response: AgentClientStatus[] };
			setUpAgentClient: { params: { id: AgentClientId }; response: AgentClientStatus[] };
			removeAgentClient: { params: { id: AgentClientId }; response: AgentClientStatus[] };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {
			/** Writes every open project's pending changes and undo history. Runs before the app quits. */
			saveAll: { params: {}; response: { ok: true } };
		};
		messages: {
			generationEvent: GenerationEventMessage;
			/** Outside Rabisco only: writes made through `writeFiles` are not echoed. */
			filesChanged: { path: string; changes: FileChange[] };
			/** Images under `public/` changed: picked in the inspector or edited outside Rabisco (decision 0010) */
			assetsChanged: { path: string; changes: AssetChange[] };
			canvasChanged: { path: string; canvas: CanvasDoc };
			/** A coding agent's tool call; answered by `agentResult` */
			agentCall: AgentCall;
			/** `rabisco open` asked for a folder; read it with `takeOpenRequest` */
			openRequested: {};
			/** The expiry sweep removed sites; read them with `takeExpiredSites` */
			sitesExpired: {};
			/** A viewer of a share link on the local network commented (decision 0038) */
			viewerComment: { path: string; comment: ViewerComment };
		};
	}>;
};
