import { applyFileChanges, type Snapshot } from "@/lib/history";
import type { ChangeOptions, ProjectSession } from "@/lib/project-session";
import { renderCheckOf, renderRepairOf, type RenderCheck } from "@/lib/render-check";
import type { RabiscoApi } from "@/lib/rpc";
import { draftLayout, variantLabel } from "@/lib/variations";
import type { DesignCheckInput, ScreenCheck } from "@/views/editor/design-check";
import type {
	Attachment,
	ElementFocus,
	FileKind,
	GenerationEvent,
	GenerationPlan,
	Problem,
	ScreenMeta,
} from "../../shared/ai/contract";
import { planRevisionPrompt, plansFirst, revisedPrompt } from "../../shared/ai/plan";
import { changeSummaryOf } from "../../shared/change-summary";
import { setResolved } from "../../shared/comments";
import type { AppliedTheme } from "../../shared/context/theme";
import { AUTO_FALLBACK_STYLE, autoDesignOf, styleById, withDesign, withStyle } from "../../shared/context/styles";
import {
	APPLYING_REVIEW_STEP,
	CHECKING_STEP,
	designNotesOf,
	mergeChanges,
	polishLabel,
	polishProblems,
	polishRequest,
	polishWrites,
	REVIEW_STEP,
	reviewNote,
	reviewRaster,
	reviewRequest,
	POLISHED_TASKS,
	type PolishMode,
	type PolishRequest,
	type ScreenFindings,
} from "../../shared/design/polish";
import { isContextFile, isScreenFile } from "../../shared/project";
import type {
	ChatMessage,
	Device,
	FileChange,
	Frame,
	GenerateParams,
	GenerateResult,
	GenerationEventMessage,
	GenerationFailure,
	ProjectFiles,
} from "../../shared/types";
import { isAlternate, placeNewFrames } from "../../shared/variations";

export type WritingFile = { kind: FileKind; screen?: ScreenMeta; text: string; done: boolean };

export type Generation = {
	id: string;
	task: "create" | "edit" | "repair" | "context" | "vary" | "theme" | "plan";
	variations: number;
	/** `variant` is set only for the extra variations (1…) of a parallel run. */
	steps: { label: string; detail?: string; variant?: number }[];
	reply: string;
	attempt: number;
	writing: Record<string, WritingFile>;
	polishing?: boolean;
};

export type GenerationDrafts = {
	frames: Frame[];
	files: ProjectFiles;
	writing: Record<string, WritingFile>;
};

export type RunOptions = {
	targets?: string[];
	attachments?: Attachment[];
	/** Unset: edit when `targets` is non-empty, else create. */
	task?: "context" | "vary";
	variations?: number;
	references?: string[];
	focus?: ElementFocus;
	repair?: { problems: Problem[] };
	/** A provider command; `prompt` is `/name args` */
	command?: { name: string; args: string };
	/** Comments the prompt came from, resolved in the same undo step as a result that changes files */
	resolves?: string[];
	/** An accepted plan: its shared components, then its screens in parallel (decision 0015) */
	plan?: GenerationPlan;
	autoDesign?: boolean;
};

/** A plan waiting in the chat for the user to review it; its request runs when they accept it */
export type PendingPlan = { id: string; plan: GenerationPlan; prompt: string; options: RunOptions };

export type ThemeReading =
	| { ok: true; theme: AppliedTheme }
	/** `busy`: another generation runs; `no-model`: no provider is set up */
	| { ok: false; reason: "busy" | "no-model" | "aborted" }
	| { ok: false; reason: "failed"; error: GenerationFailure };

export type GenerationView = {
	generation: Generation | null;
	failure: GenerationFailure | null;
	pendingPlan: PendingPlan | null;
	/** The reply whose result is an undo step, so its summary can offer Undo while that step is still the latest */
	lastRun: { messageId: string; step: Snapshot } | null;
	regenerable: boolean;
};

export type Outcome = "ready" | "failed" | "plan";

export type RenderFailure = { entry: string; problem: Problem };

export type AttachCallbacks = { onPlaced: (frames: Frame[]) => void; onResolved: (ids: string[]) => void };

