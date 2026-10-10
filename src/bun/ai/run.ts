import {
	FILE_RULES,
	type Attachment,
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
import { designTokensOf, type DesignTokens } from "../../shared/context/tokens";
import { designSourceOf, hasTokens, parseThemeReply, type AppliedTheme } from "../../shared/context/theme";
import { resolveFocus } from "../../shared/ai/focus";
import { isComponentFile, isScreenFile } from "../../shared/project";
import type { ContextFileName, Device, FileChange, ProjectFiles } from "../../shared/types";
import { focusNotes } from "./focus-guard";
import { EDIT_MISMATCH_STATUS } from "./protocol";
import { validateFiles, type ValidateOptions } from "./validate";

/** The first attempt failed, or the run was aborted. */
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
	projectFiles: ProjectFiles;
	signal: AbortSignal;
	/** Tagged with the 1-based attempt number */
	onEvent: (event: GenerationEvent, attempt: number) => void;
	/** Alternate names Rabisco assigns live (a variation run); validation accepts them */
	alternates?: ReadonlySet<string>;
};

export type RunResult = {
	/** Files that still fail after the repair attempts are left out */
	changes: FileChange[];
	reply: string;
	problems: Problem[];
	/** Non-fatal remarks, e.g. a focused edit that changed its file outside the element */
	notes: string[];
	usage?: Usage;
	attempts: number;
	editFallbacks: number;
};

export const EDIT_MISMATCH_PROBLEM =
	"The <rabisco-edit> SEARCH blocks didn't match this file exactly once. Write the whole file in a <rabisco-file> tag.";

type Attempt = {
	written: Map<string, string>;
	deleted: Set<string>;
	unmatched: Set<string>;
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
	const attempt: Attempt = { written: new Map(), deleted: new Set(), unmatched: new Set(), reply: "" };

	try {
		for await (const event of provider.generate(request, signal)) {
			if (signal.aborted) throw abortedError();
			onEvent(event);

			switch (event.type) {
				case "message.delta":
					attempt.reply += event.text;
					break;
				case "status":
					if (event.label === EDIT_MISMATCH_STATUS && event.detail) attempt.unmatched.add(event.detail);
					break;
				case "file.end":
					attempt.written.set(event.path, event.content);
					attempt.deleted.delete(event.path);
					attempt.unmatched.delete(event.path);
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
		attempt.error = {
			code: "unknown",
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		};
	}

	if (signal.aborted || attempt.error?.code === "aborted") throw abortedError();

	return attempt;
}

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
	if (!a) return b;

	if (!b) return a;
	const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));

	return {
		inputTokens: sum(a.inputTokens, b.inputTokens),
		outputTokens: sum(a.outputTokens, b.outputTokens),
		costUsd: sum(a.costUsd, b.costUsd),
	};
}

const toFiles = (written: Map<string, string>): ProjectFile[] =>
	[...written].map(([path, content]) => ({ path, content }));

/** Drops failing files until stable, so a screen importing a dropped component is dropped too. */
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

