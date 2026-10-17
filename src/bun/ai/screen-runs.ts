import type { GenerationEvent, Problem, Provider, Usage } from "../../shared/ai/contract";
import { everyScreenPrompt } from "../../shared/ai/follow-ups";
import { screenNameFromPath } from "../../shared/project";
import type { FileChange, ProjectFiles } from "../../shared/types";
import { scopedProvider } from "./plan-run";
import {
	addUsage,
	buildGenerationRequest,
	dedupeProblems,
	GenerationError,
	runGeneration,
	type BuildRequestParams,
} from "./run";

export const SCREEN_RUNS_AT_ONCE = 4;

export type ScreenRunsOptions = {
	provider: Provider;
	build: BuildRequestParams;
	targets: string[];
	projectFiles: ProjectFiles;
	signal: AbortSignal;
	onEvent: (event: GenerationEvent, attempt: number) => void;
	repair?: { problems: Problem[] };
};

export type ScreenRunsResult = {
	changes: FileChange[];
	reply: string;
	problems: Problem[];
	usage?: Usage;
};

const screens = (count: number) => (count === 1 ? "1 screen" : `${count} screens`);

export function screenRunsReply(changed: string[], unchanged: number, failed: string[]) {
	return [
		changed.length ? `Changed ${screens(changed.length)}: ${changed.join(", ")}.` : "No screen needed a change.",
		unchanged && changed.length ? `${screens(unchanged)} had nothing to change.` : "",
		failed.length ? `${failed.join(", ")} failed, so ${failed.length === 1 ? "it is" : "they are"} as before.` : "",
	]
		.filter(Boolean)
		.join(" ");
}

export async function runScreens(options: ScreenRunsOptions): Promise<ScreenRunsResult> {
	const { provider, build, targets, projectFiles, signal, onEvent, repair } = options;
	const outcomes: PromiseSettledResult<FileChange[]>[] = [];
	const problems: Problem[] = [];
	let usage: Usage | undefined;
	let next = 0;

	const runOne = async (target: string, index: number) => {
		const name = screenNameFromPath(target);
		const prompt = repair ? build.prompt : everyScreenPrompt(build.prompt, target, targets.length);
		const request = buildGenerationRequest({ ...build, id: `${build.id}-s${index}`, prompt, targets: [target] });

		if (repair) Object.assign(request, { task: "repair", problems: repair.problems.filter((p) => p.path === target) });

		const result = await runGeneration({
			provider: scopedProvider(provider, new Set([target])),
			request,
			projectFiles,
			signal,
			onEvent: (event, attempt) => {
				if (event.type === "message.delta") return;

				onEvent(
					event.type === "status" ? { type: "status", label: `Changing ${name}`, detail: event.label } : event,
					attempt,
				);
			},
		});

		usage = addUsage(usage, result.usage);
		problems.push(...result.problems);

		return result.changes.filter((change) => change.path === target && change.content !== projectFiles[target]);
	};

	const worker = async () => {
		while (next < targets.length) {
			const index = next++;

			try {
				outcomes[index] = { status: "fulfilled", value: await runOne(targets[index]!, index) };
			} catch (reason) {
				outcomes[index] = { status: "rejected", reason };
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(SCREEN_RUNS_AT_ONCE, targets.length) }, worker));

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);
	const changes: FileChange[] = [];
	const changed: string[] = [];
	const failed: string[] = [];
	let unchanged = 0;

	outcomes.forEach((outcome, index) => {
		const name = screenNameFromPath(targets[index]!);

		if (outcome.status === "rejected") failed.push(name);
		else if (outcome.value.length) {
			changes.push(...outcome.value);
			changed.push(name);
		} else unchanged++;
	});

	if (failed.length === targets.length) {
		const first = outcomes.find((outcome) => outcome.status === "rejected");

		if (first?.status === "rejected") throw first.reason;
	}

	return { changes, reply: screenRunsReply(changed, unchanged, failed), problems: dedupeProblems(problems), usage };
}