export type GenerationApi = Pick<RabiscoApi, "generate" | "stopGeneration">;

export type ControllerEnv = {
	api: GenerationApi;
	flushFiles: () => Promise<void>;
	route: (generationId: string, listener: (message: GenerationEventMessage) => void) => () => void;
	schedule: (callback: () => void) => () => void;
	check: (input: DesignCheckInput) => Promise<ScreenCheck[]>;
	watchRenderErrors: (screens: string[]) => Promise<RenderFailure[]>;
	polishMode: () => PolishMode;
	planMode: () => boolean;
	onSettled: (outcome: Outcome | null) => void;
};

type LastRequest = { prompt: string; options: RunOptions };

type Polishing = {
	id: string;
	key: string;
	chatId: string;
	model: string;
	done: ChatMessage;
	before: ProjectFiles;
	changes: FileChange[];
	problems: Problem[];
	step: Snapshot;
	screens: string[];
	prompt: string;
};

type PolishOutcome = { writes: FileChange[]; reply: string; withoutImages: boolean; failed: boolean };

type RunResult = { applied: boolean; outcome: Outcome | null };

const NO_POLISH: PolishOutcome = { writes: [], reply: "", withoutImages: false, failed: false };

const NO_IMAGES_NOTE = "This model can't see images, so the review used the design check only.";

const AUTO_DESIGN_STEP = "Writing DESIGN.md from your prompt";

const STOPPED = "Stopped. Nothing was changed.";

const NO_THEME: AppliedTheme = { light: {}, dark: {} };

const IDLE: GenerationView = { generation: null, failure: null, pendingPlan: null, lastRun: null, regenerable: false };

const SAVE_FAILED: GenerationFailure = {
	code: "unknown",
	message: "Couldn't save the result. The project folder may have moved or been deleted.",
	retryable: true,
};

let toldWithoutImages = false;

export const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
});

export type GenerationController = ReturnType<typeof createGenerationController>;