/** Generation plus repair loop (decision 0003). Throws `GenerationError` if the first attempt fails or is aborted. */
export async function runGeneration(options: RunOptions): Promise<RunResult> {
	const { provider, request, projectFiles, signal, onEvent } = options;

	if (signal.aborted) throw abortedError();

	const first = await collect(provider, request, signal, (event) => onEvent(event, 1));

	if (first.error)
		throw new GenerationError(first.error.code, first.error.message, first.error.retryable, first.error.fix);

	const written = first.written;
	const deleted = first.deleted;
	let unmatched = first.unmatched;
	let editFallbacks = unmatched.size;
	let usage = first.usage;
	let attempts = 1;
	const contextTarget = contextTargetOf(request);

	const validation: ValidateOptions = contextTarget
		? { contextTarget }
		: options.alternates
			? { alternates: options.alternates }
			: {};

	const missedEdits = (): Problem[] =>
		[...unmatched].flatMap((path) => (written.has(path) ? [] : [{ path, message: EDIT_MISMATCH_PROBLEM }]));

	let problems = [...missedEdits(), ...validateFiles(toFiles(written), projectFiles, [...deleted], validation)];

	while (problems.length && attempts <= FILE_RULES.maxRepairAttempts) {
		// A context task only repairs its target; anything else it wrote is dropped
		const targets = [...new Set(problems.map((p) => p.path))].filter(
			(path) =>
				(written.has(path) || (unmatched.has(path) && path in projectFiles)) &&
				(!contextTarget || path === contextTarget),
		);

		if (!targets.length) break;
		attempts++;
		const repair = buildRepairRequest(request, attempts, targets, problems, written, deleted, projectFiles);
		const result = await collect(provider, repair, signal, (event) => onEvent(event, attempts));
		usage = addUsage(usage, result.usage);

		if (result.error) break;
		unmatched = result.unmatched;
		editFallbacks += unmatched.size;

		for (const [path, content] of result.written) {
			written.set(path, content);
			deleted.delete(path);
		}

		for (const path of result.deleted) {
			deleted.add(path);
			written.delete(path);
		}

		problems = [...missedEdits(), ...validateFiles(toFiles(written), projectFiles, [...deleted], validation)];
	}

	if (editFallbacks)
		console.info(`Generation ${request.id}: ${editFallbacks} edit(s) didn't match, so whole files were asked for`);

	const settled = problems.length
		? settle(written, deleted, projectFiles, validation)
		: { kept: written, keptDeletes: deleted, problems: [] };

	const changes: FileChange[] = [
		...[...settled.kept].map(([path, content]) => ({ path, content })),
		...[...settled.keptDeletes].map((path) => ({ path, content: null })),
	];

	const notes = focusNotes(request.focus, projectFiles, changes);

	return {
		changes,
		reply: first.reply.trim(),
		problems: dedupeProblems([...missedEdits(), ...settled.problems]),
		notes,
		usage,
		attempts,
		editFallbacks,
	};
}

export type ThemeResult = { theme: AppliedTheme; reply: string; usage?: Usage };

/** Only DESIGN.md goes in: no files, components or history. `undefined` when it has no content. */
export function buildThemeRequest(params: {
	id: string;
	model: string;
	device: Device;
	design: string | undefined;
}): GenerationRequest | undefined {
	if (!contextBody(params.design)) return undefined;

	return {
		id: params.id,
		task: "theme",
		model: params.model,
		prompt: "",
		device: params.device,
		context: { design: params.design },
		files: [],
	};
}

