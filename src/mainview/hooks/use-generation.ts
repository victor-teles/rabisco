import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import { onFrameStatus } from "@/lib/render/frame-host";
import { api, onGenerationEvent } from "@/lib/rpc";
import type {
	Attachment,
	ElementFocus,
	FileKind,
	GenerationEvent,
	Problem,
	ScreenMeta,
} from "../../shared/ai/contract";
import { focusNote, focusOf } from "../../shared/ai/focus";
import { draftLayout, mixNote, mixPrompt, variantLabel, variationName, VARY_PROMPT, varyNote } from "@/lib/variations";
import { renderCheckOf, renderRepairOf, type RenderCheck } from "@/lib/render-check";
import { isContextFile, isScreenFile } from "../../shared/project";
import type {
	ChatMessage,
	ContextFileName,
	Device,
	FileChange,
	Frame,
	GenerationFailure,
	ProjectFiles,
} from "../../shared/types";
import { isAlternate, placeNewFrames } from "../../shared/variations";
import { openSettings, useProviders } from "./use-providers";
import type { ChangeOptions, ProjectState } from "./use-project";
import type { StructureNode } from "./use-structure";

/** A file the provider is writing right now. `done` once `file.end` arrived. */
export type WritingFile = { kind: FileKind; screen?: ScreenMeta; text: string; done: boolean };

export type Generation = {
	id: string;
	task: "create" | "edit" | "repair" | "context" | "vary";
	/** Parallel variations of this run; 1 for a single generation */
	variations: number;
	/** `variant` is set for the extra variations (1…) of a parallel run */
	steps: { label: string; detail?: string; variant?: number }[];
	/** Assistant text streamed so far */
	reply: string;
	/** 1 for the first try, then automatic repairs */
	attempt: number;
	writing: Record<string, WritingFile>;
};

export type GenerationDrafts = {
	/** Placeholder frames for screens that don't exist yet */
	frames: Frame[];
	/** Project files with every finished file of the generation applied, so frames render before it ends */
	files: ProjectFiles;
	writing: Record<string, WritingFile>;
};

type SendOptions = {
	targets?: string[];
	files?: File[];
	/**
	 * `context`: write the context file in `targets`. `vary`: new alternates of the one screen in `targets`.
	 * Otherwise the task follows from `targets` (edit or create).
	 */
	task?: "context" | "vary";
	/** Parallel variations, for create and vary */
	variations?: number;
	/** Read-only files for an edit (Mix) */
	references?: string[];
	/** Point and prompt: the one element of the one target the edit is about */
	focus?: ElementFocus;
	repair?: { problems: Problem[] };
};

type LastRequest = { prompt: string; options: SendOptions };

/** How long to wait for frames to report a render error after a generation lands */
const RENDER_CHECK_MS = 2500;

const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
});

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

