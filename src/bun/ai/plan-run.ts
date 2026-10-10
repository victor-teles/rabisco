// Plan, then screens (decision 0015): read a plan, then write its shared components in one run and its screens in parallel.

import type {
	GenerationEvent,
	GenerationPlan,
	GenerationRequest,
	Problem,
	Provider,
	ScreenMeta,
	Usage,
} from "../../shared/ai/contract";
import { fitPlan, parsePlanReply } from "../../shared/ai/plan";
import { componentSignatures } from "../../shared/components/usages";
import { contextBody } from "../../shared/context/body";
import { framesForNewScreens, isComponentFile, isScreenFile } from "../../shared/project";
import type { FileChange, Frame, ProjectFiles } from "../../shared/types";
import { isAlternate } from "../../shared/variations";
import {
	addUsage,
	buildGenerationRequest,
	dedupeProblems,
	GenerationError,
	runGeneration,
	type BuildRequestParams,
} from "./run";

export type PlanRequestParams = {
	id: string;
	model: string;
	prompt: string;
	device: GenerationRequest["device"];
	projectFiles: ProjectFiles;
	attachments?: GenerationRequest["attachments"];
	history?: GenerationRequest["history"];
};

/** Context, the component catalog and the screens' paths: no sources, so a plan stays cheap */
export function buildPlanRequest(params: PlanRequestParams): GenerationRequest {
	const files = params.projectFiles;

	const request: GenerationRequest = {
		id: params.id,
		task: "plan",
		model: params.model,
		prompt: params.prompt,
		device: params.device,
		context: {},
		files: [],
	};

	if (contextBody(files["PRODUCT.md"])) request.context.product = files["PRODUCT.md"];

	if (contextBody(files["DESIGN.md"])) request.context.design = files["DESIGN.md"];
	const catalog = componentSignatures(files);

	if (catalog.length) request.components = catalog;
	const screens = Object.keys(files).filter((path) => isScreenFile(path) && !isAlternate(path));

	if (screens.length) request.projectScreens = screens.sort();

	if (params.attachments?.length) request.attachments = params.attachments;

	if (params.history?.length) request.history = params.history;

	return request;
}

export type PlanReading = { plan: GenerationPlan; reply: string; usage?: Usage };

/** One attempt, like the theme reading; files an agent wrote are read for the plan, then ignored */
export async function runPlanReading(options: {
	provider: Provider;
	request: GenerationRequest;
	projectFiles: ProjectFiles;
	signal: AbortSignal;
	onEvent: (event: GenerationEvent) => void;
}): Promise<PlanReading> {
	const { provider, request, projectFiles, signal, onEvent } = options;
	let reply = "";
	const written: string[] = [];
	let usage: Usage | undefined;

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);

	for await (const event of provider.generate(request, signal)) {
		if (signal.aborted) break;

		// The reply is a JSON block, not chat: the plan card shows it
		if (event.type !== "message.delta") onEvent(event);

		if (event.type === "message.delta") reply += event.text;
		else if (event.type === "file.end") written.push(event.content);
		else if (event.type === "done") usage = event.usage;
		else if (event.type === "error") throw new GenerationError(event.code, event.message, event.retryable, event.fix);

		if (event.type === "done") break;
	}

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);

	const plan = [reply, ...written].map((text) => parsePlanReply(text, projectFiles)).find((p) => p !== null);

	if (!plan) throw new GenerationError("invalid_output", "The model didn't return a plan Rabisco can read.", true);

	return { plan, reply: reply.trim(), usage };
}

/**
 * Only `allowed` paths get through. A run that names its one screen differently is moved to the planned path,
 * so a near miss isn't lost; anything else is dropped before validation, which then asks for what is missing.
 */
export function scopedProvider(provider: Provider, allowed: ReadonlySet<string>): Provider {
	const screen = allowed.size === 1 ? [...allowed].find(isScreenFile) : undefined;

	return {
		id: provider.id,
		kind: provider.kind,
		label: provider.label,
		capabilities: provider.capabilities,
		health: () => provider.health(),
		listModels: () => provider.listModels(),
		async *generate(request, signal) {
			let moved: string | undefined;

			for await (const event of provider.generate(request, signal)) {
				if (!("path" in event)) {
					yield event;
					continue;
				}

				if (screen && !moved && event.path !== screen && isScreenFile(event.path) && event.type !== "file.delete")
					moved = event.path;
				const path = moved === event.path && screen ? screen : event.path;

				if (allowed.has(path)) yield { ...event, path };
			}
		},
	};
}

export type PlannedResult = {
	changes: FileChange[];
	frames: Frame[];
	reply: string;
	problems: Problem[];
	usage?: Usage;
};

export type PlannedRunOptions = {
	provider: Provider;
	/** The request a one-shot create would send; each run rebuilds it with the files written so far */
	build: BuildRequestParams;
	plan: GenerationPlan;
	projectFiles: ProjectFiles;
	signal: AbortSignal;
	/** `attempt` is per run; screen events carry the screen's planned name in their status */
	onEvent: (event: GenerationEvent, attempt: number) => void;
};

