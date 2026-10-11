import { useRef, useState } from "react";
import { Check } from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HANDLE_CURSOR, HANDLES, handleSides, handleSpan, resizeRect, type Handle } from "@/lib/frame-resize";
import { cn } from "@/lib/utils";
import type { ViewportStore } from "@/lib/viewport";
import { MIN_SECTION_SIZE, membersOf, SECTION_COLORS } from "../../../shared/sections";
import type { CanvasSection, Frame, SectionColor } from "../../../shared/types";

const DRAG_THRESHOLD = 3;

const DEFAULT_SIZE = { width: 1200, height: 900 };

export const SECTION_COLOR: Record<SectionColor, string> = {
	gray: "var(--muted-foreground)",
	red: "var(--color-red-500)",
	orange: "var(--color-orange-500)",
	yellow: "var(--color-yellow-500)",
	green: "var(--color-green-500)",
	blue: "var(--color-blue-500)",
	purple: "var(--color-purple-500)",
	pink: "var(--color-pink-500)",
};

const COLOR_NAMES: Record<SectionColor, string> = {
	gray: "Gray",
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	blue: "Blue",
	purple: "Purple",
	pink: "Pink",
};

const tint = (color: SectionColor, percent: number) =>
	`color-mix(in oklab, ${SECTION_COLOR[color]} ${percent}%, transparent)`;

type Drag = { id: string; dragId: string; startX: number; startY: number; moved: boolean; targets: HTMLElement[] };

type Rect = { x: number; y: number; width: number; height: number };

type Resize = {
	id: string;
	handle: Handle;
	startX: number;
	startY: number;
	origin: Rect;
	rect: Rect;
	target: HTMLElement;
};

const place = (target: HTMLElement, rect: Rect) => {
	target.style.left = `${rect.x}px`;
	target.style.top = `${rect.y}px`;
	target.style.width = `${rect.width}px`;
	target.style.height = `${rect.height}px`;
};

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

type SectionsLayerProps = {
	sections: CanvasSection[];
	frames: Frame[];
	viewport: ViewportStore;
	selectedId: string | null;
	renaming: string | null;
	interactive: boolean;
	onSelect: (id: string) => void;
	onMove: (id: string, dx: number, dy: number, dragId: string) => void;
	onMoveEnd: () => void;
	onResize: (id: string, rect: Rect) => void;
	onStartRename: (id: string) => void;
	onRename: (id: string, name: string | null) => void;
	onRecolor: (id: string, color: SectionColor) => void;
	onDelete: (id: string) => void;
	onSelectScreens: (files: string[]) => void;
};

