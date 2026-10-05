import type { GenerationEvent, GenerationRequest, ScreenMeta } from "../../shared/ai/contract";
import type { ProviderStatus } from "../../shared/ai/settings";
import { framesForNewScreens, isScreenFile } from "../../shared/project";
import {
	clampVariations,
	combineVariations,
	createVariantRenamer,
	variationsNote,
	type VariantOutput,
} from "../../shared/ai/variants";
import type { RabiscoRPC } from "../../shared/rpc";
import { contextBody } from "../../shared/context/body";
import { resolveFocus } from "../../shared/ai/focus";
import { DESIGN_TEMPLATE } from "../../shared/context/templates";
import type {
	ContextFileName,
	GenerateParams,
	GenerationEventMessage,
	GenerationFailure,
	ProjectFiles,
} from "../../shared/types";
import { INTERVIEW_QUESTIONS, productFromAnswers } from "./interview";

type Requests = RabiscoRPC["bun"]["requests"];

type Handler<K extends keyof Requests> = (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;

type BrowserGenerator = {
	[
		K in
			| "generate"
			| "stopGeneration"
			| "listProviders"
			| "addProvider"
			| "updateProvider"
			| "removeProvider"
			| "testProvider"
			| "setDefaultModel"
	]: Handler<K>;
};

const MOCK_STATUS: ProviderStatus = {
	id: "mock",
	type: "mock",
	kind: "api",
	label: "Mock (dev)",
	enabled: true,
	capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 0 },
	health: { ok: true },
	models: [{ id: "mock", label: "Mock (dev)" }],
};

type VariantRun = VariantOutput & { reply: string };

/** An `error` event of the mock provider, carried out of a variant's run. */
class MockGenerationError extends Error {
	readonly failure: GenerationFailure;

	constructor(failure: GenerationFailure) {
		super(failure.message);
		this.failure = failure;
	}
}

function failureOf(cause: unknown): GenerationFailure {
	if (cause instanceof MockGenerationError) return cause.failure;

	return { code: "unknown", message: cause instanceof Error ? cause.message : String(cause), retryable: true };
}

const CONTEXT_FILES: ContextFileName[] = ["PRODUCT.md", "DESIGN.md"];

