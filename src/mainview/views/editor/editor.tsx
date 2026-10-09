import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { FpsMeter } from "@/components/app/fps-meter";
import { ScreenTheme } from "@/components/app/screen-preview";
import { SettingsButton } from "@/components/app/settings-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NoDrag, TitleBar } from "@/components/app/title-bar";
import { Button } from "@/components/ui/button";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
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
import { openSettings, useProviders } from "@/hooks/use-providers";
import { useProject } from "@/hooks/use-project";
import { useShowFps } from "@/hooks/use-show-fps";
import { useStructure } from "@/hooks/use-structure";
import type { Theme } from "@/hooks/use-theme";
import { useVariations } from "@/hooks/use-variations";
import { type Action, actionById, actionForKey } from "@/lib/actions";
import { type ChatCommand, isBuiltin } from "@/lib/chat-commands";
import { commentsPrompt, openOnScreen, type ChatComment } from "@/lib/comment-threads";
import { useAutoResolve } from "@/hooks/use-auto-resolve";
import { setResolved } from "../../../shared/comments";
import { useChatCommands } from "@/hooks/use-chat-commands";
import { isDevelopment } from "@/lib/dev";
import { align, boundsOf, distribute, type Alignment, type Axis, type Rect } from "@/lib/align";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import { sourceVersion } from "@/lib/render/protocol";
import { themeCss } from "@/lib/render/styles";
import { reorderFrames } from "@/lib/screen-list";
import { contextSelection, sameSelection, selectedFrames, toggleInSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { useZoomPercent, viewportStore, type ViewportStore } from "@/lib/viewport";
import { focusOf } from "../../../shared/ai/focus";
import {
	designSourceOf,
	tokenBlock,
	tokenChanges,
	themeUpdateOf,
	type AppliedTheme,
	type ThemeUpdate,
	type TokenChange,
} from "../../../shared/context/theme";
import { applyTokenEdit, seedDesignTokens, type TokenEdit } from "../../../shared/context/token-edit";
import { designTokensOf } from "../../../shared/context/tokens";
import { LINK_ATTRIBUTE } from "../../../shared/prototype/links";
import { findElement, parseJsx } from "../../../shared/jsx";
import { FRAME_GAP, FRAME_SIZE, uniqueScreenPath } from "../../../shared/project";
import type { ChatMessage, ContextFileName, Device, Frame, ProjectFiles } from "../../../shared/types";
import { baseOf, pickVariation, selectionAfterPick, variationGroups } from "../../../shared/variations";
import { Canvas, withMoves, type CanvasHandle, type ElementRef, type FrameMove, type Tool } from "./canvas";
import { ChatPanel, type ComposerInsert, type HeldPrompt } from "./chat-panel";
import { CommentsLayer } from "./comments-layer";
import { CommentsList } from "./comments-list";
import { CodePanel } from "./code-panel";
import { CommandPalette } from "./command-palette";
import { CompareView } from "./compare-view";
import { ComponentsPanel } from "./components-panel";
import { ContextPanel } from "./context-panel";
import { Inspector, type FramePatch, type InspectorTab } from "./inspector";
import { LinkControl } from "./link-control";
import { NodeProps } from "./node-props";
import { ElementBreadcrumb } from "./element-breadcrumb";
import { LayersPanel } from "./layers-panel";
import { ExportMenu, type ExportContext } from "./export/export-menu";
import { DebugMenuItems } from "./screen-menu";
import { ActionMenuItems, type MenuEntry, SEPARATOR } from "./action-menu";
import { ELEMENT_MENU, elementActions } from "./element-actions";
import { copyCode } from "./export/code-export";
import { copyImage, exportFlowPdf, exportImages } from "./export/image-export";
import { ShareButton } from "./export/share-button";
import { PlayView } from "./play-view";
import { screenActions, type ScreenActionsContext } from "./screen-actions";
import { ShortcutSheet } from "./shortcut-sheet";
import { CustomSizeDialog } from "./custom-size-dialog";
import { NEW_SCREEN_SUBMENU, NewScreenMenu } from "./new-screen-menu";
import { ThemePrompt, type ThemeBarState } from "./theme-prompt";
import { ScreensPanel } from "./screens-panel";
import { ChatSessions } from "./chat-sessions";
import { SidePanel, useSidePanel } from "./side-panel";
import {
	ALIGN_SHORTCUTS,
	COMPONENTS_VIEW_CODE,
	DISTRIBUTE_SHORTCUTS,
	focusOwnsKey,
	NEW_CHAT_CODE,
	PLAY_KEYS,
	SCREENS_VIEW_CODE,
	SIDE_PANEL_CODE,
} from "./shortcuts";

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

const NO_ELEMENTS: ElementRef[] = [];

const NO_MESSAGES: ChatMessage[] = [];

const NO_TOKENS: AppliedTheme = { light: {}, dark: {} };

/** How long "Theme updated" stays over the canvas */
const THEME_APPLIED_MS = 10_000;

/** "Not now" holds until DESIGN.md changes again */
const updateKey = (update: ThemeUpdate) =>
	update.kind === "read" ? `read:${update.source}` : `tokens:${tokenBlock(update.tokens)}`;

const withSource = (theme: AppliedTheme, source: string | undefined): AppliedTheme =>
	source ? { light: theme.light, dark: theme.dark, source } : { light: theme.light, dark: theme.dark };

/** Arrow-key nudges closer together than this are one undo step */
const NUDGE_BURST_MS = 800;

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
		newChat,
		openChat,
		deleteChat,
		flushCanvas,
		reloadFromDisk,
	} = useProject(projectPath);

	const [tool, setTool] = useState<Tool>("move");
	const showFps = useShowFps();
	const [tab, setTab] = useState<InspectorTab>("design");
	const sidePanel = useSidePanel();
	const [contextFile, setContextFile] = useState<ContextFileName>("PRODUCT.md");
	const [viewport] = useState(() => viewportStore({ x: 80, y: 80, zoom: 0.6 }));
	/** By its base path */
	const [compareBase, setCompareBase] = useState<string | null>(null);
	const [playStart, setPlayStart] = useState<string | null>(null);
	/** The screen whose name field in the inspector takes focus */
	const [renaming, setRenaming] = useState<string | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
	const commands = useChatCommands(projectPath);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [commentsListOpen, setCommentsListOpen] = useState(false);
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
	/** Screens render with this until the user applies DESIGN.md's theme (decision 0009) */
	const appliedTokens = project?.canvas.theme ?? NO_TOKENS;
	const design = files["DESIGN.md"];
	const loaded = project !== null;

	const themeUpdate = useMemo(
		() => (loaded ? themeUpdateOf(appliedTokens, design) : null),
		[loaded, appliedTokens, design],
	);

	const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
	/** Themes read with AI, by DESIGN.md source, so going back to a version doesn't read it again */
	const readThemes = useRef(new Map<string, AppliedTheme>());

	const [appliedRead, setAppliedRead] = useState<{
		theme: AppliedTheme;
		previous: AppliedTheme;
		changes: TokenChange[];
		/** The history entry it made, so Undo can be a real undo */
		step: Snapshot | undefined;
	} | null>(null);

	// Before the first paint, so the frames mount for the fitted view only
	useLayoutEffect(() => {
		if (!project || fittedOnLoad.current) return;
		fittedOnLoad.current = true;
		const initial = selected.length ? selected : project.canvas.frames;

		if (initial.length) canvasRef.current?.fitTo(initial);
	}, [project, selected]);

	const onPlaced = useCallback((placed: Frame[]) => requestAnimationFrame(() => canvasRef.current?.fitTo(placed)), []);

	/** Toasted so pins that go away are explained; Reopen is its own undo step, apart from the design change */
	const onResolved = useCallback(
		(ids: string[]) =>
			toast(ids.length === 1 ? "Resolved the comment" : `Resolved ${ids.length} comments`, {
				action: {
					label: "Reopen",
					onClick: () =>
						change((snapshot) => ({ ...snapshot, comments: setResolved(snapshot.comments ?? [], ids, false) })),
				},
			}),
		[change],
	);

	const {
		generation,
		drafts,
		failure,
		dismissFailure,
		send,
		vary,
		fix,
		mix,
		writeContext,
		readTheme,
		stop,
		retry,
		regenerate,
		lastRun,
		undoRun,
	} = useGeneration({
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
	});

	const generating = generation !== null;
	const latestStep = project?.history.present;

	/** Offered on a run's summary while its result is still the latest undo step */
	const undoableRun = useMemo(
		() => (lastRun && !generating && latestStep === lastRun.step ? { id: lastRun.messageId, run: undoRun } : null),
		[lastRun, generating, latestStep, undoRun],
	);

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

	/** Shown where an AI action is off, so it is never ignored silently */
	const busyReason = generation
		? "Wait for the current generation to finish."
		: interview
			? "Finish or cancel the PRODUCT.md interview first."
			: undefined;

	const {
		components,
		suggestions,
		unseenSuggestions,
		dismissSuggestion,
		makeComponent,
		drop: dropComponent,
		selectedComponent,
	} = useComponents({
		projectPath,
		files,
		selection,
		stateRef,
		change,
		undo,
		busy,
		open: tab === "components",
		// The drop already selects the screen; the Components tab stays open for the next one
		onInserted: (element) => selectNode(element),
	});

	const selectComponent = useCallback((path: string | null) => setSelection(path ? [path] : []), [setSelection]);

	const projectName = project?.canvas.name ?? "Untitled design";
	const selectedComponentPath = selectedComponent?.path ?? null;

	const exportContext: ExportContext = useMemo(
		() => ({
			projectPath,
			projectName,
			frames,
			files,
			theme: appliedTokens,
			selected,
			selectedComponent: selectedComponentPath,
			flushCanvas,
			reloadFromDisk,
			hasUndoHistory: canUndo,
		}),
		[
			projectPath,
			projectName,
			frames,
			files,
			appliedTokens,
			selected,
			selectedComponentPath,
			flushCanvas,
			reloadFromDisk,
			canUndo,
		],
	);

	const codeFile = selection.length === 1 ? selection[0]! : null;
	const showCode = useCallback(() => setTab("code"), []);
	const liveStructure = useStructure({ files, file: codeFile, stateRef, change, onShowCode: showCode, busy });
	const { node, select: selectNode, naming, setNaming, makeComponent: makeNodeComponent } = liveStructure;
	const { nodes, toggle: toggleNode } = liveStructure;
	const { removeNode, editCode, setProp, setChildren, editClasses } = liveStructure;
	const { startNaming, duplicateNode, wrapNode } = liveStructure;
	const { wrapInStackNode, unwrapNode, moveNodeAmongSiblings, moveNodeTo, pasteIntoNode } = liveStructure;
	const { moveNodeEntry } = liveStructure;
	const structureBusy = liveStructure.busy;

	// A new object every render otherwise, which would re-render the memoized panels
	const structure = useMemo(
		() => ({
			node,
			nodes,
			select: selectNode,
			toggle: toggleNode,
			busy: structureBusy,
			naming,
			setNaming,
			startNaming,
			makeComponent: makeNodeComponent,
			removeNode,
			duplicateNode,
			wrapNode,
			wrapInStackNode,
			unwrapNode,
			moveNodeAmongSiblings,
			moveNodeTo,
			moveNodeEntry,
			pasteIntoNode,
			editCode,
			setProp,
			setChildren,
			editClasses,
		}),
		[
			node,
			nodes,
			selectNode,
			toggleNode,
			structureBusy,
			naming,
			setNaming,
			startNaming,
			makeNodeComponent,
			removeNode,
			duplicateNode,
			wrapNode,
			wrapInStackNode,
			unwrapNode,
			moveNodeAmongSiblings,
			moveNodeTo,
			moveNodeEntry,
			pasteIntoNode,
			editCode,
			setProp,
			setChildren,
			editClasses,
		],
	);

	/** Bumped by Ask AI to put the caret in the chat */
	const [composeKey, setComposeKey] = useState(0);
	/** Bumped by Go to source to scroll the code to the element */
	const [sourceReveal, setSourceReveal] = useState(0);

	const focus = useMemo(() => focusOf(files, structure.node), [files, structure.node]);

	/** Comments put in the composer, by id, with the text that shows they are still in the prompt */
	const commentsInComposer = useRef(new Map<string, string>());
	const [autoResolve] = useAutoResolve();

	/** Answers the PRODUCT.md interview, else changes the selected element, edits the selected screens, or creates new ones */
	const sendPrompt = useCallback(
		(prompt: string, attachments: File[] = []) => {
			if (interview) {
				answer(prompt);

				return true;
			}

			const pending = commentsInComposer.current;
			const resolves = autoResolve ? [...pending].flatMap(([id, text]) => (prompt.includes(text) ? [id] : [])) : [];

			const sent = send(prompt, {
				targets: selection,
				files: attachments,
				variations,
				focus: structure.node,
				resolves,
			});

			if (sent) pending.clear();

			return sent;
		},
		[interview, answer, autoResolve, send, selection, variations, structure.node],
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

	const editElementText = useCallback((element: ElementRef, text: string) => setChildren(element, text), [setChildren]);

	const editTextElsewhere = useCallback(() => setTab("design"), []);

	/** The drop was placed in the source at `target.version`; a newer edit makes its offsets stale */
	const moveElementTo = useCallback(
		(element: ElementRef, target: { parent: number; index: number; version: string }) => {
			const source = stateRef.current?.files[element.file];

			if (source === undefined || sourceVersion(source) !== target.version) return;

			if (node?.file !== element.file || node.start !== element.start) return;
			moveNodeTo(target.parent, target.index);
		},
		[stateRef, node, moveNodeTo],
	);

	const moveEntryTo = useCallback(
		(element: ElementRef, move: { from: number; to: number; version: string }) => {
			const source = stateRef.current?.files[element.file];

			if (source === undefined || sourceVersion(source) !== move.version) return;

			if (node?.file !== element.file || node.start !== element.start) return;
			moveNodeEntry(move.from, move.to);
		},
		[stateRef, node, moveNodeEntry],
	);

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
	const revealRects = useCallback((rects: Rect[]) => canvasRef.current?.fitTo(rects), []);

	/** New text for the chat composer */
	const [chatInsert, setChatInsert] = useState<ComposerInsert | null>(null);

	/** Comments go to the composer, not straight to the model, so they can be read and added to first */
	const chatBlocked = interview ? "Finish or cancel the PRODUCT.md interview first." : undefined;

	/**
	 * One comment targets the element under its pin, several their screen with each pin's element named.
	 * Canvas comments target nothing, so they make new screens.
	 */
	const commentsToChat = useCallback(
		async (threads: ChatComment[]) => {
			if (chatBlocked) return void toast(chatBlocked);
			const file = threads[0]?.comment.file;
			const canvas = canvasRef.current;

			const elements =
				file && canvas ? await Promise.all(threads.map((thread) => canvas.elementAt(file, thread.comment))) : [];

			const source = stateRef.current?.files ?? {};

			const named = threads.map((thread, index) => {
				const label = focusOf(source, elements[index])?.label;

				return label ? { ...thread, element: label } : thread;
			});

			for (const { comment } of threads) commentsInComposer.current.set(comment.id, comment.text.trim());
			setSelection(file ? [file] : []);

			if (file) selectNode(threads.length === 1 ? (elements[0] ?? null) : null);
			const screen = file ? frames.find((frame) => frame.file === file)?.name : undefined;
			setChatInsert((last) => ({ key: (last?.key ?? 0) + 1, text: commentsPrompt(named, screen) }));
			setComposeKey((key) => key + 1);
		},
		[chatBlocked, stateRef, setSelection, selectNode, frames],
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

	/** One undo step */
	const applyDesignTokens = useCallback(
		() =>
			change((snapshot) => {
				const design = snapshot.files["DESIGN.md"];

				return { ...snapshot, theme: withSource(designTokensOf(design), designSourceOf(design)) };
			}),
		[change],
	);

	/** One undo step that writes DESIGN.md and applies it, so no "Apply to screens" prompt follows */
	const editDesignToken = useCallback(
		(edit: TokenEdit) =>
			change((snapshot) => {
				const design = applyTokenEdit(seedDesignTokens(snapshot.files["DESIGN.md"] ?? "", snapshot.theme), edit);

				return {
					...snapshot,
					files: { ...snapshot.files, "DESIGN.md": design },
					theme: withSource(designTokensOf(design), designSourceOf(design)),
				};
			}),
		[change],
	);

	/** One undo step; the bar then shows what changed */
	const applyReadTheme = useCallback(
		(theme: AppliedTheme) => {
			const previous = stateRef.current?.canvas.theme ?? NO_TOKENS;
			change((snapshot) => ({ ...snapshot, theme }));
			const step = stateRef.current?.history.present;
			setAppliedRead({ theme, previous, changes: tokenChanges(previous, theme), step });
		},
		[stateRef, change],
	);

	const updateTheme = useCallback(async () => {
		if (themeUpdate?.kind !== "read") return;
		const cached = readThemes.current.get(themeUpdate.source);

		if (cached) return applyReadTheme(cached);
		const result = await readTheme();

		if (result.ok) {
			const source = result.theme.source ?? themeUpdate.source;
			const theme = withSource(result.theme, source);
			readThemes.current.set(source, theme);
			applyReadTheme(theme);
		} else if (result.reason === "no-model") openSettings();
		else if (result.reason === "busy") toast("Wait for the current generation to finish");
		else if (result.reason === "failed") {
			toast.error("Couldn’t read the theme from DESIGN.md", {
				description: [result.error.message, result.error.fix].filter(Boolean).join(" "),
			});
		}
	}, [themeUpdate, readTheme, applyReadTheme]);

	const undoReadTheme = useCallback(() => {
		const current = stateRef.current;

		if (!appliedRead || !current) return;

		if (current.history.present === appliedRead.step) undo();
		else change((snapshot) => ({ ...snapshot, theme: appliedRead.previous }));

		if (appliedRead.theme.source) setDismissedUpdate(`read:${appliedRead.theme.source}`);
		setAppliedRead(null);
	}, [appliedRead, stateRef, undo, change]);

	useEffect(() => {
		if (!appliedRead) return;
		const timer = setTimeout(() => setAppliedRead(null), THEME_APPLIED_MS);

		return () => clearTimeout(timer);
	}, [appliedRead]);

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

	// The model comes from the providers, so wait for them before sending the first prompt.
	// Without one, the prompt waits in the composer and goes out once a model is set up.
	const { loading: providersLoading, model } = useProviders();

	const themeBar: ThemeBarState | null =
		generation?.task === "theme"
			? { kind: "reading" }
			: appliedRead && !themeUpdate && project?.canvas.theme === appliedRead.theme
				? { kind: "applied", changes: appliedRead.changes }
				: themeUpdate && dismissedUpdate !== updateKey(themeUpdate)
					? themeUpdate.kind === "tokens"
						? { kind: "tokens", count: themeUpdate.count }
						: { kind: "read", hasModel: Boolean(model), busyReason }
					: null;

	const [heldPrompt, setHeldPrompt] = useState<HeldPrompt | null>(null);
	useEffect(() => {
		if (!project || !initialPrompt || providersLoading || startedInitialPrompt.current) return;
		startedInitialPrompt.current = true;

		if (model) send(initialPrompt, { files: initialFiles, variations: initialVariations });
		else {
			setHeldPrompt({ prompt: initialPrompt, files: initialFiles });
			openSettings();
		}
	}, [project, initialPrompt, initialFiles, initialVariations, providersLoading, model, send]);

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

	const renameScreen = useCallback((file: string, name: string) => patchFrame(file, { name }), [patchFrame]);

	const reorderScreens = useCallback(
		(moving: string[], before: string | null) =>
			change((snapshot) => {
				const reordered = reorderFrames(snapshot.frames, moving, before);

				return reordered === snapshot.frames ? snapshot : { ...snapshot, frames: reordered };
			}),
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
		const step = stateRef.current?.history.present;

		toast(doomed.size === 1 ? "Deleted 1 screen" : `Deleted ${doomed.size} screens`, {
			id: "delete-screens",
			action: {
				label: "Undo",
				onClick: () => {
					// Only while the delete is the latest step: a later edit would be undone instead
					if (stateRef.current?.history.present !== step)
						return void toast("Other edits came after the delete", { description: "Press ⌘Z to step back to it." });
					undo();
					setSelection([...doomed]);
				},
			},
		});
	}, [change, frames, selection, stateRef, undo, setSelection]);

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
			const canvas = stateRef.current?.canvas;

			if (!canvas) return;

			if (additive) return setSelection(toggleInSelection(canvas.selection, file));
			setSelection([file]);
			const frame = canvas.frames.find((f) => f.file === file);

			if (frame) canvasRef.current?.fitTo([frame]);
		},
		[stateRef, setSelection],
	);

	const zoomIn = useCallback(() => canvasRef.current?.zoomBy(1.2), []);
	const zoomOut = useCallback(() => canvasRef.current?.zoomBy(1 / 1.2), []);
	const resetZoom = useCallback(() => canvasRef.current?.resetZoom(), []);
	const fitAll = useCallback(() => canvasRef.current?.fitTo(frames), [frames]);

	/** The selected element, when it is in the one selected screen */
	const element =
		structure.node && selection.length === 1 && structure.node.file === selection[0] ? structure.node : null;

	/** The elements ⇧-click added to `element` */
	const extraElements = element ? structure.nodes.slice(1) : NO_ELEMENTS;

	const single = selected.length === 1 ? selected[0]! : null;
	const singleComments = single ? openOnScreen(comments.comments, single.file) : [];
	const singleGroup = single ? groups.find((group) => group.base === baseOf(single.file)) : undefined;
	const scopedExport: ExportContext = { ...exportContext, selected, selectedComponent: null };

	const toggleTab = (next: InspectorTab) => setTab((current) => (current === next ? "design" : next));

	const screenContext: ScreenActionsContext = {
		current: () => stateRef.current?.history.present ?? null,
		selected,
		device,
		busy,
		variations,
		change,
		rename: (file) => {
			setTab("design");
			setRenaming(file);
		},
		vary,
		pick,
		play: setPlayStart,
		startComment: comments.startDraft,
		commentTool: () => setTool("comment"),
		reveal: (shown) => canvasRef.current?.fitTo(shown),
		pointer: () => canvasRef.current?.pointer() ?? null,
	};

	/** Every editor action: the keyboard, the right-click menus and the command palette all run these */
	const actions: Action[] = [
		{ id: "undo", label: "Undo", group: "Edit", chords: [{ code: "KeyZ", mod: true }], enabled: canUndo, run: undo },
		{
			id: "redo",
			label: "Redo",
			group: "Edit",
			chords: [
				{ code: "KeyZ", mod: true, shift: true },
				{ code: "KeyY", mod: true },
			],
			enabled: canRedo,
			run: redo,
		},
		{
			id: "select-all",
			label: "Select all",
			group: "Edit",
			chords: [{ code: "KeyA", mod: true }],
			enabled: frames.length > 0,
			run: () => setSelection(frames.map((frame) => frame.file)),
		},
		{
			id: "delete-element",
			label: "Delete",
			group: "Element",
			chords: [{ key: "Backspace" }, { key: "Delete" }],
			enabled: element !== null,
			destructive: true,
			run: () => structure.removeNode(),
		},
		{
			// Figma: Escape walks up to the parent, then out to the screen, then clears. Several elements become one first
			id: "escape",
			label: "Select parent or clear selection",
			group: "Edit",
			chords: [{ key: "Escape" }],
			enabled: tool === "comment" || element !== null || selection.length > 0,
			hidden: true,
			run: () => {
				if (tool === "comment") setTool("move");
				else if (element && extraElements.length) structure.select(element);
				else if (element) structure.select(parentElement(element));
				else setSelection([]);
			},
		},
		...elementActions({
			element,
			extras: extraElements,
			files,
			structure,
			selectParent: () => element && structure.select(parentElement(element)),
			editText: () => element && canvasRef.current?.editText(element),
			askAI: () => setComposeKey((key) => key + 1),
			showSource: () => {
				setTab("code");
				setSourceReveal((key) => key + 1);
			},
			pasteScreens: () => actionById(screenActions(screenContext), "paste-screens")?.run(),
		}),
		{
			id: "send-comments",
			label: "Send comments to chat",
			group: "Screen",
			enabled: singleComments.length > 0 && !chatBlocked,
			run: () => void commentsToChat(singleComments),
		},
		{
			id: "duplicate-screens",
			label: "Duplicate",
			group: "Screen",
			chords: [{ code: "KeyD", mod: true }],
			enabled: selected.length > 0,
			run: duplicateSelection,
		},
		{
			id: "delete-screens",
			label: "Delete",
			group: "Screen",
			chords: [{ key: "Backspace" }, { key: "Delete" }],
			enabled: selected.length > 0 && element === null,
			destructive: true,
			run: deleteSelection,
		},
		{
			id: "compare",
			label: "Compare variations",
			group: "Screen",
			chords: [{ code: "KeyV", shift: true }],
			enabled: single !== null,
			run: () => {
				if (singleGroup) setCompareBase(singleGroup.base);
				else toast("This screen has no variations yet", { description: "Use Vary this in the inspector." });
			},
		},
		{
			id: "play",
			label: "Play prototype",
			group: "Screen",
			chords: [{ key: "Enter", mod: true, alt: true }],
			enabled: frames.length > 0,
			run: startPlay,
		},
		{
			id: "export-png",
			label: "Export PNG…",
			group: "Export",
			enabled: selected.length > 0,
			run: () => void exportImages("png", scopedExport),
		},
		{
			id: "export-svg",
			label: "Export SVG…",
			group: "Export",
			enabled: selected.length > 0,
			run: () => void exportImages("svg", scopedExport),
		},
		{
			id: "export-pdf",
			label: "Export PDF…",
			group: "Export",
			enabled: selected.length > 0,
			run: () => void exportFlowPdf(exportContext, selected),
		},
		{
			id: "copy-code",
			label: "Copy code",
			group: "Export",
			enabled: single !== null,
			run: () => void copyCode(scopedExport, false),
		},
		{
			id: "copy-png",
			label: "Copy as PNG",
			group: "Export",
			enabled: single !== null,
			run: () => single && void copyImage(single, files, appliedTokens),
		},
		...ALIGN_SHORTCUTS.map((item): Action => ({
			id: `align-${item.alignment}`,
			label: item.label,
			group: "Arrange",
			chords: [{ code: item.code, alt: true }],
			enabled: selected.length > 1,
			run: () => alignSelection(item.alignment),
		})),
		...DISTRIBUTE_SHORTCUTS.map((item): Action => ({
			id: `distribute-${item.axis}`,
			label: item.label,
			group: "Arrange",
			chords: [{ code: item.code, ctrl: true, alt: true }],
			enabled: selected.length > 2,
			run: () => distributeSelection(item.axis),
		})),
		{
			id: "zoom-in",
			label: "Zoom in",
			group: "View",
			chords: [
				{ key: "=", mod: true, shift: "any" },
				{ key: "+", mod: true, shift: "any" },
			],
			enabled: true,
			run: zoomIn,
		},
		{
			id: "zoom-out",
			label: "Zoom out",
			group: "View",
			chords: [{ key: "-", mod: true }],
			enabled: true,
			run: zoomOut,
		},
		{
			id: "zoom-reset",
			label: "Zoom to 100%",
			group: "View",
			chords: [{ code: "Digit0", mod: true }],
			enabled: true,
			run: resetZoom,
		},
		{
			id: "zoom-fit",
			label: "Zoom to fit",
			group: "View",
			chords: [{ code: "Digit1", shift: true }],
			enabled: frames.length > 0,
			run: fitAll,
		},
		{
			id: "zoom-selection",
			label: "Zoom to selection",
			group: "View",
			chords: [{ code: "Digit2", shift: true }],
			enabled: selected.length > 0,
			run: () => canvasRef.current?.fitTo(selected),
		},
		{
			id: "toggle-code",
			label: "Code tab",
			group: "View",
			chords: [{ code: "KeyD", shift: true }],
			enabled: true,
			run: () => toggleTab("code"),
		},
		{
			id: "toggle-context",
			label: "Context tab",
			group: "View",
			chords: [{ code: "KeyC", shift: true }],
			enabled: true,
			run: () => toggleTab("context"),
		},
		{
			id: "toggle-comments-list",
			label: "Comments list",
			group: "View",
			chords: [{ code: "KeyC", alt: true }],
			enabled: true,
			run: () => setCommentsListOpen((open) => !open),
		},
		{
			id: "toggle-components",
			label: "Components panel",
			group: "View",
			chords: [{ code: COMPONENTS_VIEW_CODE, alt: true }],
			enabled: true,
			run: () => toggleTab("components"),
		},
		{
			id: "toggle-screens",
			label: "Screens list",
			group: "View",
			chords: [{ code: SCREENS_VIEW_CODE, alt: true }],
			enabled: true,
			run: () => sidePanel.toggleTab("screens"),
		},
		{
			id: "new-chat",
			label: "New chat",
			group: "Chat",
			chords: [{ code: NEW_CHAT_CODE, mod: true, shift: true }],
			enabled: messages.length > 0 && !busy,
			global: true,
			run: startNewChat,
		},
		{
			id: "chat-history",
			label: "Chat history…",
			group: "Chat",
			enabled: (project?.chats.length ?? 0) > 0,
			run: () => {
				sidePanel.show("chat");
				setChatHistoryOpen(true);
			},
		},
		{
			id: "toggle-side-panel",
			label: "Show or hide the chat and screens panel",
			group: "View",
			chords: [{ code: SIDE_PANEL_CODE, mod: true, shift: true }],
			enabled: true,
			run: sidePanel.toggle,
		},
		{
			id: "tool-move",
			label: "Move tool",
			group: "Tools",
			chords: [{ key: "v" }],
			enabled: true,
			run: () => setTool("move"),
		},
		{
			id: "tool-hand",
			label: "Hand tool",
			group: "Tools",
			chords: [{ key: "h" }],
			enabled: true,
			run: () => setTool("hand"),
		},
		{
			id: "tool-comment",
			label: "Comment tool",
			group: "Tools",
			chords: [{ key: "c" }],
			enabled: true,
			run: () => setTool("comment"),
		},
		{
			// ⌘K only: ⌥⌘K is make component
			id: "command-palette",
			label: "Command palette",
			group: "Help",
			chords: [{ code: "KeyK", mod: true }],
			enabled: true,
			hidden: true,
			global: true,
			run: () => setPaletteOpen(true),
		},
		{
			id: "shortcut-sheet",
			label: "Keyboard shortcuts",
			group: "Help",
			chords: [{ key: "?", shift: "any" }],
			enabled: true,
			run: () => setSheetOpen(true),
		},
		// Last, so ⌘C on a selected element can be its own action
		...screenActions(screenContext),
	];

	// Reads the latest render through a ref so the handler is registered once
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || !project) return;

		if (focusOwnsKey(event)) {
			const action = actionForKey(actions, event);

			if (action?.global && action.enabled && !paletteOpen && !sheetOpen) {
				event.preventDefault();
				action.run();
			}

			return;
		}

		// The palette and the sheet are modal: ⌘Z there must not undo behind them
		if (paletteOpen || sheetOpen) return;

		// Text being edited in a frame owns the keys; Escape still cancels it if focus stayed here
		if (canvasRef.current?.isEditingText()) {
			if (event.key === "Escape") canvasRef.current.endTextEdit(false);

			return;
		}

		if (playStart) return;
		const action = actionForKey(actions, event);

		// Only undo and redo stay global in compare mode
		if (compareBase && action?.id !== "undo" && action?.id !== "redo") return;

		if (action) {
			event.preventDefault();

			if (action.enabled) action.run();
		} else if (
			event.key.startsWith("Arrow") &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			selected.length &&
			!element
		) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
			const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
			nudgeSelection(dx, dy);
		}
	};

	function startNewChat() {
		if (busyReason) return void toast(busyReason);

		newChat();
		sidePanel.show("chat");
		setComposeKey((key) => key + 1);
	}

	/** `false` when it didn't run, so the composer keeps the prompt */
	function runCommand(command: ChatCommand, args: string, files: File[] = []) {
		if (command.kind === "provider") {
			const prompt = args ? `/${command.name} ${args}` : `/${command.name}`;

			return send(prompt, {
				targets: selection,
				files,
				variations,
				focus: structure.node,
				command: { name: command.name, args },
			});
		}

		if (!isBuiltin(command)) return false;

		if (command.name === "compare" || command.name === "play") {
			const action = actionById(actions, command.name);

			if (action?.enabled) action.run();
			else toast(command.name === "play" ? "Add a screen to play the prototype" : "Select one screen to compare");

			return true;
		}

		if (busyReason) {
			toast(busyReason);

			return false;
		}

		if (command.name === "new") startNewChat();
		else if (command.name === "product-md") startInterview();
		else if (command.name === "design-md") void writeDesign();
		else if (!single) {
			toast("Select one screen to vary");

			return false;
		} else vary(single.file, args, variations > 1 ? variations : 2);

		return true;
	}

	function startPlay() {
		const start = selected.find((frame) => frame.file.startsWith("screens/"))?.file ?? frames[0]?.file;

		if (start) setPlayStart(start);
		else toast("Add a screen to play the prototype");
	}

	const latestRunCommand = useRef(runCommand);
	latestRunCommand.current = runCommand;

	const onRunCommand = useCallback(
		(command: ChatCommand, args: string, files?: File[]) => latestRunCommand.current(command, args, files),
		[],
	);

	const removeChat = useCallback(
		(chatId: string) =>
			deleteChat(chatId).then(
				() => toast("Moved the chat to the Trash"),
				(reason) => toast.error("Couldn’t delete the chat", { description: String(reason) }),
			),
		[deleteChat],
	);

	const changeDevice = useCallback((next: Device) => setMeta({ device: next }), [setMeta]);
	const clearHeldPrompt = useCallback(() => setHeldPrompt(null), []);
	const clearFocus = useCallback(() => selectNode(null), [selectNode]);
	const showDesign = useCallback(() => setTab("design"), []);
	// The hook's own changes every render; it only ever clears the failure
	const clearFailure = useRef(dismissFailure);
	clearFailure.current = dismissFailure;
	const onDismissFailure = useCallback(() => clearFailure.current(), []);

	const getZoom = useCallback(() => viewport.get().zoom, [viewport]);
	const sendComment = useCallback((thread: ChatComment) => void commentsToChat([thread]), [commentsToChat]);

	const overlay = useCallback(
		(shown: Frame[]) => (
			<CommentsLayer
				controller={comments}
				frames={shown}
				getZoom={getZoom}
				onSendToChat={sendComment}
				sendBlocked={chatBlocked}
			/>
		),
		[comments, getZoom, sendComment, chatBlocked],
	);

	// Right-click selects first, so the actions already target the screens under the pointer
	const screenMenu = () => (
		<>
			<ActionMenuItems actions={actions} entries={SCREEN_MENU} />
			{isDevelopment ? (
				<>
					<ContextMenuSeparator />
					<DebugMenuItems />
				</>
			) : null}
		</>
	);

	// The point-based versions of new screen, paste and add comment come first, so they win
	const canvasMenu = (point: { x: number; y: number }) => (
		<>
			<ActionMenuItems actions={[...screenActions(screenContext, point), ...actions]} entries={CANVAS_MENU} />
			{isDevelopment ? (
				<>
					<ContextMenuSeparator />
					<DebugMenuItems />
				</>
			) : null}
		</>
	);

	// Stable for the memoized screens list, which renders the items only while a row's menu is open
	const latestScreenMenu = useRef(screenMenu);
	latestScreenMenu.current = screenMenu;
	const listMenu = useCallback(() => latestScreenMenu.current(), []);
	const endRename = useCallback(() => setRenaming(null), []);

	const selectForMenu = useCallback(
		(file: string) => {
			const current = stateRef.current?.canvas.selection ?? [];
			const next = contextSelection(current, file);

			if (!sameSelection(next, current)) setSelection(next);
		},
		[stateRef, setSelection],
	);

	const elementMenu = () => <ActionMenuItems actions={actions} entries={ELEMENT_MENU} />;
	// Stable for the memoized code panel, which renders the items only while its menu is open
	const latestElementMenu = useRef(elementMenu);
	latestElementMenu.current = elementMenu;
	const treeMenu = useCallback(() => latestElementMenu.current(), []);

	const changeLink = useCallback(
		(element: ElementRef, to: string | null) => setProp(element, LINK_ATTRIBUTE, to),
		[setProp],
	);

	const codePanel = useMemo(
		() => (
			<CodePanel
				path={codeFile}
				source={codeFile ? files[codeFile] : undefined}
				emptyMessage={
					selection.length ? "Select a single screen or component to see its code." : "Select a screen to see its code."
				}
				structure={structure}
				onEndStep={endStep}
				onUndo={undo}
				onRedo={redo}
				onShowProps={showDesign}
				elementMenu={treeMenu}
				revealKey={sourceReveal}
			/>
		),
		[codeFile, files, selection.length, structure, endStep, undo, redo, showDesign, treeMenu, sourceReveal],
	);

	const codeSource = codeFile ? files[codeFile] : undefined;

	const layersPanel = useMemo(
		() =>
			codeFile && codeSource !== undefined ? (
				<LayersPanel path={codeFile} source={codeSource} structure={structure} elementMenu={treeMenu} />
			) : null,
		[codeFile, codeSource, structure, treeMenu],
	);

	const selectAncestor = useCallback(
		(start: number | null) => selectNode(codeFile && start !== null ? { file: codeFile, start } : null),
		[codeFile, selectNode],
	);

	const propsPanel = useMemo(
		() => (
			<>
				{codeFile && codeSource !== undefined && structure.node?.file === codeFile && structure.nodes.length === 1 ? (
					<ElementBreadcrumb
						file={codeFile}
						source={codeSource}
						start={structure.node.start}
						screenName={frames.find((frame) => frame.file === codeFile)?.name ?? codeFile}
						onSelect={selectAncestor}
					/>
				) : null}
				<NodeProps
					files={files}
					file={codeFile}
					structure={structure}
					onEndStep={endStep}
					onOpenComponent={selectComponent}
					frames={frames}
					projectPath={projectPath}
					tokens={appliedTokens}
				/>
				<LinkControl
					files={files}
					frames={frames}
					element={structure.nodes.length === 1 ? structure.node : null}
					disabled={structure.busy}
					onChange={changeLink}
				/>
			</>
		),
		[
			files,
			codeFile,
			codeSource,
			structure,
			endStep,
			selectComponent,
			frames,
			projectPath,
			appliedTokens,
			changeLink,
			selectAncestor,
		],
	);

	const componentsPanel = useMemo(
		() => (
			<ComponentsPanel
				files={files}
				frames={frames}
				components={components}
				selectedComponent={selectedComponentPath}
				suggestions={suggestions}
				busy={busy}
				onSelectComponent={selectComponent}
				onShowScreens={showScreens}
				onMakeComponent={makeComponent}
				onDismissSuggestion={dismissSuggestion}
			/>
		),
		[
			files,
			frames,
			components,
			selectedComponentPath,
			suggestions,
			busy,
			selectComponent,
			showScreens,
			makeComponent,
			dismissSuggestion,
		],
	);

	const contextPanel = useMemo(
		() => (
			<ContextPanel
				files={files}
				file={contextFile}
				onFileChange={setContextFile}
				onEdit={editContext}
				onEditToken={editDesignToken}
				onReplace={replaceContext}
				onEndStep={endStep}
				onUndo={undo}
				onRedo={redo}
				lastUsed={lastUsed}
				hasScreens={frames.length > 0}
				busy={busy}
				busyReason={busyReason}
				onWriteDesign={() => void writeDesign()}
				onInterview={startInterview}
			/>
		),
		[
			files,
			contextFile,
			editContext,
			editDesignToken,
			replaceContext,
			endStep,
			undo,
			redo,
			lastUsed,
			frames.length,
			busy,
			busyReason,
			writeDesign,
			startInterview,
		],
	);

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
		<ScreenTheme value={themeCss(appliedTokens)}>
			<div className="flex h-full flex-col">
				<TitleBar>
					<NoDrag className="flex items-center gap-1">
						<Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to home">
							<ChevronLeft />
						</Button>
						<input
							value={project?.canvas.name ?? ""}
							onChange={(event) => setMeta({ name: event.target.value }, { coalesce: "project-name" })}
							onBlur={(event) => {
								// A blank name and its fix are one step with the typing before it
								if (!event.target.value.trim()) setMeta({ name: "Untitled design" }, { coalesce: "project-name" });
								endStep();
							}}
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
					<SidePanel
						state={sidePanel}
						screenCount={frames.length}
						revealChat={composeKey}
						screens={
							<ScreensPanel
								frames={frames}
								files={files}
								selection={selection}
								onSelect={selectFromList}
								onContextSelect={selectForMenu}
								screenMenu={listMenu}
								onRename={renameScreen}
								onReorder={reorderScreens}
							/>
						}
						chat={
							<ChatPanel
								messages={messages}
								generation={generation}
								failure={failure}
								device={device}
								onDeviceChange={changeDevice}
								onSend={sendPrompt}
								heldPrompt={heldPrompt}
								onHeldPromptSent={clearHeldPrompt}
								onStop={stop}
								onRetry={retry}
								onRegenerate={regenerate}
								undoableRun={undoableRun}
								onDismissFailure={onDismissFailure}
								selectedScreenName={
									interview ? undefined : selected.length === 1 ? selected[0]!.name : selectedComponent?.name
								}
								editingCount={interview ? 0 : selection.length}
								focusLabel={interview ? undefined : focus?.label}
								onClearFocus={clearFocus}
								composeKey={composeKey}
								insert={chatInsert}
								variations={variations}
								onVariationsChange={setVariations}
								onOpenContext={openContext}
								interview={interview}
								onStartInterview={startInterview}
								onSkipQuestion={skip}
								onCancelInterview={cancelInterview}
								commands={commands}
								onRunCommand={onRunCommand}
							/>
						}
						chatActions={
							project ? (
								<ChatSessions
									chats={project.chats}
									chatId={project.chatId}
									canStartNew={messages.length > 0}
									busyReason={busyReason}
									onNew={startNewChat}
									onOpen={openChat}
									onDelete={removeChat}
									historyOpen={chatHistoryOpen}
									onHistoryOpenChange={setChatHistoryOpen}
								/>
							) : null
						}
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
							handleRef={canvasRef}
							onCompare={setCompareBase}
							onPick={pick}
							onDropItem={dropComponent}
							element={structure.node}
							elements={extraElements}
							onSelectElement={selectElement}
							onToggleElement={toggleNode}
							onEditText={editElementText}
							onMoveElement={moveElementTo}
							onMoveEntry={moveEntryTo}
							onEditClasses={editClasses}
							onEditTextElsewhere={editTextElsewhere}
							onPlaceComment={comments.startDraft}
							screenMenu={screenMenu}
							elementMenu={elementMenu}
							canvasMenu={canvasMenu}
							onPatchFrame={patchFrame}
							onFixRender={busy ? undefined : fix}
							overlay={overlay}
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
						{showFps ? <FpsMeter className="absolute top-3 left-3" /> : null}

						<Toolbar
							tool={tool}
							onToolChange={setTool}
							canUndo={canUndo}
							canRedo={canRedo}
							onUndo={undo}
							onRedo={redo}
							newScreen={<NewScreenMenu actions={actions} />}
							comments={
								<CommentsList
									controller={comments}
									frames={frames}
									open={commentsListOpen}
									onOpenChange={setCommentsListOpen}
									onReveal={revealRects}
								/>
							}
						/>
						{themeBar ? (
							<ThemePrompt
								state={themeBar}
								className="absolute top-3 left-1/2 -translate-x-1/2"
								onApply={applyDesignTokens}
								onRead={() => void updateTheme()}
								onDismiss={() =>
									themeBar.kind === "applied"
										? setAppliedRead(null)
										: themeUpdate && setDismissedUpdate(updateKey(themeUpdate))
								}
								onReview={() => openContext("DESIGN.md")}
								onStop={stop}
								onUndo={undoReadTheme}
								onOpenSettings={openSettings}
							/>
						) : null}
						<ZoomControls
							viewport={viewport}
							onZoomIn={zoomIn}
							onZoomOut={zoomOut}
							onReset={resetZoom}
							onFit={fitAll}
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
						renaming={renaming}
						onRenamed={endRename}
						onChange={patchFrame}
						onEndStep={endStep}
						onAlign={alignSelection}
						onDistribute={distributeSelection}
						onDuplicate={duplicateSelection}
						onDelete={deleteSelection}
						busy={busy}
						onPick={pick}
						onCompare={setCompareBase}
						onVary={vary}
						onMix={mix}
						busyReason={busyReason}
						componentsBadge={unseenSuggestions}
						codePanel={codePanel}
						propsPanel={propsPanel}
						layersPanel={layersPanel}
						componentsPanel={componentsPanel}
						contextPanel={contextPanel}
					/>
				</div>
			</div>
			<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
			<ShortcutSheet open={sheetOpen} onOpenChange={setSheetOpen} actions={actions} />
			<CustomSizeDialog />
		</ScreenTheme>
	);
}

