import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Download, Hand, Maximize, Minus, MousePointer2, Plus, Redo2, Share2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NoDrag, TitleBar } from "@/components/app/title-bar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { useProject } from "@/hooks/use-project";
import type { Theme } from "@/hooks/use-theme";
import { align, boundsOf, distribute, type Alignment, type Axis } from "@/lib/align";
import { applyFileChanges } from "@/lib/history";
import { api, onGenerationStep } from "@/lib/rpc";
import { selectedFrames, toggleInSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { FRAME_GAP, FRAME_SIZE, nextFrameX, uniqueScreenPath } from "../../../shared/project";
import type { ChatMessage, Device, Frame, ProjectFiles } from "../../../shared/types";
import { Canvas, type CanvasHandle, type FrameMove, type Tool, type Viewport } from "./canvas";
import { ChatPanel, type Generation } from "./chat-panel";
import { Inspector, type FramePatch, type InspectorTab } from "./inspector";
import { ALIGN_SHORTCUTS, DISTRIBUTE_SHORTCUTS, isTyping } from "./shortcuts";

type EditorProps = {
	projectPath: string;
	initialPrompt?: string;
	initialModel: string;
	theme: Theme;
	onToggleTheme: () => void;
	onBack: () => void;
};

const NO_FRAMES: Frame[] = [];
const NO_FILES: ProjectFiles = {};
const NO_SELECTION: string[] = [];
/** Arrow-key nudges closer together than this are one undo step */
const NUDGE_BURST_MS = 800;

const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
});

/** Replaces frames by file, keeping canvas order. */
const withMoves = (frames: Frame[], moves: FrameMove[]) => {
	const byFile = new Map(moves.map((move) => [move.file, move]));
	return frames.map((frame) => {
		const move = byFile.get(frame.file);
		return move && (move.x !== frame.x || move.y !== frame.y) ? { ...frame, x: move.x, y: move.y } : frame;
	});
};

