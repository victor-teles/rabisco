import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { ScreenFrame } from "@/components/app/screen-preview";
import { NoDrag, TitleBar } from "@/components/app/title-bar";
import { currentVisit, pushVisit, startHistory, stepBack, stepForward, type PlayStep } from "@/lib/play-history";
import type { LinkOptions } from "@/lib/render/protocol";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FRAME_SIZE, isScreenFile, screenNameFromPath } from "../../../shared/project";
import { resolveLink } from "../../../shared/prototype/links";
import {
	overlayMotion,
	overlayRect,
	parseOverlayMode,
	parseTransition,
	screenTransition,
	type LinkTransition,
	type OverlayMode,
	type ScreenTransition,
	type Size,
} from "../../../shared/prototype/transitions";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { isTyping, PLAY_BACK_KEYS, PLAY_FORWARD_KEYS } from "./shortcuts";

const PADDING = 48;

const PAINT_TIMEOUT_MS = 1_000;

type Layer = { id: number; file: string };

type LayerMotion = { id: number; plan: ScreenTransition; running: boolean };

type Overlay = { id: number; file: string; mode: OverlayMode; transition: LinkTransition | null; closing: boolean };

const prefersReducedMotion = () =>
	"matchMedia" in window && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Play mode (decision 0007): clicks on `data-link-to` elements move between screens */
