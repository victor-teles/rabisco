import {
	FILE_RULES,
	type Attachment,
	type ComponentSignature,
	type ElementFocus,
	type GenerationEvent,
	type GenerationRequest,
	type GenerationTask,
	type Problem,
	type ProjectFile,
	type Provider,
	type ProviderErrorCode,
	type Usage,
} from "../../shared/ai/contract";
import { componentSignatures } from "../../shared/components/usages";
import { contextBody } from "../../shared/context/body";
import { resolveFocus } from "../../shared/ai/focus";
import { isComponentFile, isScreenFile } from "../../shared/project";
import type { ContextFileName, Device, FileChange, ProjectFiles } from "../../shared/types";
import { focusNotes } from "./focus-guard";
import { validateFiles, type ValidateOptions } from "./validate";

/** A generation that produced nothing usable: the provider failed on the first attempt, or it was aborted. */
export class GenerationError extends Error {
	code: ProviderErrorCode;
	retryable: boolean;
	fix?: string;
	constructor(code: ProviderErrorCode, message: string, retryable: boolean, fix?: string) {
		super(message);
		this.name = "GenerationError";
		this.code = code;
		this.retryable = retryable;
		this.fix = fix ?? FIXES[code];
	}
}

const FIXES: Partial<Record<ProviderErrorCode, string>> = {
	not_installed: "Install the CLI, or set its path in Settings → Providers.",
	not_authenticated: "Sign in to the CLI, or check the API key in Settings → Providers.",
	rate_limited: "Wait a moment and try again.",
	context_too_large: "Select fewer screens, or pick a model with a larger context window.",
	network: "Check your connection or the provider's base URL.",
};

export type RunOptions = {
	provider: Provider;
	request: GenerationRequest;
	/** Current project files (for validation and for repair requests) */
	projectFiles: ProjectFiles;
	signal: AbortSignal;
	/** Every event, forwarded live (status, message.delta, file.*), tagged with the attempt number */
	onEvent: (event: GenerationEvent, attempt: number) => void;
	/** Alternate names Rabisco assigns live (a variation run); validation accepts them */
	alternates?: ReadonlySet<string>;
};

export type RunResult = {
	/** Validated changes; files that still fail after the repair attempts are left out (the last valid version stays) */
	changes: FileChange[];
	reply: string;
	/** Problems left after the last attempt; shown to the user */
	problems: Problem[];
	/** Non-fatal remarks for the reply, e.g. a focused edit that changed its file outside the element */
	notes: string[];
	usage?: Usage;
	attempts: number;
};

type Attempt = {
	written: Map<string, string>;
	deleted: Set<string>;
	reply: string;
	usage?: Usage;
	error?: { code: ProviderErrorCode; message: string; retryable: boolean; fix?: string };
};

const abortedError = () => new GenerationError("aborted", "Generation stopped.", true);

/** Runs one provider stream to its end, collecting files (last write wins) and the reply. */
async function collect(
	provider: Provider,
	request: GenerationRequest,
	signal: AbortSignal,
	onEvent: (event: GenerationEvent) => void,
): Promise<Attempt> {
	const attempt: Attempt = { written: new Map(), deleted: new Set(), reply: "" };
	try {
		for await (const event of provider.generate(request, signal)) {
			if (signal.aborted) throw abortedError();
			onEvent(event);
			switch (event.type) {
				case "message.delta":
					attempt.reply += event.text;
					break;
				case "file.end":
					attempt.written.set(event.path, event.content);
					attempt.deleted.delete(event.path);
					break;
				case "file.delete":
					attempt.deleted.add(event.path);
					attempt.written.delete(event.path);
					break;
				case "done":
					attempt.usage = event.usage;
					break;
				case "error":
					attempt.error = { code: event.code, message: event.message, retryable: event.retryable, fix: event.fix };
					break;
			}
			if (event.type === "done" || event.type === "error") break;
		}
	} catch (error) {
		if (error instanceof GenerationError) throw error;
		if (signal.aborted) throw abortedError();
		attempt.error = { code: "unknown", message: error instanceof Error ? error.message : String(error), retryable: true };
	}
	if (signal.aborted || attempt.error?.code === "aborted") throw abortedError();
	return attempt;
}

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
	if (!a) return b;
	if (!b) return a;
	const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
	return { inputTokens: sum(a.inputTokens, b.inputTokens), outputTokens: sum(a.outputTokens, b.outputTokens), costUsd: sum(a.costUsd, b.costUsd) };
}

const toFiles = (written: Map<string, string>): ProjectFile[] => [...written].map(([path, content]) => ({ path, content }));