export function SectionsLayer(props: SectionsLayerProps) {
	const { sections, frames, viewport, onMove, onMoveEnd, onResize } = props;
	const drag = useRef<Drag | null>(null);
	const resizing = useRef<Resize | null>(null);

	const translate = (targets: HTMLElement[], dx: number, dy: number) => {
		for (const target of targets) target.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
	};

	const start = (event: React.PointerEvent, section: CanvasSection) => {
		const layer = event.currentTarget.closest<HTMLElement>("[data-sections-layer]")?.parentElement;

		if (!layer) return;
		const members = membersOf(section, sections, frames);

		const targets = [
			...members.frames.map((file) => layer.querySelector<HTMLElement>(`[data-frame-file="${CSS.escape(file)}"]`)),
			...[section.id, ...members.sections].map((id) =>
				layer.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`),
			),
		].flatMap((target) => (target ? [target] : []));

		drag.current = {
			id: section.id,
			dragId: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
			targets,
		};
	};

	const offset = (event: React.PointerEvent, current: Drag) => {
		const { zoom } = viewport.get();

		return {
			dx: Math.round((event.clientX - current.startX) / zoom),
			dy: Math.round((event.clientY - current.startY) / zoom),
		};
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const current = drag.current;

		if (!current) return;
		event.stopPropagation();

		if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD)
			return;
		current.moved = true;
		const { dx, dy } = offset(event, current);
		translate(current.targets, dx, dy);
	};

	const onPointerUp = (event: React.PointerEvent) => {
		const current = drag.current;

		if (!current) return;
		event.stopPropagation();
		drag.current = null;

		if (!current.moved) return;
		const { dx, dy } = offset(event, current);
		onMove(current.id, dx, dy, current.dragId);
		onMoveEnd();
		translate(current.targets, 0, 0);
	};

	const startResize = (event: React.PointerEvent, section: CanvasSection, handle: Handle) => {
		const target = event.currentTarget.closest<HTMLElement>("[data-section-id]");

		if (!target) return;
		const origin = { x: section.x, y: section.y, width: section.width, height: section.height };

		resizing.current = {
			id: section.id,
			handle,
			startX: event.clientX,
			startY: event.clientY,
			origin,
			rect: origin,
			target,
		};
	};

	const onResizeMove = (event: React.PointerEvent) => {
		const current = resizing.current;

		if (!current) return;
		event.stopPropagation();
		const { zoom } = viewport.get();

		current.rect = resizeRect(
			current.origin,
			current.handle,
			(event.clientX - current.startX) / zoom,
			(event.clientY - current.startY) / zoom,
			{ keepRatio: event.shiftKey, fromCenter: event.altKey, maxSize: Infinity },
		);
		place(current.target, current.rect);
	};

	const onResizeEnd = (event: React.PointerEvent) => {
		const current = resizing.current;

		if (!current) return;
		event.stopPropagation();
		resizing.current = null;
		place(current.target, current.origin);

		if (!sameRect(current.rect, current.origin)) onResize(current.id, current.rect);
	};

	return (
		<div data-sections-layer className="contents">
			{sections.map((section) => (
				<SectionView
					key={section.id}
					section={section}
					{...props}
					onPressLabel={start}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPressHandle={startResize}
					onResizeMove={onResizeMove}
					onResizeEnd={onResizeEnd}
				/>
			))}
		</div>
	);
}

function SectionView({
	section,
	frames,
	sections,
	selectedId,
	renaming,
	interactive,
	onSelect,
	onStartRename,
	onRename,
	onRecolor,
	onDelete,
	onSelectScreens,
	onPressLabel,
	onPointerMove,
	onPointerUp,
	onPressHandle,
	onResizeMove,
	onResizeEnd,
}: SectionsLayerProps & {
	section: CanvasSection;
	onPressLabel: (event: React.PointerEvent, section: CanvasSection) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
	onPressHandle: (event: React.PointerEvent, section: CanvasSection, handle: Handle) => void;
	onResizeMove: (event: React.PointerEvent) => void;
	onResizeEnd: (event: React.PointerEvent) => void;
}) {
	const selected = selectedId === section.id;

	return (
		<div
			data-section-id={section.id}
			className="pointer-events-none absolute rounded-[calc(12px*var(--unzoom))]"
			style={{
				left: section.x,
				top: section.y,
				width: section.width,
				height: section.height,
				background: tint(section.color, 6),
				boxShadow: selected
					? "0 0 0 calc(2px * var(--unzoom)) var(--primary)"
					: `0 0 0 calc(1px * var(--unzoom)) ${tint(section.color, 45)}`,
			}}
		>
			{selected && interactive
				? HANDLES.map((handle) => {
						const sides = handleSides(handle);
						const x = handleSpan(sides.x);
						const y = handleSpan(sides.y);

						return (
							<div
								key={handle}
								data-section-handle={handle}
								className={cn("pointer-events-auto absolute", HANDLE_CURSOR[handle])}
								style={{ left: x.start, width: x.length, top: y.start, height: y.length }}
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									event.stopPropagation();
									event.currentTarget.setPointerCapture(event.pointerId);
									onPressHandle(event, section, handle);
								}}
								onPointerMove={onResizeMove}
								onPointerUp={onResizeEnd}
								onPointerCancel={onResizeEnd}
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
					})
				: null}
			<div
				className="absolute top-0 left-0 flex origin-top-left"
				style={{
					transform: "scale(var(--unzoom)) translate(8px, 8px)",
					maxWidth: `calc(${section.width}px * var(--zoom) - 16px)`,
				}}
			>
				{renaming === section.id ? (
					<input
						autoFocus
						defaultValue={section.name}
						aria-label="Section name"
						className="pointer-events-auto h-6 rounded-md bg-background px-1.5 text-xs font-medium text-foreground ring-1 ring-primary outline-none select-text"
						style={{ width: `${Math.max(section.name.length, 8) + 3}ch` }}
						onFocus={(event) => event.currentTarget.select()}
						onPointerDown={(event) => event.stopPropagation()}
						onDoubleClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (event.key === "Enter") onRename(section.id, event.currentTarget.value);
							else if (event.key === "Escape") onRename(section.id, null);
						}}
						onBlur={(event) => onRename(section.id, event.currentTarget.value)}
					/>
				) : (
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<button
								type="button"
								data-section-label
								className={cn(
									"h-6 truncate rounded-md px-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
									interactive ? "pointer-events-auto cursor-default" : "pointer-events-none",
								)}
								style={{ background: selected ? tint(section.color, 30) : tint(section.color, 18) }}
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									event.stopPropagation();
									event.currentTarget.setPointerCapture(event.pointerId);
									onSelect(section.id);
									onPressLabel(event, section);
								}}
								onPointerMove={onPointerMove}
								onPointerUp={onPointerUp}
								onPointerCancel={onPointerUp}
								onDoubleClick={(event) => {
									event.stopPropagation();
									onStartRename(section.id);
								}}
								onContextMenu={(event) => {
									event.stopPropagation();
									onSelect(section.id);
								}}
							>
								{section.name}
							</button>
						</ContextMenuTrigger>
						<ContextMenuContent className="w-52" onCloseAutoFocus={(event) => event.preventDefault()}>
							<ContextMenuItem onSelect={() => onStartRename(section.id)}>
								Rename
								<ContextMenuShortcut>⌘R</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuSub>
								<ContextMenuSubTrigger>Color</ContextMenuSubTrigger>
								<ContextMenuSubContent>
									{SECTION_COLORS.map((color) => (
										<ContextMenuItem key={color} onSelect={() => onRecolor(section.id, color)}>
											<span className="size-3 rounded-full" style={{ background: SECTION_COLOR[color] }} />
											{COLOR_NAMES[color]}
											{color === section.color ? <Check className="ml-auto" /> : null}
										</ContextMenuItem>
									))}
								</ContextMenuSubContent>
							</ContextMenuSub>
							<ContextMenuItem onSelect={() => onSelectScreens(membersOf(section, sections, frames).frames)}>
								Select screens
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem variant="destructive" onSelect={() => onDelete(section.id)}>
								Delete section
								<ContextMenuShortcut>⌫</ContextMenuShortcut>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				)}
			</div>
		</div>
	);
}

type Point = { x: number; y: number };

export function SectionDraw({
	viewport,
	onDraw,
	onCancel,
}: {
	viewport: ViewportStore;
	onDraw: (rect: { x: number; y: number; width: number; height: number }) => void;
	onCancel: () => void;
}) {
	const [box, setBox] = useState<{ start: Point; current: Point } | null>(null);

	const local = (event: React.PointerEvent): Point => {
		const rect = event.currentTarget.getBoundingClientRect();

		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	const toCanvas = (point: Point): Point => {
		const { x, y, zoom } = viewport.get();

		return { x: (point.x - x) / zoom, y: (point.y - y) / zoom };
	};

	const finish = (event: React.PointerEvent) => {
		if (!box) return;
		setBox(null);
		const end = local(event);
		const a = toCanvas(box.start);
		const b = toCanvas(end);
		const width = Math.abs(b.x - a.x);
		const height = Math.abs(b.y - a.y);

		if (Math.hypot(end.x - box.start.x, end.y - box.start.y) < DRAG_THRESHOLD)
			return onDraw({ x: Math.round(a.x), y: Math.round(a.y), ...DEFAULT_SIZE });

		onDraw({
			x: Math.round(Math.min(a.x, b.x)),
			y: Math.round(Math.min(a.y, b.y)),
			width: Math.round(Math.max(width, MIN_SECTION_SIZE)),
			height: Math.round(Math.max(height, MIN_SECTION_SIZE)),
		});
	};

	return (
		<div
			className="absolute inset-0 cursor-crosshair"
			onPointerDown={(event) => {
				if (event.button !== 0) return onCancel();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				const point = local(event);
				setBox({ start: point, current: point });
			}}
			onPointerMove={(event) => box && setBox({ ...box, current: local(event) })}
			onPointerUp={finish}
			onPointerCancel={() => setBox(null)}
			onContextMenu={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
			}}
		>
			{box ? (
				<div
					className="pointer-events-none absolute rounded-md border border-primary bg-primary/5"
					style={{
						left: Math.min(box.start.x, box.current.x),
						top: Math.min(box.start.y, box.current.y),
						width: Math.abs(box.current.x - box.start.x),
						height: Math.abs(box.current.y - box.start.y),
					}}
				/>
			) : null}
		</div>
	);
}