/** One menu for one screen or several: actions that don't apply show disabled */
const SCREEN_MENU: MenuEntry[] = [
	"rename-screen",
	"vary-screen",
	"send-comments",
	"compare",
	"pick-variation",
	SEPARATOR,
	"play-from-here",
	"zoom-selection",
	SEPARATOR,
	{
		label: "Align",
		items: ["align-left", "align-h-center", "align-right", SEPARATOR, "align-top", "align-v-middle", "align-bottom"],
	},
	{ label: "Distribute", items: ["distribute-horizontal", "distribute-vertical"] },
	SEPARATOR,
	"copy-screens",
	"duplicate-screens",
	{ label: "Export", items: ["export-png", "export-svg", "export-pdf", SEPARATOR, "copy-code", "copy-png"] },
	SEPARATOR,
	"delete-screens",
];

const CANVAS_MENU: MenuEntry[] = [
	"paste-screens",
	SEPARATOR,
	"new-screen",
	NEW_SCREEN_SUBMENU,
	"add-comment",
	SEPARATOR,
	"zoom-fit",
	"select-all",
];

const floatingBar =
	"absolute flex items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]";

function Toolbar({
	tool,
	onToolChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	newScreen,
	comments,
}: {
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	/** The new screen menu */
	newScreen: React.ReactNode;
	/** The comments list */
	comments: React.ReactNode;
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
			{newScreen}
			{comments}
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

/** The only part of the editor that renders while zooming */
const ZoomControls = memo(function ZoomControls({
	viewport,
	onZoomIn,
	onZoomOut,
	onReset,
	onFit,
}: {
	viewport: ViewportStore;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
	onFit: () => void;
}) {
	const percent = useZoomPercent(viewport);

	return (
		<div className={cn(floatingBar, "right-4 bottom-4")}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={onZoomOut}>
						<Minus />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					Zoom out <Kbd>⌘-</Kbd>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="w-14 px-0 tabular-nums"
						onClick={onReset}
						aria-label="Reset zoom to 100%"
					>
						{percent}%
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					Zoom to 100% <Kbd>⌘0</Kbd>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={onZoomIn}>
						<Plus />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					Zoom in <Kbd>⌘+</Kbd>
				</TooltipContent>
			</Tooltip>
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
});
