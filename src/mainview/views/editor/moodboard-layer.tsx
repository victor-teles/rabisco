import { useRef } from "react";
import { ImageOff } from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAssetImage } from "@/hooks/use-asset-image";
import { HANDLE_CURSOR, HANDLES, handleSides, handleSpan, resizeRect, type Handle } from "@/lib/frame-resize";
import { cn } from "@/lib/utils";
import type { ViewportStore } from "@/lib/viewport";
import type { CanvasImage } from "../../../shared/types";

const DRAG_THRESHOLD = 3;

type Rect = { x: number; y: number; width: number; height: number };

type Drag = { id: string; dragId: string; startX: number; startY: number; moved: boolean; target: HTMLElement };

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

type MoodboardLayerProps = {
	images: CanvasImage[];
	viewport: ViewportStore;
	selectedId: string | null;
	interactive: boolean;
	numbers: Map<string, number>;
	onSelect: (id: string) => void;
	onMove: (id: string, dx: number, dy: number, dragId: string) => void;
	onMoveEnd: () => void;
	onResize: (id: string, rect: Rect) => void;
	onDelete: (id: string) => void;
};

export function MoodboardLayer(props: MoodboardLayerProps) {
	const { viewport, onMove, onMoveEnd, onResize } = props;
	const drag = useRef<Drag | null>(null);
	const resizing = useRef<Resize | null>(null);

	const offset = (event: React.PointerEvent, current: Drag) => {
		const { zoom } = viewport.get();

		return {
			dx: Math.round((event.clientX - current.startX) / zoom),
			dy: Math.round((event.clientY - current.startY) / zoom),
		};
	};

	const onPress = (event: React.PointerEvent, image: CanvasImage) => {
		drag.current = {
			id: image.id,
			dragId: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
			target: event.currentTarget instanceof HTMLElement ? event.currentTarget : document.body,
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
		current.target.style.translate = `${dx}px ${dy}px`;
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
		current.target.style.translate = "";
	};

	const onPressHandle = (event: React.PointerEvent, image: CanvasImage, handle: Handle) => {
		const target = event.currentTarget.closest<HTMLElement>("[data-moodboard-image]");

		if (!target) return;
		const origin = { x: image.x, y: image.y, width: image.width, height: image.height };
		resizing.current = {
			id: image.id,
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
			{ keepRatio: !event.shiftKey, fromCenter: event.altKey, maxSize: Infinity },
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
		<div data-moodboard-layer className="contents">
			{props.images.map((image) => (
				<MoodboardImage
					key={image.id}
					image={image}
					{...props}
					onPress={onPress}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPressHandle={onPressHandle}
					onResizeMove={onResizeMove}
					onResizeEnd={onResizeEnd}
				/>
			))}
		</div>
	);
}

function MoodboardImage({
	image,
	selectedId,
	interactive,
	numbers,
	onSelect,
	onDelete,
	onPress,
	onPointerMove,
	onPointerUp,
	onPressHandle,
	onResizeMove,
	onResizeEnd,
}: MoodboardLayerProps & {
	image: CanvasImage;
	onPress: (event: React.PointerEvent, image: CanvasImage) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
	onPressHandle: (event: React.PointerEvent, image: CanvasImage, handle: Handle) => void;
	onResizeMove: (event: React.PointerEvent) => void;
	onResizeEnd: (event: React.PointerEvent) => void;
}) {
	const { found, show } = useAssetImage(image.src);
	const selected = selectedId === image.id;
	const number = numbers.get(image.id);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={!interactive}>
				<div
					data-moodboard-image={image.id}
					aria-label={number ? `${image.name}, sent as image ${number}` : image.name}
					className={cn("absolute bg-muted", interactive ? "pointer-events-auto" : "pointer-events-none")}
					style={{
						left: image.x,
						top: image.y,
						width: image.width,
						height: image.height,
						boxShadow: selected
							? "0 0 0 calc(2px * var(--unzoom)) var(--primary)"
							: number
								? "0 0 0 calc(1.5px * var(--unzoom)) color-mix(in oklab, var(--primary) 60%, transparent)"
								: undefined,
					}}
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						event.stopPropagation();
						event.currentTarget.setPointerCapture(event.pointerId);
						onSelect(image.id);
						onPress(event, image);
					}}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
				>
					{found ? (
						<img ref={show} alt="" draggable={false} className="size-full object-cover select-none" />
					) : (
						<div className="grid size-full place-items-center text-muted-foreground">
							<ImageOff className="size-[calc(24px*var(--unzoom))]" aria-hidden="true" />
						</div>
					)}
					{number ? (
						<span
							className="pointer-events-none absolute top-0 left-0 origin-top-left rounded-full bg-primary px-1.5 text-[11px]/[18px] font-medium text-primary-foreground tabular-nums"
							style={{ transform: "scale(var(--unzoom)) translate(6px, 6px)" }}
						>
							Image {number}
						</span>
					) : null}
					{selected && interactive
						? HANDLES.map((handle) => {
								const sides = handleSides(handle);

								if (!sides.x || !sides.y) return null;
								const x = handleSpan(sides.x);
								const y = handleSpan(sides.y);

								return (
									<div
										key={handle}
										className={cn("absolute", HANDLE_CURSOR[handle])}
										style={{ left: x.start, width: x.length, top: y.start, height: y.length }}
										onPointerDown={(event) => {
											if (event.button !== 0) return;
											event.stopPropagation();
											event.currentTarget.setPointerCapture(event.pointerId);
											onPressHandle(event, image, handle);
										}}
										onPointerMove={onResizeMove}
										onPointerUp={onResizeEnd}
										onPointerCancel={onResizeEnd}
									>
										<span
											className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border-primary bg-background"
											style={{
												width: "calc(8px * var(--unzoom))",
												height: "calc(8px * var(--unzoom))",
												borderWidth: "calc(1px * var(--unzoom))",
											}}
										/>
									</div>
								);
							})
						: null}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem variant="destructive" onSelect={() => onDelete(image.id)}>
					Delete image
					<ContextMenuShortcut>⌫</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