/** DESIGN.md for the browser: the template with a filled Tokens section */
const BROWSER_DESIGN = DESIGN_TEMPLATE.replace(
	/(## Tokens\n\n)<!--[\s\S]*?-->/,
	`$1- primary: oklch(0.55 0.2 264)\n- primary-foreground: #ffffff\n- radius: 0.75rem\n- font-sans: "Inter", system-ui, sans-serif\n\n### Dark\n\n- primary: oklch(0.7 0.15 264)`,
);

/** PRODUCT.md for the browser: the interview answers in the prompt, assembled as they are */
function browserProduct(prompt: string) {
	const answers = INTERVIEW_QUESTIONS.map(({ question }) => {
		const at = prompt.indexOf(`Q: ${question}\nA: `);

		return at === -1
			? ""
			: prompt
					.slice(at + question.length + 7)
					.split("\n\nQ: ")[0]!
					.trim();
	});

	if (!answers.some(Boolean)) answers[0] = prompt.trim();

	return productFromAnswers({ step: answers.length, answers }, "Product");
}

/** The deterministic `context` task: writes the target file without a model, streamed like a real one. */
async function* contextEvents(params: GenerateParams): AsyncGenerator<GenerationEvent> {
	const path = params.targets?.[0] === "DESIGN.md" ? "DESIGN.md" : "PRODUCT.md";
	const content = path === "DESIGN.md" ? BROWSER_DESIGN : browserProduct(params.prompt);
	yield { type: "status", label: path === "DESIGN.md" ? "Reading your screens" : "Reading your answers" };
	await new Promise((resolve) => setTimeout(resolve, 300));
	yield { type: "file.start", path, kind: "context" };
	yield { type: "file.delta", path, text: content };
	yield { type: "file.end", path, content };
	yield { type: "done", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
}

/** The mock provider, in development builds only (the guard lets production builds drop it) */
async function mockEvents(request: GenerationRequest, signal: AbortSignal) {
	if (!import.meta.env.DEV) throw new Error("The mock provider is only available in development.");
	const { createMockProvider } = await import("../../bun/ai/providers/mock");

	return createMockProvider().generate(request, signal);
}

const unsupported = async (): Promise<never> => {
	throw new Error("AI providers run in the desktop app. In the browser, only the mock generator is available.");
};

/**
 * Generation for the browser fallback (`hutch run hmr`): the mock provider only,
 * without validation. Variations, "vary" and references are named and laid out
 * like the main process does (`src/shared/ai/variants.ts`). The mock is imported in development builds only, so it
 * never ships.
 */
export function createBrowserGenerator(
	emit: (message: GenerationEventMessage) => void,
	readFiles: (path: string) => ProjectFiles,
): BrowserGenerator {
	const running = new Map<string, AbortController>();

	return {
		async listProviders() {
			return {
				settings: { version: 1, providers: [], defaultModel: "mock:mock" },
				statuses: import.meta.env.DEV ? [MOCK_STATUS] : [],
			};
		},
		async testProvider() {
			return MOCK_STATUS;
		},
		addProvider: unsupported,
		updateProvider: unsupported,
		async removeProvider() {
			return { ok: true };
		},
		async setDefaultModel() {
			return { ok: true };
		},
		async stopGeneration({ generationId }) {
			running.get(generationId)?.abort();

			return { ok: true };
		},
		async generate(params) {
			const task = params.task ?? "create";

			// The context task needs no model, so it works in every build
			if (task !== "context" && !import.meta.env.DEV) {
				return {
					ok: false,
					error: { code: "not_installed", message: "No AI provider in the browser.", retryable: false },
				};
			}

			const files = readFiles(params.projectPath);
			const vary = task === "vary";

			if (vary && !(params.targets?.length === 1 && isScreenFile(params.targets[0]!) && params.targets[0]! in files)) {
				return {
					ok: false,
					error: {
						code: "unknown",
						message: "Varying needs exactly one existing screen as its target.",
						retryable: false,
					},
				};
			}

			// What shaped this result: the context files that say something (the one being written doesn't count)
			const context = CONTEXT_FILES.filter(
				(path) => contextBody(files[path]) && !(task === "context" && params.targets?.includes(path)),
			);

			const controller = new AbortController();
			running.set(params.generationId, controller);

			const requestTask: GenerationRequest["task"] =
				params.task === "vary" ? "edit" : (params.task ?? (params.targets?.length ? "edit" : "create"));

			const isCreate = requestTask === "create";
			const count = vary || isCreate ? clampVariations(params.variations) : 1;
			const variants = Array.from({ length: count }, (_, i) => (vary ? i + 1 : i));
			const multi = vary || count > 1;
			const references = (params.references ?? []).filter((path) => path in files);

			// Point and prompt: an edit of the element's file, checked like the main process does
			const focus =
				requestTask === "edit" && !vary && params.targets?.includes(params.focus?.file ?? "")
					? resolveFocus(params.focus, files)
					: null;

			const base: GenerationRequest = {
				id: params.generationId,
				task: requestTask,
				model: "mock",
				prompt: params.prompt,
				device: params.device,
				context: { product: contextBody(files["PRODUCT.md"]), design: contextBody(files["DESIGN.md"]) },
				files: Object.entries(files).map(([path, content]) => ({ path, content })),
			};

			if (params.targets?.length) base.targets = params.targets;

			if (references.length) base.references = references;

			if (focus) base.focus = focus;

			const run = async (variant: number, index: number): Promise<VariantRun> => {
				const renamer = createVariantRenamer({ variant, taken: Object.keys(files), readOnly: references });

				const request: GenerationRequest = multi ? { ...base, id: `${base.id}-v${variant}` } : base;

				if (multi && count > 1) request.variation = { index, count };

				const written = new Map<string, string>();
				const screens: Record<string, ScreenMeta | undefined> = {};
				let reply = "";
				const events = task === "context" ? contextEvents(params) : await mockEvents(request, controller.signal);

				for await (const raw of events) {
					for (const event of renamer.transform(raw)) {
						const message: GenerationEventMessage = { generationId: params.generationId, attempt: 1, event };

						if (multi) message.variant = variant;
						emit(message);

						if (event.type === "file.start" && event.kind === "screen") screens[event.path] = event.screen;
						else if (event.type === "file.end") written.set(event.path, event.content);
						else if (event.type === "message.delta") reply += event.text;
						else if (event.type === "error")
							throw new MockGenerationError({
								code: event.code,
								message: event.message,
								retryable: event.retryable,
							});
					}
				}

				return {
					variant,
					reply,
					screens,
					renames: renamer.renames,
					changes: [...written].map(([path, content]) => ({ path, content })),
				};
			};

			try {
				const settled = await Promise.allSettled(variants.map(run));
				const done = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));

				if (controller.signal.aborted)
					return { ok: false, error: { code: "aborted", message: "Generation stopped.", retryable: true } };

				const [first] = settled;

				if (!done.length && first?.status === "rejected") return { ok: false, error: failureOf(first.reason) };

				if (!multi) {
					const { changes, screens, reply } = done[0]!;
					const created = changes.filter((c) => !(c.path in files)).map((c) => c.path);

					return {
						ok: true,
						changes,
						frames: framesForNewScreens(created, screens, params.device),
						reply,
						problems: [],
						context,
					};
				}

				const combined = combineVariations({
					mode: vary ? "vary" : "create",
					outputs: done,
					projectFiles: files,
					device: params.device,
				});

				const lead = done.find((d) => d.variant === combined.primary) ?? done[0]!;
				const note = variationsNote(done.length, settled.length - done.length, combined.dropped.length);
				const reply = [lead.reply, note].filter(Boolean).join("\n\n");

				return { ok: true, changes: combined.changes, frames: combined.frames, reply, problems: [], context };
			} finally {
				running.delete(params.generationId);
			}
		},
	};
}