/** Status lines name the run they come from; the runs' own chat replies are dropped, Rabisco writes one reply */
function relabel(event: GenerationEvent, label: string): GenerationEvent | null {
	if (event.type === "message.delta") return null;

	if (event.type === "status") return { type: "status", label, detail: event.label };

	return event;
}

const withChanges = (files: ProjectFiles, changes: FileChange[]) => {
	const next = { ...files };

	for (const change of changes) {
		if (change.content === null) delete next[change.path];
		else next[change.path] = change.content;
	}

	return next;
};

const list = (names: string[]) =>
	names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Components in one run, then one run per screen in parallel; one combined result, so one undo step */
export async function runPlannedCreate(options: PlannedRunOptions): Promise<PlannedResult> {
	const { provider, build, projectFiles, signal, onEvent } = options;
	const plan = fitPlan(options.plan, projectFiles);

	if (!plan.screens.length) throw new GenerationError("invalid_output", "The plan has no screens to write.", false);
	let files = projectFiles;
	let usage: Usage | undefined;
	const problems: Problem[] = [];
	const shellChanges: FileChange[] = [];

	if (plan.components.length) {
		const writes = plan.components.map((component) => component.path);

		const request: GenerationRequest = {
			...buildGenerationRequest({ ...build, id: `${build.id}-shell`, projectFiles: files }),
			plan,
			writes,
		};

		// One phase step naming the parts; the provider's own steps follow it as they are
		onEvent(
			{ type: "status", label: "Writing shared components", detail: list(plan.components.map((c) => c.name)) },
			1,
		);

		const shell = await runGeneration({
			provider: scopedProvider(provider, new Set(writes)),
			request,
			projectFiles: files,
			signal,
			onEvent: (event, attempt) => {
				if (event.type !== "message.delta") onEvent(event, attempt);
			},
		});

		usage = addUsage(usage, shell.usage);
		problems.push(...shell.problems);
		shellChanges.push(...shell.changes.filter((change) => isComponentFile(change.path)));
		files = withChanges(files, shellChanges);
	}

	// A component that failed validation isn't there to import; the screens are told only about the rest
	const written = plan.components.filter((component) => component.path in files);
	const screenPlan: GenerationPlan = { ...plan, components: written };
	const references = written.map((component) => component.path);

	const runs = plan.screens.map(async (screen) => {
		const request: GenerationRequest = {
			...buildGenerationRequest({
				...build,
				id: `${build.id}-${screen.path.slice("screens/".length, -".tsx".length)}`,
				projectFiles: files,
				references,
			}),
			plan: screenPlan,
			writes: [screen.path],
		};

		return runGeneration({
			provider: scopedProvider(provider, new Set([screen.path])),
			request,
			projectFiles: files,
			signal,
			onEvent: (event, attempt) => {
				const next = relabel(event, `Writing ${screen.name}`);

				if (next) onEvent(next, attempt);
			},
		});
	});

	const settled = await Promise.allSettled(runs);

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);
	const changes = [...shellChanges];
	const made: string[] = [];
	const failed: string[] = [];
	const meta: Record<string, ScreenMeta> = {};

	settled.forEach((outcome, index) => {
		const screen = plan.screens[index]!;

		if (outcome.status === "rejected") {
			failed.push(screen.name);

			return;
		}

		usage = addUsage(usage, outcome.value.usage);
		problems.push(...outcome.value.problems);
		const own = outcome.value.changes.filter((change) => change.path === screen.path && change.content !== null);

		if (!own.length) {
			failed.push(screen.name);

			return;
		}

		changes.push(...own);
		made.push(screen.name);
		meta[screen.path] = { name: screen.name, device: build.device };
	});

	if (!made.length) {
		const first = settled.find((outcome) => outcome.status === "rejected");

		if (first?.status === "rejected") throw first.reason;

		throw new GenerationError("invalid_output", "None of the planned screens came out valid.", true);
	}

	const screens = plan.screens.flatMap((screen) => (meta[screen.path] ? [screen.path] : []));
	const shared = written.map((component) => component.name);

	const reply = [
		`I made ${made.length === 1 ? "1 screen" : `${made.length} screens`} from the plan: ${list(made)}.`,
		shared.length
			? `They share ${list(shared)}, so the ${shared.length === 1 ? "part matches" : "parts match"} on every screen.`
			: "",
		failed.length
			? `${list(failed)} failed, so ${failed.length === 1 ? "it isn't" : "they aren't"} on the canvas. Try again to write ${failed.length === 1 ? "it" : "them"}.`
			: "",
	]
		.filter(Boolean)
		.join(" ");

	return {
		changes,
		frames: framesForNewScreens(screens, meta, build.device),
		reply,
		problems: dedupeProblems(problems),
		usage,
	};
}
