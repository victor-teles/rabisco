import type { ProviderStatus } from "../../shared/ai/settings";
import { framesForNewScreens, isScreenFile } from "../../shared/project";
import type { GenerateParams, GenerateResult, GenerationEventMessage, ProjectFiles } from "../../shared/types";
import type { ProviderCommand, ScreenMeta, Usage } from "../../shared/ai/contract";
import { isAlternate } from "../../shared/variations";
import { clampVariations, combineVariations, createVariantRenamer, variationsNote } from "../../shared/ai/variants";
import { chatPath, parseChat, readFileIfExists, readProjectFiles } from "../project-folder";
import type { SecretStore } from "./keychain";
import { ProviderRegistry, type ProviderDeps, type RegistryOptions } from "./providers";
import { varyPrompt } from "./prompt";
import {
	addUsage,
	buildGenerationRequest,
	buildThemeRequest,
	contextFilesOf,
	dedupeProblems,
	GenerationError,
	runGeneration,
	runThemeReading,
	type BuildRequestParams,
} from "./run";
import { variantProvider } from "./variant-provider";
import { createSettingsStore, type NewProvider, type ProviderPatch, type Detected } from "./settings-store";

export type AiServiceOptions = {
	userDataDir: string;
	secrets: SecretStore;
	/** Development builds only */
	includeMock: boolean;
	send: (message: GenerationEventMessage) => void;
	fetch?: typeof fetch;
	spawn?: ProviderDeps["spawn"];
	claudeExecutable?: string;
	detect?: () => Promise<Detected>;
	createProvider?: RegistryOptions["create"];
};

const HISTORY_TURNS = 12;

