import {
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type Ref,
} from "react";
import { Check, Columns2 } from "lucide-react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { boundsOf, rectFromPoints, type Rect } from "@/lib/align";
import { COMPONENT_MIME, componentDrag, hitStarts } from "@/lib/component-drop";
import { isVoidElement, readChildrenText } from "@/lib/props";
import { hostOf, type FrameHost } from "@/lib/render/frame-host";
import { sourceVersion, type Box, type FrameHit } from "@/lib/render/protocol";
import { marqueeSelection, sameSelection, selectedFrames, toggleInSelection } from "@/lib/selection";
import type { GenerationDrafts, WritingFile } from "@/hooks/use-generation";
import { cn } from "@/lib/utils";
import { LinksLayer } from "./links-layer";
import { findElement, parseJsx } from "../../../shared/jsx";
import { screenNameFromPath } from "../../../shared/project";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { FRAME_GAP } from "../../../shared/project";
import { isAlternate, variationGroups, type VariationGroup } from "../../../shared/variations";

export type Tool = "move" | "hand" | "comment";

export type Viewport = { x: number; y: number; zoom: number };

export type CanvasHandle = {
	zoomBy: (factor: number) => void;
	fitTo: (rects: Rect[]) => void;
	resetZoom: () => void;
	/** Edits the text of a screen element in place (Enter on a selected element) */
	editText: (element: ElementRef) => void;
	/** A text edit is in progress: keys go to the frame */
	isEditingText: () => boolean;
	/** Ends the text edit in progress, keeping or dropping the new text */
	endTextEdit: (commit: boolean) => void;
	/** The innermost element of `file` at frame-local `point`, if the frame shows the current source */
	elementAt: (file: string, point: Point) => Promise<ElementRef | null>;
};

/** An element of a screen: its file and its start offset in the file's current source. */
export type ElementRef = { file: string; start: number };

export type FrameMove = { file: string; x: number; y: number };

const MIN_ZOOM = 0.05;

const MAX_ZOOM = 4;

const FIT_PADDING = 96;

/** Screen pixels the pointer travels before a press becomes a drag */
const DRAG_THRESHOLD = 3;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type CanvasProps = {
	frames: Frame[];
	files: ProjectFiles;
	/** A running generation: placeholder frames, finished files and files being written */
	drafts?: GenerationDrafts | null;
	selection: string[];
	onSelectionChange: (selection: string[]) => void;
	/** Called on every pointer move of a drag; `dragId` is stable for one drag */
	onMoveFrames: (moves: FrameMove[], dragId: string) => void;
	/** The drag that moved frames ended */
	onMoveEnd: () => void;
	tool: Tool;
	viewport: Viewport;
	onViewportChange: (viewport: Viewport) => void;
	handleRef?: Ref<CanvasHandle>;
	/** Opens compare mode for the variation group of `base` */
	onCompare?: (base: string) => void;
	/** Picks the alternate `file` of its variation group */
	onPick?: (file: string) => void;
	/**
	 * An item from the components panel was dropped: the frame under the pointer
	 * (`null` outside every frame) and the screen element there, if any.
	 */
	onDropItem?: (drop: { file: string | null; data: string; hit: FrameHit | null }) => void;
	/** The element selected inside a screen */
	element?: ElementRef | null;
	/**
	 * Selects an element of a screen (click on a selected screen, or ⌘-click),
	 * or clears it (`null`): `file` is the screen, which becomes the selection.
	 */
	onSelectElement?: (file: string, element: ElementRef | null) => void;
	/** In-place text editing ended with `text` for `element` */
	onEditText?: (element: ElementRef, text: string) => void;
	/** The element's text can't be edited in place (it holds more than text): edit it elsewhere */
	onEditTextElsewhere?: (element: ElementRef) => void;
	/** With the comment tool, a click places a comment pin at this canvas point */
	onPlaceComment?: (point: Point) => void;
	/** Rendered in canvas coordinates, above the frames (comment pins) */
	overlay?: React.ReactNode;
	children?: React.ReactNode;
};

/** How a frame relates to its variation group */
type Variation = "picked" | "alternate";

/** Canvas-space padding around a group's frames, in screen pixels (divided by zoom) */
const GROUP_PADDING = 16;

/** Extra room above a group's frames for their labels, in screen pixels */
const GROUP_LABEL_ROOM = 24;

