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
import { changeSummaryOf } from "../../shared/change-summary";
import type { AppliedTheme } from "../../shared/context/theme";
import { draftLayout, mixNote, mixPrompt, variantLabel, variationName, VARY_PROMPT, varyNote } from "@/lib/variations";
import { renderCheckOf, renderRepairOf, type RenderCheck } from "@/lib/render-check";
import { setResolved } from "../../shared/comments";
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
import { flushProjectFiles, type ChangeOptions, type ProjectState } from "./use-project";
import type { StructureNode } from "./use-structure";

export type WritingFile = { kind: FileKind; screen?: ScreenMeta; text: string; done: boolean };

export type Generation = {
	id: string;
	task: "create" | "edit" | "repair" | "context" | "vary" | "theme";
	variations: number;
	/** `variant` is set only for the extra variations (1…) of a parallel run. */
	steps: { label: string; detail?: string; variant?: number }[];
	reply: string;
	attempt: number;
	writing: Record<string, WritingFile>;
};

export type GenerationDrafts = {
	frames: Frame[];
	files: ProjectFiles;
	writing: Record<string, WritingFile>;
};

type SendOptions = {
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
};

type LastRequest = { prompt: string; options: SendOptions };

export type ThemeReading =
	| { ok: true; theme: AppliedTheme }
	/** `busy`: another generation runs; `no-model`: no provider is set up */
	| { ok: false; reason: "busy" | "no-model" | "aborted" }
	| { ok: false; reason: "failed"; error: GenerationFailure };

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