/**
 * Validates `written`, then drops failing files and re-checks the rest until
 * stable, so a screen that imports a dropped component is dropped too.
 */
function settle(written: Map<string, string>, deleted: Set<string>, project: ProjectFiles, options: ValidateOptions) {
	const kept = new Map(written);
	const keptDeletes = new Set(deleted);
	const problems: Problem[] = [];
	for (;;) {
		const found = validateFiles(toFiles(kept), project, [...keptDeletes], options);
		if (!found.length) break;
		problems.push(...found);
		for (const { path } of found) {
			kept.delete(path);
			keptDeletes.delete(path);
		}
	}
	return { kept, keptDeletes, problems };
}

/**
 * Runs a generation and its repair loop (decision 0003): collects the files,
 * validates them, and sends up to `FILE_RULES.maxRepairAttempts` repair
 * requests for the files that fail. Repaired files replace earlier versions.
 * Throws `GenerationError` when the first attempt fails or the run is aborted.
 */
export async function runGeneration(options: RunOptions): Promise<RunResult> {
	const { provider, request, projectFiles, signal, onEvent } = options;
	if (signal.aborted) throw abortedError();

	const first = await collect(provider, request, signal, (event) => onEvent(event, 1));
	if (first.error) throw new GenerationError(first.error.code, first.error.message, first.error.retryable, first.error.fix);

	const written = first.written;
	const deleted = first.deleted;
	let usage = first.usage;
	let attempts = 1;
	const contextTarget = contextTargetOf(request);
	const validation: ValidateOptions = contextTarget ? { contextTarget } : options.alternates ? { alternates: options.alternates } : {};
	let problems = validateFiles(toFiles(written), projectFiles, [...deleted], validation);

	while (problems.length && attempts <= FILE_RULES.maxRepairAttempts) {
		// A context task only repairs its target; anything else it wrote is dropped
		const targets = [...new Set(problems.map((p) => p.path))].filter((path) => written.has(path) && (!contextTarget || path === contextTarget));
		if (!targets.length) break;
		attempts++;
		const repair = buildRepairRequest(request, attempts, targets, problems, written, deleted, projectFiles);
		const result = await collect(provider, repair, signal, (event) => onEvent(event, attempts));
		usage = addUsage(usage, result.usage);
		if (result.error) break;
		for (const [path, content] of result.written) {
			written.set(path, content);
			deleted.delete(path);
		}
		for (const path of result.deleted) {
			deleted.add(path);
			written.delete(path);
		}
		problems = validateFiles(toFiles(written), projectFiles, [...deleted], validation);
	}

	const settled = problems.length ? settle(written, deleted, projectFiles, validation) : { kept: written, keptDeletes: deleted, problems: [] };
	const changes: FileChange[] = [
		...[...settled.kept].map(([path, content]) => ({ path, content })),
		...[...settled.keptDeletes].map((path) => ({ path, content: null })),
	];
	const notes = focusNotes(request.focus, projectFiles, changes);
	return { changes, reply: first.reply.trim(), problems: dedupeProblems(settled.problems), notes, usage, attempts };
}

