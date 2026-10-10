import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { draftsOf, message, type AttachCallbacks, type RunOptions } from "@/lib/generation-session";
import { projectSessions } from "@/lib/sessions";
import type { Attachment, GenerationPlan, Problem } from "../../shared/ai/contract";
import { focusNote, focusOf } from "../../shared/ai/focus";
import type { DesignNote } from "../../shared/change-summary";
import { DESIGN_RULE_LABELS } from "../../shared/design/findings";
import { isFreshNote, noteProblem, POLISH_PROMPT } from "../../shared/design/polish";
import type { ContextFileName, Device, Frame, ProjectFiles } from "../../shared/types";
import { mixNote, mixPrompt, variationName, VARY_PROMPT, varyNote } from "@/lib/variations";
import { openSettings, useProviders } from "./use-providers";
import type { StructureNode } from "./use-structure";

export type { Generation, GenerationDrafts, PendingPlan, ThemeReading, WritingFile } from "@/lib/generation-session";

const IMAGE_TYPES: ReadonlySet<string> = new Set<Attachment["mediaType"]>([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

const isImageType = (type: string): type is Attachment["mediaType"] => IMAGE_TYPES.has(type);

async function toAttachments(files: File[] = []): Promise<Attachment[]> {
	const images = files.flatMap((file) => {
		const mediaType = file.type;

		return isImageType(mediaType) ? [{ file, mediaType }] : [];
	});

	return Promise.all(
		images.map(async ({ file, mediaType }) => {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let binary = "";

			for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

			return { name: file.name, mediaType, data: btoa(binary) };
		}),
	);
}

export function useGeneration({
	projectPath,
	files,
	frames,
	device,
	onPlaced,
	onResolved,
}: {
	projectPath: string;
	files: ProjectFiles;
	frames: Frame[];
	device: Device;
	onPlaced: (frames: Frame[]) => void;
	/** Comments a result resolved */
	onResolved: (ids: string[]) => void;
}) {
	const { model } = useProviders();
	const { session, controller } = useMemo(() => projectSessions.open(projectPath), [projectPath]);
	const view = useSyncExternalStore(controller.subscribe, controller.get);
	const { generation, failure, pendingPlan, lastRun, regenerable } = view;
	const attached = useRef<AttachCallbacks>({ onPlaced, onResolved });

	useLayoutEffect(() => {
		attached.current = { onPlaced, onResolved };
	});

	useEffect(() => {
		const detach = controller.attach({
			onPlaced: (placed) => attached.current.onPlaced(placed),
			onResolved: (ids) => attached.current.onResolved(ids),
		});

		return () => {
			detach();

			if (controller.task() === "theme") controller.stop();
		};
	}, [controller]);

	const ready = useCallback(() => {
		if (!session.state()) return false;

		if (controller.busy()) {
			toast("Wait for the current generation to finish");

			return false;
		}

		if (!model) {
			toast("Choose an AI provider first", { description: "Add an API key, a CLI or a local model." });
			openSettings();

			return false;
		}

		return true;
	}, [session, controller, model]);

	const run = useCallback(
		(prompt: string, options: RunOptions) => {
			if (!model) {
				openSettings();

				return Promise.resolve(false);
			}

			return controller.run(prompt, options, model);
		},
		[controller, model],
	);

	const acceptPlan = useCallback(
		(plan: GenerationPlan) => {
			if (ready() && model) controller.acceptPlan(plan, model);
		},
		[ready, controller, model],
	);

	/**
	 * `variations` is ignored when editing `targets`; a stale `focus` falls back to editing the whole file.
	 * `false` when nothing was sent (no model, or a generation is running), so the caller can keep the prompt.
	 */
	const send = useCallback(
		(
			prompt: string,
			{
				focus: node,
				files,
				...options
			}: {
				targets?: string[];
				files?: File[];
				variations?: number;
				focus?: StructureNode | null;
				command?: { name: string; args: string };
				resolves?: string[];
				autoDesign?: boolean;
			} = {},
		): boolean => {
			if (!ready() || !model) return false;

			void toAttachments(files).then(
				(attachments) => {
					const current = session.state();

					if (!current) return;

					const user = (content: string) =>
						attachments.length ? { ...message("user", content), attachments } : message("user", content);

					const focused = Boolean(node && node.file in current.files);
					const waiting = controller.get().pendingPlan;

					if (waiting && !focused && !options.targets?.length && !options.command) {
						session.addMessages([user(prompt)]);
						controller.revisePlan(prompt, attachments, model);

						return;
					}

					if (waiting) session.addMessages([message("assistant", "Dropped the plan that was waiting.")]);

					if (node && focused) {
						const focus = focusOf(current.files, node);
						const where = variationName(node.file, current.canvas.frames);
						session.addMessages([user(focus ? focusNote(focus.label, where, prompt) : prompt)]);

						const send: RunOptions = {
							targets: [node.file],
							attachments,
							command: options.command,
							resolves: options.resolves,
						};

						if (focus) send.focus = focus;
						void controller.run(prompt, send, model);

						return;
					}

					session.addMessages([user(prompt)]);
					void controller.run(
						prompt,
						{ ...options, attachments, variations: options.targets?.length ? undefined : options.variations },
						model,
					);
				},
				(reason) => toast.error("Couldn't read the attached images", { description: String(reason) }),
			);

			return true;
		},
		[ready, model, session, controller],
	);

	/** Another repair, on request, for a screen that still fails to render after the automatic one */
	const fix = useCallback(
		(target: string, problem: Problem) => {
			if (!ready()) return;
			const frames = session.state()!.canvas.frames;
			session.addMessages([message("user", `Fix ${variationName(target, frames)} so it renders`)]);
			const targets = [...new Set([target, problem.path])];
			void run(`Fix ${target} so it renders.`, { targets, repair: { problems: [problem] } });
		},
		[ready, session, run],
	);

	const fixNote = useCallback(
		(note: DesignNote) => {
			if (!ready()) return;
			const current = session.state()!;

			if (!(note.path in current.files)) {
				toast("That file is no longer in the project");

				return;
			}

			const fresh = isFreshNote(note, current.files);

			const focus =
				fresh && note.start !== undefined ? focusOf(current.files, { file: note.path, start: note.start }) : null;

			const where = variationName(note.screen, current.canvas.frames);
			const label = DESIGN_RULE_LABELS[note.rule];

			session.addMessages([
				message("user", focus ? focusNote(focus.label, where, `fix “${label}”`) : `Fix “${label}” in ${where}`),
			]);

			const options: RunOptions = { targets: [note.path], repair: { problems: [noteProblem(note, fresh)] } };

			if (focus) options.focus = focus;
			void run(POLISH_PROMPT, options);
		},
		[ready, session, run],
	);

	const vary = useCallback(
		(target: string, direction: string, count: number) => {
			if (!ready()) return;
			const frames = session.state()!.canvas.frames;
			session.addMessages([message("user", varyNote(variationName(target, frames), direction))]);
			void run(direction.trim() || VARY_PROMPT, { task: "vary", targets: [target], variations: count });
		},
		[ready, session, run],
	);

	const mix = useCallback(
		(receiver: string, source: string, section: string) => {
			if (!ready() || !section.trim()) return;
			const frames = session.state()!.canvas.frames;
			const sourceName = variationName(source, frames);
			session.addMessages([message("user", mixNote(section, sourceName, variationName(receiver, frames)))]);
			void run(mixPrompt(section, sourceName, source), { targets: [receiver], references: [source] });
		},
		[ready, session, run],
	);

	const writeContext = useCallback(
		async (path: ContextFileName, prompt: string, note?: string): Promise<boolean> => {
			if (!ready()) return false;

			if (note) session.addMessages([message("user", note)]);

			return run(prompt, { task: "context", targets: [path] });
		},
		[ready, session, run],
	);

	const readTheme = useCallback(() => controller.readTheme(model), [controller, model]);

	const retry = useCallback(() => {
		if (model) controller.retry(model);
	}, [controller, model]);

	const regenerate = useCallback(() => {
		if (ready() && model) controller.regenerate(model);
	}, [ready, controller, model]);

	const writing = generation?.writing;

	// Only finished files and new paths change the drafts; deltas just update `writing`
	const doneKey = writing
		? Object.entries(writing)
				.map(([path, f]) => (f.done ? `${path}:${f.text.length}` : path))
				.join("|")
		: null;

	const drafts = useMemo(() => {
		const current = controller.get().generation?.writing;

		if (doneKey === null || !current) return null;

		return draftsOf(current, files, frames, device);
	}, [controller, doneKey, files, frames, device]);

	return {
		generation,
		drafts: drafts && writing ? { ...drafts, writing } : null,
		failure,
		dismissFailure: controller.dismissFailure,
		send,
		vary,
		fix,
		fixNote,
		mix,
		writeContext,
		readTheme,
		stop: controller.stop,
		retry,
		regenerate: regenerable ? regenerate : null,
		lastRun,
		undoRun: controller.undoRun,
		pendingPlan,
		acceptPlan,
		cancelPlan: controller.cancelPlan,
	};
}
