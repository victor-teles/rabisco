/**
 * The contract between Rabisco and every AI provider (CLI, SDK or API).
 * Decision record: docs/decisions/0003-ai-provider-contract.md
 *
 * One rule shapes all of it: a provider's only way to change a design is to
 * write files. Rabisco validates, names, places and renders them.
 */

import type { Device } from "../types";

// ---------------------------------------------------------------- providers

export type ProviderKind = "cli" | "sdk" | "api";

export type ProviderCapabilities = {
	/** Emits file and message deltas while generating */
	streaming: boolean;
	/** Accepts images (screenshots, sketches) as input */
	images: boolean;
	/** Edits files itself, through tools in a staging directory (CLI and SDK agents) */
	agentic: boolean;
	/** Approximate context window, in tokens */
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

	/** Checks that the CLI is installed, the key is valid or the endpoint answers */
	health(): Promise<ProviderHealth>;
	listModels(): Promise<ProviderModel[]>;

	/**
	 * Runs one generation. Implementations must stop promptly when `signal`
	 * aborts, and must end the stream with exactly one `done` or `error` event.
	 */
	generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent>;
}

// ---------------------------------------------------------------- request

export type GenerationTask =
	/** New screens from a prompt */
	| "create"
	/** Change existing screens or components */
	| "edit"
	/** Fix files that failed validation; `request.problems` lists the errors */
	| "repair"
	/** Write PRODUCT.md or DESIGN.md (the one path in `targets`) from the prompt and the project's screens */
	| "context";

export type ProjectFile = {
	/** Project-relative path with forward slashes, e.g. `screens/welcome.tsx` */
	path: string;
	content: string;
};

export type Attachment = {
	name: string;
	mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
	/** Base64-encoded bytes */
	data: string;
};

export type Problem = {
	path: string;
	message: string;
	line?: number;
};

/** A project component as the prompt lists it: one signature per exported component. */
export type ComponentSignature = {
	/** `components/<kebab>.tsx` */
	path: string;
	/** e.g. `StatCard({ label: string; tone?: "default" | "success" = "default" })` */
	signature: string[];
	/** Files that import it */
	usedBy?: string[];
};

/** One JSX element of a file, as the file is now (`src/shared/ai/focus.ts` builds it) */
export type ElementFocus = {
	/** Project-relative path of the file it is in */
	file: string;
	/** Source offsets: `<` of the opening tag to the end of the closing tag (or of `/>`) */
	start: number;
	end: number;
	/** 1-based lines of `start` and of the last character */
	startLine: number;
	endLine: number;
	/** The element's source, `start` to `end` */
	snippet: string;
	/** Readable name for people and prompts: `<Button> “Get started”`, `<section#pricing>` */
	label: string;
};

export type GenerationRequest = {
	id: string;
	task: GenerationTask;
	model: string;
	prompt: string;
	device: Device;

	/** The project's own instructions; always included when present */
	context: {
		product?: string; // PRODUCT.md
		design?: string; // DESIGN.md
	};

	/**
	 * Files the provider may read: the targets of an edit, the components it can
	 * reuse, and the screens that give it style. Agentic providers also get these
	 * on disk, in their staging directory.
	 */
	files: ProjectFile[];

	/**
	 * Every component in the project, built from all of its files, so the
	 * catalog is complete even when component sources don't fit in `files`.
	 * The provider must reuse these before writing new markup.
	 */
	components?: ComponentSignature[];

	/** For `edit` and `repair`: the files the change is about */
	targets?: string[];

	/** For `repair`: what failed validation in the previous attempt */
	problems?: Problem[];

	/** Paths in `files` the provider reads but must not change, e.g. the variation a "Mix" takes a section from. Writes to them are dropped. */
	references?: string[];

	/**
	 * Set when the request is one of several parallel generations of the same
	 * task (decision 0003): the prompt asks for a direction distinct from the
	 * others. `index` is 0-based. Paths stay logical; Rabisco renames the results.
	 */
	variation?: { index: number; count: number };

	/**
	 * Point and prompt: for an `edit` of `focus.file`, the one element the
	 * request is about. The provider changes that element (plus the imports or
	 * helper it needs) and keeps the rest of the file as it is. Repairs keep it.
	 */
	focus?: ElementFocus;

	attachments?: Attachment[];

	/** Earlier turns of the conversation, oldest first */
	history?: { role: "user" | "assistant"; content: string }[];
};