export function PlayView({
	start,
	frames,
	files,
	onClose,
}: {
	start: string;
	frames: Frame[];
	files: ProjectFiles;
	onClose: () => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const [history, setHistory] = useState(() => startHistory(start));
	const [layers, setLayers] = useState<Layer[]>([{ id: 0, file: start }]);
	const [motion, setMotion] = useState<LayerMotion | null>(null);
	const [overlays, setOverlays] = useState<Overlay[]>([]);
	const nextId = useRef(1);
	const layerRefs = useRef(new Map<number, HTMLDivElement>());
	const [stage, setStage] = useState({ width: 0, height: 0 });
	const current = currentVisit(history).file;
	const frame = frames.find((f) => f.file === current);
	const size = frame ?? FRAME_SIZE[frames[0]?.device ?? "mobile"];
	const device = frame?.device ?? frames[0]?.device ?? "mobile";
	const name = frame?.name || screenNameFromPath(current);
	const exists = files[current] !== undefined;
	const screens = frames.filter((f) => isScreenFile(f.file) && files[f.file] !== undefined);
	const overlayOpen = overlays.some((overlay) => !overlay.closing);
	const canBack = history.index > 0;
	const canForward = history.index < history.stack.length - 1;

	// Scale down to fit the window, never up
	useLayoutEffect(() => {
		const el = stageRef.current;

		if (!el) return;
		const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);

		return () => observer.disconnect();
	}, []);

	const scale = stage.width
		? Math.max(0.1, Math.min(1, (stage.width - PADDING * 2) / size.width, (stage.height - PADDING * 2) / size.height))
		: 1;

	const show = useCallback((file: string, plan: ScreenTransition | null) => {
		if (!plan) {
			setMotion(null);
			setLayers((list) => [{ id: list.at(-1)!.id, file }]);

			return;
		}

		const id = nextId.current++;
		setMotion({ id, plan, running: false });
		setLayers((list) => [list.at(-1)!, { id, file }]);
	}, []);

	const apply = useCallback(
		(step: PlayStep | null) => {
			if (!step) return;
			setHistory(step.history);
			show(currentVisit(step.history).file, screenTransition(step.transition, step.direction, prefersReducedMotion()));
		},
		[show],
	);

	const runMotion = useCallback((id: number) => {
		setMotion((active) => (active && active.id === id && !active.running ? { ...active, running: true } : active));
	}, []);

	useEffect(() => {
		if (!motion || motion.running) return;
		const id = motion.id;
		const timer = setTimeout(() => runMotion(id), PAINT_TIMEOUT_MS);

		return () => clearTimeout(timer);
	}, [motion, runMotion]);

	useLayoutEffect(() => {
		if (!motion?.running) return;
		const { id, plan } = motion;
		const incoming = layerRefs.current.get(id);
		const outgoing = [...layerRefs.current].find(([layer]) => layer !== id)?.[1];
		const timing: KeyframeAnimationOptions = { duration: plan.duration, easing: plan.easing };

		const animations = [
			plan.incoming.length ? incoming?.animate(plan.incoming, timing) : undefined,
			plan.outgoing.length ? outgoing?.animate(plan.outgoing, { ...timing, fill: "forwards" }) : undefined,
		];

		const timer = setTimeout(() => {
			setMotion(null);
			setLayers((list) => list.filter((layer) => layer.id === id));
		}, plan.duration);

		return () => {
			clearTimeout(timer);

			for (const animation of animations) animation?.cancel();
		};
	}, [motion]);

	const closeOverlay = useCallback(() => {
		setOverlays((list) => {
			const top = list.filter((overlay) => !overlay.closing).at(-1);

			return top ? list.map((overlay) => (overlay === top ? { ...overlay, closing: true } : overlay)) : list;
		});
	}, []);

	const removeOverlay = useCallback((id: number) => {
		setOverlays((list) => list.filter((overlay) => overlay.id !== id));
	}, []);

	const go = useCallback(
		(file: string, transition: LinkTransition = "instant") => {
			setOverlays([]);
			apply(pushVisit(history, file, transition));
		},
		[history, apply],
	);

	const back = useCallback(() => {
		if (overlayOpen) closeOverlay();
		else apply(stepBack(history));
	}, [overlayOpen, closeOverlay, history, apply]);

	const forward = useCallback(() => {
		setOverlays([]);
		apply(stepForward(history));
	}, [history, apply]);

	const restart = useCallback(() => {
		setOverlays([]);
		setHistory(startHistory(start));
		show(start, null);
	}, [start, show]);

	const escape = useCallback(() => {
		if (overlayOpen) closeOverlay();
		else onClose();
	}, [overlayOpen, closeOverlay, onClose]);

	const navigate = useCallback(
		(to: string, options: LinkOptions) => {
			const target = resolveLink(to, files);

			if (target.kind === "screen") {
				const transition = parseTransition(options.transition);
				const mode = parseOverlayMode(options.mode);

				if (!mode) go(target.file, transition ?? "instant");
				else
					setOverlays((list) => [
						...list,
						{ id: nextId.current++, file: target.file, mode, transition, closing: false },
					]);
			} else if (target.kind === "back") {
				if (canBack || overlayOpen) back();
				else toast("This is the first screen", { description: "There's nothing to go back to yet." });
			} else
				toast("This link goes nowhere yet", {
					description: `No screen at ${target.to}. Pick a target in the inspector.`,
				});
		},
		[files, go, back, canBack, overlayOpen],
	);

	const sizeOf = (file: string): Size => {
		const target = frames.find((f) => f.file === file);

		return target ?? FRAME_SIZE[device];
	};

	// Owns the keyboard while open: the editor's shortcuts would act on a canvas the user can't see
	const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (isTyping(event.target)) return;
		const mod = event.metaKey || (event.ctrlKey && !event.altKey);

		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};

		if (event.key === "Escape") {
			handled();
			escape();
		} else if ((mod && event.key === "[") || (event.altKey && event.key === "ArrowLeft")) {
			handled();
			back();
		} else if ((mod && event.key === "]") || (event.altKey && event.key === "ArrowRight")) {
			handled();
			forward();
		} else if (!mod && !event.altKey && event.key.toLowerCase() === "r") {
			handled();
			restart();
		} else {
			// Default actions (button activation) still happen
			event.stopPropagation();
		}
	});

	useEffect(() => {
		const listener = (event: KeyboardEvent) => onKeyDown(event);
		window.addEventListener("keydown", listener, { capture: true });

		return () => window.removeEventListener("keydown", listener, { capture: true });
	}, []);

	useEffect(() => {
		const el = rootRef.current;

		if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
	}, []);

	// The canvas listens to the wheel natively: keep ours to ourselves
	useEffect(() => {
		const el = rootRef.current;

		if (!el) return;
		const onWheel = (event: WheelEvent) => event.stopPropagation();
		el.addEventListener("wheel", onWheel);

		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-label={`Play ${name}`}
			tabIndex={-1}
			className="fixed inset-0 z-50 flex flex-col bg-muted outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
			onPointerDown={(event) => event.stopPropagation()}
		>
			<TitleBar className="gap-3">
				<NoDrag className="flex items-center gap-0.5">
					<BarButton label="Back" keys={PLAY_BACK_KEYS} disabled={!canBack && !overlayOpen} onClick={back}>
						<ArrowLeft />
					</BarButton>
					<BarButton label="Forward" keys={PLAY_FORWARD_KEYS} disabled={!canForward} onClick={forward}>
						<ArrowRight />
					</BarButton>
					<BarButton
						label="Restart"
						keys="R"
						disabled={history.stack.length === 1 && current === start}
						onClick={restart}
					>
						<RotateCcw />
					</BarButton>
				</NoDrag>
				<Separator orientation="vertical" className="h-5!" />
				<div className="min-w-0 flex-1">
					<NoDrag className="inline-flex max-w-full">
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="max-w-full gap-1 px-2 text-[13px] font-medium"
									aria-label="Go to screen"
								>
									<span className="truncate">{name}</span>
									<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="max-h-80 min-w-48">
								<DropdownMenuRadioGroup value={current} onValueChange={(file) => go(file)}>
									{screens.map((screen) => (
										<DropdownMenuRadioItem key={screen.file} value={screen.file} className="text-[13px]">
											<span className="truncate">{screen.name || screenNameFromPath(screen.file)}</span>
											{screen.file === start ? (
												<span className="ml-auto pl-3 text-xs text-subtle-foreground">start</span>
											) : null}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</NoDrag>
				</div>
				<div className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
					<span>Click links to move between screens</span>
				</div>
				<Separator orientation="vertical" className="h-5!" />
				<NoDrag>
					<BarButton label="Close" keys="Esc" onClick={onClose}>
						<X />
					</BarButton>
				</NoDrag>
			</TitleBar>

			<div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
				{exists ? (
					<div
						className="overflow-hidden bg-white shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_10px_40px_-12px_rgb(0_0_0/0.25)]"
						style={{
							width: size.width * scale,
							height: size.height * scale,
							borderRadius: (device === "desktop" ? 6 : 28) * scale,
						}}
					>
						<div
							className="relative origin-top-left"
							style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
						>
							{layers.map((layer) => (
								<div
									key={layer.id}
									ref={(element) => {
										if (element) layerRefs.current.set(layer.id, element);
										else layerRefs.current.delete(layer.id);
									}}
									className={cn(
										"absolute inset-0",
										motion?.id === layer.id && !motion.running && "invisible",
										layer !== layers.at(-1) && "pointer-events-none",
									)}
									style={{
										zIndex: motion && (layer.id === motion.id) === (motion.plan.top === "incoming") ? 1 : 0,
									}}
								>
									<ScreenFrame
										entry={layer.file}
										files={files}
										width={size.width}
										height={size.height}
										interactive
										play
										onNavigate={navigate}
										onEscape={escape}
										onPainted={() => runMotion(layer.id)}
									/>
								</div>
							))}
							{overlays.map((overlay) => (
								<OverlayLayer
									key={overlay.id}
									overlay={overlay}
									screen={size}
									size={sizeOf(overlay.file)}
									files={files}
									onNavigate={navigate}
									onEscape={escape}
									onDismiss={closeOverlay}
									onClosed={removeOverlay}
								/>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center gap-3 text-center">
						<p className="text-[13px] text-muted-foreground">{name} isn't in the project anymore.</p>
						<Button variant="outline" size="sm" onClick={restart}>
							<RotateCcw />
							Restart
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function OverlayLayer({
	overlay,
	screen,
	size,
	files,
	onNavigate,
	onEscape,
	onDismiss,
	onClosed,
}: {
	overlay: Overlay;
	screen: Size;
	size: Size;
	files: ProjectFiles;
	onNavigate: (to: string, options: LinkOptions) => void;
	onEscape: () => void;
	onDismiss: () => void;
	onClosed: (id: number) => void;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(false);
	const rect = overlayRect(overlay.mode, screen, size);
	const closed = useEffectEvent(() => onClosed(overlay.id));
	const { mode, transition, closing } = overlay;

	useEffect(() => {
		if (shown) return;
		const timer = setTimeout(() => setShown(true), PAINT_TIMEOUT_MS);

		return () => clearTimeout(timer);
	}, [shown]);

	useLayoutEffect(() => {
		const motion = shown ? overlayMotion(mode, transition, !closing, prefersReducedMotion()) : null;

		if (!motion) {
			if (closing) closed();

			return;
		}

		const timing: KeyframeAnimationOptions = { duration: motion.duration, easing: motion.easing, fill: "forwards" };

		const animations = [
			panelRef.current?.animate(motion.panel, timing),
			backdropRef.current?.animate(motion.backdrop, timing),
		];

		const timer = closing ? setTimeout(closed, motion.duration) : undefined;

		return () => {
			clearTimeout(timer);

			for (const animation of animations) animation?.cancel();
		};
	}, [shown, mode, transition, closing]);

	return (
		<div className={cn("absolute inset-0 z-10", closing && "pointer-events-none")}>
			<div
				ref={backdropRef}
				aria-hidden
				className={cn("absolute inset-0 bg-black/40", !shown && "invisible")}
				onClick={onDismiss}
			/>
			<div
				ref={panelRef}
				className={cn("absolute overflow-hidden shadow-2xl", !shown && "invisible")}
				style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
			>
				<ScreenFrame
					entry={overlay.file}
					files={files}
					width={rect.width}
					height={rect.height}
					interactive
					play
					onNavigate={onNavigate}
					onEscape={onEscape}
					onPainted={() => setShown(true)}
				/>
			</div>
		</div>
	);
}

function BarButton({
	label,
	keys,
	disabled,
	onClick,
	children,
}: {
	label: string;
	keys: string;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{label} <Kbd>{keys}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}
