// Decision record: docs/decisions/0003-ai-provider-contract.md

import type { Device } from "../types";

export type ProviderKind = "cli" | "sdk" | "api";

export type ProviderCapabilities = {
	streaming: boolean;
	images: boolean;
	/** Edits files itself, through tools in a staging directory (CLI and SDK agents) */
	agentic: boolean;
	/** Approximate, in tokens */
	maxContextTokens: number;
};

export type ProviderModel = {
	id: string;
	label: string;
};

export type ProviderHealth =
	| { ok: true; version?: string }
	| { ok: false; code: ProviderErrorCode; message: string; fix?: string };

export interface Provider {
	readonly id: string;
	readonly kind: ProviderKind;
	readonly label: string;
	readonly capabilities: ProviderCapabilities;

	health(): Promise<ProviderHealth>;
	listModels(): Promise<ProviderModel[]>;

	/** Must stop promptly on abort and end the stream with exactly one `done` or `error` event. */
	generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent>;

	/** The user's and the project's own commands for this tool, run as `/name args` from the chat */
	listCommands?(projectPath: string): Promise<ProviderCommand[]>;
	/** The prompt `/name args` stands for, or `null` when there is no such command */
	expandCommand?(projectPath: string, name: string, args: string): Promise<string | null>;
}

export type ProviderCommand = {
	/** Without the slash; nested folders join with `:` (`git:commit`) */
	name: string;
	description: string;
	argumentHint?: string;
	source: "user" | "project";
};

export type GenerationTask =
	| "create"
	| "edit"
	/** Fix files that failed validation; `request.problems` lists the errors */
	| "repair"
	/** Write PRODUCT.md or DESIGN.md (the one path in `targets`) */
	| "context"
	/** Read the theme tokens from `context.design`; the reply holds them, and no file is written (decision 0009) */
	| "theme";

export type ProjectFile = {
	/** Project-relative, forward slashes */
	path: string;
	content: string;
};

export type Attachment = {
	name: string;
	mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
	/** Base64 */
	data: string;
};

export type Problem = {
	path: string;
	message: string;
	line?: number;
};

export type ComponentSignature = {
	path: string;
	/** e.g. `StatCard({ label: string; tone?: "default" | "success" = "default" })` */
	signature: string[];
	usedBy?: string[];
};

export type ElementFocus = {
	file: string;
	/** Source offsets: `<` of the opening tag to the end of the closing tag (or of `/>`) */
	start: number;
	end: number;
	/** 1-based */
	startLine: number;
	endLine: number;
	snippet: string;
	/** e.g. `<Button> “Get started”`, `<section#pricing>` */
	label: string;
};

export type GenerationRequest = {
	id: string;
	task: GenerationTask;
	model: string;
	prompt: string;
	device: Device;

	context: {
		product?: string;
		design?: string;
	};

	/** Agentic providers also get these on disk, in their staging directory. */
	files: ProjectFile[];

	/** Built from all project files, so the catalog is complete even when sources don't fit in `files`. */
	components?: ComponentSignature[];

	targets?: string[];

	problems?: Problem[];

	/** Paths in `files` the provider reads but must not change; writes to them are dropped. */
	references?: string[];

	/** One of several parallel generations of the same task; `index` is 0-based. */
	variation?: { index: number; count: number };

	/** For an `edit` of `focus.file`: the one element to change, keeping the rest of the file. */
	focus?: ElementFocus;

	attachments?: Attachment[];

	/** Oldest first */
	history?: { role: "user" | "assistant"; content: string }[];
};

export type FileKind = "screen" | "component" | "context";

/** Ignored for components and for edits to existing files */
export type ScreenMeta = {
	name: string;
	device?: Device;
};

export type GenerationEvent =
	| { type: "status"; label: string; detail?: string }
	| { type: "message.delta"; text: string }
	/** `path` is logical; Rabisco may rename it (alternates). */
	| { type: "file.start"; path: string; kind: FileKind; screen?: ScreenMeta }
	/** Optional: only for streaming providers. */
	| { type: "file.delta"; path: string; text: string }
	/** `content` is the complete file and is the only content Rabisco trusts. */
	| { type: "file.end"; path: string; content: string }
	| { type: "file.delete"; path: string }
	| { type: "done"; usage?: Usage }
	| { type: "error"; code: ProviderErrorCode; message: string; retryable: boolean; fix?: string };

export type Usage = {
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
};

export type ProviderErrorCode =
	| "not_installed"
	| "not_authenticated"
	| "rate_limited"
	| "context_too_large"
	| "invalid_output"
	| "aborted"
	| "network"
	| "unknown";

/** Anything else is rejected before it reaches the canvas and sent back as a `repair` task. */
export const FILE_RULES = {
	paths: {
		screen: /^screens\/[a-z0-9]+(?:-[a-z0-9]+)*\.tsx$/,
		component: /^components\/[a-z0-9]+(?:-[a-z0-9]+)*\.tsx$/,
		/** Only for the `context` task, and only the file in `targets` */
		context: /^(?:PRODUCT|DESIGN)\.md$/,
	},
	/** Local imports must point to existing or co-written files */
	imports: [
		/^react$/,
		/^lucide-react$/,
		/^@\/components\/ui\/[a-z0-9-]+$/,
		/^@\/lib\/utils$/,
		/^\.\.?\/components\/[a-z0-9-]+$/,
		/^\.\/[a-z0-9-]+$/,
	],
	exports: { screen: "default", component: "named" },
	/** In characters */
	maxFileLength: 60_000,
	maxRepairAttempts: 2,
} as const;

/** API providers wrap every file in `<rabisco-file>` tags; text outside tags becomes `message.delta`. */
export const TEXT_PROTOCOL = {
	fileOpen: /<rabisco-file\s+([^>]*)>/,
	fileClose: "</rabisco-file>",
	delete: /<rabisco-delete\s+path="([^"]+)"\s*\/>/,
} as const;