// ---------------------------------------------------------------- events

export type FileKind = "screen" | "component" | "context";

/** Metadata for a new screen; ignored for components and for edits to existing files */
export type ScreenMeta = {
	name: string;
	device?: Device;
};

export type GenerationEvent =
	/** Progress the user should see: a thinking summary, a tool call, a step */
	| { type: "status"; label: string; detail?: string }
	/** Assistant text for the chat, streamed */
	| { type: "message.delta"; text: string }
	/** A file write begins. `path` is the logical path; Rabisco may rename it (alternates). */
	| { type: "file.start"; path: string; kind: FileKind; screen?: ScreenMeta }
	/** Streamed file content, appended in order. Optional: only for streaming providers. */
	| { type: "file.delta"; path: string; text: string }
	/** A file write ends. `content` is the complete file and is the only content Rabisco trusts. */
	| { type: "file.end"; path: string; content: string }
	| { type: "file.delete"; path: string }
	| { type: "done"; usage?: Usage }
	/** `fix` tells the user what to do, e.g. "Run `claude` in a terminal and log in" */
	| { type: "error"; code: ProviderErrorCode; message: string; retryable: boolean; fix?: string };

export type Usage = {
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
};

export type ProviderErrorCode =
	| "not_installed" // CLI binary missing
	| "not_authenticated" // CLI logged out, missing or invalid key
	| "rate_limited"
	| "context_too_large"
	| "invalid_output" // nothing usable could be parsed
	| "aborted"
	| "network"
	| "unknown";

// ---------------------------------------------------------------- file rules

/**
 * What a provider may write. Rabisco rejects anything else before it reaches
 * the canvas, and sends the problems back as a `repair` task.
 */
export const FILE_RULES = {
	/** Writable locations, by kind */
	paths: {
		screen: /^screens\/[a-z0-9]+(?:-[a-z0-9]+)*\.tsx$/,
		component: /^components\/[a-z0-9]+(?:-[a-z0-9]+)*\.tsx$/,
		/** Only for the `context` task, and only the file in `targets` */
		context: /^(?:PRODUCT|DESIGN)\.md$/,
	},
	/** Allowed import specifiers; local imports must point to existing or co-written files */
	imports: [/^react$/, /^lucide-react$/, /^@\/components\/ui\/[a-z0-9-]+$/, /^@\/lib\/utils$/, /^\.\.?\/components\/[a-z0-9-]+$/, /^\.\/[a-z0-9-]+$/],
	/** Screens default-export one React component; components use named exports */
	exports: { screen: "default", component: "named" },
	/** Upper bound for a single file, in characters */
	maxFileLength: 60_000,
	/** How many automatic repair attempts before the error goes to the user */
	maxRepairAttempts: 2,
} as const;

// ---------------------------------------------------------------- text protocol (API providers)

/**
 * API providers return text. They are told to wrap every file in a tag, which
 * Rabisco parses into the same events agentic providers produce:
 *
 *   <rabisco-file path="screens/welcome.tsx" kind="screen" name="Welcome" device="mobile">
 *   ...complete TSX...
 *   </rabisco-file>
 *
 *   <rabisco-delete path="screens/old.tsx" />
 *
 * Text outside tags becomes `message.delta`. Files are always complete: no
 * diffs, no placeholders such as "rest unchanged".
 */
export const TEXT_PROTOCOL = {
	fileOpen: /<rabisco-file\s+([^>]*)>/,
	fileClose: "</rabisco-file>",
	delete: /<rabisco-delete\s+path="([^"]+)"\s*\/>/,
} as const;