export function createGenerationController(session: ProjectSession, env: ControllerEnv) {
	let view = IDLE;
	let live: Generation | null = null;
	let cancelFlush: (() => void) | null = null;
	let last: LastRequest | null = null;
	let lastResult: Snapshot | null = null;
	let stopped: string | null = null;
	let active = 0;
	let callbacks: AttachCallbacks | null = null;
	let disposed = false;
	const listeners = new Set<() => void>();

	const emit = () => {
		for (const listener of listeners) listener();
	};

	const set = (patch: Partial<GenerationView>) => {
		view = { ...view, ...patch };
		emit();
	};

	const show = (next: Generation) => {
		live = next;
		set({ generation: next });
	};

	const cancelScheduled = () => {
		cancelFlush?.();
		cancelFlush = null;
	};

	const clearLive = (generationId: string) => {
		cancelScheduled();

		if (live?.id === generationId) live = null;

		if (view.generation?.id === generationId) set({ generation: null });
	};

	const receive = ({ generationId, attempt, variant, event }: GenerationEventMessage) => {
		if (!live || live.id !== generationId) return;
		live = applyEvent(live, attempt, event, variant);

		cancelFlush ??= env.schedule(() => {
			cancelFlush = null;
			set({ generation: live });
		});
	};

	async function generate(params: GenerateParams): Promise<GenerateResult> {
		const unroute = env.route(params.generationId, receive);

		try {
			await env.flushFiles();

			return await env.api.generate(params);
		} finally {
			unroute();
		}
	}

	const say = (chatId: string, content: string) => session.addMessages([message("assistant", content)], chatId);

	async function writeAutoDesign(
		prompt: string,
		options: RunOptions,
		model: string,
		chatId: string,
	): Promise<"stopped" | null> {
		const current = session.state();

		if (!current) return null;
		const generationId = crypto.randomUUID();

		show({
			id: generationId,
			task: "context",
			variations: 1,
			steps: [{ label: AUTO_DESIGN_STEP }],
			reply: "",
			attempt: 1,
			writing: {},
		});

		let design: string | null = null;
		let why = "";

		try {
			const result = await generate({
				generationId,
				projectPath: session.path,
				prompt,
				device: current.canvas.device,
				model,
				task: "context",
				targets: ["DESIGN.md"],
				attachments: options.attachments,
			});

			if (!result.ok && result.error.code === "aborted") return "stopped";
			design = result.ok ? autoDesignOf(result.changes.find((c) => c.path === "DESIGN.md")?.content) : null;

			if (!design) why = result.ok ? "it came back without tokens" : result.error.message;
		} catch (reason) {
			why = String(reason);
		} finally {
			clearLive(generationId);
		}

		const fallback = styleById(AUTO_FALLBACK_STYLE).label;
		session.change((snapshot) => (design ? withDesign(snapshot, design) : withStyle(snapshot, AUTO_FALLBACK_STYLE)));

		say(
			chatId,
			design
				? "Wrote DESIGN.md from your prompt and applied its tokens to the screens."
				: `Couldn't write DESIGN.md from your prompt (${why.replace(/\.$/, "")}), so the project starts from the ${fallback} style.`,
		);

		return null;
	}

	/** The plan step of a create; `null` when it failed, so the request runs in one go instead (no dead end) */
	async function readPlan(
		prompt: string,
		options: RunOptions,
		model: string,
		chatId: string,
	): Promise<GenerationPlan | "stopped" | null> {
		const current = session.state();

		if (!current) return null;
		const generationId = crypto.randomUUID();
		show({ id: generationId, task: "plan", variations: 1, steps: [], reply: "", attempt: 1, writing: {} });

		try {
			const result = await generate({
				generationId,
				projectPath: session.path,
				prompt,
				device: current.canvas.device,
				model,
				task: "plan",
				attachments: options.attachments,
				chatId,
				command: options.command,
			});

			if (result.ok) return result.plan ?? null;

			return result.error.code === "aborted" ? "stopped" : null;
		} catch {
			return null;
		} finally {
			clearLive(generationId);
		}
	}

	async function checkScreens(screens: string[], screenshots = false): Promise<ScreenFindings[]> {
		const current = session.state();
		const watched = new Set(screens);
		const selected = current ? current.canvas.frames.filter((frame) => watched.has(frame.file)) : [];

		if (!current || !selected.length) return [];

		const results = await env.check({
			frames: current.canvas.frames,
			selected,
			files: current.files,
			theme: current.canvas.theme ?? NO_THEME,
			raster: screenshots ? (frame) => reviewRaster(frame.width, frame.height) : undefined,
		});

		return results.flatMap((result) =>
			result.error ? [] : [{ screen: result.frame.file, findings: result.findings, image: result.image }],
		);
	}

	async function polishRun(polishing: Polishing, request: PolishRequest): Promise<PolishOutcome> {
		const current = session.state();

		if (!current || !live) return NO_POLISH;
		const generationId = crypto.randomUUID();
		const label = request.review ? REVIEW_STEP : polishLabel(request.problems.length);

		show({ ...live, id: generationId, polishing: true, steps: [...live.steps, { label }] });

		const result = await generate({
			generationId,
			projectPath: session.path,
			prompt: request.prompt,
			device: current.canvas.device,
			model: polishing.model,
			targets: request.targets,
			task: "repair",
			problems: request.problems,
			chatId: polishing.chatId,
			review: request.review,
		});

		const latest = session.state();
		const failed = !result.ok && result.error.code !== "aborted";
		const writes = result.ok && latest && !disposed ? polishWrites(result.changes, latest.files, request.targets) : [];

		const outcome: PolishOutcome = {
			writes: [],
			reply: result.ok ? result.reply : "",
			withoutImages: result.ok && result.withoutImages === true,
			failed,
		};

		if (!latest || !writes.length) return outcome;

		if (writes.some((write) => latest.files[write.path] !== polishing.step.files[write.path])) return outcome;

		session.change((snapshot) => ({ ...snapshot, files: applyFileChanges(snapshot.files, writes) }), {
			coalesce: polishing.key,
		});

		return { ...outcome, writes };
	}

	async function polish(polishing: Polishing, renderFailed: boolean) {
		let checks: ScreenFindings[] = [];
		let polished: FileChange[] = [];
		let note = "";

		try {
			const mode = env.polishMode();

			if (!renderFailed && stopped !== polishing.id) checks = await checkScreens(polishing.screens, mode === "review");

			const request =
				mode === "review"
					? reviewRequest(polishing.prompt, checks)
					: polishRequest(mode === "polish" ? polishProblems(checks) : []);

			if ((request.problems.length || request.review) && stopped !== polishing.id) {
				let outcome = await polishRun(polishing, request);

				if (outcome.failed && request.review && request.problems.length && stopped !== polishing.id)
					outcome = { ...(await polishRun(polishing, polishRequest(request.problems))), withoutImages: true };

				polished = outcome.writes;
				const reviewed = request.review && !outcome.withoutImages;

				if (polished.length) {
					if (reviewed && live) show({ ...live, steps: [...live.steps, { label: APPLYING_REVIEW_STEP }] });

					checks = await checkScreens(polishing.screens);
				}

				if (reviewed) note = reviewNote(outcome.reply, polished);
				else if (polished.length)
					note = `Polished ${request.problems.length === 1 ? "1 design problem" : `${request.problems.length} design problems`} the check found.`;

				if (outcome.withoutImages && !toldWithoutImages) {
					toldWithoutImages = true;
					note = [note, NO_IMAGES_NOTE].filter(Boolean).join(" ");
				}
			}
		} catch {
		} finally {
			const latest = session.state();
			const step = polished.length ? (latest?.history.present ?? polishing.step) : polishing.step;
			const notes = designNotesOf(checks, latest?.files ?? {});
			const summary = changeSummaryOf(polishing.before, mergeChanges(polishing.changes, polished), polishing.problems);

			const done: ChatMessage = {
				...polishing.done,
				content: note ? `${polishing.done.content}\n\n${note}` : polishing.done.content,
			};

			if (summary) done.summary = notes.length ? { ...summary, design: notes } : summary;

			session.addMessages([done], polishing.chatId);
			lastResult = step;
			cancelScheduled();
			live = null;
			set({ generation: null, lastRun: summary?.files.length ? { messageId: done.id, step } : null });
		}
	}

	async function runSteps(prompt: string, request: RunOptions, model: string): Promise<RunResult> {
		let options = request;
		const current = session.state();
		const nothing: RunResult = { applied: false, outcome: null };

		if (!current) return nothing;
		const chatId = current.chatId;
		const generationId = crypto.randomUUID();
		const task = options.repair ? "repair" : (options.task ?? (options.targets?.length ? "edit" : "create"));
		const variations = task === "create" || task === "vary" ? Math.max(1, options.variations ?? 1) : 1;

		if (!options.repair) {
			last = { prompt, options };
			lastResult = null;
		}

		// A new request replaces a plan still waiting for review
		set({ failure: null, pendingPlan: null, regenerable: view.regenerable || !options.repair });

		if (options.autoDesign) {
			options = { ...options, autoDesign: undefined };
			last = { prompt, options };

			if ((await writeAutoDesign(prompt, options, model, chatId)) === "stopped") {
				say(chatId, STOPPED);

				return nothing;
			}
		}

		if (plansFirst({ planMode: env.planMode(), task, variations, plan: options.plan })) {
			const plan = await readPlan(prompt, options, model, chatId);

			if (plan === "stopped") {
				say(chatId, STOPPED);

				return nothing;
			}

			if (plan && !disposed) {
				set({ pendingPlan: { id: generationId, plan, prompt, options } });

				return { applied: false, outcome: "plan" };
			}
		}

		show({ id: generationId, task, variations, steps: [], reply: "", attempt: 1, writing: {} });
		let check: RenderCheck = { screens: [], via: new Map() };
		let applied = false;
		let outcome: Outcome | null = null;
		let polishing: Polishing | null = null;

		try {
			const result = await generate({
				generationId,
				projectPath: session.path,
				prompt,
				device: current.canvas.device,
				model,
				targets: options.targets,
				task,
				variations: variations > 1 || task === "vary" ? variations : undefined,
				references: options.references,
				focus: options.focus,
				problems: options.repair?.problems,
				attachments: options.attachments,
				chatId,
				command: options.command,
				plan: options.plan,
			});

			const latest = session.state();

			if (!latest || disposed) return nothing;

			if (!result.ok) {
				if (result.error.code === "aborted") say(chatId, STOPPED);
				else {
					set({ failure: result.error });
					outcome = "failed";
				}

				return { applied: false, outcome };
			}

			const placedFiles = new Set(latest.canvas.frames.map((frame) => frame.file));

			const placed = placeNewFrames(
				latest.canvas.frames,
				result.frames.filter((frame) => !placedFiles.has(frame.file)),
			);

			const resolving = result.changes.length
				? (latest.canvas.comments ?? []).flatMap((comment) =>
						options.resolves?.includes(comment.id) && !comment.resolved ? [comment.id] : [],
					)
				: [];

			let step: Snapshot | null = null;
			const screens = POLISHED_TASKS.has(task) ? writtenScreens(result.changes) : [];
			const key = `generation:${generationId}`;
			const changeOptions: ChangeOptions = {};

			if (placed.length) changeOptions.select = placed.map((frame) => frame.file);

			if (screens.length) changeOptions.coalesce = key;

			if (result.changes.length) {
				session.change((snapshot) => {
					const files = applyFileChanges(snapshot.files, result.changes);
					const frames = [...snapshot.frames, ...placed].filter((frame) => frame.file in files);

					return resolving.length
						? { files, frames, comments: setResolved(snapshot.comments ?? [], resolving, true) }
						: { files, frames };
				}, changeOptions);

				step = session.state()?.history.present ?? null;

				if (!options.repair) lastResult = step;
			}

			const reply = result.reply.trim() || summarize(result.changes);

			const leftOut = result.problems.length
				? `\n\nI couldn't make ${[...new Set(result.problems.map((p) => p.path))].join(", ")} valid, so I left ${result.problems.length === 1 ? "it" : "them"} out:\n${result.problems.map((p) => `• ${p.path}${p.line ? `:${p.line}` : ""}: ${p.message}`).join("\n")}`
				: "";

			const done: ChatMessage = { ...message("assistant", reply + leftOut), context: result.context ?? [] };
			const summary = changeSummaryOf(latest.files, result.changes, result.problems);

			if (step && screens.length) {
				polishing = {
					id: generationId,
					key,
					chatId,
					model,
					done,
					before: latest.files,
					changes: result.changes,
					problems: result.problems,
					step,
					screens,
					prompt,
				};
			} else {
				if (summary) done.summary = summary;
				session.addMessages([done], chatId);
				set({ lastRun: step && summary?.files.length ? { messageId: done.id, step } : null });
			}

			if (placed.length) callbacks?.onPlaced(placed);

			if (resolving.length) callbacks?.onResolved(resolving);
			applied = true;
			outcome = "ready";

			if (!options.repair) check = renderCheckOf(applyFileChanges(latest.files, result.changes), result.changes);

			if (!callbacks && result.changes.length && !(await session.flushCanvas())) {
				set({ failure: SAVE_FAILED });
				outcome = "failed";
			}
		} catch (reason) {
			set({ failure: { code: "unknown", message: String(reason), retryable: true } });
			outcome = "failed";
		} finally {
			cancelScheduled();

			if (polishing && live?.id === generationId) show({ ...live, steps: [...live.steps, { label: CHECKING_STEP }] });
			else clearLive(generationId);
		}

		// Decision 0003, check 5: one automatic repair, then the error stays in the frame.
		const failures = callbacks ? await env.watchRenderErrors(check.screens) : [];

		if (polishing) await polish(polishing, failures.length > 0);

		if (failures.length && !live && callbacks && !disposed) {
			const failed = [...new Set(failures.map((f) => f.problem.path))];
			say(chatId, `${failed.join(", ")} failed to render. Fixing it…`);
			const repair = renderRepairOf(failures, check.via);
			void run(prompt, { targets: repair.targets, repair: { problems: repair.problems } }, model);
		}

		return { applied, outcome };
	}

	async function settle(outcome: Outcome | null) {
		if (!callbacks && !disposed && outcome !== "failed" && !(await session.flushCanvas())) {
			set({ failure: SAVE_FAILED });
			outcome = "failed";
		}

		if (!disposed) env.onSettled(outcome);
	}

	async function track<T extends RunResult>(work: () => Promise<T>): Promise<T> {
		active++;
		emit();
		let result: T | null = null;

		try {
			result = await work();

			return result;
		} finally {
			await settle(result?.outcome ?? null);
			active--;
			emit();
		}
	}

	async function run(prompt: string, options: RunOptions, model: string): Promise<boolean> {
		if (!session.state() || live || disposed) return false;
		const { applied } = await track(() => runSteps(prompt, options, model));

		return applied;
	}

	/** Runs the reviewed plan: the card's ticks and names are in `plan` */
	function acceptPlan(plan: GenerationPlan, model: string) {
		const pending = view.pendingPlan;
		const chatId = session.state()?.chatId;

		if (!pending || live || !chatId) return;
		set({ pendingPlan: null });

		if (!plan.screens.length) return say(chatId, "No screens were left in the plan, so nothing was made.");

		void run(pending.prompt, { ...pending.options, plan }, model);
	}

	async function revise(pending: PendingPlan, feedback: string, attachments: Attachment[], model: string) {
		const chatId = session.state()?.chatId;

		if (!chatId) return { applied: false, outcome: null };
		set({ pendingPlan: null });

		const options = attachments.length
			? { ...pending.options, attachments: [...(pending.options.attachments ?? []), ...attachments] }
			: pending.options;

		const plan = await readPlan(planRevisionPrompt(pending.prompt, pending.plan, feedback), options, model, chatId);

		if (disposed) return { applied: false, outcome: null };

		if (plan === "stopped" || !plan) {
			set({ pendingPlan: pending });
			say(
				chatId,
				plan === "stopped" ? "Stopped. The plan is unchanged." : "Couldn't revise the plan, so it is unchanged.",
			);

			return { applied: false, outcome: "plan" as const };
		}

		set({
			pendingPlan: { id: crypto.randomUUID(), plan, prompt: revisedPrompt(pending.prompt, feedback), options },
		});

		return { applied: false, outcome: "plan" as const };
	}

	function revisePlan(feedback: string, attachments: Attachment[], model: string) {
		const pending = view.pendingPlan;

		if (pending && !live) void track(() => revise(pending, feedback, attachments, model));
	}

	function cancelPlan() {
		const chatId = session.state()?.chatId;

		if (!view.pendingPlan || !chatId) return;
		set({ pendingPlan: null });
		say(chatId, "Cancelled the plan. Nothing was changed.");
	}

	/** Reads DESIGN.md's theme with AI; changes nothing, the caller applies the result. */
	async function readTheme(model: string | null): Promise<ThemeReading> {
		const current = session.state();

		if (!current || live) return { ok: false, reason: "busy" };

		if (!model) return { ok: false, reason: "no-model" };
		const generationId = crypto.randomUUID();
		show({ id: generationId, task: "theme", variations: 1, steps: [], reply: "", attempt: 1, writing: {} });

		try {
			const result = await generate({
				generationId,
				projectPath: session.path,
				prompt: "",
				device: current.canvas.device,
				model,
				task: "theme",
			});

			if (result.ok && result.theme) return { ok: true, theme: result.theme };

			if (result.ok)
				return {
					ok: false,
					reason: "failed",
					error: { code: "invalid_output", message: "No theme came back.", retryable: true },
				};

			return result.error.code === "aborted"
				? { ok: false, reason: "aborted" }
				: { ok: false, reason: "failed", error: result.error };
		} catch (reason) {
			return { ok: false, reason: "failed", error: { code: "unknown", message: String(reason), retryable: true } };
		} finally {
			clearLive(generationId);
		}
	}

	function stop() {
		const id = live?.id;

		if (!id) return;
		stopped = id;
		void env.api.stopGeneration({ generationId: id });
	}

	function retry(model: string) {
		if (last) void run(last.prompt, last.options, model);
	}

	/** Runs the last request again, in place of its result when nothing changed since */
	function regenerate(model: string) {
		const request = last;

		if (!request || live) return;

		if (lastResult && session.state()?.history.present === lastResult) session.undo();
		void run(request.prompt, request.options, model);
	}

	/** One undo step, and only while the run's result is still the latest one */
	function undoRun() {
		if (view.lastRun && session.state()?.history.present === view.lastRun.step) session.undo();
	}

	function attach(next: AttachCallbacks) {
		callbacks = next;

		return () => {
			if (callbacks === next) callbacks = null;
		};
	}

	function dispose() {
		stop();
		disposed = true;
		cancelScheduled();
	}

	return {
		get: () => view,
		subscribe(listener: () => void) {
			listeners.add(listener);

			return () => void listeners.delete(listener);
		},
		busy: () => live !== null,
		working: () => active > 0 || view.pendingPlan !== null,
		task: () => live?.task ?? null,
		attached: () => callbacks !== null,
		attach,
		run,
		readTheme,
		acceptPlan,
		revisePlan,
		cancelPlan,
		stop,
		retry,
		regenerate,
		undoRun,
		dismissFailure: () => set({ failure: null }),
		dispose,
	};
}

