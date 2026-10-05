import type { Attachment, ElementFocus, GenerationEvent, Problem, ProviderErrorCode, Usage } from "./ai/contract";

export type Device = "mobile" | "desktop";

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
};

/** A folder; its absolute path is its id. */
export type Project = {
	path: string;
	canvas: CanvasDoc;
	files: ProjectFiles;
	messages: ChatMessage[];
};

/** Everything to render one screen on its own (thumbnails) */
export type ScreenSource = {
	entry: string;
	device: Device;
	width: number;
	height: number;
	files: ProjectFiles;
};

export type ProjectSummary = {
	path: string;
	name: string;
	device: Device;
	updatedAt: string;
	screenCount: number;
	cover: ScreenSource | null;
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
	task?: "create" | "edit" | "repair" | "context" | "vary";
	/** 1 to `MAX_VARIATIONS`, for `create` and `vary`; run as parallel generations */
	variations?: number;
	/** Read but must not change, e.g. the variation a "Mix" takes a section from */
	references?: string[];
	/** Dropped by the main process when the element is gone from the file on disk */
	focus?: ElementFocus;
	problems?: Problem[];
	attachments?: Attachment[];
};

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
	  }
	| { ok: false; error: GenerationFailure };

/** `attempt` 1 is the first try, then repairs. */
export type GenerationEventMessage = {
	generationId: string;
	attempt: number;
	/** 0-based; paths are already final names. Missing for single generations. */
	variant?: number;
	event: GenerationEvent;
};
