import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { boundsOf } from "@/lib/align";
import { centeredView, containsRect, minimapLayout, toCanvasPoint, visibleArea } from "@/lib/minimap";
import { cn } from "@/lib/utils";
import type { ViewportStore } from "@/lib/viewport";
import type { Frame } from "../../../shared/types";

/** In pixels */
const MAX_WIDTH = 176;

const MAX_HEIGHT = 112;

/** A few screens are easy to find without a map */
const MIN_FRAMES = 4;

type Size = { width: number; height: number };

/**
 * An overview of every screen and the part of the canvas in view; a click or a drag moves the view there.
 * Shows only when there are several screens and some of them are out of view.
 */
export function Minimap({
	frames,
	selected,
	view,
	viewSize,
	onNavigate,
	className,
}: {
	frames: Frame[];
	selected: ReadonlySet<string>;
	view: ViewportStore;
	/** The canvas size in pixels */
	viewSize: () => Size | null;
	/** After each move of the view */
	onNavigate: () => void;
	className?: string;
}) {
	const content = useMemo(() => boundsOf(frames), [frames]);
	const layout = useMemo(() => (content ? minimapLayout(content, MAX_WIDTH, MAX_HEIGHT) : null), [content]);
	const mapRef = useRef<HTMLDivElement>(null);
	const areaRef = useRef<HTMLDivElement>(null);

	// A boolean, so panning re-renders only when it flips
	const outOfView = useSyncExternalStore(view.subscribe, () => {
		const size = viewSize();

		return !!content && !!size && !containsRect(visibleArea(view.get(), size.width, size.height), content);
	});

	const shown = layout !== null && frames.length >= MIN_FRAMES && outOfView;

	// The view's outline follows pan and zoom without a render
	useEffect(() => {
		if (!shown) return;

		const paint = () => {
			const area = areaRef.current;
			const size = viewSize();

			if (!area || !size) return;
			const visible = visibleArea(view.get(), size.width, size.height);
			area.style.left = `${(visible.x - layout.bounds.x) * layout.scale}px`;
			area.style.top = `${(visible.y - layout.bounds.y) * layout.scale}px`;
			area.style.width = `${visible.width * layout.scale}px`;
			area.style.height = `${visible.height * layout.scale}px`;
		};

		paint();

		return view.subscribe(paint);
	}, [shown, layout, view, viewSize]);

	if (!shown) return null;

	const navigate = (event: React.PointerEvent) => {
		const map = mapRef.current?.getBoundingClientRect();
		const size = viewSize();

		if (!map || !size) return;
		const point = toCanvasPoint(layout, { x: event.clientX - map.left, y: event.clientY - map.top });
		view.set(centeredView(point, view.get().zoom, size.width, size.height));
		onNavigate();
	};

	// The canvas below must not start a marquee, a hover or a menu from here
	return (
		<div
			aria-hidden
			className={cn(
				"absolute cursor-pointer overflow-hidden rounded-xl border bg-popover p-1.5 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]",
				className,
			)}
			onPointerDown={(event) => {
				event.stopPropagation();

				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				navigate(event);
			}}
			onPointerMove={(event) => {
				event.stopPropagation();

				if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event);
			}}
			onDoubleClick={(event) => event.stopPropagation()}
			onContextMenu={(event) => {
				event.stopPropagation();
				event.preventDefault();
			}}
		>
			<div ref={mapRef} className="relative" style={{ width: layout.width, height: layout.height }}>
				{frames.map((frame) => (
					<div
						key={frame.file}
						className={cn("absolute rounded-[1px]", selected.has(frame.file) ? "bg-primary/60" : "bg-foreground/20")}
						style={{
							left: (frame.x - layout.bounds.x) * layout.scale,
							top: (frame.y - layout.bounds.y) * layout.scale,
							width: Math.max(1, frame.width * layout.scale),
							height: Math.max(1, frame.height * layout.scale),
						}}
					/>
				))}
				<div ref={areaRef} className="absolute rounded-[2px] border border-primary bg-primary/5" />
			</div>
		</div>
	);
}
