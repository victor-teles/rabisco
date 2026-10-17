import { memo, useState } from "react";
import { Check } from "lucide-react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { MOTION_MIME, motionDrag } from "@/lib/motion-drop";
import { cn } from "@/lib/utils";
import {
	MOTION_KIND_HINTS,
	MOTION_KIND_LABELS,
	MOTION_KINDS,
	presetsOfKind,
	type MotionPreset,
} from "../../../shared/motion/presets";
import { motionPreviewModule, motionPreviewPath } from "../../../shared/motion/preview";
import type { ProjectFiles } from "../../../shared/types";

type MotionPanelProps = {
	/** Presets on the selected element; empty without one */
	applied: readonly string[];
	/** An element with plain classes is selected, so a click adds the preset to it */
	canApply: boolean;
	onToggle: (preset: string, on: boolean) => void;
};

/** Snapshots are half resolution: a frame at twice the size shown stays sharp */
const PREVIEW = { width: 320, height: 192, scale: 0.5 };

/** One module each, the same object every render, so a preview never compiles again */
const previewFiles = new Map<string, { entry: string; files: ProjectFiles }>();

function previewOf(preset: MotionPreset) {
	let preview = previewFiles.get(preset.id);

	if (!preview) {
		const entry = motionPreviewPath(preset.id);
		preview = { entry, files: { [entry]: motionPreviewModule(preset) } };
		previewFiles.set(preset.id, preview);
	}

	return preview;
}

function startDrag(event: React.DragEvent, preset: MotionPreset) {
	motionDrag.start(preset.id);
	event.dataTransfer.setData(MOTION_MIME, preset.id);
	// WebKit only starts a drag that carries a standard type
	event.dataTransfer.setData("text/plain", preset.name);
	event.dataTransfer.effectAllowed = "copy";
	const chip = document.createElement("div");
	chip.textContent = `${MOTION_KIND_LABELS[preset.kind]}: ${preset.name}`;
	chip.className =
		"fixed -top-96 left-0 rounded-md border bg-popover px-2 py-1 text-[13px] font-medium text-popover-foreground shadow-sm";
	document.body.append(chip);
	event.dataTransfer.setDragImage(chip, 12, 12);
	requestAnimationFrame(() => chip.remove());
}

/** The motion catalog (decision 0027): previews play while the pointer is on them; drag one onto an element */
export const MotionPanel = memo(function MotionPanel({ applied, canApply, onToggle }: MotionPanelProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
			<p className="px-3 pt-1 pb-2 text-[12px] text-subtle-foreground">
				Drag a preset onto an element, or click one to add it to the selected element.
			</p>
			{MOTION_KINDS.map((kind) => (
				<section key={kind} className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0">
					<header className="flex h-8 items-center gap-1.5 px-3">
						<h3 className="text-[12px] font-medium">{MOTION_KIND_LABELS[kind]}</h3>
						<span className="truncate text-[11px] text-subtle-foreground">{MOTION_KIND_HINTS[kind]}</span>
					</header>
					<div className="grid grid-cols-2 gap-2 px-3">
						{presetsOfKind(kind).map((preset) => (
							<MotionTile
								key={preset.id}
								preset={preset}
								applied={applied.includes(preset.id)}
								canApply={canApply}
								onToggle={onToggle}
							/>
						))}
					</div>
				</section>
			))}
		</div>
	);
});

function MotionTile({
	preset,
	applied,
	canApply,
	onToggle,
}: {
	preset: MotionPreset;
	applied: boolean;
	canApply: boolean;
	onToggle: (preset: string, on: boolean) => void;
}) {
	const [live, setLive] = useState(false);
	const { entry, files } = previewOf(preset);

	const title = canApply
		? applied
			? `Remove ${preset.name} from the selected element`
			: `Add ${preset.name} to the selected element`
		: "Drag onto an element in a screen";

	return (
		<div
			className="relative flex flex-col gap-1"
			onPointerEnter={() => setLive(true)}
			onPointerLeave={() => setLive(false)}
		>
			<div
				className={cn(
					"flex h-24 items-center justify-center overflow-hidden rounded-md bg-background shadow-[0_0_0_1px_rgb(0_0_0/0.07)]",
					applied && "shadow-[0_0_0_1.5px_var(--primary)]",
				)}
			>
				<div
					className="pointer-events-none shrink-0"
					style={{ width: PREVIEW.width * PREVIEW.scale, height: PREVIEW.height * PREVIEW.scale }}
				>
					<div className="origin-top-left" style={{ transform: `scale(${PREVIEW.scale})` }}>
						<ScreenFrame entry={entry} files={files} width={PREVIEW.width} height={PREVIEW.height} live={live} />
					</div>
				</div>
			</div>
			<div className="flex items-center gap-1 px-0.5 text-[12px]">
				<span className="truncate">{preset.name}</span>
				{applied ? <Check className="size-3 shrink-0 text-primary" aria-label="On the selected element" /> : null}
			</div>
			{/* WebKit cancels a drag whose source contains an iframe, so a layer over the tile is the draggable */}
			<button
				type="button"
				draggable
				title={title}
				aria-label={`${MOTION_KIND_LABELS[preset.kind]}: ${preset.name}`}
				aria-pressed={canApply ? applied : undefined}
				onFocus={() => setLive(true)}
				onBlur={() => setLive(false)}
				onDragStart={(event) => startDrag(event, preset)}
				onDragEnd={() => motionDrag.end()}
				onClick={() => canApply && onToggle(preset.id, !applied)}
				className="absolute inset-0 cursor-grab rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
			/>
		</div>
	);
}
