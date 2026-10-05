import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Maximize, Minus, Plus, X } from "lucide-react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { screenNameFromPath } from "../../../shared/project";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { altNumber, type VariationGroup } from "../../../shared/variations";
import { isTyping } from "./shortcuts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
/** Screen pixels around and between the columns */
const PADDING = 48;
const GAP = 40;
/** A runaway screen (height that follows the viewport) stops growing here, in frame heights */
const MAX_HEIGHT_RATIO = 8;
/** Used when a file of the group has no frame, e.g. one still being generated */
const FALLBACK_SIZE = { width: 390, height: 844 };

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Column = { file: string; label: string; picked: boolean; width: number; height: number; radius: number };

/** The columns of `group`: one per file, sized like its frame on the canvas. */
function columnsOf(group: VariationGroup, frames: Frame[]): Column[] {
	const byFile = new Map(frames.map((frame) => [frame.file, frame]));
	const sibling = group.files.map((file) => byFile.get(file)).find(Boolean);
	return group.files.map((file) => {
		const frame = byFile.get(file) ?? sibling;
		const size = frame ?? FALLBACK_SIZE;
		const picked = file === group.picked;
		return {
			file,
			label: picked ? "Picked" : `Alt ${altNumber(file) ?? ""}`.trim(),
			picked,
			width: size.width,
			height: size.height,
			// Same corners as the frame on the canvas
			radius: frame?.device === "mobile" ? 28 : 6,
		};
	});
}

/**
 * Compare mode: a group's variations side by side at one zoom. Every column is as
 * tall as its screen's content and they share one scroll container, so scrolling
 * is synced. ←/→ move the highlight, Enter picks it, Esc closes.
 */