/** A variation group with the canvas bounds of its frames, drafts included. */
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
			moved: boolean;
			/** Pressed an already-selected frame: a click without moving selects only it */
			pressed: string | null;
			/** A click without moving selects the element under the pointer in this screen */
			pick: string | null;
	  }
	| { kind: "marquee"; start: Point; current: Point; base: string[]; additive: boolean; moved: boolean };

/** The latest pointer position to hit-test for hover, while one is in flight. */
type HoverRequest = { clientX: number; clientY: number; deep: boolean };

/**
 * Infinite canvas: wheel pans, ⌘/ctrl + wheel (or pinch) zooms around the
 * cursor, space, the hand tool or the middle button drags the view. In move
 * mode, frames drag (the whole selection moves together) and empty space
 * draws a selection marquee.
 */
export function Canvas({
	frames,
	files,
	drafts,
	selection,
	onSelectionChange,
	onMoveFrames,
	onMoveEnd,
	tool,
	viewport,
	onViewportChange,
	handleRef,
	onCompare,
	onPick,
	onDropItem,
	element = null,
	onSelectElement,
	onEditText,
	onEditTextElsewhere,
	onPlaceComment,
	overlay,
	children,
}: CanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	const [spaceHeld, setSpaceHeld] = useState(false);
	const viewportRef = useRef(viewport);
	// Stable for the memoized frames, whatever the parent passes
	const pickRef = useRef(onPick);
	const pick = useCallback((file: string) => pickRef.current?.(file), []);
	/** The frame a dragged component would land on */
	const [dropFile, setDropFile] = useState<string | null>(null);
	const draggingComponent = useSyncExternalStore(componentDrag.subscribe, () => componentDrag.current() !== null);
	/** The element under the pointer, outlined on hover */
	const [hover, setHover] = useState<{ file: string; start: number; box: Box } | null>(null);
	const hovering = useRef<{ busy: boolean; next: HoverRequest | null }>({ busy: false, next: null });
	/** The screen whose element's text is being edited in place */
	const [editing, setEditing] = useState<ElementRef | null>(null);
	const editingRef = useRef(editing);
	const rendered = drafts?.files ?? files;
	const filesRef = useRef(rendered);
	const callbacks = useRef({ onEditText, onEditTextElsewhere });

	// Latest props and state for the callbacks and listeners below, updated before any event can reach them
	useLayoutEffect(() => {
		viewportRef.current = viewport;
		pickRef.current = onPick;
		editingRef.current = editing;
		filesRef.current = rendered;
		callbacks.current = { onEditText, onEditTextElsewhere };
	});

	const zoomAround = useCallback(
		(factor: number, clientX?: number, clientY?: number) => {
			const rect = containerRef.current?.getBoundingClientRect();

			if (!rect) return;
			const current = viewportRef.current;
			const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
			const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
			const zoom = clampZoom(current.zoom * factor);
			const ratio = zoom / current.zoom;
			onViewportChange({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
		},
		[onViewportChange],
	);

	const fitTo = useCallback(
		(targets: Rect[]) => {
			const rect = containerRef.current?.getBoundingClientRect();
			const bounds = boundsOf(targets);

			if (!rect || !bounds) return;

			const zoom = clampZoom(
				Math.min((rect.width - FIT_PADDING * 2) / bounds.width, (rect.height - FIT_PADDING * 2) / bounds.height, 1),
			);

			onViewportChange({
				zoom,
				x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
				y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
			});
		},
		[onViewportChange],
	);

	/** The host feeding the frame of `file`, found through its iframe. */
	const hostFor = useCallback(
		(file: string) =>
			hostOf(containerRef.current?.querySelector<HTMLIFrameElement>(`[data-frame-file="${CSS.escape(file)}"] iframe`)),
		[],
	);

	/**
	 * Edits an element's text in place, in the instance under frame-local
	 * `point` when given. Elements that hold more than text, or whose rendered
	 * DOM doesn't match their source text, go to `onEditTextElsewhere`.
	 */
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
			zoomBy: (factor) => zoomAround(factor),
			fitTo,
			resetZoom: () => zoomAround(1 / viewportRef.current.zoom),
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
		}),
		[zoomAround, fitTo, editText, hostFor],
	);

	// Non-passive wheel listener so we can stop the webview from scrolling/zooming
	useEffect(() => {
		const el = containerRef.current;

		if (!el) return;

		const onWheel = (event: WheelEvent) => {
			event.preventDefault();

			if (event.ctrlKey || event.metaKey) {
				zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
			} else {
				const current = viewportRef.current;
				onViewportChange({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
			}
		};

		el.addEventListener("wheel", onWheel, { passive: false });

		return () => el.removeEventListener("wheel", onWheel);
	}, [zoomAround, onViewportChange]);

	useEffect(() => {
		const isTyping = (target: EventTarget | null) =>
			target instanceof HTMLElement && (target.isContentEditable || /input|textarea/i.test(target.tagName));

		const down = (event: KeyboardEvent) => {
			if (event.code === "Space" && !isTyping(event.target)) {
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

		return {
			x: (clientX - rect.left - viewport.x) / viewport.zoom,
			y: (clientY - rect.top - viewport.y) / viewport.zoom,
		};
	};

	/** The topmost frame under a client point, if any. */
	const frameAt = (clientX: number, clientY: number) => {
		const point = toCanvas(clientX, clientY);

		const inside = (frame: Frame) =>
			point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height;

		// Later frames paint on top
		for (let i = frames.length - 1; i >= 0; i--) if (inside(frames[i]!)) return frames[i];

		return undefined;
	};

	// Components dragged from the panel. The frames ignore pointer input, so the canvas gets every drag event.
	const isComponentDrag = (event: React.DragEvent) =>
		!!onDropItem && (componentDrag.current() !== null || event.dataTransfer.types.includes(COMPONENT_MIME));

	// WebKit accepts a drop only when both dragenter and dragover are cancelled
	const onDragOver = (event: React.DragEvent) => {
		if (!isComponentDrag(event)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		const file = frameAt(event.clientX, event.clientY)?.file ?? null;

		if (file !== dropFile) setDropFile(file);
	};

	const onDragLeave = (event: React.DragEvent) => {
		const entered = event.relatedTarget instanceof Node ? event.relatedTarget : null;

		if (!containerRef.current?.contains(entered)) setDropFile(null);
	};

	const onDrop = (event: React.DragEvent) => {
		if (!isComponentDrag(event)) return;
		event.preventDefault();
		setDropFile(null);
		const data = componentDrag.current() ?? event.dataTransfer.getData(COMPONENT_MIME);
		componentDrag.end();
		const frame = frameAt(event.clientX, event.clientY);

		if (!frame) return onDropItem!({ file: null, data, hit: null });
		const point = toCanvas(event.clientX, event.clientY);
		const host = hostFor(frame.file);
		const hit = host ? host.hitTest(point.x - frame.x, point.y - frame.y) : Promise.resolve(null);
		void hit.then((found) => onDropItem!({ file: frame.file, data, hit: found }));
	};

	const startFrameDrag = (
		event: React.PointerEvent,
		dragged: string[],
		pressed: string | null,
		pick: string | null = null,
	) => {
		setDrag({
			kind: "frames",
			id: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			origins: selectedFrames(frames, dragged).map(({ file, x, y }) => ({ file, x, y })),
			moved: false,
			pressed,
			pick,
		});
	};

	/**
	 * The screen elements at a client point of `frame`, innermost first, when
	 * the frame shows the current source (offsets of an older render would
	 * point at the wrong elements).
	 */
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

	/** Selects the innermost element under a client point in `frame` (or clears the element). */
	const pickElement = async (frame: Frame, clientX: number, clientY: number) => {
		const found = await elementsAt(frame, clientX, clientY);
		onSelectElement?.(frame.file, found ? { file: frame.file, start: found.starts[0]! } : null);

		return found;
	};

	/** Hover outlines: elements of the selected screen, or of any screen while ⌘ is held. */
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
				setHover(found && box && frame ? { file: frame.file, start: found.starts[0]!, box } : null);
			}

			state.busy = false;
		};

		void run();
	};

	const clearHover = () => {
		hovering.current.next = null;
		setHover(null);
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
			setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: viewport });

			return;
		}

		if (tool === "comment") {
			onPlaceComment?.(toCanvas(event.clientX, event.clientY));

			return;
		}

		const target = event.target instanceof Element ? event.target : null;
		const file = target?.closest<HTMLElement>("[data-frame-file]")?.dataset.frameFile;

		if (!file) {
			if (!event.shiftKey) onSelectionChange([]);
			const start = toCanvas(event.clientX, event.clientY);
			setDrag({ kind: "marquee", start, current: start, base: selection, additive: event.shiftKey, moved: false });

			return;
		}

		const deep = event.metaKey || event.ctrlKey;

		if (onSelectElement && !event.shiftKey && (deep || (selection.length === 1 && selection[0] === file))) {
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
			onViewportChange({
				...drag.origin,
				x: drag.origin.x + event.clientX - drag.startX,
				y: drag.origin.y + event.clientY - drag.startY,
			});
		} else if (drag.kind === "frames") {
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;

			if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

			if (!drag.moved) setDrag({ ...drag, moved: true });
			onMoveFrames(
				drag.origins.map((origin) => ({
					file: origin.file,
					x: Math.round(origin.x + dx / viewport.zoom),
					y: Math.round(origin.y + dy / viewport.zoom),
				})),
				drag.id,
			);
		} else {
			const current = toCanvas(event.clientX, event.clientY);

			const moved =
				drag.moved || Math.hypot(current.x - drag.start.x, current.y - drag.start.y) * viewport.zoom >= DRAG_THRESHOLD;

			if (!moved) return;
			setDrag({ ...drag, current, moved });
			const next = marqueeSelection(frames, rectFromPoints(drag.start, current), drag.base, drag.additive);

			if (!sameSelection(next, selection)) onSelectionChange(next);
		}
	};

	const endDrag = (event: React.PointerEvent) => {
		if (drag?.kind === "frames") {
			if (drag.moved) onMoveEnd();
			else if (drag.pick) {
				const frame = frames.find((f) => f.file === drag.pick);

				if (frame) void pickElement(frame, event.clientX, event.clientY);
			} else if (drag.pressed && selection.length > 1) onSelectionChange([drag.pressed]);
		}

		setDrag(null);
	};

	/** Double-click: select the element under the pointer and edit its text in place. */
	const onDoubleClick = (event: React.MouseEvent) => {
		if (!onSelectElement || panning || tool !== "move" || editingRef.current) return;
		const frame = frameAt(event.clientX, event.clientY);

		if (!frame) return;
		void pickElement(frame, event.clientX, event.clientY).then((found) => {
			if (found) editText({ file: frame.file, start: found.starts[0]! }, found.point);
		});
	};

	const gridSize = 24 * viewport.zoom;
	const selected = new Set(selection);
	const selectionBounds = selection.length > 1 ? boundsOf(selectedFrames(frames, selection)) : null;
	const marquee = drag?.kind === "marquee" && drag.moved ? rectFromPoints(drag.start, drag.current) : null;
	const groups = groupLayouts(frames, drafts?.frames);
	const pickedFiles = new Set(groups.flatMap(({ group }) => (group.picked ? [group.picked] : [])));

	const variationOf = (file: string): Variation | undefined =>
		isAlternate(file) ? "alternate" : pickedFiles.has(file) ? "picked" : undefined;

	return (
		<div
			ref={containerRef}
			className={cn(
				"relative h-full w-full touch-none overflow-hidden bg-muted/50 select-none",
				panning || drag?.kind === "pan"
					? drag
						? "cursor-grabbing"
						: "cursor-grab"
					: tool === "comment"
						? "cursor-crosshair"
						: "cursor-default",
			)}
			style={{
				backgroundImage:
					viewport.zoom > 0.25
						? "radial-gradient(circle, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1px)"
						: undefined,
				backgroundSize: `${gridSize}px ${gridSize}px`,
				backgroundPosition: `${viewport.x}px ${viewport.y}px`,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onPointerLeave={hover ? clearHover : undefined}
			onDoubleClick={onDoubleClick}
			onAuxClick={(event) => event.preventDefault()}
			onDragEnter={onDragOver}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<div
				className="absolute top-0 left-0 origin-top-left"
				style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
			>
				{frames.map((frame) => (
					<FrameView
						key={frame.file}
						frame={frame}
						files={drafts?.files ?? files}
						selected={selected.has(frame.file)}
						dropTarget={dropFile === frame.file}
						zoom={viewport.zoom}
						writing={drafts?.writing[frame.file]}
						variation={variationOf(frame.file)}
						onPick={onPick ? pick : undefined}
						editing={editing?.file === frame.file}
					/>
				))}
				{drafts?.frames.map((frame) => (
					<FrameView
						key={frame.file}
						frame={frame}
						files={drafts.files}
						selected={false}
						zoom={viewport.zoom}
						writing={drafts.writing[frame.file]}
						variation={variationOf(frame.file)}
						draft
					/>
				))}
				<LinksLayer frames={frames} files={rendered} zoom={viewport.zoom} selected={element} />
				{hover && !(element && hover.file === element.file && hover.start === element.start) ? (
					<ElementOutline frame={frames.find((f) => f.file === hover.file)} boxes={[hover.box]} zoom={viewport.zoom} />
				) : null}
				{element ? (
					<SelectedElement
						key={element.file}
						element={element}
						frame={frames.find((f) => f.file === element.file)}
						source={rendered[element.file]}
						host={hostFor}
						zoom={viewport.zoom}
					/>
				) : null}
				{groups.map(({ group, bounds, name }) => (
					<GroupOutline
						key={group.base}
						group={group}
						bounds={bounds}
						name={name}
						zoom={viewport.zoom}
						onCompare={onCompare}
					/>
				))}
				{selectionBounds ? (
					<div
						className="pointer-events-none absolute"
						style={{
							left: selectionBounds.x,
							top: selectionBounds.y,
							width: selectionBounds.width,
							height: selectionBounds.height,
							outline: `${1 / viewport.zoom}px solid color-mix(in oklab, var(--primary) 60%, transparent)`,
							outlineOffset: 8 / viewport.zoom,
						}}
					/>
				) : null}
				{overlay}
				{marquee ? (
					<div
						className="pointer-events-none absolute bg-primary/8"
						style={{
							left: marquee.x,
							top: marquee.y,
							width: marquee.width,
							height: marquee.height,
							outline: `${1 / viewport.zoom}px solid var(--primary)`,
						}}
					/>
				) : null}
			</div>
			{/* WebKit sends drag events into iframes despite `pointer-events: none`, and a frame
			    would swallow the drop: while a component drags, this layer takes them all */}
			{draggingComponent && onDropItem ? <div className="absolute inset-0" /> : null}
			{children}
		</div>
	);
}

/** One frame: its label and the sandboxed screen. Memoized so drags of other frames don't re-render it. */
const FrameView = memo(function FrameView({
	frame,
	files,
	selected,
	zoom,
	writing,
	variation,
	onPick,
	draft = false,
	dropTarget = false,
	editing = false,
}: {
	frame: Frame;
	files: ProjectFiles;
	selected: boolean;
	zoom: number;
	/** The generation is writing this file */
	writing?: WritingFile;
	variation?: Variation;
	onPick?: (file: string) => void;
	/** A screen that doesn't exist yet: not selectable, shows its code until the file is complete */
	draft?: boolean;
	/** A component dragged from the panel would land here */
	dropTarget?: boolean;
	/** An element's text is being edited in place: the frame takes pointer input */
	editing?: boolean;
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
				style={{ transform: `scale(${1 / zoom})`, maxWidth: frame.width * zoom }}
			>
				<span className="truncate">{frame.name}</span>
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
						? `0 0 0 ${2 / zoom}px var(--primary), 0 10px 40px -12px rgb(0 0 0 / 0.25)`
						: `0 0 0 ${1 / zoom}px color-mix(in oklab, var(--foreground) 10%, transparent), 0 10px 40px -12px rgb(0 0 0 / 0.2)`,
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
					/>
				)}
			</div>
			{selected ? null : (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover/frame:opacity-100",
						frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
					)}
					style={{ boxShadow: `0 0 0 ${1.5 / zoom}px color-mix(in oklab, var(--primary) 70%, transparent)` }}
				/>
			)}
			{dropTarget ? (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 bg-primary/5",
						frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
					)}
					style={{ boxShadow: `0 0 0 ${2 / zoom}px var(--primary)` }}
				/>
			) : null}
		</div>
	);
});