export function useGeneration({
	projectPath,
	stateRef,
	change,
	addMessages,
	files,
	frames,
	device,
	onPlaced,
	onResolved,
	undo,
}: {
	projectPath: string;
	stateRef: RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	addMessages: (messages: ChatMessage[]) => void;
	files: ProjectFiles;
	frames: Frame[];
	device: Device;
	onPlaced: (frames: Frame[]) => void;
	/** Comments a result resolved */
	onResolved?: (ids: string[]) => void;
	/** Regenerating takes the last result back first, while it is still the latest undo step */
	undo?: () => void;
}) {
	const { model } = useProviders();
	const [generation, setGeneration] = useState<Generation | null>(null);
	const [failure, setFailure] = useState<GenerationFailure | null>(null);
	const live = useRef<Generation | null>(null);
	const flush = useRef(0);
	const last = useRef<LastRequest | null>(null);
	/** The undo step the last request's result made */
	const lastResult = useRef<Snapshot | null>(null);
	const [regenerable, setRegenerable] = useState(false);
	/** The reply whose result is an undo step, so its summary can offer Undo while that step is still the latest */
	const [lastRun, setLastRun] = useState<{ messageId: string; step: Snapshot } | null>(null);

	// Events arrive per token; batch them into one render per frame
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
		async (prompt: string, options: SendOptions = {}): Promise<boolean> => {
			const current = stateRef.current;

			if (!current || live.current) return false;

			if (!model) {
				openSettings();

				return false;
			}

			const generationId = crypto.randomUUID();
			const task = options.repair ? "repair" : (options.task ?? (options.targets?.length ? "edit" : "create"));
			const variations = task === "create" || task === "vary" ? Math.max(1, options.variations ?? 1) : 1;

			if (!options.repair) {
				last.current = { prompt, options };
				lastResult.current = null;
				setRegenerable(true);
			}

			setFailure(null);
			live.current = { id: generationId, task, variations, steps: [], reply: "", attempt: 1, writing: {} };
			setGeneration(live.current);
			let check: RenderCheck = { screens: [], via: new Map() };
			let applied = false;

			try {
				await flushProjectFiles();

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
					attachments: options.attachments,
					chatId: current.chatId,
					command: options.command,
				});

				const latest = stateRef.current;

				if (!latest) return false;

				if (!result.ok) {
					if (result.error.code === "aborted") addMessages([message("assistant", "Stopped. Nothing was changed.")]);
					else setFailure(result.error);

					return false;
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

				if (result.changes.length) {
					change(
						(snapshot) => {
							const files = applyFileChanges(snapshot.files, result.changes);
							const frames = [...snapshot.frames, ...placed].filter((frame) => frame.file in files);

							return resolving.length
								? { files, frames, comments: setResolved(snapshot.comments ?? [], resolving, true) }
								: { files, frames };
						},
						placed.length ? { select: placed.map((frame) => frame.file) } : undefined,
					);

					step = stateRef.current?.history.present ?? null;

					if (!options.repair) lastResult.current = step;
				}

				const reply = result.reply.trim() || summarize(result.changes);

				const leftOut = result.problems.length
					? `\n\nI couldn't make ${[...new Set(result.problems.map((p) => p.path))].join(", ")} valid, so I left ${result.problems.length === 1 ? "it" : "them"} out:\n${result.problems.map((p) => `• ${p.path}${p.line ? `:${p.line}` : ""}: ${p.message}`).join("\n")}`
					: "";

				const done: ChatMessage = { ...message("assistant", reply + leftOut), context: result.context ?? [] };
				const summary = changeSummaryOf(latest.files, result.changes, result.problems);

				if (summary) done.summary = summary;
				addMessages([done]);
				setLastRun(step && summary?.files.length ? { messageId: done.id, step } : null);

				if (placed.length) onPlaced(placed);

				if (resolving.length) onResolved?.(resolving);
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

			// Decision 0003, check 5: one automatic repair, then the error stays in the frame.
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
		[stateRef, model, projectPath, device, change, addMessages, onPlaced, onResolved, collectRenderErrors],
	);

	const ready = useCallback(() => {
		if (!stateRef.current) return false;

		if (live.current) {
			toast("Wait for the current generation to finish");

			return false;
		}

		if (!model) {
			toast("Choose an AI provider first", { description: "Add an API key, a CLI or a local model." });
			openSettings();

			return false;
		}

		return true;
	}, [stateRef, model]);

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
			} = {},
		): boolean => {
			if (!ready()) return false;

			void toAttachments(files).then(
				(attachments) => {
					const current = stateRef.current;

					if (!current) return;

					const user = (content: string) =>
						attachments.length ? { ...message("user", content), attachments } : message("user", content);

					if (node && node.file in current.files) {
						const focus = focusOf(current.files, node);
						const where = variationName(node.file, current.canvas.frames);
						addMessages([user(focus ? focusNote(focus.label, where, prompt) : prompt)]);

						const send: SendOptions = {
							targets: [node.file],
							attachments,
							command: options.command,
							resolves: options.resolves,
						};

						if (focus) send.focus = focus;
						void run(prompt, send);

						return;
					}

					addMessages([user(prompt)]);
					void run(prompt, {
						...options,
						attachments,
						variations: options.targets?.length ? undefined : options.variations,
					});
				},
				(reason) => toast.error("Couldn't read the attached images", { description: String(reason) }),
			);

			return true;
		},
		[ready, stateRef, addMessages, run],
	);

	/** Another repair, on request, for a screen that still fails to render after the automatic one */
	const fix = useCallback(
		(target: string, problem: Problem) => {
			if (!ready()) return;
			const frames = stateRef.current!.canvas.frames;
			addMessages([message("user", `Fix ${variationName(target, frames)} so it renders`)]);
			const targets = [...new Set([target, problem.path])];
			void run(`Fix ${target} so it renders.`, { targets, repair: { problems: [problem] } });
		},
		[ready, stateRef, addMessages, run],
	);

	const vary = useCallback(
		(target: string, direction: string, count: number) => {
			if (!ready()) return;
			const frames = stateRef.current!.canvas.frames;
			addMessages([message("user", varyNote(variationName(target, frames), direction))]);
			void run(direction.trim() || VARY_PROMPT, { task: "vary", targets: [target], variations: count });
		},
		[ready, stateRef, addMessages, run],
	);

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

	const writeContext = useCallback(
		async (path: ContextFileName, prompt: string, note?: string): Promise<boolean> => {
			if (!ready()) return false;

			if (note) addMessages([message("user", note)]);

			return run(prompt, { task: "context", targets: [path] });
		},
		[ready, addMessages, run],
	);

	/** Reads DESIGN.md's theme with AI; changes nothing, the caller applies the result. */
	const readTheme = useCallback(async (): Promise<ThemeReading> => {
		if (!stateRef.current || live.current) return { ok: false, reason: "busy" };

		if (!model) return { ok: false, reason: "no-model" };
		const generationId = crypto.randomUUID();
		live.current = { id: generationId, task: "theme", variations: 1, steps: [], reply: "", attempt: 1, writing: {} };
		setGeneration(live.current);

		try {
			await flushProjectFiles();

			const result = await api.generate({ generationId, projectPath, prompt: "", device, model, task: "theme" });

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
			if (flush.current) cancelAnimationFrame(flush.current);
			flush.current = 0;

			if (live.current?.id === generationId) live.current = null;
			setGeneration((g) => (g?.id === generationId ? null : g));
		}
	}, [stateRef, model, projectPath, device]);

	const stop = useCallback(() => {
		const id = live.current?.id;

		if (id) void api.stopGeneration({ generationId: id });
	}, []);

	const retry = useCallback(() => {
		if (last.current) void run(last.current.prompt, last.current.options);
	}, [run]);

	/** Runs the last request again, in place of its result when nothing changed since */
	const regenerate = useCallback(() => {
		const request = last.current;

		if (!request || !ready()) return;

		if (lastResult.current && stateRef.current?.history.present === lastResult.current) undo?.();
		void run(request.prompt, request.options);
	}, [ready, stateRef, undo, run]);

	/** One undo step, and only while the run's result is still the latest one */
	const undoRun = useCallback(() => {
		if (lastRun && stateRef.current?.history.present === lastRun.step) undo?.();
	}, [lastRun, stateRef, undo]);

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
		fix,
		mix,
		writeContext,
		readTheme,
		stop,
		retry,
		regenerate: regenerable ? regenerate : null,
		lastRun,
		undoRun,
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