/** One attempt; invalid tokens are dropped, and files the provider wrote are ignored (DESIGN.md stays as it is). */
export async function runThemeReading(options: {
	provider: Provider;
	request: GenerationRequest;
	signal: AbortSignal;
	onEvent: (event: GenerationEvent) => void;
}): Promise<ThemeResult> {
	const { provider, request, signal, onEvent } = options;

	if (signal.aborted) throw abortedError();
	const attempt = await collect(provider, request, signal, onEvent);

	if (attempt.error)
		throw new GenerationError(attempt.error.code, attempt.error.message, attempt.error.retryable, attempt.error.fix);

	// Agents sometimes write the block to a file instead of replying with it
	const candidates = [attempt.reply, ...attempt.written.values()];
	const parsed = candidates.map(parseThemeReply).find(hasTokens);

	if (!parsed) {
		throw new GenerationError(
			"invalid_output",
			"The model didn't return any theme tokens Rabisco can use.",
			true,
			"Try again, or add a ## Tokens section to DESIGN.md.",
		);
	}

	const theme: AppliedTheme = { light: parsed.light, dark: parsed.dark };
	const source = designSourceOf(request.context.design);

	if (source) theme.source = source;

	return { theme, reply: attempt.reply.trim(), usage: attempt.usage };
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

export function contextTargetOf(request: GenerationRequest): ContextFileName | undefined {
	const target = request.task === "context" ? request.targets?.[0] : undefined;

	return target && isContextFileName(target) ? target : undefined;
}

const isContextFileName = (path: string): path is ContextFileName => FILE_RULES.paths.context.test(path);

export function contextFilesOf(request: GenerationRequest): ContextFileName[] {
	const used: ContextFileName[] = [];

	if (contextBody(request.context.product)) used.push("PRODUCT.md");

	if (contextBody(request.context.design)) used.push("DESIGN.md");

	return used;
}

/** Failing files plus every component they may import; keeps the original context and focus. */
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

	for (const path of targets) files.set(path, written.get(path) ?? project[path]!);
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

export type BuildRequestParams = {
	id: string;
	task: Exclude<GenerationTask, "repair" | "theme">;
	prompt: string;
	device: Device;
	/** Model id inside the provider, not the `ModelRef` */
	model: string;
	projectFiles: ProjectFiles;
	/** For `context`: the single context file to write */
	targets?: string[];
	/** Read-only files; always included, like targets */
	references?: string[];
	/** `edit` only; dropped unless its file is a target and the element still resolves */
	focus?: ElementFocus;
	attachments?: Attachment[];
	history?: GenerationRequest["history"];
	/** The applied theme (rabisco.json); DESIGN.md's tokens when missing */
	theme?: DesignTokens;
	/** Characters, context + files */
	maxChars?: number;
	/** Default 2; every screen that fits when writing DESIGN.md */
	styleScreens?: number;
};

export const DEFAULT_REQUEST_CHARS = 150_000;

/** Over `maxChars`, style screens are dropped first, then components; targets and references always stay. */
export function buildGenerationRequest(params: BuildRequestParams): GenerationRequest {
	const files = params.projectFiles;
	const maxChars = params.maxChars ?? DEFAULT_REQUEST_CHARS;

	const contextTarget =
		params.task === "context" ? params.targets?.find((path) => FILE_RULES.paths.context.test(path)) : undefined;

	const context: GenerationRequest["context"] = {};

	if (contextTarget !== "PRODUCT.md" && contextBody(files["PRODUCT.md"])) context.product = files["PRODUCT.md"];

	if (contextTarget !== "DESIGN.md" && contextBody(files["DESIGN.md"])) context.design = files["DESIGN.md"];

	const targets = contextTarget
		? [contextTarget]
		: (params.targets ?? []).filter((path) => path in files && !FILE_RULES.paths.context.test(path));

	const styleScreens = params.styleScreens ?? (contextTarget === "DESIGN.md" ? Infinity : 2);
	let used = (contextBody(context.product)?.length ?? 0) + (contextBody(context.design)?.length ?? 0);
	const picked: ProjectFile[] = [];

	const add = (path: string, required = false) => {
		const content = files[path]!;

		if (!required && used + content.length > maxChars) return;
		used += content.length;
		picked.push({ path, content });
	};

	const focus =
		params.task === "edit" && params.focus && targets.includes(params.focus.file)
			? resolveFocus(params.focus, files)
			: null;

	const references = contextTarget
		? []
		: [...new Set(params.references ?? [])].filter(
				(path) => path in files && !targets.includes(path) && !FILE_RULES.paths.context.test(path),
			);

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

	const request: GenerationRequest = {
		id: params.id,
		task: params.task,
		model: params.model,
		prompt: params.prompt,
		device: params.device,
		context,
		files: picked,
	};

	// The catalog is the whole project's components; a context task writes no markup
	const catalog = contextTarget ? [] : componentSignatures(files);

	if (catalog.length) request.components = catalog;

	const theme = params.theme ?? designTokensOf(files["DESIGN.md"]);

	if (!contextTarget && hasTokens(theme)) request.theme = { light: theme.light, dark: theme.dark };

	if (targets.length) request.targets = targets;

	if (references.length) request.references = references;

	if (focus) request.focus = focus;

	if (params.attachments?.length) request.attachments = params.attachments;

	if (params.history?.length) request.history = params.history;

	return request;
}
