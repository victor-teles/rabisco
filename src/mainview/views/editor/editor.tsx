import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronLeft,
	Hand,
	Maximize,
	MessageCircle,
	Minus,
	MousePointer2,
	Play,
	Plus,
	Redo2,
	Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsButton } from "@/components/app/settings-button";
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
import { useComments } from "@/hooks/use-comments";
import { useComponents } from "@/hooks/use-components";
import { useGeneration } from "@/hooks/use-generation";
import { useInterview } from "@/hooks/use-interview";
import { useProviders } from "@/hooks/use-providers";
import { useProject } from "@/hooks/use-project";
import { useStructure } from "@/hooks/use-structure";
import type { Theme } from "@/hooks/use-theme";
import { useVariations } from "@/hooks/use-variations";
import { align, boundsOf, distribute, type Alignment, type Axis } from "@/lib/align";
import { applyFileChanges } from "@/lib/history";
import { selectedFrames, toggleInSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { focusOf } from "../../../shared/ai/focus";
import { LINK_ATTRIBUTE } from "../../../shared/prototype/links";
import { findElement, parseJsx } from "../../../shared/jsx";
import { FRAME_GAP, FRAME_SIZE, uniqueScreenPath } from "../../../shared/project";
import type { CanvasComment, ChatMessage, ContextFileName, Device, Frame, ProjectFiles } from "../../../shared/types";
import { baseOf, pickVariation, selectionAfterPick, variationGroups } from "../../../shared/variations";
import { Canvas, type CanvasHandle, type ElementRef, type FrameMove, type Tool, type Viewport } from "./canvas";
import { ChatPanel } from "./chat-panel";
import { CommentsLayer } from "./comments-layer";
import { CodePanel } from "./code-panel";
import { CompareView } from "./compare-view";
import { ComponentsPanel } from "./components-panel";
import { ContextPanel } from "./context-panel";
import { Inspector, type FramePatch, type InspectorTab } from "./inspector";
import { LinkControl } from "./link-control";
import { NodeProps } from "./node-props";
import { ExportMenu, type ExportContext } from "./export/export-menu";
import { ShareButton } from "./export/share-button";
import { PlayView } from "./play-view";
import { ALIGN_SHORTCUTS, COMPONENTS_VIEW_CODE, DISTRIBUTE_SHORTCUTS, isPlay, isTyping, PLAY_KEYS } from "./shortcuts";

type EditorProps = {
	projectPath: string;
	initialPrompt?: string;
	initialFiles?: File[];
	initialVariations?: number;
	theme: Theme;
	onToggleTheme: () => void;
	onBack: () => void;
};

const NO_FRAMES: Frame[] = [];

const NO_FILES: ProjectFiles = {};

const NO_SELECTION: string[] = [];

const NO_MESSAGES: ChatMessage[] = [];

/** Arrow-key nudges closer together than this are one undo step */
const NUDGE_BURST_MS = 800;

const withMoves = (frames: Frame[], moves: FrameMove[]) => {
	const byFile = new Map(moves.map((move) => [move.file, move]));

	return frames.map((frame) => {
		const move = byFile.get(frame.file);

		return move && (move.x !== frame.x || move.y !== frame.y) ? { ...frame, x: move.x, y: move.y } : frame;
	});
};

export function EditorView({
	projectPath,
	initialPrompt,
	initialFiles,
	initialVariations,
	theme,
	onToggleTheme,
	onBack,
}: EditorProps) {
	const {
		project,
		error,
		stateRef,
		canUndo,
		canRedo,
		change,
		endStep,
		undo,
		redo,
		setSelection,
		setMeta,
		addMessages,
		flushCanvas,
		reloadFromDisk,
	} = useProject(projectPath);

	const [tool, setTool] = useState<Tool>("move");
	const [tab, setTab] = useState<InspectorTab>("design");
	const [contextFile, setContextFile] = useState<ContextFileName>("PRODUCT.md");
	const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 80, zoom: 0.6 });
	/** By its base path */
	const [compareBase, setCompareBase] = useState<string | null>(null);
	const [playStart, setPlayStart] = useState<string | null>(null);
	const [variations, setVariations] = useVariations();
	const canvasRef = useRef<CanvasHandle>(null);
	const startedInitialPrompt = useRef(false);
	const fittedOnLoad = useRef(false);
	const nudge = useRef({ key: "", at: 0 });

	const frames = project?.canvas.frames ?? NO_FRAMES;
	const files = project?.files ?? NO_FILES;
	const selection = project?.canvas.selection ?? NO_SELECTION;
	const device = project?.canvas.device ?? "mobile";
	const messages = project?.messages ?? NO_MESSAGES;
	const selected = useMemo(() => selectedFrames(frames, selection), [frames, selection]);

	useEffect(() => {
		if (!project || fittedOnLoad.current) return;
		fittedOnLoad.current = true;
		const initial = selected.length ? selected : project.canvas.frames;

		if (initial.length) requestAnimationFrame(() => canvasRef.current?.fitTo(initial));
	}, [project, selected]);

	const onPlaced = useCallback((placed: Frame[]) => requestAnimationFrame(() => canvasRef.current?.fitTo(placed)), []);

	const { generation, drafts, failure, dismissFailure, send, vary, mix, writeContext, stop, retry } = useGeneration({
		projectPath,
		stateRef,
		change,
		addMessages,
		files,
		frames,
		device,
		onPlaced,
	});

	const openContext = useCallback((file: ContextFileName) => {
		setContextFile(file);
		setTab("context");
	}, []);

	const openProduct = useCallback(() => openContext("PRODUCT.md"), [openContext]);

	const {
		interview,
		start: startInterview,
		answer,
		skip,
		cancel: cancelInterview,
	} = useInterview({
		projectName: project?.canvas.name ?? "",
		addMessages,
		change,
		writeContext,
		onWritten: openProduct,
	});

	const writeDesign = useCallback(async () => {
		const prompt =
			"Write DESIGN.md from the existing screens and components: the tokens they use (colors, radius, fonts), typography, layout and spacing, and the component rules they follow.";

		if (await writeContext("DESIGN.md", prompt, "Write DESIGN.md from my screens")) openContext("DESIGN.md");
	}, [writeContext, openContext]);

	const busy = generation !== null || interview !== null;

	const {
		components,
		suggestions,
		unseenSuggestions,
		dismissSuggestion,
		makeComponent,
		drop: dropComponent,
		selectedComponent,
	} = useComponents({ projectPath, files, selection, stateRef, change, undo, busy, open: tab === "components" });

	const selectComponent = useCallback((path: string | null) => setSelection(path ? [path] : []), [setSelection]);

	const exportContext: ExportContext = {
		projectPath,
		projectName: project?.canvas.name ?? "Untitled design",
		frames,
		files,
		selected,
		selectedComponent: selectedComponent?.path ?? null,
		flushCanvas,
		reloadFromDisk,
	};

	const codeFile = selection.length === 1 ? selection[0]! : null;
	const showCode = useCallback(() => setTab("code"), []);
	const structure = useStructure({ files, file: codeFile, stateRef, change, onShowCode: showCode, busy });
	const { select: selectNode, setChildren: setNodeChildren } = structure;
	const focus = useMemo(() => focusOf(files, structure.node), [files, structure.node]);

	/** Answers the PRODUCT.md interview, else changes the selected element, edits the selected screens, or creates new ones */
	const sendPrompt = useCallback(
		(prompt: string, attachments: File[] = []) => {
			if (interview) answer(prompt);
			else send(prompt, { targets: selection, files: attachments, variations, focus: structure.node });
		},
		[interview, answer, send, selection, variations, structure.node],
	);

	const selectElement = useCallback(
		(file: string, element: ElementRef | null) => {
			const current = stateRef.current?.canvas.selection;

			if (!current || current.length !== 1 || current[0] !== file) setSelection([file]);
			selectNode(element);

			// Element props and styles live in the Design tab; the Code tab follows the selection in its outline
			if (element) setTab((tab) => (tab === "context" || tab === "components" ? "design" : tab));
		},
		[stateRef, setSelection, selectNode],
	);

	const editElementText = useCallback(
		(element: ElementRef, text: string) => setNodeChildren(element, text),
		[setNodeChildren],
	);

	const editTextElsewhere = useCallback(() => setTab("design"), []);

	/** Fragments have no props of their own */
	const parentElement = (element: ElementRef): ElementRef | null => {
		const source = files[element.file];
		let parent = source === undefined ? null : (findElement(parseJsx(source), element.start)?.parent ?? null);

		while (parent && parent.name === null) parent = parent.parent;

		return parent ? { file: element.file, start: parent.start } : null;
	};

	const showScreens = useCallback(
		(targets: string[]) => {
			setSelection(targets);
			const shown = selectedFrames(frames, targets);

			if (shown.length) canvasRef.current?.fitTo(shown);
		},
		[frames, setSelection],
	);

	const comments = useComments({ comments: project?.canvas.comments, frames, change, endStep });

	/** Changes the element under the pin, else its screen; a canvas pin creates new screens */
	const askAboutComment = useCallback(
		async (comment: CanvasComment) => {
			if (!comment.file) return send(comment.text, { variations });
			const element = (await canvasRef.current?.elementAt(comment.file, comment)) ?? null;
			send(comment.text, { targets: [comment.file], focus: element });
		},
		[send, variations],
	);

	const groups = useMemo(() => variationGroups(Object.keys(files)), [files]);
	const compareGroup = compareBase ? (groups.find((group) => group.base === compareBase) ?? null) : null;
	useEffect(() => {
		if (compareBase && !compareGroup) setCompareBase(null);
	}, [compareBase, compareGroup]);

	/** Swaps the variation into the screen's own file (decision 0004) as one undo step */
	const pick = useCallback(
		(file: string) => {
			if (generation) {
				toast("Wait for the generation to finish");

				return;
			}

			const current = stateRef.current;

			if (!current) return;
			change(
				(snapshot) => {
					const files = applyFileChanges(snapshot.files, pickVariation(snapshot.files, file));
					const base = baseOf(file);
					const hasBaseFrame = snapshot.frames.some((frame) => frame.file === base);

					const frames = hasBaseFrame
						? snapshot.frames
						: snapshot.frames.map((frame) => (frame.file === file ? { ...frame, file: base } : frame));

					return { ...snapshot, files, frames: frames.filter((frame) => frame.file in files) };
				},
				{ select: selectionAfterPick(current.canvas.selection, file) },
			);
		},
		[generation, stateRef, change],
	);

	const editContext = useCallback(
		(file: ContextFileName, text: string, step: string) =>
			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: text } }), { coalesce: step }),
		[change],
	);

	const replaceContext = useCallback(
		(replacements: Partial<Record<ContextFileName, string>>) =>
			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, ...replacements } })),
		[change],
	);

	// Older replies and interview questions have no `context`
	const lastUsed = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--)
			if (messages[i]!.role === "assistant" && messages[i]!.context) return messages[i]!.context!;

		return null;
	}, [messages]);

	// The model comes from the providers, so wait for them before sending the first prompt
	const { loading: providersLoading } = useProviders();
	useEffect(() => {
		if (!project || !initialPrompt || providersLoading || startedInitialPrompt.current) return;
		startedInitialPrompt.current = true;
		send(initialPrompt, { files: initialFiles, variations: initialVariations });
	}, [project, initialPrompt, initialFiles, initialVariations, providersLoading, send]);

	const draftCount = drafts?.frames.length ?? 0;
	useEffect(() => {
		if (draftCount === 1 && drafts) canvasRef.current?.fitTo([...frames, ...drafts.frames]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftCount]);

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
			change((snapshot) => ({ ...snapshot, frames: withMoves(snapshot.frames, moves) }), {
				coalesce: `drag:${dragId}`,
			}),
		[change],
	);

	const alignSelection = useCallback(
		(alignment: Alignment) =>
			change((snapshot) => {
				const targets = selectedFrames(snapshot.frames, selection);

				return targets.length < 2
					? snapshot
					: { ...snapshot, frames: withMoves(snapshot.frames, align(targets, alignment)) };
			}),
		[change, selection],
	);

	const distributeSelection = useCallback(
		(axis: Axis) =>
			change((snapshot) => {
				const targets = selectedFrames(snapshot.frames, selection);

				return targets.length < 3
					? snapshot
					: { ...snapshot, frames: withMoves(snapshot.frames, distribute(targets, axis)) };
			}),
		[change, selection],
	);

	/** Undo brings the files back. A selected component file is never deleted this way. */
	const deleteSelection = useCallback(() => {
		const doomed = new Set(selectedFrames(frames, selection).map((frame) => frame.file));

		if (!doomed.size) return;
		change(
			(snapshot) => ({
				frames: snapshot.frames.filter((frame) => !doomed.has(frame.file)),
				files: Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => !doomed.has(path))),
			}),
			{ select: [] },
		);
	}, [change, frames, selection]);

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

	// Reads the latest render through a ref so the handler is registered once
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || isTyping(event.target) || !project) return;

		// Text being edited in a frame owns the keys; Escape still cancels it if focus stayed here
		if (canvasRef.current?.isEditingText()) {
			if (event.key === "Escape") canvasRef.current.endTextEdit(false);

			return;
		}

		const element =
			structure.node && selection.length === 1 && structure.node.file === selection[0] ? structure.node : null;

		const mod = event.metaKey || (event.ctrlKey && !event.altKey);
		const code = event.code;

		if (playStart) return;

		if (isPlay(event)) {
			event.preventDefault();
			startPlay();

			return;
		}

		// Only undo/redo stay global in compare mode
		if (compareBase && !(mod && (code === "KeyZ" || code === "KeyY"))) return;

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

			if (code === COMPONENTS_VIEW_CODE) {
				event.preventDefault();
				setTab((current) => (current === "components" ? "design" : "components"));
			} else if (item) {
				event.preventDefault();
				alignSelection(item.alignment);
			}
		} else if (event.metaKey || event.ctrlKey) {
			return;
		} else if (event.shiftKey && code === "KeyD") {
			setTab((current) => (current === "code" ? "design" : "code"));
		} else if (event.shiftKey && code === "KeyC") {
			setTab((current) => (current === "context" ? "design" : "context"));
		} else if (event.shiftKey && code === "KeyV") {
			const group = selected.length === 1 ? groups.find((g) => g.base === baseOf(selected[0]!.file)) : undefined;

			if (group) setCompareBase(group.base);
			else if (selected.length === 1)
				toast("This screen has no variations yet", { description: "Use Vary this in the inspector." });
		} else if (event.shiftKey && code === "Digit1") {
			canvasRef.current?.fitTo(frames);
		} else if (event.shiftKey && code === "Digit2") {
			if (selected.length) canvasRef.current?.fitTo(selected);
		} else if (event.key === "v") setTool("move");
		else if (event.key === "h") setTool("hand");
		else if (event.key === "c") setTool("comment");
		else if (event.key === "Escape") {
			// Figma: Escape walks up to the parent, then out to the screen, then clears
			if (tool === "comment") setTool("move");
			else if (element) structure.select(parentElement(element));
			else setSelection([]);
		} else if (event.key === "Enter" && element) {
			event.preventDefault();
			canvasRef.current?.editText(element);
		} else if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();

			if (element) structure.removeNode();
			else deleteSelection();
		} else if (event.key.startsWith("Arrow") && selected.length) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
			const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
			nudgeSelection(dx, dy);
		}
	};

	function startPlay() {
		const start = selected.find((frame) => frame.file.startsWith("screens/"))?.file ?? frames[0]?.file;

		if (start) setPlayStart(start);
		else toast("Add a screen to play the prototype");
	}

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
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Play prototype"
								onClick={startPlay}
								disabled={frames.length === 0}
							>
								<Play />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Play prototype <Kbd>{PLAY_KEYS}</Kbd>
						</TooltipContent>
					</Tooltip>
					<SettingsButton />
					<ThemeToggle theme={theme} onToggle={onToggleTheme} />
					<ShareButton {...exportContext} />
					<ExportMenu {...exportContext} />
				</NoDrag>
			</TitleBar>

			<div className="flex min-h-0 flex-1">
				<ChatPanel
					messages={messages}
					generation={generation}
					failure={failure}
					device={device}
					onDeviceChange={(next: Device) => setMeta({ device: next })}
					onSend={sendPrompt}
					onStop={stop}
					onRetry={retry}
					onDismissFailure={dismissFailure}
					selectedScreenName={
						interview ? undefined : selected.length === 1 ? selected[0]!.name : selectedComponent?.name
					}
					editingCount={interview ? 0 : selection.length}
					focusLabel={interview ? undefined : focus?.label}
					onClearFocus={() => structure.select(null)}
					variations={variations}
					onVariationsChange={setVariations}
					onOpenContext={openContext}
					interview={interview}
					onStartInterview={startInterview}
					onSkipQuestion={skip}
					onCancelInterview={cancelInterview}
				/>

				<div className="relative min-w-0 flex-1">
					<Canvas
						frames={frames}
						files={files}
						drafts={drafts}
						selection={selection}
						onSelectionChange={setSelection}
						onMoveFrames={moveFrames}
						onMoveEnd={endStep}
						tool={tool}
						viewport={viewport}
						onViewportChange={setViewport}
						handleRef={canvasRef}
						onCompare={setCompareBase}
						onPick={pick}
						onDropItem={dropComponent}
						element={structure.node}
						onSelectElement={selectElement}
						onEditText={editElementText}
						onEditTextElsewhere={editTextElsewhere}
						onPlaceComment={comments.startDraft}
						overlay={
							<CommentsLayer
								controller={comments}
								frames={frames}
								zoom={viewport.zoom}
								onAskAI={(comment) => void askAboutComment(comment)}
							/>
						}
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

					<Toolbar tool={tool} onToolChange={setTool} canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
					<ZoomControls
						zoom={viewport.zoom}
						onZoomIn={() => canvasRef.current?.zoomBy(1.2)}
						onZoomOut={() => canvasRef.current?.zoomBy(1 / 1.2)}
						onReset={() => canvasRef.current?.resetZoom()}
						onFit={() => canvasRef.current?.fitTo(frames)}
					/>
					{playStart ? (
						<PlayView start={playStart} frames={frames} files={files} onClose={() => setPlayStart(null)} />
					) : null}
					{compareGroup ? (
						<CompareView
							group={compareGroup}
							frames={frames}
							files={files}
							onPick={pick}
							onClose={() => setCompareBase(null)}
						/>
					) : null}
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
					busy={generation !== null || interview !== null}
					onPick={pick}
					onCompare={setCompareBase}
					onVary={vary}
					onMix={mix}
					componentsBadge={unseenSuggestions}
					codePanel={
						<CodePanel
							path={codeFile}
							source={codeFile ? files[codeFile] : undefined}
							emptyMessage={
								selection.length
									? "Select a single screen or component to see its code."
									: "Select a screen to see its code."
							}
							structure={structure}
							onEndStep={endStep}
							onUndo={undo}
							onRedo={redo}
							onShowProps={() => setTab("design")}
						/>
					}
					propsPanel={
						<>
							<NodeProps
								files={files}
								file={codeFile}
								structure={structure}
								onEndStep={endStep}
								onOpenComponent={selectComponent}
							/>
							<LinkControl
								files={files}
								frames={frames}
								element={structure.node}
								disabled={structure.busy}
								onChange={(element, to) => structure.setProp(element, LINK_ATTRIBUTE, to)}
							/>
						</>
					}
					componentsPanel={
						<ComponentsPanel
							files={files}
							frames={frames}
							components={components}
							selectedComponent={selectedComponent?.path ?? null}
							suggestions={suggestions}
							busy={busy}
							onSelectComponent={selectComponent}
							onShowScreens={showScreens}
							onMakeComponent={makeComponent}
							onDismissSuggestion={dismissSuggestion}
						/>
					}
					contextPanel={
						<ContextPanel
							files={files}
							file={contextFile}
							onFileChange={setContextFile}
							onEdit={editContext}
							onReplace={replaceContext}
							onEndStep={endStep}
							onUndo={undo}
							onRedo={redo}
							lastUsed={lastUsed}
							hasScreens={frames.length > 0}
							busy={generation !== null || interview !== null}
							onWriteDesign={() => void writeDesign()}
							onInterview={startInterview}
						/>
					}
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
		{ id: "comment" as const, label: "Comment", shortcut: "C", icon: MessageCircle },
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
							className={cn(
								tool === t.id && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
							)}
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
			<Button
				variant="ghost"
				size="sm"
				className="w-14 px-0 tabular-nums"
				onClick={onReset}
				aria-label="Reset zoom to 100%"
			>
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
