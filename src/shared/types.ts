import type {
	Attachment,
	ElementFocus,
	GenerationEvent,
	GenerationPlan,
	Problem,
	ProviderErrorCode,
	Usage,
} from "./ai/contract";
import type { ProjectAssets } from "./assets";
import type { ChangeSummary } from "./change-summary";
import type { ChatSummary } from "./chats";
import type { AppliedTheme } from "./context/theme";
import type { DesignTokens } from "./context/tokens";

export type Device = "mobile" | "tablet" | "desktop";

export type ContextFileName = "PRODUCT.md" | "DESIGN.md";

/** Code lives in the screen file; the frame only stores where it sits. */
export type Frame = {
	/** Unique per canvas */
	file: string;
	name: string;
	device: Device;
	/** Canvas-space top-left corner */
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Derived from file names (decision 0004) */
export type AlternateGroup = {
	picked: string;
	/** Includes the picked one */
	files: string[];
};

/** `rabisco.json`: canvas data only, never code */
export type CanvasDoc = {
	version: 1;
	name: string;
	device: Device;
	createdAt: string;
	updatedAt: string;
	frames: Frame[];
	selection: string[];
	alternates: AlternateGroup[];
	/** Missing in projects saved before comments existed */
	comments?: CanvasComment[];
	/** The theme screens render with, applied on request (decision 0009). Missing in older projects: DESIGN.md's tokens count as applied */
	theme?: AppliedTheme;
};

export type CommentReply = { id: string; text: string; createdAt: string };

/** With `file`, `x`/`y` are relative to that frame, so the pin moves with it. */
export type CanvasComment = {
	id: string;
	file?: string;
	x: number;
	y: number;
	text: string;
	createdAt: string;
	resolved?: boolean;
	replies?: CommentReply[];
};

/** Keyed by project-relative path with forward slashes */
export type ProjectFiles = Record<string, string>;

/** `content: null` deletes the file. */
export type FileChange = { path: string; content: string | null };

/** Path relative to the export folder */
export type ExportFile = { path: string; content: string; encoding?: "utf8" | "base64" };

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
	/** Assistant replies: context files the generation followed */
	context?: ContextFileName[];
	/** User prompts: the images sent with them. On disk they live in `attachments/`. */
	attachments?: Attachment[];
	/** Assistant replies to a generation that changed files or left problems. Missing in older chats */
	summary?: ChangeSummary;
};

/** A folder; its absolute path is its id. */
export type Project = {
	path: string;
	canvas: CanvasDoc;
	files: ProjectFiles;
	/** The open chat session; a new one has no file until its first message */
	chatId: string;
	/** Of `chatId` */
	messages: ChatMessage[];
	chats: ChatSummary[];
	/** Images under `public/`, pushed to frames as bytes (decision 0010). Not files: they stay out of history */
	assets?: ProjectAssets;
};

/** Everything to render one screen on its own (thumbnails) */
export type ScreenSource = {
	entry: string;
	device: Device;
	width: number;
	height: number;
	files: ProjectFiles;
	theme: DesignTokens;
};

/** Which screen a project's cover shows; its files load with `loadCover` */
export type ScreenCover = Pick<ScreenSource, "entry" | "device" | "width" | "height">;

export type ProjectSummary = {
	path: string;
	name: string;
	device: Device;
	updatedAt: string;
	screenCount: number;
	cover: ScreenCover | null;
	/** Moved or deleted since last opened */
	missing: boolean;
};

/** Mock generator output (development only) */
export type GenerateScreensResult = {
	changes: FileChange[];
	/** Laid out from the canvas origin; the editor offsets them. */
	frames: Frame[];
	reply: string;
};

/** The main process reads the project files and chat from disk. */
export type GenerateParams = {
	generationId: string;
	projectPath: string;
	prompt: string;
	device: Device;
	/** `ModelRef` */
	model: string;
	/** Empty or missing: create new screens */
	targets?: string[];
	/** `vary`: new alternates of the one screen in `targets`, leaving it as it is. */
	/** `plan`: reply with a plan for a `create` and write nothing; `create` with `plan` follows one (decision 0015) */
	task?: "create" | "edit" | "repair" | "context" | "vary" | "theme" | "plan";
	/** 1 to `MAX_VARIATIONS`, for `create` and `vary`; run as parallel generations */
	variations?: number;
	/** Read but must not change, e.g. the variation a "Mix" takes a section from */
	references?: string[];
	/** Dropped by the main process when the element is gone from the file on disk */
	focus?: ElementFocus;
	problems?: Problem[];
	attachments?: Attachment[];
	/** The chat session whose messages are the history. Missing: no history */
	chatId?: string;
	/** `prompt` is `/name args`; the main process expands the provider's command */
	command?: { name: string; args: string };
	/** `create`: the plan the user accepted; its shared components are written first, then its screens in parallel */
	plan?: GenerationPlan;
	review?: VisualReview;
};

export type VisualReview = { prompt: string; attachments: Attachment[] };

export type GenerationFailure = {
	code: ProviderErrorCode;
	message: string;
	retryable: boolean;
	/** e.g. "Run `claude` in a terminal and log in" */
	fix?: string;
	/** So the UI can open its settings */
	providerId?: string;
};

export type GenerateResult =
	| {
			ok: true;
			changes: FileChange[];
			/** Laid out from the canvas origin; the editor offsets them. */
			frames: Frame[];
			reply: string;
			/** Left after automatic repairs; those files were not written */
			problems: Problem[];
			usage?: Usage;
			/** Context files that had content and went into the request */
			context: ContextFileName[];
			/** `theme` task: the valid tokens read from DESIGN.md, with the source they were read from */
			theme?: AppliedTheme;
			/** `plan` task: the plan, fitted to the project; nothing was written */
			plan?: GenerationPlan;
			withoutImages?: true;
	  }
	| { ok: false; error: GenerationFailure };

export type ImprovePromptParams = {
	generationId: string;
	prompt: string;
	device: Device;
	model: string;
	projectPath?: string;
};

export type ImprovePromptResult = { ok: true; brief: string; usage?: Usage } | { ok: false; error: GenerationFailure };

/** `attempt` 1 is the first try, then repairs. */
export type GenerationEventMessage = {
	generationId: string;
	attempt: number;
	/** 0-based; paths are already final names. Missing for single generations. */
	variant?: number;
	event: GenerationEvent;
};