export function applyEvent(
	generation: Generation,
	attempt: number,
	event: GenerationEvent,
	variant?: number,
): Generation {
	switch (event.type) {
		case "status": {
			const label = variantLabel(event.label, variant);
			const last = [...generation.steps].reverse().find((step) => (step.variant ?? 0) === (variant || 0));

			if (last?.label === label && last.detail === event.detail) return generation;

			return {
				...generation,
				steps: [...generation.steps, { label, detail: event.detail, variant: variant || undefined }],
			};
		}

		case "message.delta":
			// Keep only the primary variation's first attempt; the others would interleave
			return attempt <= 1 && !variant && !generation.polishing
				? { ...generation, reply: generation.reply + event.text }
				: generation;
		case "file.start":
			return {
				...generation,
				attempt,
				writing: {
					...generation.writing,
					[event.path]: { kind: event.kind, screen: event.screen, text: "", done: false },
				},
			};
		case "file.delta": {
			const file = generation.writing[event.path];

			if (!file) return generation;

			return {
				...generation,
				writing: { ...generation.writing, [event.path]: { ...file, text: file.text + event.text } },
			};
		}

		case "file.end": {
			const file = generation.writing[event.path] ?? {
				kind: isScreenFile(event.path) ? "screen" : "component",
				text: "",
				done: false,
			};

			return {
				...generation,
				writing: { ...generation.writing, [event.path]: { ...file, text: event.content, done: true } },
			};
		}

		default:
			return generation;
	}
}

