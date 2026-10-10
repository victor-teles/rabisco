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
import { designSourceOf, hasTokens, parseThemeReply, type AppliedTheme } from "../../shared/context/theme";
import { resolveFocus } from "../../shared/ai/focus";
import { DESIGN_TEMPLATE } from "../../shared/context/templates";
import type {
	ContextFileName,
	GenerateParams,
	GenerateResult,
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
			| "setFastModel"
			| "improvePrompt"
	]: Handler<K>;
};

const MOCK_STATUS: ProviderStatus = {
	id: "mock",
	type: "mock",
	kind: "api",
	label: "Mock (dev)",
	enabled: true,
	capabilities: { streaming: true, images: true, agentic: false, maxContextTokens: 0 },
	health: { ok: true },
	models: [{ id: "mock", label: "Mock (dev)" }],
};

type VariantRun = VariantOutput & { reply: string };

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

const BROWSER_DESIGN = DESIGN_TEMPLATE.replace(
	/(## Tokens\n\n)<!--[\s\S]*?-->/,
	`$1- primary: oklch(0.55 0.2 264)\n- primary-foreground: #ffffff\n- radius: 0.75rem\n- font-sans: "Inter", system-ui, sans-serif\n\n### Dark\n\n- primary: oklch(0.7 0.15 264)`,
);

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

/** The `import.meta.env.DEV` guard lets production builds drop the mock. */
async function mockEvents(request: GenerationRequest, signal: AbortSignal) {
	if (!import.meta.env.DEV) throw new Error("The mock provider is only available in development.");
	const { createMockProvider } = await import("../../bun/ai/providers/mock");

	return createMockProvider().generate(request, signal);
}

/** Plans run the main process's own orchestration (`src/bun/ai/plan-run.ts`) on the mock provider, with validation */
async function planned(
	params: GenerateParams,
	files: ProjectFiles,
	context: ContextFileName[],
	signal: AbortSignal,
	emit: (message: GenerationEventMessage) => void,
): Promise<GenerateResult> {
	if (!import.meta.env.DEV) throw new Error("The mock provider is only available in development.");

	const [{ createMockProvider }, { buildPlanRequest, runPlannedCreate, runPlanReading }] = await Promise.all([
		import("../../bun/ai/providers/mock"),
		import("../../bun/ai/plan-run"),
	]);

	const provider = createMockProvider();
	const send = (event: GenerationEvent, attempt = 1) => emit({ generationId: params.generationId, attempt, event });

	try {
		if (params.task === "plan") {
			const request = buildPlanRequest({
				id: params.generationId,
				model: "mock",
				prompt: params.prompt,
				device: params.device,
				projectFiles: files,
				attachments: params.attachments,
			});

			const reading = await runPlanReading({ provider, request, projectFiles: files, signal, onEvent: send });

			return { ok: true, changes: [], frames: [], reply: "", problems: [], context, plan: reading.plan };
		}

		const result = await runPlannedCreate({
			provider,
			build: {
				id: params.generationId,
				task: "create",
				prompt: params.prompt,
				device: params.device,
				model: "mock",
				projectFiles: files,
				attachments: params.attachments,
			},
			plan: params.plan ?? { screens: [], components: [], links: [] },
			projectFiles: files,
			signal,
			onEvent: send,
		});

		return { ok: true, ...result, context };
	} catch (cause) {
		if (signal.aborted)
			return { ok: false, error: { code: "aborted", message: "Generation stopped.", retryable: true } };

		return { ok: false, error: failureOf(cause) };
	}
}

/** Mirrors `runThemeReading` in `src/bun/ai/run.ts` */
async function readTheme(
	params: GenerateParams,
	design: string | undefined,
	signal: AbortSignal,
	emit: (message: GenerationEventMessage) => void,
): Promise<GenerateResult> {
	if (!contextBody(design)) {
		return {
			ok: false,
			error: { code: "unknown", message: "DESIGN.md is empty, so there is no theme to read.", retryable: false },
		};
	}

	const request: GenerationRequest = {
		id: params.generationId,
		task: "theme",
		model: "mock",
		prompt: "",
		device: params.device,
		context: { design },
		files: [],
	};

	let reply = "";

	for await (const event of await mockEvents(request, signal)) {
		emit({ generationId: params.generationId, attempt: 1, event });

		if (event.type === "message.delta") reply += event.text;
		else if (event.type === "error")
			return { ok: false, error: { code: event.code, message: event.message, retryable: event.retryable } };
	}

	if (signal.aborted) return { ok: false, error: { code: "aborted", message: "Generation stopped.", retryable: true } };
	const parsed = parseThemeReply(reply);

	if (!hasTokens(parsed)) {
		return {
			ok: false,
			error: {
				code: "invalid_output",
				message: "The model didn't return any theme tokens Rabisco can use.",
				retryable: true,
			},
		};
	}

	const theme: AppliedTheme = { light: parsed.light, dark: parsed.dark, source: designSourceOf(design) };

	return { ok: true, changes: [], frames: [], reply: reply.trim(), problems: [], context: ["DESIGN.md"], theme };
}

const unsupported = async (): Promise<never> => {
	throw new Error("AI providers run in the desktop app. In the browser, only the mock generator is available.");
};

/** Browser fallback (`hutch run hmr`): mock provider only, no validation; mirrors `src/shared/ai/variants.ts`. */
export function createBrowserGenerator(
	emit: (message: GenerationEventMessage) => void,
	readFiles: (path: string) => ProjectFiles,
): BrowserGenerator {
	const running = new Map<string, AbortController>();
	let fastModel: string | undefined;

	return {
		async listProviders() {
			return {
				settings: { version: 1, providers: [], defaultModel: "mock:mock", fastModel },
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
		async setFastModel({ model }) {
			fastModel = model ?? undefined;

			return { ok: true };
		},
		async improvePrompt(params) {
			if (!import.meta.env.DEV) {
				return {
					ok: false,
					error: { code: "not_installed", message: "No AI provider in the browser.", retryable: false },
				};
			}

			const [{ createMockProvider }, { buildBriefRequest, runBrief }] = await Promise.all([
				import("../../bun/ai/providers/mock"),
				import("../../bun/ai/brief"),
			]);

			const files = params.projectPath ? readFiles(params.projectPath) : {};
			const controller = new AbortController();
			running.set(params.generationId, controller);

			try {
				const result = await runBrief({
					provider: createMockProvider(),
					request: buildBriefRequest({
						id: params.generationId,
						model: "mock",
						prompt: params.prompt,
						device: params.device,
						product: files["PRODUCT.md"],
						design: files["DESIGN.md"],
					}),
					signal: controller.signal,
					onEvent: (event) => emit({ generationId: params.generationId, attempt: 1, event }),
				});

				return { ok: true, brief: result.brief };
			} catch (cause) {
				if (controller.signal.aborted)
					return { ok: false, error: { code: "aborted", message: "Generation stopped.", retryable: true } };

				return { ok: false, error: failureOf(cause) };
			} finally {
				running.delete(params.generationId);
			}
		},
		async stopGeneration({ generationId }) {
			running.get(generationId)?.abort();

			return { ok: true };
		},
		async generate(params) {
			const task = params.task ?? "create";

			if (task !== "context" && !import.meta.env.DEV) {
				return {
					ok: false,
					error: { code: "not_installed", message: "No AI provider in the browser.", retryable: false },
				};
			}

			const files = readFiles(params.projectPath);

			if (task === "theme") {
				const controller = new AbortController();
				running.set(params.generationId, controller);

				try {
					return await readTheme(params, files["DESIGN.md"], controller.signal, emit);
				} catch (cause) {
					return { ok: false, error: failureOf(cause) };
				} finally {
					running.delete(params.generationId);
				}
			}

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

			const context = CONTEXT_FILES.filter(
				(path) => contextBody(files[path]) && !(task === "context" && params.targets?.includes(path)),
			);

			const controller = new AbortController();
			running.set(params.generationId, controller);

			if (task === "plan" || (task === "create" && params.plan && clampVariations(params.variations) === 1)) {
				try {
					return await planned(params, files, context, controller.signal, emit);
				} finally {
					running.delete(params.generationId);
				}
			}

			const requestTask: GenerationRequest["task"] =
				params.task === "vary" ? "edit" : (params.task ?? (params.targets?.length ? "edit" : "create"));

			const isCreate = requestTask === "create";
			const count = vary || isCreate ? clampVariations(params.variations) : 1;
			const variants = Array.from({ length: count }, (_, i) => (vary ? i + 1 : i));
			const multi = vary || count > 1;
			const references = (params.references ?? []).filter((path) => path in files);

			const focus =
				requestTask === "edit" && !vary && params.targets?.includes(params.focus?.file ?? "")
					? resolveFocus(params.focus, files)
					: null;

			const base: GenerationRequest = {
				id: params.generationId,
				task: requestTask,
				model: "mock",
				prompt: params.review?.prompt ?? params.prompt,
				device: params.device,
				context: { product: contextBody(files["PRODUCT.md"]), design: contextBody(files["DESIGN.md"]) },
				files: Object.entries(files).map(([path, content]) => ({ path, content })),
			};

			if (params.targets?.length) base.targets = params.targets;

			if (requestTask === "repair") base.problems = params.problems ?? [];

			if (references.length) base.references = references;

			if (focus) base.focus = focus;

			if (params.review) base.attachments = params.review.attachments;
			else if (params.attachments?.length) base.attachments = params.attachments;

			const run = async (variant: number, index: number): Promise<VariantRun> => {
				const renamer = createVariantRenamer({ variant, taken: Object.keys(files), readOnly: references });

				const request: GenerationRequest = multi ? { ...base, id: `${base.id}-v${variant}` } : base;

				if (multi && count > 1) request.variation = { index, count };

				const written = new Map<string, string>();
				const screens: Record<string, ScreenMeta | undefined> = {};
				let reply = "";

				const events =
					task === "context" && !(import.meta.env.DEV && params.targets?.[0] === "DESIGN.md")
						? contextEvents(params)
						: await mockEvents(request, controller.signal);

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