/** `box` clipped to the frame's bounds, in frame coordinates; `null` when nothing is left. */
function clip(box: Box, frame: Frame): Box | null {
	const x = Math.max(0, box.x);
	const y = Math.max(0, box.y);
	const right = Math.min(frame.width, box.x + box.width);
	const bottom = Math.min(frame.height, box.y + box.height);

	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Outlines of a screen element's boxes, over its frame. Hover is thin; a selection is solid and labelled. */
function ElementOutline({
	frame,
	boxes,
	zoom,
	label,
	component = false,
	selected = false,
}: {
	frame: Frame | undefined;
	boxes: Box[];
	zoom: number;
	label?: string;
	/** A component usage: drawn in the component color */
	component?: boolean;
	selected?: boolean;
}) {
	if (!frame) return null;
	const visible = boxes.flatMap((box) => clip(box, frame) ?? []);

	if (!visible.length) return null;
	const color = component ? "var(--color-violet-500)" : "var(--primary)";
	const first = visible[0]!;

	return (
		<div
			className="pointer-events-none absolute"
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			{visible.map((box, i) => (
				<div
					key={i}
					className="absolute"
					style={{
						left: box.x,
						top: box.y,
						width: box.width,
						height: box.height,
						outline: `${(selected ? 1.5 : 1) / zoom}px solid ${selected ? color : `color-mix(in oklab, ${color} 70%, transparent)`}`,
					}}
				/>
			))}
			{label ? (
				<div
					className="absolute origin-bottom-left rounded-[4px] px-1 font-mono text-[11px]/4 whitespace-nowrap text-white"
					style={{
						left: first.x,
						top: first.y,
						transform: `translateY(-100%) scale(${1 / zoom}) translateY(-2px)`,
						transformOrigin: "top left",
						background: color,
					}}
				>
					{label}
				</div>
			) : null}
		</div>
	);
}

/**
 * The selected element's outline. The frame reports its boxes for the source
 * version the canvas shows, and again whenever the layout changes; the last
 * boxes stay up while a newer version renders, so edits don't flicker.
 */
function SelectedElement({
	element,
	frame,
	source,
	host,
	zoom,
}: {
	element: ElementRef;
	frame: Frame | undefined;
	source: string | undefined;
	host: (file: string) => FrameHost | undefined;
	zoom: number;
}) {
	const [boxes, setBoxes] = useState<Box[]>([]);
	const version = source === undefined ? "" : sourceVersion(source);
	useEffect(() => {
		const target = host(element.file);

		if (!target || !version) return;
		target.onBoxes = (update) => setBoxes(update.boxes);
		target.track(element.start, version);

		return () => {
			target.onBoxes = null;
			target.track(null, version);
		};
	}, [host, element.file, element.start, version, frame?.width, frame?.height]);
	const node = source === undefined ? null : findElement(parseJsx(source), element.start);

	if (!node) return null;

	return (
		<ElementOutline
			frame={frame}
			boxes={boxes}
			zoom={zoom}
			label={node.name ?? "Fragment"}
			component={!node.intrinsic && node.name !== null}
			selected
		/>
	);
}

/**
 * A quiet dashed outline around a variation group's frames, with a counter-scaled
 * label chip above it. Only the chip takes pointer input.
 */
function GroupOutline({
	group,
	bounds,
	name,
	zoom,
	onCompare,
}: {
	group: VariationGroup;
	bounds: Rect;
	name: string;
	zoom: number;
	onCompare?: (base: string) => void;
}) {
	// Never wider than a third of the gap between frames, so neighbouring groups don't overlap when zoomed out
	const pad = Math.min(GROUP_PADDING / zoom, FRAME_GAP / 3);
	const roomy = bounds.width * zoom >= 240;
	const top = pad + GROUP_LABEL_ROOM / zoom;
	const count = group.files.length;

	return (
		<div
			className="pointer-events-none absolute"
			style={{
				left: bounds.x - pad,
				top: bounds.y - top,
				width: bounds.width + pad * 2,
				height: bounds.height + top + pad,
				border: `${1 / zoom}px dashed color-mix(in oklab, var(--foreground) 22%, transparent)`,
				borderRadius: 20 / zoom,
			}}
		>
			<div
				className="pointer-events-auto absolute bottom-full left-0 mb-1.5 flex origin-bottom-left items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
				style={{ transform: `scale(${1 / zoom})`, maxWidth: (bounds.width + pad * 2) * zoom }}
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
						{roomy ? "Compare" : null}
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** The tail of a file as it streams in, shown in a frame before the screen can render. */
function StreamingCode({ text }: { text: string }) {
	const lines = text.split("\n");

	return (
		<div className="flex h-full flex-col justify-end overflow-hidden bg-zinc-950 p-6 font-mono text-[13px]/5 text-zinc-300">
			<pre className="whitespace-pre-wrap break-all">{lines.slice(-60).join("\n")}</pre>
			<span className="mt-1 inline-block h-4 w-2 bg-zinc-300 motion-safe:animate-pulse" />
		</div>
	);
}
