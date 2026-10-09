import {
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type Ref,
} from "react";
import { Check, Columns2, TriangleAlert } from "lucide-react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { boundsOf, rectFromPoints, type Rect } from "@/lib/align";
import { COMPONENT_MIME, componentDrag, dropTarget, hitStarts, slotOf } from "@/lib/component-drop";
import { dropPlacement } from "@/lib/drop-placement";
import { elementHover, type ElementHover } from "@/lib/element-hover";
import {
	draggedElement,
	draggedEntry,
	entryOrder,
	entryPlacement,
	moveTarget,
	type DraggedElement,
	type DraggedEntry,
} from "@/lib/element-move";
import { HANDLES, handleSides, resizeRect, snapResize, type Handle } from "@/lib/frame-resize";
import { isVoidElement, readChildrenText } from "@/lib/props";
import { hostOf, onFrameStatus, type FrameHost } from "@/lib/render/frame-host";
import { sourceVersion, type Box, type DropLayout, type FrameError } from "@/lib/render/protocol";
import type { ElementLayout, Spacing } from "@/lib/render/spacing";
import { contextSelection, marqueeSelection, sameSelection, selectedFrames, toggleInSelection } from "@/lib/selection";
import { guidesFor, snapMove, type Guide } from "@/lib/snapping";
import type { Viewport, ViewportStore } from "@/lib/viewport";
import type { GenerationDrafts, WritingFile } from "@/hooks/use-generation";
import { cn } from "@/lib/utils";
import { ElementHandles } from "./element-handles";
import { LinksLayer } from "./links-layer";
import { Minimap } from "./minimap";
import { focusOwnsKey, isTyping } from "./shortcuts";
import type { Problem } from "../../../shared/ai/contract";
import { findElement, parseJsx } from "../../../shared/jsx";
import { readClassName } from "../../../shared/tailwind/classes";
import { screenNameFromPath } from "../../../shared/project";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { FRAME_GAP } from "../../../shared/project";
import { isAlternate, variationGroups, type VariationGroup } from "../../../shared/variations";

export type Tool = "move" | "hand" | "comment";

export type CanvasHandle = {
	zoomBy: (factor: number) => void;
	fitTo: (rects: Rect[]) => void;
	resetZoom: () => void;
	editText: (element: ElementRef) => void;
	isEditingText: () => boolean;
	endTextEdit: (commit: boolean) => void;
	/** Null unless the frame shows the current source */
	elementAt: (file: string, point: Point) => Promise<ElementRef | null>;
	/** The pointer in canvas coordinates, or `null` when it is outside the canvas */
	pointer: () => Point | null;
};

/** `start` is the element's offset in the file's current source */
export type ElementRef = { file: string; start: number };

export type FrameMove = { file: string; x: number; y: number };

/** What the canvas edits on a frame by itself: its place, size and name */
export type FrameEdit = Partial<Pick<Frame, "name" | "x" | "y" | "width" | "height">>;

export const withMoves = (frames: Frame[], moves: FrameMove[]) => {
	const byFile = new Map(moves.map((move) => [move.file, move]));

	return frames.map((frame) => {
		const move = byFile.get(frame.file);

		return move && (move.x !== frame.x || move.y !== frame.y) ? { ...frame, x: move.x, y: move.y } : frame;
	});
};

const MIN_ZOOM = 0.05;

const MAX_ZOOM = 4;

const FIT_PADDING = 96;

/** Screen pixels the pointer travels before a press becomes a drag */
const DRAG_THRESHOLD = 3;

/** Canvas units */
const GRID = 24;

const GRID_DOTS =
	"radial-gradient(circle, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1px)";

/** Screen pixels within which a dragged frame snaps to another's edge or center */
const SNAP_DISTANCE = 6;

const GUIDE_COLOR = "var(--color-rose-500)";

/** Below this every screen shows its snapshot */
const LIVE_MIN_ZOOM = 0.25;

/** Screens this far outside the view (a share of its size, per side) stay mounted */
const LIVE_MARGIN = 0.5;

/** Wheel and pan events closer together than this are one gesture */
const GESTURE_IDLE_MS = 150;

/** Blurred shadows are slow to repaint while zooming: frames keep only their ring during a gesture */
const NO_SHADOW = "0 0 #0000";

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((v) => b.has(v));

const NO_ELEMENTS: ElementRef[] = [];

type CanvasProps = {
	frames: Frame[];
	files: ProjectFiles;
	drafts?: GenerationDrafts | null;
	selection: string[];
	onSelectionChange: (selection: string[]) => void;
	/** Once per drag, on release; `dragId` is stable for one drag */
	onMoveFrames: (moves: FrameMove[], dragId: string) => void;
	onMoveEnd: () => void;
	tool: Tool;
	viewport: ViewportStore;
	handleRef?: Ref<CanvasHandle>;
	onCompare?: (base: string) => void;
	onPick?: (file: string) => void;
	/** `file` is `null` when dropped outside every frame; `target` is `null` when the drop wasn't placed */
	onDropItem?: (drop: {
		file: string | null;
		data: string;
		target: { parent: number; index: number; version: string } | null;
	}) => void;
	element?: ElementRef | null;
	/** Click on a selected screen, or ⌘-click; `null` clears the element. `file` becomes the selection */
	onSelectElement?: (file: string, element: ElementRef | null) => void;
	/** Elements ⇧-click added to `element`, in its file */
	elements?: ElementRef[];
	/** ⇧-click in the selected screen once it has a selected element: adds or removes the element under the pointer */
	onToggleElement?: (element: ElementRef) => void;
	onEditText?: (element: ElementRef, text: string) => void;
	/** Dragging the selected element drops it here; `parent` and `index` are offsets in the source at `version` */
	onMoveElement?: (element: ElementRef, target: { parent: number; index: number; version: string }) => void;
	/** Dragging an item a `.map` renders moves its array entry `from` to `to`, indexes in the source at `version` */
	onMoveEntry?: (element: ElementRef, move: { from: number; to: number; version: string }) => void;
	/** The selection's resize, padding and gap handles; one undo step per call */
	onEditClasses?: (element: ElementRef, edit: (classes: string) => string) => void;
	/** For elements that hold more than text */
	onEditTextElsewhere?: (element: ElementRef) => void;
	onPlaceComment?: (point: Point) => void;
	/** Items of the right-click menu on screens; `files` is the selection it acts on */
	screenMenu?: (files: string[]) => React.ReactNode;
	/** Items of the right-click menu on the canvas background; `point` is where it opened, in canvas coordinates */
	canvasMenu?: (point: Point) => React.ReactNode;
	/** Items of the right-click menu on an element, which it selects first */
	elementMenu?: () => React.ReactNode;
	/** Resizes with the handles and renames on the label; edits sharing `step` are one undo step */
	onPatchFrame?: (file: string, edit: FrameEdit, step?: string) => void;
	/** Offered on screens that fail to render; unset while it can't run (a generation is under way) */
	onFixRender?: (file: string, problem: Problem) => void;
	/** Drawn in canvas coordinates; `frames` include a drag in progress */
	overlay?: (frames: Frame[]) => React.ReactNode;
	children?: React.ReactNode;
};

type Variation = "picked" | "alternate";

/** In screen pixels */
const GROUP_PADDING = 16;

/** In screen pixels */
const GROUP_LABEL_ROOM = 24;

function groupLayouts(frames: Frame[], drafts: Frame[] = []): { group: VariationGroup; bounds: Rect; name: string }[] {
	const all = [...frames, ...drafts];
	const byFile = new Map(all.map((frame) => [frame.file, frame]));

	return variationGroups(byFile.keys()).flatMap((group) => {
		const bounds = boundsOf(group.files.flatMap((file) => byFile.get(file) ?? []));

		if (!bounds) return [];
		const picked = group.picked ? byFile.get(group.picked) : undefined;

		return [{ group, bounds, name: picked?.name || screenNameFromPath(group.base) }];
	});
}

type Point = { x: number; y: number };

type Drag =
	| { kind: "pan"; startX: number; startY: number; origin: Viewport }
	| {
			kind: "frames";
			id: string;
			startX: number;
			startY: number;
			origins: FrameMove[];
			/** Of the dragged frames, where they started */
			bounds: Rect;
			/** The frames they snap to */
			others: Rect[];
			moved: boolean;
			/** Pressed an already-selected frame: a click without moving selects only it */
			pressed: string | null;
			/** A click without moving selects the element under the pointer in this screen */
			pick: string | null;
	  }
	| {
			/** The selected or hovered element, pressed inside its box: a drag moves it, a click picks what's under the pointer */
			kind: "element";
			file: string;
			start: number;
			/** A hovered element becomes the selection once the drag starts, so the move applies to it */
			selected: boolean;
			version: string;
			/** Exactly one is set: an element moves anywhere, an item of a `.map` reorders among its siblings */
			dragged: DraggedElement | null;
			entry: DraggedEntry | null;
			/** Frame-local, the instance that was pressed */
			box: Box;
			startX: number;
			startY: number;
			moved: boolean;
	  }
	| {
			kind: "resize";
			id: string;
			file: string;
			handle: Handle;
			origin: Rect;
			others: Rect[];
			startX: number;
			startY: number;
			moved: boolean;
	  }
	| {
			kind: "marquee";
			start: Point;
			current: Point;
			base: string[];
			additive: boolean;
			moved: boolean;
			/** Shown on the canvas during the drag; the editor gets it once, on release */
			selection: string[];
	  };

type HoverRequest = { clientX: number; clientY: number; deep: boolean };

type Hover = { file: string; start: number; box: Box };

const sameBox = (a: Box | null, b: Box | null) =>
	a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

const sameHover = (a: Hover | null, b: Hover | null) =>
	a === b || (!!a && !!b && a.file === b.file && a.start === b.start && sameBox(a.box, b.box));

/** Frame-local boxes; `line` is `null` for an empty container. `from` is set for an entry, and `index` is where it goes */
type DropSpot = {
	parent: number;
	index: number;
	from: number | null;
	version: string;
	name: string;
	box: Box;
	line: Box | null;
};

