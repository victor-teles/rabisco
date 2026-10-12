import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssetImage } from "@/hooks/use-asset-image";
import { compareWithScreenshot, type Comparison } from "@/lib/recreate";
import type { DesignTokens } from "../../../shared/context/tokens";
import type { CanvasImage, Frame, ProjectFiles } from "../../../shared/types";
import { isTyping } from "./shortcuts";

type Mode = "side" | "overlay" | "difference";

const MODES: { value: Mode; label: string; key: string }[] = [
	{ value: "side", label: "Side by side", key: "1" },
	{ value: "overlay", label: "Overlay", key: "2" },
	{ value: "difference", label: "Difference", key: "3" },
];

const isMode = (value: string): value is Mode => MODES.some((mode) => mode.value === value);

const PADDING = 48;

const GAP = 40;

type Reading = { comparison: Comparison } | { error: string } | null;

export function ScreenshotCompare({
	frame,
	image,
	files,
	theme,
	onClose,
}: {
	frame: Frame;
	image: CanvasImage;
	files: ProjectFiles;
	theme: DesignTokens;
	onClose: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [mode, setMode] = useState<Mode>("side");
	const [opacity, setOpacity] = useState(50);
	const [reading, setReading] = useState<Reading>(null);
	const [available, setAvailable] = useState(0);
	const reference = useAssetImage(image.src);
	const comparison = reading && "comparison" in reading ? reading.comparison : null;
	const columns = mode === "side" ? 2 : 1;
	const width = comparison?.width ?? frame.width;
	const zoom = Math.min(1, Math.max(0.1, (available - PADDING * 2 - GAP * (columns - 1)) / (width * columns)));

	useEffect(() => {
		let current = true;

		compareWithScreenshot(frame, image, files, theme).then(
			(next) => current && setReading({ comparison: next }),
			(reason) => current && setReading({ error: reason instanceof Error ? reason.message : String(reason) }),
		);

		return () => {
			current = false;
		};
	}, [frame, image, files, theme]);

	useLayoutEffect(() => {
		const el = scrollRef.current;

		if (!el) return;
		const measure = () => setAvailable(el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);

		return () => observer.disconnect();
	}, []);

	const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
		const picked = MODES.find((each) => each.key === event.key);

		if (event.key === "Escape") onClose();
		else if (picked) setMode(picked.value);
		else return void event.stopPropagation();

		event.preventDefault();
		event.stopPropagation();
	});

	useEffect(() => {
		const listener = (event: KeyboardEvent) => onKeyDown(event);
		window.addEventListener("keydown", listener, { capture: true });

		return () => window.removeEventListener("keydown", listener, { capture: true });
	}, []);

	useEffect(() => {
		scrollRef.current?.focus({ preventScroll: true });
	}, []);

	const box = comparison ? { width: comparison.width * zoom, height: comparison.height * zoom } : null;

	const screenshot = (className: string, style?: React.CSSProperties) =>
		reference.found ? <img ref={reference.show} alt="" draggable={false} className={className} style={style} /> : null;

	const screen = (className: string) =>
		comparison ? <img src={comparison.screen} alt="" draggable={false} className={className} /> : null;

	return (
		<div
			role="dialog"
			aria-label={`Compare ${frame.name} with ${image.name}`}
			className="absolute inset-0 z-30 flex flex-col bg-muted motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
			onPointerDown={(event) => event.stopPropagation()}
			onWheel={(event) => event.stopPropagation()}
		>
			<header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
				<div className="min-w-0 flex-1 truncate text-sm">
					<span className="font-medium">{frame.name}</span>
					<span className="text-muted-foreground"> · {image.name}</span>
				</div>
				{mode === "overlay" ? (
					<Slider
						aria-label="Screenshot opacity"
						className="w-28"
						min={0}
						max={100}
						step={1}
						value={[opacity]}
						onValueChange={([value]) => setOpacity(value ?? opacity)}
					/>
				) : null}
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={mode}
					onValueChange={(value) => isMode(value) && setMode(value)}
				>
					{MODES.map((each) => (
						<ToggleGroupItem
							key={each.value}
							value={each.value}
							aria-keyshortcuts={each.key}
							className="px-2.5 text-xs"
						>
							{each.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<Separator orientation="vertical" className="h-5!" />
				<Score reading={reading} />
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
				{reading && "error" in reading ? (
					<p className="p-12 text-center text-sm text-muted-foreground">Couldn't compare: {reading.error}</p>
				) : box ? (
					<div className="mx-auto flex w-max items-start" style={{ gap: GAP, padding: PADDING, paddingTop: 0 }}>
						{mode === "side" ? (
							<>
								<Column label="Screenshot" box={box}>
									{screenshot("block size-full")}
								</Column>
								<Column label="Screen" box={box}>
									{screen("block w-full")}
								</Column>
							</>
						) : (
							<Column
								label={mode === "overlay" ? "Screenshot over the screen" : "Difference: matching pixels are black"}
								box={box}
							>
								{screen("block w-full")}
								{screenshot(
									mode === "difference"
										? "absolute inset-0 size-full mix-blend-difference"
										: "absolute inset-0 size-full",
									mode === "overlay" ? { opacity: opacity / 100 } : undefined,
								)}
							</Column>
						)}
					</div>
				) : (
					<div className="grid h-full place-items-center text-muted-foreground">
						<LoaderCircle className="size-5 animate-spin" aria-label="Rendering the screen" />
					</div>
				)}
			</div>
		</div>
	);
}

function Column({
	label,
	box,
	children,
}: {
	label: string;
	box: { width: number; height: number };
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col" style={{ width: box.width }}>
			<div className="sticky top-0 z-10 flex h-12 items-center bg-muted text-xs text-muted-foreground">{label}</div>
			<div
				className="relative overflow-hidden bg-white"
				style={{
					height: box.height,
					boxShadow:
						"0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent), 0 10px 40px -12px rgb(0 0 0 / 0.2)",
				}}
			>
				{children}
			</div>
		</div>
	);
}

function Score({ reading }: { reading: Reading }) {
	if (!reading) return <span className="text-xs text-muted-foreground">Measuring…</span>;

	if ("error" in reading) return <span className="text-xs text-muted-foreground">No score</span>;

	const percent = Math.round(reading.comparison.difference * 100);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="text-xs font-medium tabular-nums" tabIndex={0}>
					{percent}% different
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">Pixels whose color differs, at the screenshot's size</TooltipContent>
		</Tooltip>
	);
}