export function EditorView({ projectPath, initialPrompt, initialModel, theme, onToggleTheme, onBack }: EditorProps) {
	const { project, error, stateRef, canUndo, canRedo, change, endStep, undo, redo, setSelection, setMeta, addMessages } =
		useProject(projectPath);
	const [tool, setTool] = useState<Tool>("move");
	const [tab, setTab] = useState<InspectorTab>("design");
	const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 80, zoom: 0.6 });
	const [generation, setGeneration] = useState<Generation | null>(null);
	const [model, setModel] = useState(initialModel);
	const canvasRef = useRef<CanvasHandle>(null);
	const startedInitialPrompt = useRef(false);
	const fittedOnLoad = useRef(false);
	const nudge = useRef({ key: "", at: 0 });

	const frames = project?.canvas.frames ?? NO_FRAMES;
	const files = project?.files ?? NO_FILES;
	const selection = project?.canvas.selection ?? NO_SELECTION;
	const device = project?.canvas.device ?? "mobile";
	const selected = useMemo(() => selectedFrames(frames, selection), [frames, selection]);

	// Frame existing work once the project opens
	useEffect(() => {
		if (!project || fittedOnLoad.current) return;
		fittedOnLoad.current = true;
		const initial = project.canvas.selection.length ? selected : project.canvas.frames;
		if (initial.length) requestAnimationFrame(() => canvasRef.current?.fitTo(initial));
	}, [project, selected]);

	useEffect(
		() =>
			onGenerationStep((step) =>
				setGeneration((current) =>
					current && current.id === step.generationId
						? { ...current, steps: [...current.steps, step.label] }
						: current,
				),
			),
		[],
	);

	const send = useCallback(
		async (prompt: string) => {
			if (!stateRef.current || generation) return;
			const generationId = crypto.randomUUID();
			addMessages([message("user", prompt)]);
			setGeneration({ id: generationId, steps: [] });

			try {
				const result = await api.generateScreens({
					generationId,
					projectPath,
					prompt,
					device,
					model,
					existingFiles: Object.keys(stateRef.current.files),
				});
				const current = stateRef.current;
				if (!current) return;
				// Files, frames and the reply land together; files + frames are one undo step
				const placedFiles = new Set(current.canvas.frames.map((frame) => frame.file));
				const offset = nextFrameX(current.canvas.frames);
				const placed = result.frames
					.filter((frame) => !placedFiles.has(frame.file))
					.map((frame) => ({ ...frame, x: frame.x + offset }));
				change(
					(snapshot) => {
						const nextFiles = applyFileChanges(snapshot.files, result.changes);
						return {
							files: nextFiles,
							frames: [...snapshot.frames, ...placed].filter((frame) => frame.file in nextFiles),
						};
					},
					{ select: placed.map((frame) => frame.file) },
				);
				addMessages([message("assistant", result.reply)]);
				if (placed.length) requestAnimationFrame(() => canvasRef.current?.fitTo(placed));
			} catch (reason) {
				toast.error("Generation failed", { description: String(reason) });
			} finally {
				setGeneration(null);
			}
		},
		[stateRef, generation, addMessages, projectPath, device, model, change],
	);

	useEffect(() => {
		if (!project || !initialPrompt || startedInitialPrompt.current) return;
		startedInitialPrompt.current = true;
		send(initialPrompt);
	}, [project, initialPrompt, send]);

	const patchFrame = useCallback(
		(file: string, patch: FramePatch, step?: string) =>
			change(
				(snapshot) => ({
					...snapshot,
					frames: snapshot.frames.map((frame) => {
						if (frame.file !== file) return frame;
						// Switching device resets the frame to that device's size
						const size = patch.device && patch.device !== frame.device ? FRAME_SIZE[patch.device] : {};
						return { ...frame, ...patch, ...size };
					}),
				}),
				{ coalesce: step },
			),
		[change],
	);

	const moveFrames = useCallback(
		(moves: FrameMove[], dragId: string) =>
			change((snapshot) => ({ ...snapshot, frames: withMoves(snapshot.frames, moves) }), { coalesce: `drag:${dragId}` }),
		[change],
	);

	const alignSelection = useCallback(
		(alignment: Alignment) =>
			change((snapshot) => {
				const targets = selectedFrames(snapshot.frames, selection);
				return targets.length < 2 ? snapshot : { ...snapshot, frames: withMoves(snapshot.frames, align(targets, alignment)) };
			}),
		[change, selection],
	);

	const distributeSelection = useCallback(
		(axis: Axis) =>
			change((snapshot) => {
				const targets = selectedFrames(snapshot.frames, selection);
				return targets.length < 3 ? snapshot : { ...snapshot, frames: withMoves(snapshot.frames, distribute(targets, axis)) };
			}),
		[change, selection],
	);

	/** Deleting a frame deletes its screen file; undo brings both back. */
	const deleteSelection = useCallback(() => {
		if (!selection.length) return;
		const doomed = new Set(selection);
		change(
			(snapshot) => ({
				frames: snapshot.frames.filter((frame) => !doomed.has(frame.file)),
				files: Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => !doomed.has(path))),
			}),
			{ select: [] },
		);
	}, [change, selection]);

	/** Copies each selected screen to a new file, placed below the selection. */
	const duplicateSelection = useCallback(() => {
		const current = stateRef.current;
		if (!current) return;
		const sources = selectedFrames(current.canvas.frames, selection);
		const bounds = boundsOf(sources);
		if (!bounds) return;
		const taken = new Set(Object.keys(current.files));
		const copies = sources.map((frame) => {
			const file = uniqueScreenPath(frame.file.replace(/^screens\//, "").replace(/\.tsx$/, ""), taken);
			taken.add(file);
			return { ...frame, file, name: `${frame.name} copy`, y: frame.y + bounds.height + FRAME_GAP };
		});
		change(
			(snapshot) => ({
				files: {
					...snapshot.files,
					...Object.fromEntries(copies.map((copy, i) => [copy.file, snapshot.files[sources[i]!.file] ?? ""])),
				},
				frames: [...snapshot.frames, ...copies],
			}),
			{ select: copies.map((copy) => copy.file) },
		);
	}, [stateRef, change, selection]);

	const nudgeSelection = useCallback(
		(dx: number, dy: number) => {
			const now = Date.now();
			if (now - nudge.current.at > NUDGE_BURST_MS) nudge.current.key = `nudge:${now}`;
			nudge.current.at = now;
			const targets = selectedFrames(frames, selection);
			moveFrames(
				targets.map((frame) => ({ file: frame.file, x: frame.x + dx, y: frame.y + dy })),
				nudge.current.key,
			);
		},
		[frames, selection, moveFrames],
	);

	const selectFromList = useCallback(
		(file: string, additive: boolean) => {
			if (additive) return setSelection(toggleInSelection(selection, file));
			setSelection([file]);
			const frame = frames.find((f) => f.file === file);
			if (frame) canvasRef.current?.fitTo([frame]);
		},
		[frames, selection, setSelection],
	);

	// Keyboard shortcuts (Figma conventions), ignored while typing. The handler
	// reads the latest render through a ref so it is registered once.
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || isTyping(event.target) || !project) return;
		const mod = event.metaKey || (event.ctrlKey && !event.altKey);
		const code = event.code;

		if (mod && code === "KeyZ") {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (mod && code === "KeyY") {
			event.preventDefault();
			redo();
		} else if (mod && code === "KeyA") {
			event.preventDefault();
			setSelection(frames.map((frame) => frame.file));
		} else if (mod && code === "KeyD") {
			event.preventDefault();
			duplicateSelection();
		} else if (mod && code === "Digit0") {
			event.preventDefault();
			canvasRef.current?.resetZoom();
		} else if (mod && (event.key === "=" || event.key === "+")) {
			event.preventDefault();
			canvasRef.current?.zoomBy(1.2);
		} else if (mod && event.key === "-") {
			event.preventDefault();
			canvasRef.current?.zoomBy(1 / 1.2);
		} else if (event.ctrlKey && event.altKey && !event.metaKey) {
			const item = DISTRIBUTE_SHORTCUTS.find((s) => s.code === code);
			if (item) {
				event.preventDefault();
				distributeSelection(item.axis);
			}
		} else if (event.altKey && !event.metaKey && !event.ctrlKey) {
			const item = ALIGN_SHORTCUTS.find((s) => s.code === code);
			if (item) {
				event.preventDefault();
				alignSelection(item.alignment);
			}
		} else if (event.metaKey || event.ctrlKey) {
			return;
		} else if (event.shiftKey && code === "KeyD") {
			setTab((current) => (current === "code" ? "design" : "code"));
		} else if (event.shiftKey && code === "Digit1") {
			canvasRef.current?.fitTo(frames);
		} else if (event.shiftKey && code === "Digit2") {
			if (selected.length) canvasRef.current?.fitTo(selected);
		} else if (event.key === "v") setTool("move");
		else if (event.key === "h") setTool("hand");
		else if (event.key === "Escape") setSelection([]);
		else if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			deleteSelection();
		} else if (event.key.startsWith("Arrow") && selected.length) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
			const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
			nudgeSelection(dx, dy);
		}
	};
	const keyHandler = useRef(onKeyDown);
	keyHandler.current = onKeyDown;
	useEffect(() => {
		const listener = (event: KeyboardEvent) => keyHandler.current(event);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, []);

	if (error) {
		return (
			<div className="grid h-full place-items-center">
				<div className="max-w-sm text-center">
					<p className="text-sm font-medium">This project couldn't be opened</p>
					<p className="mt-1 text-[13px] break-words text-muted-foreground">{error}</p>
					<Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
						Back to home
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<TitleBar>
				<NoDrag className="flex items-center gap-1">
					<Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to home">
						<ChevronLeft />
					</Button>
					<input
						value={project?.canvas.name ?? ""}
						onChange={(event) => setMeta({ name: event.target.value })}
						onBlur={(event) => !event.target.value.trim() && setMeta({ name: "Untitled design" })}
						onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
						aria-label="Project name"
						title={projectPath}
						className="h-7 w-56 rounded-md bg-transparent px-2 text-[13px] font-medium outline-none hover:bg-accent focus:bg-accent"
					/>
				</NoDrag>
				<div className="flex-1" />
				<NoDrag className="flex items-center gap-1">
					<ThemeToggle theme={theme} onToggle={onToggleTheme} />
					<Button variant="ghost" size="sm" onClick={() => toast("Sharing is coming soon")}>
						<Share2 />
						Share
					</Button>
					<Button size="sm" onClick={() => toast("Export to code is coming soon")}>
						<Download />
						Export
					</Button>
				</NoDrag>
			</TitleBar>

			<div className="flex min-h-0 flex-1">
				<ChatPanel
					messages={project?.messages ?? []}
					generation={generation}
					device={device}
					onDeviceChange={(next: Device) => setMeta({ device: next })}
					model={model}
					onModelChange={setModel}
					onSend={send}
					selectedScreenName={selected.length === 1 ? selected[0]!.name : undefined}
				/>

				<div className="relative min-w-0 flex-1">
					<Canvas
						frames={frames}
						files={files}
						selection={selection}
						onSelectionChange={setSelection}
						onMoveFrames={moveFrames}
						onMoveEnd={endStep}
						tool={tool}
						viewport={viewport}
						onViewportChange={setViewport}
						handleRef={canvasRef}
					>
						{project && frames.length === 0 && !generation ? (
							<div className="pointer-events-none absolute inset-0 grid place-items-center">
								<EmptyState variant="plain" className="max-w-xs">
									<EmptyStateContent>
										<EmptyStateHeader>
											<EmptyStateTitle>Your canvas is empty</EmptyStateTitle>
											<EmptyStateDescription>
												Describe what you want in the chat and Rabisco will draft the first screens here.
											</EmptyStateDescription>
										</EmptyStateHeader>
									</EmptyStateContent>
								</EmptyState>
							</div>
						) : null}
					</Canvas>

					<Toolbar
						tool={tool}
						onToolChange={setTool}
						canUndo={canUndo}
						canRedo={canRedo}
						onUndo={undo}
						onRedo={redo}
					/>
					<ZoomControls
						zoom={viewport.zoom}
						onZoomIn={() => canvasRef.current?.zoomBy(1.2)}
						onZoomOut={() => canvasRef.current?.zoomBy(1 / 1.2)}
						onReset={() => canvasRef.current?.resetZoom()}
						onFit={() => canvasRef.current?.fitTo(frames)}
					/>
				</div>

				<Inspector
					frames={frames}
					files={files}
					selection={selection}
					tab={tab}
					onTabChange={setTab}
					onSelect={selectFromList}
					onChange={patchFrame}
					onEndStep={endStep}
					onAlign={alignSelection}
					onDistribute={distributeSelection}
					onDuplicate={duplicateSelection}
					onDelete={deleteSelection}
				/>
			</div>
		</div>
	);
}

const floatingBar =
	"absolute flex items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]";

function Toolbar({
	tool,
	onToolChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
}: {
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
}) {
	const tools = [
		{ id: "move" as const, label: "Move", shortcut: "V", icon: MousePointer2 },
		{ id: "hand" as const, label: "Hand", shortcut: "H", icon: Hand },
	];
	const history = [
		{ label: "Undo", shortcut: "⌘Z", icon: Undo2, enabled: canUndo, onClick: onUndo },
		{ label: "Redo", shortcut: "⇧⌘Z", icon: Redo2, enabled: canRedo, onClick: onRedo },
	];
	return (
		<div className={cn(floatingBar, "bottom-4 left-1/2 -translate-x-1/2")}>
			{tools.map((t) => (
				<Tooltip key={t.id}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t.label}
							aria-pressed={tool === t.id}
							onClick={() => onToolChange(t.id)}
							className={cn(tool === t.id && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
						>
							<t.icon />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{t.label} <Kbd>{t.shortcut}</Kbd>
					</TooltipContent>
				</Tooltip>
			))}
			<Separator orientation="vertical" className="mx-0.5 h-5!" />
			{history.map((h) => (
				<Tooltip key={h.label}>
					<TooltipTrigger asChild>
						{/* aria-disabled keeps the tooltip reachable when there is nothing to undo */}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={h.label}
							aria-disabled={!h.enabled}
							onClick={() => h.enabled && h.onClick()}
							className={cn("text-muted-foreground", !h.enabled && "opacity-40 hover:bg-transparent")}
						>
							<h.icon />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{h.label} <Kbd>{h.shortcut}</Kbd>
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}

function ZoomControls({
	zoom,
	onZoomIn,
	onZoomOut,
	onReset,
	onFit,
}: {
	zoom: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
	onFit: () => void;
}) {
	return (
		<div className={cn(floatingBar, "right-4 bottom-4")}>
			<Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={onZoomOut}>
				<Minus />
			</Button>
			<Button variant="ghost" size="sm" className="w-14 px-0 tabular-nums" onClick={onReset} aria-label="Reset zoom to 100%">
				{Math.round(zoom * 100)}%
			</Button>
			<Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={onZoomIn}>
				<Plus />
			</Button>
			<Separator orientation="vertical" className="mx-0.5 h-5!" />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label="Zoom to fit" onClick={onFit}>
						<Maximize />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					Zoom to fit <Kbd>⇧1</Kbd>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