export function dedupeProblems(problems: Problem[]) {
	const seen = new Set<string>();
	return problems.filter((p) => {
		const key = `${p.path}\0${p.line ?? ""}\0${p.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The file a `context` task writes, or undefined for other tasks. */
export function contextTargetOf(request: GenerationRequest): ContextFileName | undefined {
	const target = request.task === "context" ? request.targets?.[0] : undefined;
	return target && FILE_RULES.paths.context.test(target) ? (target as ContextFileName) : undefined;
}

/** The context files that went into a request: what shapes its result. */
export function contextFilesOf(request: GenerationRequest): ContextFileName[] {
	const used: ContextFileName[] = [];
	if (contextBody(request.context.product)) used.push("PRODUCT.md");
	if (contextBody(request.context.design)) used.push("DESIGN.md");
	return used;
}

/**
 * A `repair` request: the failing files as written, plus every component they
 * may import. Context comes along from the original request, and so does the
 * focus: the prompt reminds the model which element the edit was about.
 */
function buildRepairRequest(
	original: GenerationRequest,
	attempt: number,
	targets: string[],
	problems: Problem[],
	written: Map<string, string>,
	deleted: Set<string>,
	project: ProjectFiles,
): GenerationRequest {
	const files = new Map<string, string>();
	for (const path of targets) files.set(path, written.get(path)!);
	const components = { ...project, ...Object.fromEntries(written) };
	for (const [path, content] of Object.entries(components)) {
		if (isComponentFile(path) && !deleted.has(path) && !files.has(path)) files.set(path, content);
	}
	return {
		...original,
		id: `${original.id}-repair-${attempt - 1}`,
		task: "repair",
		files: toFiles(files),
		targets,
		problems: problems.filter((p) => targets.includes(p.path)),
		attachments: undefined,
	};
}

// ---------------------------------------------------------------- requests

export type BuildRequestParams = {
	id: string;
	task: Exclude<GenerationTask, "repair">;
	prompt: string;
	device: Device;
	/** Model id inside the provider (not the `ModelRef`) */
	model: string;
	projectFiles: ProjectFiles;
	/** For `edit`: the files the change is about. For `context`: the one file to write (`PRODUCT.md` or `DESIGN.md`). */
	targets?: string[];
	/** Files to read but not change; always included, like targets */
	references?: string[];
	/** Point and prompt, for `edit`: kept when its file is a target and the element is still in it (`resolveFocus`) */
	focus?: ElementFocus;
	attachments?: Attachment[];
	history?: GenerationRequest["history"];
	/** Upper bound for context + files, in characters */
	maxChars?: number;
	/** How many other screens to include for style (default 2; every screen that fits when writing DESIGN.md) */
	styleScreens?: number;
};

export const DEFAULT_REQUEST_CHARS = 150_000;

/** `{ components }` for a request: every component file with its signatures and users, or nothing when there are none. */
function componentCatalog(files: ProjectFiles): { components?: ComponentSignature[] } {
	const components = componentSignatures(files);
	return components.length ? { components } : {};
}

/**
 * Builds a request from editor-level params: PRODUCT.md and DESIGN.md as
 * context, then the edit targets and references, every component and a few
 * screens for style. Style screens are dropped first, then components, to stay
 * within `maxChars`; targets and references are always included. The component
 * catalog (`components`: signatures from the whole project) is always included.
 *
 * A context file goes in as written (agents get the real file on disk; the
 * prompt strips its comments), and only when `contextBody` finds something in
 * it: an untouched template is no context. A `context` task gets the file it
 * writes as its target, in `files` when it exists, and not as context.
 */
export function buildGenerationRequest(params: BuildRequestParams): GenerationRequest {
	const files = params.projectFiles;
	const maxChars = params.maxChars ?? DEFAULT_REQUEST_CHARS;
	const contextTarget = params.task === "context" ? params.targets?.find((path) => FILE_RULES.paths.context.test(path)) : undefined;
	const context: GenerationRequest["context"] = {};
	if (contextTarget !== "PRODUCT.md" && contextBody(files["PRODUCT.md"])) context.product = files["PRODUCT.md"];
	if (contextTarget !== "DESIGN.md" && contextBody(files["DESIGN.md"])) context.design = files["DESIGN.md"];

	const targets = contextTarget ? [contextTarget] : (params.targets ?? []).filter((path) => path in files && !FILE_RULES.paths.context.test(path));
	const styleScreens = params.styleScreens ?? (contextTarget === "DESIGN.md" ? Infinity : 2);
	let used = (contextBody(context.product)?.length ?? 0) + (contextBody(context.design)?.length ?? 0);
	const picked: ProjectFile[] = [];
	const add = (path: string, required = false) => {
		const content = files[path]!;
		if (!required && used + content.length > maxChars) return;
		used += content.length;
		picked.push({ path, content });
	};

	const focus = params.task === "edit" && params.focus && targets.includes(params.focus.file) ? resolveFocus(params.focus, files) : null;
	const references = contextTarget
		? []
		: [...new Set(params.references ?? [])].filter((path) => path in files && !targets.includes(path) && !FILE_RULES.paths.context.test(path));
	const required = [...targets, ...references];
	for (const path of required) if (path in files) add(path, true);
	const components = Object.keys(files)
		.filter((path) => isComponentFile(path) && !required.includes(path))
		.sort();
	for (const path of components) add(path);
	// Plain screens only (not alternates), smallest first so more of them fit
	const screens = Object.keys(files)
		.filter((path) => isScreenFile(path) && !path.includes(".alt-") && !required.includes(path))
		.sort((a, b) => files[a]!.length - files[b]!.length || a.localeCompare(b))
		.slice(0, styleScreens);
	for (const path of screens) add(path);

	return {
		id: params.id,
		task: params.task,
		model: params.model,
		prompt: params.prompt,
		device: params.device,
		context,
		files: picked,
		...(contextTarget ? {} : componentCatalog(files)),
		...(targets.length ? { targets } : {}),
		...(references.length ? { references } : {}),
		...(focus ? { focus } : {}),
		...(params.attachments?.length ? { attachments: params.attachments } : {}),
		...(params.history?.length ? { history: params.history } : {}),
	};
}
