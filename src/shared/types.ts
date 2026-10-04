export type Device = "mobile" | "desktop";

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

/** Variation group (Phase 4, decision 0004). Stored now so the format doesn't change later. */
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
};

/**
 * Text files of a project, keyed by project-relative path with forward slashes:
 * `screens/*.tsx`, `components/*.tsx`, `PRODUCT.md`, `DESIGN.md`.
 */
export type ProjectFiles = Record<string, string>;

/** One file write; `content: null` deletes the file. */
export type FileChange = { path: string; content: string | null };

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
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

export type GenerationStep = {
	generationId: string;
	label: string;
	detail?: string;
};

export type GenerateScreensParams = {
	generationId: string;
	projectPath: string;
	prompt: string;
	device: Device;
	model: string;
	/** Paths that already exist, so new files get unique names */
	existingFiles: string[];
};

export type GenerateScreensResult = {
	/** Files to write. The editor applies them as one undoable step. */
	changes: FileChange[];
	/** Frames for the new screens, laid out from the canvas origin; the editor offsets them. */
	frames: Frame[];
	reply: string;
};
