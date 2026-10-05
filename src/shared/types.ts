import type { Attachment, ElementFocus, GenerationEvent, Problem, ProviderErrorCode, Usage } from "./ai/contract";

export type Device = "mobile" | "desktop";

/** The project's context files (principle 5) */
export type ContextFileName = "PRODUCT.md" | "DESIGN.md";

/**
 * A frame on the canvas. Each frame renders one screen file; the code lives in
 * the file, the frame only stores where it sits.
 */
export type Frame = {
	/** Project-relative path of the screen it renders, e.g. `screens/welcome.tsx`. Unique per canvas. */
	file: string;
	name: string;
	device: Device;
	/** Canvas-space position of the frame's top-left corner */
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Variation group (decision 0004). Derived from the file names (`src/shared/variations.ts`) and saved with the canvas. */
export type AlternateGroup = {
	/** The picked file, e.g. `screens/welcome.tsx` */
	picked: string;
	/** Every file in the group, including the picked one */
	files: string[];
};

/** `rabisco.json`: canvas data only, never code. */
export type CanvasDoc = {
	version: 1;
	name: string;
	device: Device;
	createdAt: string;
	updatedAt: string;
	frames: Frame[];
	/** Files of the selected frames */
	selection: string[];
	alternates: AlternateGroup[];
	/** Pins on the canvas. Missing in projects saved before comments existed. */
	comments?: CanvasComment[];
};

export type CommentReply = { id: string; text: string; createdAt: string };

/**
 * A comment pin. With `file`, it sits on that frame and `x`/`y` are relative to the
 * frame's top-left corner, so it moves with the frame; without, they are canvas coordinates.
 */
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

/**
 * Text files of a project, keyed by project-relative path with forward slashes:
 * `screens/*.tsx`, `components/*.tsx`, `PRODUCT.md`, `DESIGN.md`.
 */
export type ProjectFiles = Record<string, string>;

/** One file write; `content: null` deletes the file. */
export type FileChange = { path: string; content: string | null };

/** One file of an export (code, images, PDF), relative to the export folder. `base64` holds bytes. */
export type ExportFile = { path: string; content: string; encoding?: "utf8" | "base64" };

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
	/** Assistant replies: the context files the generation followed */
	context?: ContextFileName[];
};

/** A project is a folder (`my-app.rabisco/`). Its absolute path is its id. */
export type Project = {
	path: string;
	canvas: CanvasDoc;
	files: ProjectFiles;
	/** From `chat.jsonl` */
	messages: ChatMessage[];
};

/** Everything a frame needs to render one screen on its own (thumbnails). */
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
	/** First frame, used as the card thumbnail */
	cover: ScreenSource | null;
	/** The folder was moved or deleted since it was last opened */
	missing: boolean;
};

/** Output of the Phase 0 mock generator (development only). */
export type GenerateScreensResult = {
	/** Files to write. The editor applies them as one undoable step. */
	changes: FileChange[];
	/** Frames for the new screens, laid out from the canvas origin; the editor offsets them. */
	frames: Frame[];
	reply: string;
};

/** Starts a real generation (decision 0003). The main process reads the project files and chat from disk. */
export type GenerateParams = {
	generationId: string;
	projectPath: string;
	prompt: string;
	device: Device;
	/** `ModelRef`: `<providerId>:<modelId>` */
	model: string;
	/** Screens or components to change. Empty or missing: create new screens. */
	targets?: string[];
	/**
	 * `repair`: fix `problems` in `targets` (render errors the frames reported).
	 * `context`: write the one context file in `targets` (`["DESIGN.md"]` or `["PRODUCT.md"]`).
	 * `vary`: write new alternates of the one screen in `targets` (`*.alt-N.tsx`), leaving it as it is.
	 */
	task?: "create" | "edit" | "repair" | "context" | "vary";
	/**
	 * How many variations to generate (1 to `MAX_VARIATIONS`), for `create` and `vary`. They run
	 * as parallel generations of the same task; Rabisco names the extra ones `*.alt-N.tsx` (decision 0004).
	 */
	variations?: number;
	/** Files the provider reads but must not change, e.g. the variation a "Mix" takes a section from */
	references?: string[];
	/**
	 * Point and prompt: an `edit` of the one element (`targets` is `[focus.file]`). The main process
	 * checks it against the file on disk and drops it when the element is gone.
	 */
	focus?: ElementFocus;
	problems?: Problem[];
	attachments?: Attachment[];
};

export type GenerationFailure = {
	code: ProviderErrorCode;
	message: string;
	retryable: boolean;
	/** What the user can do about it, e.g. "Run `claude` in a terminal and log in" */
	fix?: string;
	/** The provider that failed, so the UI can open its settings */
	providerId?: string;
};

export type GenerateResult =
	| {
			ok: true;
			/** Validated files to write. The editor applies them as one undoable step. */
			changes: FileChange[];
			/** Frames for new screens, laid out from the canvas origin; the editor offsets them. */
			frames: Frame[];
			reply: string;
			/** Problems left after the automatic repairs; those files were not written */
			problems: Problem[];
			usage?: Usage;
			/** Context files that had content and went into the request: what shaped this result */
			context: ContextFileName[];
	  }
	| { ok: false; error: GenerationFailure };

/** One provider event, pushed to the webview while a generation runs. `attempt` 1 is the first try, then repairs. */
export type GenerationEventMessage = {
	generationId: string;
	attempt: number;
	/**
	 * Which of the parallel variations sent it, from 0. Paths are already the final names
	 * (`*.alt-N.tsx` for the extra variations). Missing for single generations.
	 */
	variant?: number;
	event: GenerationEvent;
};