export function createAiService(options: AiServiceOptions) {
	const store = createSettingsStore({
		userDataDir: options.userDataDir,
		secrets: options.secrets,
		detect: options.detect,
	});

	const registry = new ProviderRegistry({
		secrets: options.secrets,
		fetch: options.fetch,
		spawn: options.spawn,
		claudeExecutable: options.claudeExecutable,
		includeMock: options.includeMock,
		create: options.createProvider,
	});

	const running = new Map<string, AbortController>();
	let statuses: ProviderStatus[] | null = null;

	async function sync() {
		registry.setConfigs(await store.list());
	}

	async function statusOf(id: string): Promise<ProviderStatus> {
		await sync();
		const all = await registry.statuses();
		const status = all.find((s) => s.id === id);

		if (!status) throw new Error(`No provider with id "${id}"`);
		statuses = statuses ? [...statuses.filter((s) => s.id !== id), status] : null;

		return status;
	}

	return {
		async listProviders(refresh = false) {
			await sync();

			if (!statuses || refresh) statuses = await registry.statuses();
			const settings = await store.get();
			// Keep the order of the settings file; the mock goes last
			const order = registry.configs().map((c) => c.id);

			return { settings, statuses: [...statuses].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) };
		},

		async addProvider({ apiKey, ...input }: NewProvider & { apiKey?: string }) {
			const config = await store.add(input);

			if (apiKey?.trim()) await store.setApiKey(config.id, apiKey);

			return statusOf(config.id);
		},

		async updateProvider(id: string, patch: ProviderPatch, apiKey?: string | null) {
			await store.update(id, patch);

			if (apiKey === null) await store.clearApiKey(id);
			else if (apiKey?.trim()) await store.setApiKey(id, apiKey);

			return statusOf(id);
		},

		async removeProvider(id: string) {
			await store.remove(id);
			statuses = statuses?.filter((s) => s.id !== id) ?? null;
			await sync();
		},

		testProvider: statusOf,

		setDefaultModel: (model: string) => store.setDefaultModel(model),

		/** The active model's provider commands; an unavailable model or a tool without commands has none */
		async listCommands(model: string, projectPath: string): Promise<ProviderCommand[]> {
			await sync();

			return (await registry.resolve(model)?.provider.listCommands?.(projectPath)) ?? [];
		},

		async generate(params: GenerateParams): Promise<GenerateResult> {
			if (params.task === "context" && !isContextTarget(params.targets)) {
				return {
					ok: false,
					error: {
						code: "unknown",
						message: "Writing context needs exactly one target: PRODUCT.md or DESIGN.md.",
						retryable: false,
					},
				};
			}

			await sync();
			const resolved = registry.resolve(params.model);

			if (!resolved) {
				return {
					ok: false,
					error: {
						code: "not_authenticated",
						message: `The model "${params.model}" isn't available. Its provider was removed or disabled.`,
						fix: "Pick another model, or enable the provider in Settings.",
						retryable: false,
					},
				};
			}

			const controller = new AbortController();
			running.set(params.generationId, controller);

			const failure = (cause: unknown): GenerateResult => {
				if (cause instanceof GenerationError) {
					return {
						ok: false,
						error: {
							code: cause.code,
							message: cause.message,
							retryable: cause.retryable,
							fix: cause.fix,
							providerId: resolved.config.id,
						},
					};
				}

				return {
					ok: false,
					error: {
						code: "unknown",
						message: cause instanceof Error ? cause.message : String(cause),
						retryable: true,
						providerId: resolved.config.id,
					},
				};
			};

			try {
				const projectFiles = readProjectFiles(params.projectPath);

				if (params.task === "theme") {
					const request = buildThemeRequest({
						id: params.generationId,
						model: resolved.model,
						device: params.device,
						design: projectFiles["DESIGN.md"],
					});

					if (!request) {
						return {
							ok: false,
							error: {
								code: "unknown",
								message: "DESIGN.md is empty, so there is no theme to read.",
								retryable: false,
							},
						};
					}

					const result = await runThemeReading({
						provider: resolved.provider,
						request,
						signal: controller.signal,
						onEvent: (event) => options.send({ generationId: params.generationId, attempt: 1, event }),
					});

					return {
						ok: true,
						changes: [],
						frames: [],
						reply: result.reply,
						problems: [],
						usage: result.usage,
						context: ["DESIGN.md"],
						theme: result.theme,
					};
				}

				const vary = params.task === "vary";

				if (vary && !isVaryTarget(params.targets, projectFiles)) {
					return {
						ok: false,
						error: {
							code: "unknown",
							message: "Varying needs exactly one existing screen as its target.",
							retryable: false,
						},
					};
				}

				// The chat shows `/name args`; the provider gets what the command stands for
				const prompt = params.command
					? await resolved.provider.expandCommand?.(params.projectPath, params.command.name, params.command.args)
					: params.prompt;

				if (prompt === null || prompt === undefined) {
					return {
						ok: false,
						error: {
							code: "unknown",
							message: `${resolved.provider.label} has no /${params.command?.name} command.`,
							fix: "Pick a command from the list that opens when you type /.",
							retryable: false,
						},
					};
				}

				const chat = params.chatId ? readFileIfExists(chatPath(params.projectPath, params.chatId)) : null;
				const history = parseChat(chat ?? "").map(({ role, content }) => ({ role, content }));

				// The webview appends the prompt before generating; it is the request, not history.
				// A focused prompt's message starts with `focusNote`, so it ends with the prompt.
				const lastTurn = history.at(-1);

				if (
					lastTurn?.role === "user" &&
					(lastTurn.content === params.prompt || (params.prompt && lastTurn.content.endsWith(params.prompt)))
				)
					history.pop();

				const task = taskOf(params);

				const request = buildGenerationRequest({
					id: params.generationId,
					task,
					prompt: vary ? varyPrompt(prompt) : prompt,
					device: params.device,
					model: resolved.model,
					projectFiles,
					targets: params.task === "context" ? params.targets : params.targets?.filter((path) => path in projectFiles),
					references: params.references,
					focus: vary ? undefined : params.focus,
					attachments: params.attachments,
					history: history.slice(-HISTORY_TURNS),
				});

				if (params.task === "repair") Object.assign(request, { task: "repair", problems: params.problems ?? [] });

				// `create` runs variant 0 (the primary) to N-1; `vary` runs 1 to N, all alternates
				const count = vary || task === "create" ? clampVariations(params.variations) : 1;
				const variants = Array.from({ length: count }, (_, i) => (vary ? i + 1 : i));
				const multi = vary || count > 1;

				const runs = variants.map(async (variant, index) => {
					const renamer = createVariantRenamer({
						variant,
						taken: Object.keys(projectFiles),
						readOnly: request.references,
					});

					const screens: Record<string, ScreenMeta | undefined> = {};
					let runRequest = request;

					if (multi) {
						runRequest = { ...request, id: `${request.id}-v${variant}` };

						if (count > 1) runRequest.variation = { index, count };
					}

					const result = await runGeneration({
						provider: variant || request.references ? variantProvider(resolved.provider, renamer) : resolved.provider,
						request: runRequest,
						projectFiles,
						signal: controller.signal,
						// Variations accept the alternates Rabisco assigns; an edit or repair of an alternate keeps its path
						alternates: variant ? renamer.assigned : new Set(request.targets?.filter(isAlternate)),
						onEvent: (event, attempt) => {
							if (event.type === "file.start" && event.kind === "screen") screens[event.path] = event.screen;
							const message: GenerationEventMessage = { generationId: params.generationId, attempt, event };

							if (multi) message.variant = variant;
							options.send(message);
						},
					});

					return { variant, result, screens, renames: renamer.renames };
				});

				const settled = await Promise.allSettled(runs);

				if (controller.signal.aborted) return failure(new GenerationError("aborted", "Generation stopped.", true));
				const done = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
				const first = settled.find((s) => s.status === "rejected");

				if (!done.length) return failure(first?.reason);

				if (!multi) {
					const { result, screens } = done[0]!;

					const created = result.changes
						.filter((c) => c.content !== null && !(c.path in projectFiles))
						.map((c) => c.path);

					return {
						ok: true,
						changes: result.changes,
						frames: framesForNewScreens(created, screens, params.device),
						reply: [result.reply, ...result.notes].filter(Boolean).join("\n\n"),
						problems: result.problems,
						usage: result.usage,
						context: contextFilesOf(request),
					};
				}

				const combined = combineVariations({
					mode: vary ? "vary" : "create",
					outputs: done.map(({ variant, result, screens, renames }) => ({
						variant,
						changes: result.changes,
						screens,
						renames,
					})),
					projectFiles,
					device: params.device,
				});

				const lead = done.find((run) => run.variant === combined.primary) ?? done[0]!;
				const note = variationsNote(done.length, settled.length - done.length, combined.dropped.length);

				return {
					ok: true,
					changes: combined.changes,
					frames: combined.frames,
					reply: [lead.result.reply, note].filter(Boolean).join("\n\n"),
					problems: dedupeProblems(done.flatMap((run) => run.result.problems)),
					usage: done.reduce<Usage | undefined>((sum, run) => addUsage(sum, run.result.usage), undefined),
					context: contextFilesOf(request),
				};
			} catch (error) {
				return failure(error);
			} finally {
				running.delete(params.generationId);
			}
		},

		stopGeneration(generationId: string) {
			running.get(generationId)?.abort();
		},

		stopAll() {
			for (const controller of running.values()) controller.abort();
		},
	};
}

export type AiService = ReturnType<typeof createAiService>;

const isContextTarget = (targets: string[] | undefined) =>
	targets?.length === 1 && (targets[0] === "PRODUCT.md" || targets[0] === "DESIGN.md");

/** An alternate is fine: its base is what gets new alternates. */
const isVaryTarget = (targets: string[] | undefined, files: ProjectFiles) =>
	targets?.length === 1 && isScreenFile(targets[0]!) && targets[0]! in files;

/** `repair` and `vary` start as an edit of their targets. */
function taskOf(params: GenerateParams): BuildRequestParams["task"] {
	if (params.task === "context") return "context";

	return params.task === "create" || (!params.task && !params.targets?.length) ? "create" : "edit";
}