function applyEvent(generation: Generation, attempt: number, event: GenerationEvent, variant?: number): Generation {
	switch (event.type) {
		case "status": {
			// Parallel variations interleave; skip repeats within one variation
			const label = variantLabel(event.label, variant);
			const last = [...generation.steps].reverse().find((step) => (step.variant ?? 0) === (variant || 0));

			if (last?.label === label && last.detail === event.detail) return generation;

			return {
				...generation,
				steps: [...generation.steps, { label, detail: event.detail, variant: variant || undefined }],
			};
		}

		case "message.delta":
			// Repairs talk about the fix, and parallel variations all talk at once: keep the primary's first attempt
			return attempt <= 1 && !variant ? { ...generation, reply: generation.reply + event.text } : generation;
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

/**
 * Runs generations for the editor: streams provider events into the chat and
 * the canvas, applies the validated result as one undo step, checks that the
 * new screens render and asks for one repair when they don't.
 */
export function useGeneration({
	projectPath,
	stateRef,
	change,
	addMessages,
	files,
	frames,
	device,
	onPlaced,
}: {
	projectPath: string;
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	addMessages: (messages: ChatMessage[]) => void;
	files: ProjectFiles;
	frames: Frame[];
	device: Device;
	onPlaced: (frames: Frame[]) => void;
}) {
	const { model } = useProviders();
	const [generation, setGeneration] = useState<Generation | null>(null);
	const [failure, setFailure] = useState<GenerationFailure | null>(null);
	const live = useRef<Generation | null>(null);
	const flush = useRef(0);
	const last = useRef<LastRequest | null>(null);

	// Events can arrive per token; batch them into one render per frame
	useEffect(
		() =>
			onGenerationEvent(({ generationId, attempt, variant, event }) => {
				if (!live.current || live.current.id !== generationId) return;
				live.current = applyEvent(live.current, attempt, event, variant);

				if (!flush.current) {
					flush.current = requestAnimationFrame(() => {
						flush.current = 0;
						setGeneration(live.current);
					});
				}
			}),
		[],
	);

	/** Waits for frames of `screens` to render and collects their errors, by screen. */
	const collectRenderErrors = useCallback((screens: string[]) => {
		type Failure = { entry: string; problem: Problem };

		const watched = new Set(screens);
		const failures = new Map<string, Failure>();

		if (!watched.size) return Promise.resolve<Failure[]>([]);

		return new Promise<Failure[]>((resolve) => {
			const unsubscribe = onFrameStatus((status) => {
				if (!watched.has(status.entry)) return;

				if (status.status === "error") {
					const file = status.error.file ?? status.entry;
					failures.set(status.entry, {
						entry: status.entry,
						problem: { path: file, message: status.error.message, line: status.error.line },
					});
				} else if (status.status === "rendered") failures.delete(status.entry);
			});

			setTimeout(() => {
				unsubscribe();
				resolve([...failures.values()]);
			}, RENDER_CHECK_MS);
		});
	}, []);

	const run = useCallback(
		/** Resolves to whether the result was applied. */
		async (prompt: string, options: SendOptions = {}): Promise<boolean> => {
			const current = stateRef.current;

			if (!current || live.current) return false;

			if (!model) {
				openSettings();

				return false;
			}

			const generationId = crypto.randomUUID();
			const task = options.repair ? "repair" : (options.task ?? (options.targets?.length ? "edit" : "create"));
			// Variations apply to new screens only; edits change the selected ones
			const variations = task === "create" || task === "vary" ? Math.max(1, options.variations ?? 1) : 1;
			last.current = options.repair ? last.current : { prompt, options };
			setFailure(null);
			live.current = { id: generationId, task, variations, steps: [], reply: "", attempt: 1, writing: {} };
			setGeneration(live.current);
			let check: RenderCheck = { screens: [], via: new Map() };
			let applied = false;

			try {
				const result = await api.generate({
					generationId,
					projectPath,
					prompt,
					device,
					model,
					targets: options.targets,
					task,
					variations: variations > 1 || task === "vary" ? variations : undefined,
					references: options.references,
					focus: options.focus,
					problems: options.repair?.problems,
					attachments: await toAttachments(options.files),
				});

				const latest = stateRef.current;

				if (!latest) return false;

				if (!result.ok) {
					if (result.error.code === "aborted") addMessages([message("assistant", "Stopped. Nothing was changed.")]);
					else setFailure(result.error);

					return false;
				}

				// New frames go right of the canvas; new alternates go below their group
				const placedFiles = new Set(latest.canvas.frames.map((frame) => frame.file));

				const placed = placeNewFrames(
					latest.canvas.frames,
					result.frames.filter((frame) => !placedFiles.has(frame.file)),
				);

				if (result.changes.length) {
					change(
						(snapshot) => {
							const files = applyFileChanges(snapshot.files, result.changes);

							return { files, frames: [...snapshot.frames, ...placed].filter((frame) => frame.file in files) };
						},
						placed.length ? { select: placed.map((frame) => frame.file) } : undefined,
					);
				}

				const reply = result.reply.trim() || summarize(result.changes);

				const leftOut = result.problems.length
					? `\n\nI couldn't make ${[...new Set(result.problems.map((p) => p.path))].join(", ")} valid, so I left ${result.problems.length === 1 ? "it" : "them"} out:\n${result.problems.map((p) => `• ${p.path}${p.line ? `:${p.line}` : ""}: ${p.message}`).join("\n")}`
					: "";

				// `context` records which files shaped this result; the chat and the Context panel show it
				addMessages([{ ...message("assistant", reply + leftOut), context: result.context ?? [] }]);

				if (placed.length) onPlaced(placed);
				applied = true;

				if (!options.repair) check = renderCheckOf(applyFileChanges(latest.files, result.changes), result.changes);
			} catch (reason) {
				setFailure({ code: "unknown", message: String(reason), retryable: true });
			} finally {
				if (flush.current) cancelAnimationFrame(flush.current);
				flush.current = 0;

				if (live.current?.id === generationId) live.current = null;
				setGeneration((g) => (g?.id === generationId ? null : g));
			}

			// Check 5 of decision 0003: the frames must render. One automatic repair, then the error stays in the frame.
			const failures = await collectRenderErrors(check.screens);

			if (failures.length && !live.current) {
				const failed = [...new Set(failures.map((f) => f.problem.path))];
				addMessages([message("assistant", `${failed.join(", ")} failed to render. Fixing it…`)]);
				const repair = renderRepairOf(failures, check.via);
				void run(prompt, { targets: repair.targets, repair: { problems: repair.problems } });
			}

			return applied;
		},
		// `run` calls itself for the repair; the latest closure is fine there
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[stateRef, model, projectPath, device, change, addMessages, onPlaced, collectRenderErrors],
	);

	/** Whether a new request can start; points to Settings when no model is set up. */
	const ready = useCallback(() => {
		if (!stateRef.current || live.current) return false;

		if (!model) {
			toast("Choose an AI provider first", { description: "Add an API key, a CLI or a local model." });
			openSettings();

			return false;
		}

		return true;
	}, [stateRef, model]);

	/**
	 * With `targets` the prompt edits them and `variations` is ignored; without, it creates `variations` versions.
	 * With `focus` (point and prompt) it edits that element of its file only, and `targets` is that file. When the
	 * element is gone from the current source, it falls back to an edit of the whole file.
	 */
	const send = useCallback(
		(
			prompt: string,
			{
				focus: node,
				...options
			}: { targets?: string[]; files?: File[]; variations?: number; focus?: StructureNode | null } = {},
		) => {
			if (!ready()) return;
			const current = stateRef.current!;

			if (node && node.file in current.files) {
				const focus = focusOf(current.files, node);
				const where = variationName(node.file, current.canvas.frames);
				addMessages([message("user", focus ? focusNote(focus.label, where, prompt) : prompt)]);
				const send: SendOptions = { targets: [node.file], files: options.files };

				if (focus) send.focus = focus;
				void run(prompt, send);

				return;
			}

			addMessages([message("user", prompt)]);
			void run(prompt, options.targets?.length ? { ...options, variations: undefined } : options);
		},
		[ready, stateRef, addMessages, run],
	);

	/** "Vary this": `count` new alternates of `target`, with an optional direction ("bolder"). The screen stays as it is. */
	const vary = useCallback(
		(target: string, direction: string, count: number) => {
			if (!ready()) return;
			const frames = stateRef.current!.canvas.frames;
			addMessages([message("user", varyNote(variationName(target, frames), direction))]);
			void run(direction.trim() || VARY_PROMPT, { task: "vary", targets: [target], variations: count });
		},
		[ready, stateRef, addMessages, run],
	);

	/** Mix: takes `section` ("header") of `source` into `receiver`, an edit that only reads `source`. */
	const mix = useCallback(
		(receiver: string, source: string, section: string) => {
			if (!ready() || !section.trim()) return;
			const frames = stateRef.current!.canvas.frames;
			const sourceName = variationName(source, frames);
			addMessages([message("user", mixNote(section, sourceName, variationName(receiver, frames)))]);
			void run(mixPrompt(section, sourceName, source), { targets: [receiver], references: [source] });
		},
		[ready, stateRef, addMessages, run],
	);

	/**
	 * Writes PRODUCT.md or DESIGN.md with a `context` generation. `note` is the
	 * user-visible chat message ("Write DESIGN.md from my screens"); the prompt
	 * itself can be longer. Resolves to whether the file was written.
	 */
	const writeContext = useCallback(
		async (path: ContextFileName, prompt: string, note?: string): Promise<boolean> => {
			if (!ready()) return false;

			if (note) addMessages([message("user", note)]);

			return run(prompt, { task: "context", targets: [path] });
		},
		[ready, addMessages, run],
	);

	const stop = useCallback(() => {
		const id = live.current?.id;

		if (id) void api.stopGeneration({ generationId: id });
	}, []);

	const retry = useCallback(() => {
		if (last.current) void run(last.current.prompt, last.current.options);
	}, [run]);

	// Stop a running generation when the editor closes
	useEffect(() => () => stop(), [stop]);

	const writing = generation?.writing;

	// Only finished files and new paths change the drafts; deltas just update `writing`
	const doneKey = writing
		? Object.entries(writing)
				.map(([path, f]) => (f.done ? `${path}:${f.text.length}` : path))
				.join("|")
		: null;

	const drafts = useMemo(() => {
		const current = live.current?.writing;

		if (doneKey === null || !current) return null;
		const fresh = Object.keys(current).filter((path) => isScreenFile(path) && !(path in files));
		const meta = Object.fromEntries(fresh.map((path) => [path, current[path]!.screen]));
		const draftFrames = placeNewFrames(frames, draftLayout(fresh, meta, device));
		const draftFiles = { ...files };

		for (const [path, file] of Object.entries(current)) if (file.done) draftFiles[path] = file.text;

		return { frames: draftFrames, files: draftFiles };
	}, [doneKey, files, frames, device]);

	return {
		generation,
		drafts: drafts && writing ? ({ ...drafts, writing } satisfies GenerationDrafts) : null,
		failure,
		dismissFailure: () => setFailure(null),
		send,
		vary,
		mix,
		writeContext,
		stop,
		retry,
	};
}

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