/** `spot` is `null` where the screen can't take the drop */
type DropPreview = { file: string; spot: DropSpot | null };

const sameDrop = (a: DropPreview | null, b: DropPreview | null) =>
	a === b ||
	(!!a &&
		!!b &&
		a.file === b.file &&
		(a.spot === b.spot ||
			(!!a.spot &&
				!!b.spot &&
				a.spot.parent === b.spot.parent &&
				a.spot.index === b.spot.index &&
				a.spot.version === b.spot.version &&
				sameBox(a.spot.box, b.spot.box) &&
				sameBox(a.spot.line, b.spot.line))));

type DropProbe = {
	busy: boolean;
	next: { clientX: number; clientY: number } | null;
	/** Bumped when a drag ends, so probes still in flight are ignored */
	generation: number;
	preview: DropPreview | null;
	/** Layout doesn't move during a drag: one request per file, container and version */
	layouts: Map<string, DropLayout>;
	/** Keeps the preview and the live frame while a drop resolves */
	holding: boolean;
};

export function Canvas({
	frames,
	files,
	drafts,
	selection,
	onSelectionChange,
	onMoveFrames,
	onMoveEnd,
	tool,
	viewport: view,
	handleRef,
	onCompare,
	onPick,
	onDropItem,
	element = null,
	onSelectElement,
	elements = NO_ELEMENTS,
	onToggleElement,
	onEditText,
	onMoveElement,
	onMoveEntry,
	onEditClasses,
	onEditTextElsewhere,
	onPlaceComment,
	screenMenu,
	canvasMenu,
	elementMenu,
	onPatchFrame,
	onFixRender,
	overlay,
	children,
}: CanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const layerRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	/** Where the dragged frames are until the drag commits them */
	const [moving, setMoving] = useState<FrameMove[] | null>(null);
	/** The frame being resized, until the drag commits it */
	const [resized, setResized] = useState<{ file: string; rect: Rect } | null>(null);
	const [guides, setGuides] = useState<Guide[]>([]);

	const pendingMoves = useRef<{ moves: FrameMove[] | null; resized: Rect | null; guides: Guide[]; request: number }>({
		moves: null,
		resized: null,
		guides: [],
		request: 0,
	});

	const pendingMarquee = useRef(0);

	const shown = useMemo(() => {
		const moved = moving ? withMoves(frames, moving) : frames;

		return resized
			? moved.map((frame) => (frame.file === resized.file ? { ...frame, ...resized.rect } : frame))
			: moved;
	}, [frames, moving, resized]);

	const framesRef = useRef(shown);
	const [spaceHeld, setSpaceHeld] = useState(false);
	// Stable for the memoized frames, whatever the parent passes
	const pickRef = useRef(onPick);
	const pick = useCallback((file: string) => pickRef.current?.(file), []);
	const [dropFile, setDropFile] = useState<string | null>(null);
	const draggingComponent = useSyncExternalStore(componentDrag.subscribe, () => componentDrag.current() !== null);
	const layerHover = useSyncExternalStore(elementHover.subscribe, elementHover.current);
	const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);

	const dropping = useRef<DropProbe>({
		busy: false,
		next: null,
		generation: 0,
		preview: null,
		layouts: new Map(),
		holding: false,
	});

	/** The element being moved: its drop preview leaves out the element and what it holds */
	const movingElement = useRef<{
		file: string;
		version: string;
		dragged: DraggedElement | null;
		entry: DraggedEntry | null;
		box: Box;
	} | null>(null);

	/** Frame-local, how far a dragged list item has followed the pointer */
	const entryOffset = useRef<Point | null>(null);

	/** Where the selected element renders, for a press that drags it */
	const selectedBoxes = useRef<{ file: string; start: number; boxes: Box[] } | null>(null);
	const ghostRef = useRef<HTMLDivElement>(null);
	const [hover, setHover] = useState<Hover | null>(null);
	const hovering = useRef<{ busy: boolean; next: HoverRequest | null }>({ busy: false, next: null });
	const [editing, setEditing] = useState<ElementRef | null>(null);
	const editingRef = useRef(editing);
	const rendered = drafts?.files ?? files;
	const filesRef = useRef(rendered);
	const selectionRef = useRef(selection);
	const callbacks = useRef({ onEditText, onEditTextElsewhere, onPatchFrame, onFixRender });
	const menuTrigger = useRef<HTMLSpanElement>(null);
	/** Client coordinates, for pasting under the pointer */
	const lastPointer = useRef<{ clientX: number; clientY: number } | null>(null);
	/** `null` for the canvas background menu */
	const [menuFiles, setMenuFiles] = useState<string[] | null>([]);
	const [menuOnElement, setMenuOnElement] = useState(false);
	/** Bumped by each right-click, so a hit test that comes back late doesn't open an old menu */
	const menuRequest = useRef(0);
	const [menuPoint, setMenuPoint] = useState<Point>({ x: 0, y: 0 });
	/** Frames in or near the view, which keep their live iframe */
	const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
	const painted = useRef({ request: 0, zoom: Number.NaN, gesture: 0 });
	/** The screen whose label is an input */
	const [renaming, setRenaming] = useState<string | null>(null);
	const renamingRef = useRef<string | null>(null);
	/** Screens whose last render on this canvas failed, by file */
	const [failures, setFailures] = useState<ReadonlyMap<string, FrameError>>(() => new Map());
	const failuresRef = useRef(failures);

	// Latest props and state for the callbacks and listeners below, updated before any event can reach them
	useLayoutEffect(() => {
		pickRef.current = onPick;
		editingRef.current = editing;
		filesRef.current = rendered;
		framesRef.current = shown;
		selectionRef.current = selection;
		failuresRef.current = failures;
		callbacks.current = { onEditText, onEditTextElsewhere, onPatchFrame, onFixRender };
	});

	const updateVisible = useCallback(() => {
		const container = containerRef.current;

		if (!container) return;
		const { x, y, zoom } = view.get();
		const next = new Set<string>();
		const width = container.clientWidth / zoom;
		const height = container.clientHeight / zoom;
		const left = -x / zoom - width * LIVE_MARGIN;
		const top = -y / zoom - height * LIVE_MARGIN;
		const right = left + width * (1 + LIVE_MARGIN * 2);
		const bottom = top + height * (1 + LIVE_MARGIN * 2);
		// Mounting an iframe is the most expensive thing the canvas does: a selection never mounts more than one,
		// the single selected screen near the view, so a click inside it can pick an element at any zoom
		const single = selectionRef.current.length === 1 ? selectionRef.current[0] : null;

		for (const frame of framesRef.current) {
			if (zoom < LIVE_MIN_ZOOM && frame.file !== single) continue;

			if (frame.x < right && frame.x + frame.width > left && frame.y < bottom && frame.y + frame.height > top)
				next.add(frame.file);
		}

		setVisible((current) => (sameSet(current, next) ? current : next));
	}, [view]);

	const paint = useCallback(() => {
		const state = painted.current;
		state.request = 0;
		const layer = layerRef.current;
		const grid = gridRef.current;

		if (!layer || !grid) return;
		const { x, y, zoom } = view.get();
		const size = GRID * zoom;
		layer.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;

		// The grid layer is a cell larger than the view on every side and moves by less than a cell
		const offset = (value: number) => ((value % size) + size) % size;
		grid.style.transform = `translate(${offset(x)}px, ${offset(y)}px)`;

		if (zoom === state.zoom) return;
		state.zoom = zoom;
		layer.style.setProperty("--zoom", String(zoom));
		layer.style.setProperty("--unzoom", String(1 / zoom));
		grid.style.inset = `${-size}px`;
		grid.style.backgroundSize = `${size}px ${size}px`;
		grid.style.backgroundImage = zoom > 0.25 ? GRID_DOTS : "none";
	}, [view]);

	useLayoutEffect(() => {
		paint();

		return view.subscribe(() => {
			if (!painted.current.request) painted.current.request = requestAnimationFrame(paint);
		});
	}, [view, paint]);

	/** Writes the viewport now instead of on the next frame, and settles the live frames */
	const settle = useCallback(() => {
		cancelAnimationFrame(painted.current.request);
		paint();
		updateVisible();
	}, [paint, updateVisible]);

	/** Promotes the layers while wheel or pan events keep coming */
	const gesture = useCallback(() => {
		const state = painted.current;
		const layer = layerRef.current;
		const grid = gridRef.current;

		if (!layer || !grid) return;

		if (state.gesture) clearTimeout(state.gesture);
		else {
			layer.style.willChange = "transform";
			grid.style.willChange = "transform";
			layer.style.setProperty("--frame-shadow", NO_SHADOW);
		}

		state.gesture = window.setTimeout(() => {
			state.gesture = 0;
			layer.style.willChange = "";
			grid.style.willChange = "";
			layer.style.removeProperty("--frame-shadow");
			updateVisible();
		}, GESTURE_IDLE_MS);
	}, [updateVisible]);

	useLayoutEffect(updateVisible, [shown, selection, updateVisible]);

	useEffect(() => {
		const container = containerRef.current;

		if (!container) return;
		const observer = new ResizeObserver(updateVisible);
		observer.observe(container);
		const state = painted.current;
		const moves = pendingMoves.current;

		return () => {
			observer.disconnect();
			cancelAnimationFrame(state.request);
			cancelAnimationFrame(moves.request);
			clearTimeout(state.gesture);
			state.request = state.gesture = moves.request = 0;
		};
	}, [updateVisible]);

	const zoomAround = useCallback(
		(factor: number, clientX?: number, clientY?: number) => {
			const rect = containerRef.current?.getBoundingClientRect();

			if (!rect) return;
			const current = view.get();
			const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
			const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
			const zoom = clampZoom(current.zoom * factor);
			const ratio = zoom / current.zoom;
			view.set({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
		},
		[view],
	);

	const fitTo = useCallback(
		(targets: Rect[]) => {
			const rect = containerRef.current?.getBoundingClientRect();
			const bounds = boundsOf(targets);

			if (!rect || !bounds) return;

			const zoom = clampZoom(
				Math.min((rect.width - FIT_PADDING * 2) / bounds.width, (rect.height - FIT_PADDING * 2) / bounds.height, 1),
			);

			view.set({
				zoom,
				x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
				y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
			});
			settle();
		},
		[view, settle],
	);

	const hostFor = useCallback(
		(file: string) =>
			hostOf(containerRef.current?.querySelector<HTMLIFrameElement>(`[data-frame-file="${CSS.escape(file)}"] iframe`)),
		[],
	);

	/** Falls back to `onEditTextElsewhere` when the element holds more than text or its DOM doesn't match the source */
	const editText = useCallback(
		(target: ElementRef, point?: Point) => {
			const source = filesRef.current[target.file];
			const node = source === undefined ? null : findElement(parseJsx(source), target.start);
			const text = node && node.name !== null && !isVoidElement(node) ? readChildrenText(node) : null;
			const host = hostFor(target.file);

			if (source === undefined || text === null || !host) return callbacks.current.onEditTextElsewhere?.(target);
			// The frame takes pointer input and focus while editing, so the caret can be placed with the mouse
			void host
				.editText({ start: target.start, version: sourceVersion(source), text, ...point }, () => {
					setEditing(target);
					host.frame.focus();
				})
				.then((result) => {
					setEditing((current) => (current === target ? null : current));

					// Give the keys back to the editor (undo, Escape)
					if (document.activeElement === host.frame) host.frame.blur();

					if (result === undefined) callbacks.current.onEditTextElsewhere?.(target);
					else if (result !== null && result !== text) callbacks.current.onEditText?.(target, result);
				});
			setEditing(target);
			host.frame.focus();
		},
		[hostFor],
	);

	useImperativeHandle(
		handleRef,
		() => ({
			zoomBy: (factor) => {
				zoomAround(factor);
				settle();
			},
			fitTo,
			resetZoom: () => {
				zoomAround(1 / view.get().zoom);
				settle();
			},
			editText: (target) => editText(target),
			isEditingText: () => editingRef.current !== null,
			endTextEdit: (commit) => {
				if (editingRef.current) hostFor(editingRef.current.file)?.endTextEdit(commit);
			},
			elementAt: async (file, point) => {
				const host = hostFor(file);
				const source = filesRef.current[file];

				if (!host || source === undefined) return null;
				const starts = hitStarts(await host.hitTest(point.x, point.y), file, source);

				return starts ? { file, start: starts[0]! } : null;
			},
			pointer: () => {
				const last = lastPointer.current;
				const rect = containerRef.current?.getBoundingClientRect();

				if (!last || !rect) return null;

				const inside =
					last.clientX >= rect.left &&
					last.clientX <= rect.right &&
					last.clientY >= rect.top &&
					last.clientY <= rect.bottom;

				if (!inside) return null;
				const { x, y, zoom } = view.get();

				return { x: (last.clientX - rect.left - x) / zoom, y: (last.clientY - rect.top - y) / zoom };
			},
		}),
		[view, zoomAround, fitTo, settle, editText, hostFor],
	);

	// On the window, so leaving the canvas for a panel counts. A live frame takes the events while the pointer
	// is over it, which leaves the last point at its edge: close enough for a paste
	useEffect(() => {
		const move = (event: PointerEvent) => {
			lastPointer.current = { clientX: event.clientX, clientY: event.clientY };
		};

		window.addEventListener("pointermove", move, { passive: true });

		return () => window.removeEventListener("pointermove", move);
	}, []);

	// Only this canvas's own frames count: the same screen renders elsewhere (snapshots, compare, play)
	useEffect(
		() =>
			onFrameStatus((status) => {
				if (!containerRef.current?.contains(status.frame)) return;
				const { entry } = status;

				if (status.status === "error") {
					const { error } = status;
					setFailures((current) => (current.get(entry) === error ? current : new Map(current).set(entry, error)));
				} else if (status.status === "rendered") {
					setFailures((current) => {
						if (!current.has(entry)) return current;
						const next = new Map(current);
						next.delete(entry);

						return next;
					});
				}
			}),
		[],
	);

	const fixRender = useCallback((file: string) => {
		const error = failuresRef.current.get(file);

		if (error)
			callbacks.current.onFixRender?.(file, { path: error.file ?? file, message: error.message, line: error.line });
	}, []);

	const startRename = (file: string) => {
		renamingRef.current = file;
		setRenaming(file);
	};

	/** `name` is `null` to cancel; a blur after Enter or Escape finds the rename already ended */
	const endRename = useCallback((file: string, name: string | null) => {
		if (renamingRef.current !== file) return;
		renamingRef.current = null;
		setRenaming(null);
		const next = name?.trim();
		const frame = framesRef.current.find((f) => f.file === file);

		if (next && frame && next !== frame.name) callbacks.current.onPatchFrame?.(file, { name: next });
	}, []);

	const viewSize = useCallback(() => {
		const container = containerRef.current;

		return container ? { width: container.clientWidth, height: container.clientHeight } : null;
	}, []);

	// Non-passive wheel listener so we can stop the webview from scrolling/zooming
	useEffect(() => {
		const el = containerRef.current;

		if (!el) return;

		const onWheel = (event: WheelEvent) => {
			event.preventDefault();

			if (event.ctrlKey || event.metaKey) {
				zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
			} else {
				const current = view.get();
				view.set({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
			}

			gesture();
		};

		el.addEventListener("wheel", onWheel, { passive: false });

		return () => el.removeEventListener("wheel", onWheel);
	}, [view, zoomAround, gesture]);

	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (event.code === "Space" && !focusOwnsKey(event)) {
				event.preventDefault();
				setSpaceHeld(true);
			}
		};

		const up = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};

		const blur = () => setSpaceHeld(false);
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);

		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, []);

	const panning = tool === "hand" || spaceHeld;

	const toCanvas = (clientX: number, clientY: number): Point => {
		const rect = containerRef.current!.getBoundingClientRect();
		const { x, y, zoom } = view.get();

		return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
	};

	const frameAt = (clientX: number, clientY: number) => {
		const point = toCanvas(clientX, clientY);

		const inside = (frame: Frame) =>
			point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height;

		// Later frames paint on top
		for (let i = shown.length - 1; i >= 0; i--) if (inside(shown[i]!)) return shown[i];

		return undefined;
	};

	// The frames ignore pointer input, so the canvas gets every drag event
	const isComponentDrag = (event: React.DragEvent) =>
		!!onDropItem && (componentDrag.current() !== null || event.dataTransfer.types.includes(COMPONENT_MIME));

	const clearDrop = useCallback(() => {
		const state = dropping.current;

		if (state.holding) return;
		state.next = null;
		state.generation++;
		state.preview = null;
		state.layouts.clear();
		setDropPreview(null);
		setDropFile(null);
	}, []);

	// A cancelled drag (Esc) ends without a drop or a dragleave
	useEffect(
		() =>
			componentDrag.subscribe(() => {
				if (componentDrag.current() === null) clearDrop();
			}),
		[clearDrop],
	);

	/** `null` off the screens and while the screen under the pointer loads */
	const probeDrop = async (clientX: number, clientY: number): Promise<DropPreview | null> => {
		const frame = frameAt(clientX, clientY);

		if (!frame) return null;
		const host = hostFor(frame.file);
		const source = filesRef.current[frame.file];
		const blocked = { file: frame.file, spot: null };
		const moving = movingElement.current;

		// An element moves within its own screen
		if (host?.status === "error" || (moving && moving.file !== frame.file)) return blocked;

		if (!host || host.status !== "rendered" || source === undefined) return null;
		const point = toCanvas(clientX, clientY);
		const local = { x: point.x - frame.x, y: point.y - frame.y };
		const version = sourceVersion(source);

		if (moving?.entry) return moving.version === version ? probeEntry(host, frame.file, moving, local) : null;
		const hit = await host.hitTest(local.x, local.y);

		// A newer version is about to render
		if ((hit && hit.version !== version) || (moving && moving.version !== version)) return null;
		const starts = hitStarts(hit, frame.file, source);
		const target = moving?.dragged ? moveTarget(source, moving.dragged, starts) : dropTarget(source, starts);

		if (!target) return blocked;
		const { layouts } = dropping.current;
		const key = `${frame.file}\n${target.parent}\n${version}`;
		const layout = layouts.get(key) ?? (await host.dropLayout(target.parent, version, local.x, local.y));

		if (!layout || layout.version !== version) return blocked;
		layouts.set(key, layout);
		const { index, line } = dropPlacement(layout, (start) => slotOf(target, start), local);

		return {
			file: frame.file,
			spot: { parent: target.parent, index, from: null, version, name: target.name, box: layout.box, line },
		};
	};

	/** The entry reorders among the instances in its parent, wherever the pointer is in the screen */
	const probeEntry = async (
		host: FrameHost,
		file: string,
		moving: { version: string; entry: DraggedEntry | null; box: Box },
		local: Point,
	): Promise<DropPreview | null> => {
		const { entry, version, box } = moving;

		if (!entry) return null;
		const { layouts } = dropping.current;
		const key = `${file}\n${entry.parent}\n${version}`;
		const pressed = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		// The parent's instance that holds the pressed item, when the parent repeats too
		const layout = layouts.get(key) ?? (await host.dropLayout(entry.parent, version, pressed.x, pressed.y));
		const blocked = { file, spot: null };

		if (!layout || layout.version !== version) return blocked;
		layouts.set(key, layout);
		const placement = entryPlacement(layout, entry, box, local);

		if (!placement) return blocked;
		const { from, to, line } = placement;
		const name = nameAt(filesRef.current[file], entry.parent) ?? "";

		return { file, spot: { parent: entry.parent, index: to, from, version, name, box: layout.box, line } };
	};

	/** The siblings of a dragged list item make room in the frame itself, so the screen doesn't render mid-drag */
	const shiftEntries = (settle = false) => {
		const moving = movingElement.current;

		if (!moving?.entry) return;
		const { preview } = dropping.current;
		const spot = preview?.file === moving.file ? preview.spot : null;
		const from = spot?.from ?? 0;
		const to = spot?.from == null ? from : spot.index;
		const order = entryOrder(moving.entry.count, from, to);
		const offset = settle ? null : entryOffset.current;
		hostFor(moving.file)?.previewOrder(moving.entry.start, moving.version, { order, box: moving.box, offset });
	};

	/** One probe in flight, like `updateHover` */
	const updateDrop = (clientX: number, clientY: number) => {
		const state = dropping.current;
		state.next = { clientX, clientY };

		if (state.busy) return;
		state.busy = true;

		const run = async () => {
			while (state.next) {
				const { clientX: x, clientY: y } = state.next;
				state.next = null;
				const generation = state.generation;
				const next = await probeDrop(x, y);

				if (generation !== state.generation) continue;
				state.preview = next;
				setDropPreview((current) => (sameDrop(current, next) ? current : next));
				shiftEntries();
			}

			state.busy = false;
		};

		void run();
	};

	// WebKit accepts a drop only when both dragenter and dragover are cancelled
	const onDragOver = (event: React.DragEvent) => {
		if (!isComponentDrag(event)) return;
		event.preventDefault();
		const file = frameAt(event.clientX, event.clientY)?.file ?? null;
		const { preview } = dropping.current;
		event.dataTransfer.dropEffect = file && preview?.file === file && !preview.spot ? "none" : "copy";

		if (file !== dropFile) setDropFile(file);
		updateDrop(event.clientX, event.clientY);
	};

	const onDragLeave = (event: React.DragEvent) => {
		const entered = event.relatedTarget instanceof Node ? event.relatedTarget : null;

		if (!containerRef.current?.contains(entered)) clearDrop();
	};

	const onDrop = (event: React.DragEvent) => {
		if (!isComponentDrag(event)) return;
		event.preventDefault();
		const data = componentDrag.current() ?? event.dataTransfer.getData(COMPONENT_MIME);
		const frame = frameAt(event.clientX, event.clientY);
		const state = dropping.current;
		state.holding = true;
		state.next = null;
		state.generation++;
		componentDrag.end();

		const release = () => {
			state.holding = false;
			clearDrop();
		};

		if (!frame) {
			release();

			return onDropItem!({ file: null, data, target: null });
		}

		// Placed again at the drop point, so it lands where the last preview showed
		void probeDrop(event.clientX, event.clientY).then((preview) => {
			release();

			if (preview && !preview.spot) return;
			const spot = preview?.spot;
			onDropItem!({
				file: frame.file,
				data,
				target: spot ? { parent: spot.parent, index: spot.index, version: spot.version } : null,
			});
		});
	};

	const startFrameDrag = (
		event: React.PointerEvent,
		dragged: string[],
		pressed: string | null,
		pick: string | null = null,
	) => {
		const moved = selectedFrames(shown, dragged);
		const files = new Set(moved.map((frame) => frame.file));
		const bounds = boundsOf(moved);

		if (!bounds) return;

		setDrag({
			kind: "frames",
			id: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			origins: moved.map(({ file, x, y }) => ({ file, x, y })),
			bounds,
			others: shown.filter((frame) => !files.has(frame.file)),
			moved: false,
			pressed,
			pick,
		});
	};

	/** The element a press at `local` would drag: the selected one, else the hovered one, as in Figma */
	const pressedElement = (file: string, local: { x: number; y: number }) => {
		const boxes = selectedBoxes.current;

		if (element?.file === file && boxes?.file === file && boxes.start === element.start) {
			const box = boxes.boxes.find((b) => contains(b, local));

			if (box) return { start: element.start, box, selected: true };
		}

		return hover?.file === file && contains(hover.box, local)
			? { start: hover.start, box: hover.box, selected: false }
			: null;
	};

	/** A press inside the selected or hovered element drags the element; `false` leaves the press to the screen */
	const startElementDrag = (event: React.PointerEvent, file: string) => {
		const source = filesRef.current[file];
		const frame = shown.find((f) => f.file === file);

		if (!onMoveElement || source === undefined || !frame) return false;
		const point = toCanvas(event.clientX, event.clientY);
		const pressed = pressedElement(file, { x: point.x - frame.x, y: point.y - frame.y });
		const dragged = pressed ? draggedElement(source, pressed.start) : null;
		const entry = pressed && !dragged && onMoveEntry ? draggedEntry(source, pressed.start) : null;

		if (!pressed || (!dragged && !entry)) return false;
		const { start, box, selected } = pressed;

		setDrag({
			kind: "element",
			file,
			start,
			selected,
			version: sourceVersion(source),
			dragged,
			entry,
			box,
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
		});

		return true;
	};

	/** Placed again at the release point, so it lands where the last preview showed */
	const dropElement = (drag: Extract<Drag, { kind: "element" }>, clientX: number, clientY: number) => {
		const state = dropping.current;
		state.holding = true;
		state.next = null;
		state.generation++;

		void probeDrop(clientX, clientY).then((preview) => {
			const spot = preview?.file === drag.file ? preview.spot : null;
			const reorders = spot?.from != null && spot.from !== spot.index;

			// The items stay in their new slots until the render that applies the move
			if (drag.entry && reorders) {
				state.preview = preview;
				shiftEntries(true);
			} else if (drag.entry) hostFor(drag.file)?.previewOrder(drag.entry.start, drag.version, null);
			movingElement.current = null;
			entryOffset.current = null;
			state.holding = false;
			clearDrop();
			const element = { file: drag.file, start: drag.start };

			if (!spot) return;

			if (spot.from === null)
				onMoveElement?.(element, { parent: spot.parent, index: spot.index, version: spot.version });
			else if (reorders) onMoveEntry?.(element, { from: spot.from, to: spot.index, version: spot.version });
		});
	};

	// Escape drops nothing and keeps the selection
	const draggingElement = drag?.kind === "element";

	useEffect(() => {
		if (!draggingElement) return;

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			const moving = movingElement.current;

			if (moving?.entry) hostFor(moving.file)?.previewOrder(moving.entry.start, moving.version, null);
			movingElement.current = null;
			entryOffset.current = null;
			clearDrop();
			setDrag(null);
		};

		window.addEventListener("keydown", onKey, true);

		return () => window.removeEventListener("keydown", onKey, true);
	}, [draggingElement, clearDrop, hostFor]);

	const zoomOf = useCallback(() => view.get().zoom, [view]);

	const reportSelectedBoxes = useCallback((file: string, start: number, boxes: Box[]) => {
		selectedBoxes.current = { file, start, boxes };
	}, []);

	/** `null` unless the frame shows the current source: offsets of an older render point at the wrong elements */
	const elementsAt = async (frame: Frame, clientX: number, clientY: number) => {
		const host = hostFor(frame.file);
		const source = filesRef.current[frame.file];

		if (!host || source === undefined) return null;
		const point = toCanvas(clientX, clientY);
		const local = { x: point.x - frame.x, y: point.y - frame.y };
		const hit = await host.hitTest(local.x, local.y);
		const starts = hitStarts(hit, frame.file, source);

		return starts && hit ? { starts, boxes: hit.boxes ?? [], point: local } : null;
	};

	/** `keepSelected`: a right-click on one of several selected elements keeps them all, as in Figma */
	const pickElement = async (frame: Frame, clientX: number, clientY: number, keepSelected = false) => {
		const found = await elementsAt(frame, clientX, clientY);
		const start = found?.starts[0];

		const kept =
			keepSelected &&
			elements.length > 0 &&
			element?.file === frame.file &&
			[element, ...elements].some((selected) => selected.start === start);

		if (!kept) onSelectElement?.(frame.file, start === undefined ? null : { file: frame.file, start });

		return found;
	};

	const updateHover = (clientX: number, clientY: number, deep: boolean) => {
		const state = hovering.current;
		state.next = { clientX, clientY, deep };

		if (state.busy) return;
		state.busy = true;

		const run = async () => {
			while (state.next) {
				const { clientX: x, clientY: y, deep: meta } = state.next;
				state.next = null;
				const frame = frameAt(x, y);

				const eligible =
					frame &&
					onSelectElement &&
					!editingRef.current &&
					(meta || (selection.length === 1 && selection[0] === frame.file));

				const found = eligible ? await elementsAt(frame, x, y) : null;
				const box = found?.boxes[0];
				const next = found && box && frame ? { file: frame.file, start: found.starts[0]!, box } : null;
				setHover((current) => (sameHover(current, next) ? current : next));

				if (next) elementHover.set({ file: next.file, start: next.start, from: "canvas" });
				else elementHover.clear("canvas");
			}

			state.busy = false;
		};

		void run();
	};

	const clearHover = () => {
		hovering.current.next = null;
		setHover(null);
		elementHover.clear("canvas");
	};

	const onPointerDown = (event: React.PointerEvent) => {
		if (event.button !== 0 && event.button !== 1) return;

		// A press outside the frame being edited ends the edit, keeping the text
		if (editingRef.current) {
			hostFor(editingRef.current.file)?.endTextEdit(true);

			return;
		}

		event.currentTarget.setPointerCapture(event.pointerId);

		if (panning || event.button === 1) {
			event.preventDefault();
			setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: view.get() });

			return;
		}

		if (tool === "comment") {
			onPlaceComment?.(toCanvas(event.clientX, event.clientY));

			return;
		}

		const target = event.target instanceof Element ? event.target : null;
		const handle = target?.closest<HTMLElement>("[data-resize-handle]")?.dataset;
		const resizing = handle ? shown.find((frame) => frame.file === handle.file) : undefined;

		if (handle && resizing && isHandle(handle.resizeHandle)) {
			setDrag({
				kind: "resize",
				id: crypto.randomUUID(),
				file: resizing.file,
				handle: handle.resizeHandle,
				origin: { x: resizing.x, y: resizing.y, width: resizing.width, height: resizing.height },
				others: shown.filter((frame) => frame.file !== resizing.file),
				startX: event.clientX,
				startY: event.clientY,
				moved: false,
			});

			return;
		}

		const file = target?.closest<HTMLElement>("[data-frame-file]")?.dataset.frameFile;

		if (!file) {
			const start = toCanvas(event.clientX, event.clientY);
			const base = event.shiftKey ? selection : [];

			setDrag({
				kind: "marquee",
				start,
				current: start,
				base: selection,
				additive: event.shiftKey,
				moved: false,
				selection: base,
			});

			return;
		}

		const deep = event.metaKey || event.ctrlKey;
		const pressedFrame = shown.find((f) => f.file === file);

		// Figma's ⇧-click on layers. Without a selected element, ⇧-click still adds and removes screens
		if (event.shiftKey && onToggleElement && pressedFrame && element?.file === file && tool === "move") {
			void elementsAt(pressedFrame, event.clientX, event.clientY).then(
				(found) => found && onToggleElement({ file, start: found.starts[0]! }),
			);

			return;
		}

		if (onSelectElement && !event.shiftKey && (deep || (selection.length === 1 && selection[0] === file))) {
			if (!deep && startElementDrag(event, file)) return;

			// Inside the selected screen (or with ⌘ anywhere): a click picks an element, a drag still moves the screen
			if (deep && !(selection.length === 1 && selection[0] === file)) onSelectionChange([file]);
			startFrameDrag(event, [file], null, file);
		} else if (event.shiftKey) {
			const next = toggleInSelection(selection, file);
			onSelectionChange(next);

			if (next.includes(file)) startFrameDrag(event, next, null);
		} else if (selection.includes(file)) {
			startFrameDrag(event, selection, file);
		} else {
			onSelectionChange([file]);
			startFrameDrag(event, [file], null);
		}
	};

	const onPointerMove = (event: React.PointerEvent) => {
		if (!drag) {
			if (!panning && tool === "move" && onSelectElement)
				updateHover(event.clientX, event.clientY, event.metaKey || event.ctrlKey);
			else if (hover) clearHover();

			return;
		}

		if (hover) clearHover();

		if (drag.kind === "pan") {
			view.set({
				...drag.origin,
				x: drag.origin.x + event.clientX - drag.startX,
				y: drag.origin.y + event.clientY - drag.startY,
			});
			gesture();
		} else if (drag.kind === "element") {
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;

			if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

			if (!drag.moved) {
				if (!drag.selected) onSelectElement?.(drag.file, { file: drag.file, start: drag.start });
				movingElement.current = {
					file: drag.file,
					version: drag.version,
					dragged: drag.dragged,
					entry: drag.entry,
					box: drag.box,
				};
				setDrag({ ...drag, moved: true });
			}

			const { zoom } = view.get();

			// The ghost follows the pointer without a render
			if (ghostRef.current) ghostRef.current.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`;

			if (drag.entry) {
				entryOffset.current = { x: dx / zoom, y: dy / zoom };
				shiftEntries();
			}

			updateDrop(event.clientX, event.clientY);
		} else if (drag.kind === "frames") {
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;

			if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

			if (!drag.moved) setDrag({ ...drag, moved: true });
			const { zoom } = view.get();
			const pending = pendingMoves.current;
			const dragged = { ...drag.bounds, x: drag.bounds.x + dx / zoom, y: drag.bounds.y + dy / zoom };
			const snapped = snapMove(dragged, drag.others, SNAP_DISTANCE / zoom);

			pending.moves = drag.origins.map((origin) => ({
				file: origin.file,
				x: origin.x + snapped.x - drag.bounds.x,
				y: origin.y + snapped.y - drag.bounds.y,
			}));

			pending.guides = snapped.guides;

			// One render per frame; the project changes once, on release
			pending.request ||= requestAnimationFrame(() => {
				pending.request = 0;
				setMoving(pending.moves);
				setGuides(pending.guides);
			});
		} else if (drag.kind === "resize") {
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;

			if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

			if (!drag.moved) setDrag({ ...drag, moved: true });
			const { zoom } = view.get();
			const pending = pendingMoves.current;
			const options = { keepRatio: event.shiftKey, fromCenter: event.altKey };
			const rect = resizeRect(drag.origin, drag.handle, dx / zoom, dy / zoom, options);

			// Snapping one side would break the aspect ratio
			const snapped = options.keepRatio
				? { rect, guides: guidesFor(rect, drag.others) }
				: snapResize(rect, drag.handle, drag.others, SNAP_DISTANCE / zoom, options.fromCenter);

			pending.resized = snapped.rect;
			pending.guides = snapped.guides;

			pending.request ||= requestAnimationFrame(() => {
				pending.request = 0;
				setResized(pending.resized ? { file: drag.file, rect: pending.resized } : null);
				setGuides(pending.guides);
			});
		} else {
			const current = toCanvas(event.clientX, event.clientY);

			const moved =
				drag.moved ||
				Math.hypot(current.x - drag.start.x, current.y - drag.start.y) * view.get().zoom >= DRAG_THRESHOLD;

			if (!moved) return;
			cancelAnimationFrame(pendingMarquee.current);

			// One render per frame
			pendingMarquee.current = requestAnimationFrame(() => {
				const next = marqueeSelection(shown, rectFromPoints(drag.start, current), drag.base, drag.additive);
				setDrag((latest) =>
					latest?.kind === "marquee"
						? { ...latest, current, moved, selection: sameSelection(next, latest.selection) ? latest.selection : next }
						: latest,
				);
			});
		}
	};

	const endDrag = (event: React.PointerEvent) => {
		if (drag?.kind === "frames") {
			const pending = pendingMoves.current;
			cancelAnimationFrame(pending.request);
			const moves = pending.moves;
			pendingMoves.current = { moves: null, resized: null, guides: [], request: 0 };
			setGuides([]);

			if (drag.moved) {
				if (moves) onMoveFrames(moves, drag.id);
				onMoveEnd();
				setMoving(null);
			} else if (drag.pick) {
				const frame = shown.find((f) => f.file === drag.pick);

				if (frame) void pickElement(frame, event.clientX, event.clientY);
			} else if (drag.pressed && selection.length > 1) onSelectionChange([drag.pressed]);
		} else if (drag?.kind === "resize") {
			const pending = pendingMoves.current;
			cancelAnimationFrame(pending.request);
			const rect = pending.resized;
			pendingMoves.current = { moves: null, resized: null, guides: [], request: 0 };
			setGuides([]);

			if (drag.moved) {
				if (rect) onPatchFrame?.(drag.file, rect, `resize:${drag.id}`);
				onMoveEnd();
				setResized(null);
			}
		} else if (drag?.kind === "element") {
			const frame = shown.find((f) => f.file === drag.file);

			if (drag.moved) dropElement(drag, event.clientX, event.clientY);
			else if (frame) void pickElement(frame, event.clientX, event.clientY);
		} else if (drag?.kind === "marquee") {
			cancelAnimationFrame(pendingMarquee.current);

			const next = drag.moved
				? marqueeSelection(
						shown,
						rectFromPoints(drag.start, toCanvas(event.clientX, event.clientY)),
						drag.base,
						drag.additive,
					)
				: drag.selection;

			if (!sameSelection(next, selection)) onSelectionChange(next);
		}

		setDrag(null);
	};

	// Radix opens a context menu only from its trigger's event, and would also take it on the canvas
	// background and in comment fields: on a screen, re-dispatch it to a hidden trigger instead
	const onContextMenu = (event: React.MouseEvent) => {
		const target = event.target instanceof Element ? event.target : null;

		if (isTyping(target)) return;
		event.preventDefault();
		const file = target?.closest<HTMLElement>("[data-frame-file]")?.dataset.frameFile;

		if (panning || drag || editingRef.current) return;
		const { clientX, clientY } = event;
		const request = ++menuRequest.current;
		const frame = file ? shown.find((f) => f.file === file) : undefined;
		const inSelected = selection.length === 1 && selection[0] === file;

		// Where a click would pick an element (⌃-click is a right-click on macOS, so only ⌘ reaches in)
		if (frame && elementMenu && onSelectElement && tool === "move" && (inSelected || event.metaKey)) {
			void pickElement(frame, clientX, clientY, true).then((found) => {
				if (request !== menuRequest.current || (!found && !screenMenu)) return;
				setMenuOnElement(found !== null);
				setMenuFiles([frame.file]);
				openMenu(clientX, clientY);
			});

			return;
		}

		setMenuOnElement(false);

		if (file && screenMenu) {
			const next = contextSelection(selection, file);

			if (!sameSelection(next, selection)) onSelectionChange(next);
			setMenuFiles(next);
		} else if (!file && canvasMenu) {
			setMenuFiles(null);
			setMenuPoint(toCanvas(event.clientX, event.clientY));
		} else return;
		openMenu(clientX, clientY);
	};

	const openMenu = (clientX: number, clientY: number) =>
		menuTrigger.current?.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }),
		);

	const onDoubleClick = (event: React.MouseEvent) => {
		if (panning || tool !== "move" || editingRef.current) return;

		const label = event.target instanceof Element ? event.target.closest("[data-frame-label]") : null;
		const labelled = label?.closest<HTMLElement>("[data-frame-file]")?.dataset.frameFile;

		if (labelled && onPatchFrame) return startRename(labelled);

		if (!onSelectElement) return;
		const frame = frameAt(event.clientX, event.clientY);

		if (!frame) return;
		void pickElement(frame, event.clientX, event.clientY).then((found) => {
			if (found) editText({ file: frame.file, start: found.starts[0]! }, found.point);
		});
	};

	const shownSelection = drag?.kind === "marquee" ? drag.selection : selection;
	const selected = new Set(shownSelection);
	const selectionBounds = shownSelection.length > 1 ? boundsOf(selectedFrames(shown, shownSelection)) : null;
	const marquee = drag?.kind === "marquee" && drag.moved ? rectFromPoints(drag.start, drag.current) : null;
	const groups = groupLayouts(shown, drafts?.frames);
	const pickedFiles = new Set(groups.flatMap(({ group }) => (group.picked ? [group.picked] : [])));

	const variationOf = (file: string): Variation | undefined =>
		isAlternate(file) ? "alternate" : pickedFiles.has(file) ? "picked" : undefined;

	const single = shownSelection.length === 1 ? shown.find((frame) => frame.file === shownSelection[0]) : undefined;

	// Element handles take over once an element in the screen is selected
	const sizing =
		single &&
		onPatchFrame &&
		tool === "move" &&
		!panning &&
		!drafts &&
		!editing &&
		element?.file !== single.file &&
		(!drag || drag.kind === "resize")
			? single
			: undefined;

	return (
		<>
			<div
				ref={containerRef}
				className={cn(
					"relative h-full w-full touch-none overflow-hidden bg-muted/50 select-none",
					drag?.kind === "resize"
						? HANDLE_CURSOR[drag.handle]
						: panning || drag?.kind === "pan"
							? drag
								? "cursor-grabbing"
								: "cursor-grab"
							: tool === "comment"
								? "cursor-crosshair"
								: "cursor-default",
				)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onPointerLeave={hover ? clearHover : undefined}
				onDoubleClick={onDoubleClick}
				onContextMenu={onContextMenu}
				onAuxClick={(event) => event.preventDefault()}
				onDragEnter={onDragOver}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
			>
				<div ref={gridRef} aria-hidden className="pointer-events-none absolute" />
				{/* `--zoom` and `--unzoom` (set with the transform) counter-scale the chrome without re-rendering it */}
				<div ref={layerRef} className="absolute top-0 left-0 origin-top-left">
					{shown.map((frame) => {
						const writing = drafts?.writing[frame.file];

						return (
							<FrameView
								key={frame.file}
								frame={frame}
								files={rendered}
								selected={selected.has(frame.file)}
								dropTarget={dropFile === frame.file && dropPreview?.file !== frame.file}
								writing={writing}
								variation={variationOf(frame.file)}
								onPick={onPick ? pick : undefined}
								editing={editing?.file === frame.file}
								renaming={renaming === frame.file}
								onRename={endRename}
								failure={failures.get(frame.file)}
								onFix={onFixRender ? fixRender : undefined}
								live={
									visible.has(frame.file) ||
									editing?.file === frame.file ||
									hover?.file === frame.file ||
									dropFile === frame.file ||
									(!!writing && !writing.done)
								}
							/>
						);
					})}
					{drafts?.frames.map((frame) => (
						<FrameView
							key={frame.file}
							frame={frame}
							files={drafts.files}
							selected={false}
							writing={drafts.writing[frame.file]}
							variation={variationOf(frame.file)}
							draft
						/>
					))}
					<LinksLayer frames={shown} files={rendered} selected={element} />
					{hover && !(element && hover.file === element.file && hover.start === element.start) ? (
						<ElementOutline
							frame={shown.find((f) => f.file === hover.file)}
							boxes={[hover.box]}
							label={nameAt(rendered[hover.file], hover.start)}
							size
						/>
					) : null}
					{layerHover?.from === "layers" &&
					!(element && layerHover.file === element.file && layerHover.start === element.start) ? (
						<LayerHover
							hover={layerHover}
							frame={shown.find((f) => f.file === layerHover.file)}
							source={rendered[layerHover.file]}
							host={hostFor}
						/>
					) : null}
					{element ? (
						<SelectedElement
							key={element.file}
							element={element}
							frame={shown.find((f) => f.file === element.file)}
							source={rendered[element.file]}
							host={hostFor}
							zoom={zoomOf}
							onBoxes={reportSelectedBoxes}
							onEditClasses={
								editing || draggingElement || drafts || tool !== "move" || elements.length ? undefined : onEditClasses
							}
						/>
					) : null}
					{element && elements.length ? (
						<SelectedElements
							key={element.file}
							starts={[element.start, ...elements.map((extra) => extra.start)]}
							frame={shown.find((f) => f.file === element.file)}
							source={rendered[element.file]}
							host={hostFor}
						/>
					) : null}
					{drag?.kind === "element" && drag.moved ? (
						<ElementGhost ghostRef={ghostRef} box={drag.box} frame={shown.find((f) => f.file === drag.file)} />
					) : null}
					{sizing ? <FrameHandles frame={sizing} resizing={drag?.kind === "resize" && drag.moved} /> : null}
					{guides.map((guide) => (
						<GuideLine key={`${guide.axis}${guide.at}`} guide={guide} />
					))}
					{groups.map(({ group, bounds, name }) => (
						<GroupOutline key={group.base} group={group} bounds={bounds} name={name} onCompare={onCompare} />
					))}
					{selectionBounds ? (
						<div
							className="pointer-events-none absolute"
							style={{
								left: selectionBounds.x,
								top: selectionBounds.y,
								width: selectionBounds.width,
								height: selectionBounds.height,
								outline: "calc(1px * var(--unzoom)) solid color-mix(in oklab, var(--primary) 60%, transparent)",
								outlineOffset: "calc(8px * var(--unzoom))",
							}}
						/>
					) : null}
					{dropPreview ? (
						<DropOutline preview={dropPreview} frame={shown.find((f) => f.file === dropPreview.file)} />
					) : null}
					{overlay?.(shown)}
					{marquee ? (
						<div
							className="pointer-events-none absolute bg-primary/8"
							style={{
								left: marquee.x,
								top: marquee.y,
								width: marquee.width,
								height: marquee.height,
								outline: "calc(1px * var(--unzoom)) solid var(--primary)",
							}}
						/>
					) : null}
				</div>
				{/* WebKit sends drag events into iframes despite `pointer-events: none`, and a frame
				    would swallow the drop: while a component drags, this layer takes them all */}
				{draggingComponent && onDropItem ? <div className="absolute inset-0" /> : null}
				{children}
				<Minimap
					frames={shown}
					selected={selected}
					view={view}
					viewSize={viewSize}
					onNavigate={gesture}
					className="right-4 bottom-16"
				/>
			</div>
			{screenMenu || canvasMenu || elementMenu ? (
				<ContextMenu>
					<ContextMenuTrigger ref={menuTrigger} className="hidden" />
					{/* Releasing the right button that opened the menu must not pick the item that shifted under it */}
					<ContextMenuContent
						className="w-52"
						onPointerUpCapture={(event) => event.button === 2 && event.stopPropagation()}
						// Rename focuses the inspector's name field; focus coming back here would take it away
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						{menuOnElement ? elementMenu?.() : menuFiles ? screenMenu?.(menuFiles) : canvasMenu?.(menuPoint)}
					</ContextMenuContent>
				</ContextMenu>
			) : null}
		</>
	);
}

/** Memoized so drags of other frames don't re-render it */
const FrameView = memo(function FrameView({
	frame,
	files,
	selected,
	writing,
	variation,
	onPick,
	draft = false,
	dropTarget = false,
	editing = false,
	live = true,
	renaming = false,
	onRename,
	failure,
	onFix,
}: {
	frame: Frame;
	files: ProjectFiles;
	selected: boolean;
	writing?: WritingFile;
	variation?: Variation;
	onPick?: (file: string) => void;
	/** The label is an input; `onRename` gets the name, or `null` to cancel */
	renaming?: boolean;
	onRename?: (file: string, name: string | null) => void;
	/** The last render failed */
	failure?: FrameError;
	onFix?: (file: string) => void;
	/** A screen that doesn't exist yet: not selectable, shows its code until the file is complete */
	draft?: boolean;
	dropTarget?: boolean;
	editing?: boolean;
	/** `false` shows the screen's snapshot instead of mounting it */
	live?: boolean;
}) {
	const streaming = writing && !writing.done;

	return (
		<div
			data-frame-file={draft ? undefined : frame.file}
			className={cn("group/frame absolute", draft && "pointer-events-none")}
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			<div
				className={cn(
					"absolute bottom-full left-0 mb-1 flex origin-bottom-left items-center gap-1.5 text-xs font-medium whitespace-nowrap",
					selected ? "text-primary" : "text-muted-foreground",
				)}
				style={{ transform: "scale(var(--unzoom))", maxWidth: `calc(${frame.width}px * var(--zoom))` }}
			>
				{renaming && onRename ? (
					<input
						autoFocus
						defaultValue={frame.name}
						aria-label="Screen name"
						className="-my-0.5 h-5 rounded-sm bg-background px-1 font-medium text-foreground ring-1 ring-primary outline-none select-text"
						style={{ width: `${Math.max(frame.name.length, 8) + 2}ch` }}
						onFocus={(event) => event.currentTarget.select()}
						onPointerDown={(event) => event.stopPropagation()}
						onDoubleClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (event.key === "Enter") onRename(frame.file, event.currentTarget.value);
							else if (event.key === "Escape") onRename(frame.file, null);
						}}
						onBlur={(event) => onRename(frame.file, event.currentTarget.value)}
					/>
				) : (
					<span data-frame-label className="truncate">
						{frame.name}
					</span>
				)}
				{failure && !streaming && !draft ? (
					<span className="flex shrink-0 items-center gap-0.5 font-normal text-destructive" title={failure.message}>
						<TriangleAlert className="size-3" />
						Didn’t render
					</span>
				) : null}
				{failure && onFix && !streaming && !draft ? (
					<Button
						variant="ghost"
						size="xs"
						className="-my-0.5 h-5 shrink-0 px-1.5 text-foreground"
						title={failure.message}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={() => onFix(frame.file)}
					>
						Fix
					</Button>
				) : null}
				{variation === "picked" ? (
					<span className="flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground">
						<Check className="size-3" />
						Picked
					</span>
				) : null}
				{streaming ? (
					<span className="shrink-0 font-normal text-primary motion-safe:animate-pulse">Writing…</span>
				) : null}
				{variation === "alternate" && onPick && !draft ? (
					<Button
						variant="ghost"
						size="xs"
						className={cn(
							"-my-0.5 h-5 shrink-0 px-1.5 text-foreground",
							!selected &&
								"opacity-0 group-hover/frame:opacity-100 focus-visible:opacity-100 motion-safe:transition-opacity",
						)}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={() => onPick(frame.file)}
					>
						Pick
					</Button>
				) : null}
			</div>
			<div
				className={cn(
					"h-full w-full overflow-hidden bg-white",
					frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
				)}
				style={{
					boxShadow: selected
						? "0 0 0 calc(2px * var(--unzoom)) var(--primary), var(--frame-shadow, 0 10px 40px -12px rgb(0 0 0 / 0.25))"
						: "0 0 0 calc(1px * var(--unzoom)) color-mix(in oklab, var(--foreground) 10%, transparent), var(--frame-shadow, 0 10px 40px -12px rgb(0 0 0 / 0.2))",
				}}
			>
				{draft && !writing?.done ? (
					<StreamingCode text={writing?.text ?? ""} />
				) : (
					<ScreenFrame
						entry={frame.file}
						files={files}
						width={frame.width}
						height={frame.height}
						interactive={editing}
						live={live}
					/>
				)}
			</div>
			{selected ? null : (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover/frame:opacity-100",
						frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
					)}
					style={{
						boxShadow: "0 0 0 calc(1.5px * var(--unzoom)) color-mix(in oklab, var(--primary) 70%, transparent)",
					}}
				/>
			)}
			{dropTarget ? (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 bg-primary/5",
						frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
					)}
					style={{ boxShadow: "0 0 0 calc(2px * var(--unzoom)) var(--primary)" }}
				/>
			) : null}
		</div>
	);
});

const HANDLE_CURSOR: Record<Handle, string> = {
	n: "cursor-ns-resize",
	s: "cursor-ns-resize",
	e: "cursor-ew-resize",
	w: "cursor-ew-resize",
	ne: "cursor-nesw-resize",
	sw: "cursor-nesw-resize",
	nw: "cursor-nwse-resize",
	se: "cursor-nwse-resize",
};

const isHandle = (value: string | undefined): value is Handle => HANDLES.some((handle) => handle === value);

/** CSS lengths along one axis of the frame */
type HandleSpan = { start: string; length: string };

/** Along one axis: a side handle spans between the corners, a corner sits across the edge */
function handleSpan(side: number): HandleSpan {
	if (side === 0) return { start: "calc(5px * var(--unzoom))", length: "calc(100% - 10px * var(--unzoom))" };

	return {
		start: side === -1 ? "calc(-5px * var(--unzoom))" : "calc(100% - 5px * var(--unzoom))",
		length: "calc(10px * var(--unzoom))",
	};
}

/** Corner squares and side strips that resize the selected screen, as in Figma; the canvas runs the drag */
function FrameHandles({ frame, resizing }: { frame: Frame; resizing: boolean }) {
	return (
		<div
			className="pointer-events-none absolute"
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			{HANDLES.map((handle) => {
				const sides = handleSides(handle);
				const x = handleSpan(sides.x);
				const y = handleSpan(sides.y);

				return (
					<div
						key={handle}
						data-resize-handle={handle}
						data-file={frame.file}
						className={cn("pointer-events-auto absolute", HANDLE_CURSOR[handle])}
						style={{ left: x.start, width: x.length, top: y.start, height: y.length }}
					>
						{sides.x && sides.y ? (
							<span
								className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border-primary bg-background"
								style={{
									width: "calc(8px * var(--unzoom))",
									height: "calc(8px * var(--unzoom))",
									borderWidth: "calc(1px * var(--unzoom))",
								}}
							/>
						) : null}
					</div>
				);
			})}
			{resizing ? (
				<div
					className="absolute rounded-[4px] bg-primary px-1 font-sans text-[11px]/4 whitespace-nowrap text-primary-foreground tabular-nums"
					style={{
						left: "50%",
						top: "100%",
						transform: "translateX(-50%) scale(var(--unzoom)) translateY(6px)",
						transformOrigin: "top center",
					}}
				>
					{px(frame.width)} × {px(frame.height)}
				</div>
			) : null}
		</div>
	);
}

/** A smart guide; one screen pixel thick at any zoom */
function GuideLine({ guide }: { guide: Guide }) {
	const across = `calc(${guide.at}px - 0.5px * var(--unzoom))`;
	const thickness = "calc(1px * var(--unzoom))";
	const length = guide.to - guide.from;

	return (
		<div
			className="pointer-events-none absolute"
			style={
				guide.axis === "x"
					? { left: across, top: guide.from, width: thickness, height: length, background: GUIDE_COLOR }
					: { left: guide.from, top: across, width: length, height: thickness, background: GUIDE_COLOR }
			}
		/>
	);
}

const contains = (box: Box, point: Point) =>
	point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

/** Follows the pointer while the selected element is dragged; `ghostRef` gets the offset */
function ElementGhost({ ghostRef, box, frame }: { ghostRef: Ref<HTMLDivElement>; box: Box; frame: Frame | undefined }) {
	if (!frame) return null;

	return (
		<div
			ref={ghostRef}
			className="pointer-events-none absolute bg-primary/10"
			style={{
				left: frame.x + box.x,
				top: frame.y + box.y,
				width: box.width,
				height: box.height,
				outline: "calc(1px * var(--unzoom)) dashed var(--primary)",
			}}
		/>
	);
}

function clip(box: Box, frame: Frame): Box | null {
	const x = Math.max(0, box.x);
	const y = Math.max(0, box.y);
	const right = Math.min(frame.width, box.x + box.width);
	const bottom = Math.min(frame.height, box.y + box.height);

	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** `null` when the source has no element there */
function nameAt(source: string | undefined, start: number) {
	const node = source === undefined ? null : findElement(parseJsx(source), start);

	return node ? (node.name ?? "Fragment") : undefined;
}

/** Figma rounds to whole pixels unless the size has a fraction worth showing */
const px = (value: number) => String(Math.round(value * 10) / 10);

const sizeOf = (box: Box) => `${px(box.width)} × ${px(box.height)}`;

const PADDING_FILL = "color-mix(in oklab, var(--primary) 14%, transparent)";

/** Hatched like Chrome's gap overlay; stripes keep their screen width at any zoom */
const GAP_FILL =
	"repeating-linear-gradient(45deg, color-mix(in oklab, var(--primary) 45%, transparent) 0 calc(1px * var(--unzoom)), transparent 0 calc(5px * var(--unzoom)))";

/** `size` adds the first box's size: in the label for a hover, below the box for a selection */
function ElementOutline({
	frame,
	boxes,
	label,
	component = false,
	selected = false,
	size = false,
	spacing = null,
}: {
	frame: Frame | undefined;
	boxes: Box[];
	label?: string;
	component?: boolean;
	selected?: boolean;
	size?: boolean;
	spacing?: Spacing | null;
}) {
	if (!frame) return null;
	const visible = boxes.flatMap((box) => clip(box, frame) ?? []);

	if (!visible.length) return null;
	const color = component ? "var(--color-violet-500)" : "var(--primary)";
	const first = visible[0]!;
	const dimensions = size ? sizeOf(boxes.find((box) => clip(box, frame)) ?? first) : null;

	const filled = (boxes: Box[], fill: string) =>
		boxes.flatMap((box) => {
			const shown = clip(box, frame);

			return shown ? [{ box: shown, fill }] : [];
		});

	const fills = spacing ? [...filled(spacing.padding, PADDING_FILL), ...filled(spacing.gaps, GAP_FILL)] : [];

	return (
		<div
			className="pointer-events-none absolute"
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			{fills.map(({ box, fill }, i) => (
				<div
					key={`fill-${i}`}
					className="absolute"
					style={{ left: box.x, top: box.y, width: box.width, height: box.height, background: fill }}
				/>
			))}
			{visible.map((box, i) => (
				<div
					key={i}
					className="absolute"
					style={{
						left: box.x,
						top: box.y,
						width: box.width,
						height: box.height,
						outline: `calc(${selected ? 1.5 : 1}px * var(--unzoom)) solid ${selected ? color : `color-mix(in oklab, ${color} 70%, transparent)`}`,
					}}
				/>
			))}
			{label ? (
				<div
					className="absolute origin-bottom-left rounded-[4px] px-1 font-mono text-[11px]/4 whitespace-nowrap text-white"
					style={{
						left: first.x,
						top: first.y,
						transform: "translateY(-100%) scale(var(--unzoom)) translateY(-2px)",
						transformOrigin: "top left",
						background: color,
					}}
				>
					{label}
					{dimensions && !selected ? <span className="ml-1.5 font-sans opacity-80">{dimensions}</span> : null}
				</div>
			) : null}
			{dimensions && selected ? (
				<div
					className="absolute rounded-[4px] px-1 font-sans text-[11px]/4 whitespace-nowrap text-white tabular-nums"
					style={{
						left: first.x + first.width / 2,
						top: first.y + first.height,
						transform: "translateX(-50%) scale(var(--unzoom)) translateY(4px)",
						transformOrigin: "top center",
						background: color,
					}}
				>
					{dimensions}
				</div>
			) : null}
		</div>
	);
}

/** A row hovered in the layers: asks the frame where the element is, once per row */
function LayerHover({
	hover,
	frame,
	source,
	host,
}: {
	hover: ElementHover;
	frame: Frame | undefined;
	source: string | undefined;
	host: (file: string) => FrameHost | undefined;
}) {
	const version = source === undefined ? "" : sourceVersion(source);
	const key = `${hover.file}\n${hover.start}\n${version}`;
	const [found, setFound] = useState<{ key: string; boxes: Box[] } | null>(null);

	useEffect(() => {
		const target = host(hover.file);

		if (!target || !version) return;
		let current = true;
		void target.elementBoxes(hover.start, version).then((boxes) => current && setFound({ key, boxes: boxes ?? [] }));

		return () => {
			current = false;
		};
	}, [host, hover.file, hover.start, version, key]);

	if (found?.key !== key) return null;
	const node = source === undefined ? null : findElement(parseJsx(source), hover.start);

	return (
		<ElementOutline
			frame={frame}
			boxes={found.boxes}
			label={node?.name ?? "Fragment"}
			component={!!node && !node.intrinsic && node.name !== null}
			size
		/>
	);
}

const OUTLINE_LABEL = "absolute rounded-[4px] px-1 font-mono text-[11px]/4 whitespace-nowrap text-white";

/** Raises a label above its box, at any zoom */
const LABEL_ABOVE = "translateY(-100%) scale(var(--unzoom)) translateY(-2px)";

/** The container a drop goes into and where among its children, or a screen that can't take it */
function DropOutline({ preview, frame }: { preview: DropPreview; frame: Frame | undefined }) {
	if (!frame) return null;
	const { spot } = preview;

	if (!spot)
		return (
			<div
				className={cn(
					"pointer-events-none absolute bg-destructive/5",
					frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
				)}
				style={{
					left: frame.x,
					top: frame.y,
					width: frame.width,
					height: frame.height,
					boxShadow: "0 0 0 calc(2px * var(--unzoom)) var(--destructive)",
				}}
			>
				<div
					className={cn(OUTLINE_LABEL, "bg-destructive font-sans font-medium")}
					style={{ left: 0, top: 0, transform: LABEL_ABOVE, transformOrigin: "top left" }}
				>
					Can't drop here
				</div>
			</div>
		);
	const box = clip(spot.box, frame);
	// The items show the new order themselves
	const line = spot.from === null ? spot.line : null;
	const solid = !!line || spot.from !== null;
	const vertical = !!line && line.width < line.height;

	// A line has no thickness: clip it as if it had two pixels, centered
	const shownLine =
		line && clip(vertical ? { ...line, x: line.x - 1, width: 2 } : { ...line, y: line.y - 1, height: 2 }, frame);

	return (
		<div
			className="pointer-events-none absolute"
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			{box ? (
				<div
					className={cn("absolute", solid ? "bg-primary/5" : "bg-primary/15")}
					style={{
						left: box.x,
						top: box.y,
						width: box.width,
						height: box.height,
						outline: `calc(1.5px * var(--unzoom)) ${solid ? "solid" : "dashed"} var(--primary)`,
					}}
				>
					<div
						className={cn(OUTLINE_LABEL, "bg-primary")}
						style={{ left: 0, top: 0, transform: LABEL_ABOVE, transformOrigin: "top left" }}
					>
						{spot.name}
					</div>
				</div>
			) : null}
			{line && shownLine ? (
				<div
					className="absolute rounded-full bg-primary"
					style={
						vertical
							? {
									left: `calc(${line.x}px - 1px * var(--unzoom))`,
									top: shownLine.y,
									width: "calc(2px * var(--unzoom))",
									height: shownLine.height,
								}
							: {
									left: shownLine.x,
									top: `calc(${line.y}px - 1px * var(--unzoom))`,
									width: shownLine.width,
									height: "calc(2px * var(--unzoom))",
								}
					}
				/>
			) : null}
		</div>
	);
}

/** The last boxes stay up while a newer version renders, so edits don't flicker */
function SelectedElement({
	element,
	frame,
	source,
	host,
	zoom,
	onBoxes,
	onEditClasses,
}: {
	element: ElementRef;
	frame: Frame | undefined;
	source: string | undefined;
	host: (file: string) => FrameHost | undefined;
	zoom: () => number;
	onBoxes: (file: string, start: number, boxes: Box[]) => void;
	/** Shows the handles that write classes */
	onEditClasses?: (element: ElementRef, edit: (classes: string) => string) => void;
}) {
	const [boxes, setBoxes] = useState<Box[]>([]);
	const [spacing, setSpacing] = useState<Spacing | null>(null);
	const [layout, setLayout] = useState<ElementLayout | null>(null);
	const version = source === undefined ? "" : sourceVersion(source);
	useEffect(() => {
		const target = host(element.file);

		if (!target || !version) return;

		target.onBoxes = (update) => {
			setBoxes(update.boxes);
			setSpacing(update.spacing);
			setLayout(update.layout);
			onBoxes(element.file, update.start, update.boxes);
		};

		target.track(element.start, version);

		return () => {
			target.onBoxes = null;
			target.track(null, version);
		};
	}, [host, element.file, element.start, version, frame?.width, frame?.height, onBoxes]);
	const node = source === undefined ? null : findElement(parseJsx(source), element.start);

	if (!node || source === undefined) return null;
	const info = onEditClasses ? readClassName(source, element.start) : null;
	const first = boxes[0];
	const handles = onEditClasses && info?.editable && layout && first && frame ? { info, layout, first } : null;

	return (
		<>
			<ElementOutline
				frame={frame}
				boxes={boxes}
				label={node.name ?? "Fragment"}
				component={!node.intrinsic && node.name !== null}
				selected
				size={!handles}
				spacing={spacing}
			/>
			{handles && frame ? (
				<div
					className="pointer-events-none absolute"
					style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
				>
					<ElementHandles
						box={handles.first}
						layout={handles.layout}
						spacing={spacing}
						classes={handles.info.classes}
						zoom={zoom}
						onPreview={(style) => host(element.file)?.previewStyle(element.start, version, style)}
						onCommit={(edit) => onEditClasses?.(element, edit)}
					/>
				</div>
			) : null}
		</>
	);
}

/** The elements ⇧-click added, and a box around all of them as Figma draws it. Asks the frame once per version */
function SelectedElements({
	starts,
	frame,
	source,
	host,
}: {
	starts: number[];
	frame: Frame | undefined;
	source: string | undefined;
	host: (file: string) => FrameHost | undefined;
}) {
	const version = source === undefined ? "" : sourceVersion(source);
	const file = frame?.file;
	const startsKey = starts.join(",");
	// The last boxes stay up while a newer version renders, so edits don't flicker
	const [found, setFound] = useState<Box[][]>([]);

	useEffect(() => {
		const target = file ? host(file) : undefined;

		if (!target || !version) return;
		let current = true;

		void Promise.all(startsKey.split(",").map((start) => target.elementBoxes(Number(start), version))).then(
			(all) => current && setFound(all.map((boxes) => boxes ?? [])),
		);

		return () => {
			current = false;
		};
	}, [host, file, version, startsKey, frame?.width, frame?.height]);

	if (!frame) return null;
	const tree = source === undefined ? null : parseJsx(source);
	const bounds = boundsOf(found.flat());
	const union = bounds && clip(bounds, frame);

	return (
		<>
			{found.slice(1).map((boxes, i) => {
				const node = tree ? findElement(tree, starts[i + 1]!) : null;

				return (
					<ElementOutline
						key={starts[i + 1]}
						frame={frame}
						boxes={boxes}
						component={!!node && !node.intrinsic && node.name !== null}
						selected
					/>
				);
			})}
			{union ? (
				<div
					className="pointer-events-none absolute"
					style={{
						left: frame.x + union.x,
						top: frame.y + union.y,
						width: union.width,
						height: union.height,
						outline: "calc(1px * var(--unzoom)) solid color-mix(in oklab, var(--primary) 60%, transparent)",
						outlineOffset: "calc(4px * var(--unzoom))",
					}}
				/>
			) : null}
		</>
	);
}

function GroupOutline({
	group,
	bounds,
	name,
	onCompare,
}: {
	group: VariationGroup;
	bounds: Rect;
	name: string;
	onCompare?: (base: string) => void;
}) {
	const count = group.files.length;

	// Never wider than a third of the gap between frames, so neighbouring groups don't overlap when zoomed out
	const style: React.CSSProperties & Record<`--${string}`, string> = {
		"--pad": `min(calc(${GROUP_PADDING}px * var(--unzoom)), ${FRAME_GAP / 3}px)`,
		"--room": `calc(${GROUP_LABEL_ROOM}px * var(--unzoom))`,
		left: `calc(${bounds.x}px - var(--pad))`,
		top: `calc(${bounds.y}px - var(--pad) - var(--room))`,
		width: `calc(${bounds.width}px + var(--pad) * 2)`,
		height: `calc(${bounds.height}px + var(--pad) * 2 + var(--room))`,
		border: "calc(1px * var(--unzoom)) dashed color-mix(in oklab, var(--foreground) 22%, transparent)",
		borderRadius: "calc(20px * var(--unzoom))",
	};

	return (
		<div className="pointer-events-none absolute" style={style}>
			{/* As wide as the group on screen, so the label can drop "Compare" when it's narrow */}
			<div
				className="@container absolute bottom-full left-0 mb-1.5 origin-bottom-left"
				style={{ transform: "scale(var(--unzoom))", width: `calc((${bounds.width}px + var(--pad) * 2) * var(--zoom))` }}
			>
				<div
					className="pointer-events-auto flex w-fit max-w-full items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
					onPointerDown={(event) => event.stopPropagation()}
				>
					<span className="min-w-0 truncate pl-1">
						<span className="font-medium text-foreground/80">{name}</span> · {count}{" "}
						{count === 1 ? "variation" : "variations"}
					</span>
					{onCompare && count > 1 ? (
						<Button
							variant="ghost"
							size="xs"
							className="h-5 shrink-0 px-1.5"
							aria-label="Compare"
							title="Compare"
							onClick={() => onCompare(group.base)}
						>
							<Columns2 />
							<span className="hidden @min-[240px]:inline">Compare</span>
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function StreamingCode({ text }: { text: string }) {
	const lines = text.split("\n");

	return (
		<div className="flex h-full flex-col justify-end overflow-hidden bg-zinc-950 p-6 font-mono text-[13px]/5 text-zinc-300">
			<pre className="whitespace-pre-wrap break-all">{lines.slice(-60).join("\n")}</pre>
			<span className="mt-1 inline-block h-4 w-2 bg-zinc-300 motion-safe:animate-pulse" />
		</div>
	);
}
