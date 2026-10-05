import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { ScreenFrame } from "@/components/app/screen-preview";
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
import type { Frame, ProjectFiles } from "../../../shared/types";
import { isTyping, PLAY_BACK_KEYS, PLAY_FORWARD_KEYS } from "./shortcuts";

const PADDING = 48;

type History = { stack: string[]; index: number };

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
	const [history, setHistory] = useState<History>({ stack: [start], index: 0 });
	const [stage, setStage] = useState({ width: 0, height: 0 });
	const current = history.stack[history.index]!;
	const frame = frames.find((f) => f.file === current);
	const size = frame ?? FRAME_SIZE[frames[0]?.device ?? "mobile"];
	const device = frame?.device ?? frames[0]?.device ?? "mobile";
	const name = frame?.name || screenNameFromPath(current);
	const exists = files[current] !== undefined;
	const screens = frames.filter((f) => isScreenFile(f.file) && files[f.file] !== undefined);
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

	const go = useCallback((file: string) => {
		setHistory((h) =>
			h.stack[h.index] === file ? h : { stack: [...h.stack.slice(0, h.index + 1), file], index: h.index + 1 },
		);
	}, []);

	const back = useCallback(() => {
		setHistory((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h));
	}, []);

	const forward = useCallback(() => {
		setHistory((h) => (h.index < h.stack.length - 1 ? { ...h, index: h.index + 1 } : h));
	}, []);

	const restart = useCallback(() => setHistory({ stack: [start], index: 0 }), [start]);

	const navigate = useCallback(
		(to: string) => {
			const target = resolveLink(to, files);

			if (target.kind === "screen") go(target.file);
			else if (target.kind === "back") {
				if (canBack) back();
				else toast("This is the first screen", { description: "There's nothing to go back to yet." });
			} else
				toast("This link goes nowhere yet", {
					description: `No screen at ${target.to}. Pick a target in the inspector.`,
				});
		},
		[files, go, back, canBack],
	);

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
			onClose();
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
			className="fixed inset-0 z-50 flex flex-col bg-muted motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
			onPointerDown={(event) => event.stopPropagation()}
		>
			<header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
				<div className="flex items-center gap-0.5">
					<BarButton label="Back" keys={PLAY_BACK_KEYS} disabled={!canBack} onClick={back}>
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
				</div>
				<Separator orientation="vertical" className="h-5!" />
				<div className="min-w-0 flex-1">
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
							<DropdownMenuRadioGroup value={current} onValueChange={go}>
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
				</div>
				<div className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
					<span>Click links to move between screens</span>
				</div>
				<Separator orientation="vertical" className="h-5!" />
				<BarButton label="Close" keys="Esc" onClick={onClose}>
					<X />
				</BarButton>
			</header>

			<div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
				{exists ? (
					<div
						className="overflow-hidden bg-white shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_10px_40px_-12px_rgb(0_0_0/0.25)]"
						style={{
							width: size.width * scale,
							height: size.height * scale,
							borderRadius: (device === "mobile" ? 28 : 6) * scale,
						}}
					>
						<div className="origin-top-left" style={{ transform: `scale(${scale})` }}>
							<ScreenFrame
								entry={current}
								files={files}
								width={size.width}
								height={size.height}
								interactive
								play
								onNavigate={navigate}
								onEscape={onClose}
							/>
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