export function draftsOf(writing: Record<string, WritingFile>, files: ProjectFiles, frames: Frame[], device: Device) {
	const fresh = Object.keys(writing).filter((path) => isScreenFile(path) && !(path in files));
	const meta = Object.fromEntries(fresh.map((path) => [path, writing[path]!.screen]));
	const draftFrames = placeNewFrames(frames, draftLayout(fresh, meta, device));
	const draftFiles = { ...files };

	for (const [path, file] of Object.entries(writing)) if (file.done) draftFiles[path] = file.text;

	return { frames: draftFrames, files: draftFiles };
}

const writtenScreens = (changes: FileChange[]) =>
	changes.flatMap((change) => (change.content !== null && isScreenFile(change.path) ? [change.path] : []));

function summarize(changes: FileChange[]) {
	const written = changes.filter((c) => c.content !== null);
	const alternates = written.filter((c) => isAlternate(c.path)).length;
	const screens = written.filter((c) => isScreenFile(c.path)).length - alternates;
	const components = written.filter((c) => !isScreenFile(c.path) && !isContextFile(c.path)).length;
	const context = written.flatMap((c) => (isContextFile(c.path) ? [c.path] : []));

	if (!screens && !components && !context.length) return "Done. No files changed.";

	const parts = [
		screens && `${screens} ${screens === 1 ? "screen" : "screens"}`,
		alternates && `${alternates} ${alternates === 1 ? "variation" : "variations"}`,
		components && `${components} ${components === 1 ? "component" : "components"}`,
	];

	const updated = parts.some(Boolean) ? `Updated ${parts.filter(Boolean).join(" and ")}.` : "";

	return [context.length ? `Wrote ${context.join(" and ")}.` : "", updated].filter(Boolean).join(" ");
}