export function CompareView({
	group,
	frames,
	files,
	onPick,
	onClose,
}: {
	group: VariationGroup;
	frames: Frame[];
	files: ProjectFiles;
	onPick: (file: string) => void;
	onClose: () => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const columnRefs = useRef(new Map<string, HTMLDivElement>());
	const columns = columnsOf(group, frames);
	const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
	const [zoomSetting, setZoomSetting] = useState<number | "fit">("fit");
	const [fitZoom, setFitZoom] = useState(1);
	const [highlight, setHighlight] = useState(0);
	const zoom = zoomSetting === "fit" ? fitZoom : zoomSetting;
	const current = Math.min(highlight, columns.length - 1);
	const name = frames.find((frame) => frame.file === group.picked)?.name || screenNameFromPath(group.base);

	// Fit every column into the available width (never above 100%)
	const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
	const gaps = PADDING * 2 + GAP * Math.max(0, columns.length - 1);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const measure = () => setFitZoom(clampZoom(Math.min(1, (el.clientWidth - gaps) / Math.max(1, totalWidth))));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [totalWidth, gaps]);

	// Keep the same part of the screens in view when the zoom changes
	const previousZoom = useRef(zoom);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		const ratio = zoom / previousZoom.current;
		previousZoom.current = zoom;
		if (!el || ratio === 1) return;
		el.scrollTop *= ratio;
		el.scrollLeft *= ratio;
	}, [zoom]);

	const zoomBy = useCallback((factor: number) => setZoomSetting(clampZoom(zoom * factor)), [zoom]);

	const pick = useCallback(
		(file: string) => {
			onPick(file);
			// The picked design now lives in the screen's own file, the first column
			setHighlight(0);
		},
		[onPick],
	);

	const moveHighlight = useCallback(
		(delta: number) => {
			const next = Math.min(columns.length - 1, Math.max(0, current + delta));
			setHighlight(next);
			const column = columnRefs.current.get(columns[next]!.file);
			const el = scrollRef.current;
			if (!column || !el) return;
			const left = column.offsetLeft - PADDING;
			const right = column.offsetLeft + column.offsetWidth + PADDING - el.clientWidth;
			if (el.scrollLeft > left) el.scrollLeft = left;
			else if (el.scrollLeft < right) el.scrollLeft = right;
		},
		[columns, current],
	);

	// Compare mode owns the keyboard while open: the editor's canvas shortcuts would act on
	// frames the user can't see. Undo and redo still reach it, so a pick can be undone.
	const keys = useRef<(event: KeyboardEvent) => void>(() => {});
	keys.current = (event) => {
		if (isTyping(event.target)) return;
		const mod = event.metaKey || (event.ctrlKey && !event.altKey);
		const onButton = event.target instanceof HTMLElement && event.target.closest("button, a") !== null;
		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		if (event.key === "Escape") {
			handled();
			onClose();
		} else if (mod && (event.key === "=" || event.key === "+")) {
			handled();
			zoomBy(ZOOM_STEP);
		} else if (mod && event.key === "-") {
			handled();
			zoomBy(1 / ZOOM_STEP);
		} else if (mod && event.code === "Digit0") {
			handled();
			setZoomSetting("fit");
		} else if (mod && /^Key[ZY]$/.test(event.code)) {
			return;
		} else if (!mod && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			handled();
			moveHighlight(event.key === "ArrowLeft" ? -1 : 1);
		} else if (!mod && event.key === "Enter" && !onButton) {
			handled();
			const column = columns[current];
			if (column && !column.picked) pick(column.file);
		} else {
			// Default actions (scrolling, button activation) still happen
			event.stopPropagation();
		}
	};
	useEffect(() => {
		const listener = (event: KeyboardEvent) => keys.current(event);
		window.addEventListener("keydown", listener, { capture: true });
		return () => window.removeEventListener("keydown", listener, { capture: true });
	}, []);

	// The canvas listens to the wheel natively (pointer input goes through React, stopped on
	// the root below): keep ours to ourselves, and let ⌘/ctrl + wheel (or pinch) zoom the comparison instead of the page.
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.stopPropagation();
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				setZoomSetting(clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01)));
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	useEffect(() => {
		scrollRef.current?.focus({ preventScroll: true });
	}, []);

	const setContentHeight = useCallback((file: string, height: number) => {
		setContentHeights((heights) => (heights[file] === height ? heights : { ...heights, [file]: height }));
	}, []);

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-label={`Compare ${name} variations`}
			className="absolute inset-0 z-30 flex flex-col bg-muted motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
			onPointerDown={(event) => event.stopPropagation()}
		>
			<header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
				<div className="min-w-0 flex-1 truncate text-sm">
					<span className="font-medium">{name}</span>
					<span className="text-muted-foreground"> · {columns.length} variations</span>
				</div>
				<div className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
					<Kbd>←</Kbd>
					<Kbd>→</Kbd>
					<span className="mr-2">to move</span>
					<Kbd>↵</Kbd>
					<span>to pick</span>
				</div>
				<Separator orientation="vertical" className="h-5!" />
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
						<Minus />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="w-14 px-0 tabular-nums"
						aria-label="Zoom to 100%"
						onClick={() => setZoomSetting(1)}
					>
						{Math.round(zoom * 100)}%
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
						<Plus />
					</Button>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Fit to width"
								aria-pressed={zoomSetting === "fit"}
								className={cn(zoomSetting === "fit" && "text-primary")}
								onClick={() => setZoomSetting("fit")}
							>
								<Maximize />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Fit to width <Kbd>⌘0</Kbd>
						</TooltipContent>
					</Tooltip>
				</div>
				<Separator orientation="vertical" className="h-5!" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label="Close compare" onClick={onClose}>
							<X />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						Close <Kbd>Esc</Kbd>
					</TooltipContent>
				</Tooltip>
			</header>

			<div ref={scrollRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none">
				<div className="flex w-max items-start" style={{ gap: GAP, padding: PADDING, paddingTop: 0 }}>
					{columns.map((column, index) => {
						const height = Math.min(
							column.height * MAX_HEIGHT_RATIO,
							Math.max(column.height, contentHeights[column.file] ?? 0),
						);
						const active = index === current;
						return (
							<div
								key={column.file}
								ref={(el) => {
									if (el) columnRefs.current.set(column.file, el);
									else columnRefs.current.delete(column.file);
								}}
								className="flex flex-col"
								style={{ width: column.width * zoom }}
								onClick={() => setHighlight(index)}
							>
								<div className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-muted text-xs">
									<span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>
										{column.label}
									</span>
									{column.picked ? (
										<Check className="size-3.5 text-muted-foreground" aria-hidden />
									) : (
										<Button
											variant={active ? "secondary" : "ghost"}
											size="xs"
											className="ml-auto"
											onClick={(event) => {
												event.stopPropagation();
												pick(column.file);
											}}
										>
											Pick
										</Button>
									)}
								</div>
								<div
									className="overflow-hidden bg-white motion-safe:transition-shadow"
									style={{
										borderRadius: column.radius * zoom,
										width: column.width * zoom,
										height: height * zoom,
										boxShadow: active
											? "0 0 0 2px var(--primary), 0 10px 40px -12px rgb(0 0 0 / 0.25)"
											: "0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent), 0 10px 40px -12px rgb(0 0 0 / 0.2)",
									}}
								>
									<div className="origin-top-left" style={{ transform: `scale(${zoom})` }}>
										<ScreenFrame
											entry={column.file}
											files={files}
											width={column.width}
											height={height}
											onContentHeight={(contentHeight) => setContentHeight(column.file, contentHeight)}
										/>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
