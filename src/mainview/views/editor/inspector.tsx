import { useRef, useState } from "react";
import {
	AlignCenterHorizontal,
	AlignCenterVertical,
	AlignEndHorizontal,
	AlignEndVertical,
	AlignHorizontalSpaceAround,
	AlignStartHorizontal,
	AlignStartVertical,
	AlignVerticalSpaceAround,
	Copy,
	Monitor,
	Smartphone,
	Trash2,
	type LucideIcon,
} from "lucide-react";
import { DeviceToggle } from "@/components/app/design-composer";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Alignment, Axis } from "@/lib/align";
import { cn } from "@/lib/utils";
import type { Device, Frame, ProjectFiles } from "../../../shared/types";
import { CodeView } from "./code-view";
import { ALIGN_SHORTCUTS, CODE_VIEW_KEYS, DISTRIBUTE_SHORTCUTS } from "./shortcuts";

export type InspectorTab = "design" | "code";

export type FramePatch = Partial<Pick<Frame, "name" | "x" | "y" | "width" | "height" | "device">>;

type InspectorProps = {
	frames: Frame[];
	files: ProjectFiles;
	selection: string[];
	tab: InspectorTab;
	onTabChange: (tab: InspectorTab) => void;
	/** List click; `additive` with ⇧ */
	onSelect: (file: string, additive: boolean) => void;
	/** `step` groups edits of one field focus into a single undo step */
	onChange: (file: string, patch: FramePatch, step?: string) => void;
	/** A field lost focus: its burst of edits is one finished step */
	onEndStep: () => void;
	onAlign: (alignment: Alignment) => void;
	onDistribute: (axis: Axis) => void;
	onDuplicate: () => void;
	onDelete: () => void;
};

const ALIGN_ICONS: Record<Alignment, LucideIcon> = {
	left: AlignStartVertical,
	"h-center": AlignCenterVertical,
	right: AlignEndVertical,
	top: AlignStartHorizontal,
	"v-middle": AlignCenterHorizontal,
	bottom: AlignEndHorizontal,
};

const DISTRIBUTE_ICONS: Record<Axis, LucideIcon> = {
	horizontal: AlignHorizontalSpaceAround,
	vertical: AlignVerticalSpaceAround,
};

export function Inspector(props: InspectorProps) {
	const { frames, files, selection, tab, onTabChange, onSelect } = props;
	const selectedSet = new Set(selection);
	const selected = frames.filter((frame) => selectedSet.has(frame.file));
	const single = selected.length === 1 ? selected[0]! : null;

	return (
		<aside
			className={cn(
				"flex shrink-0 flex-col border-l bg-background transition-[width] duration-150",
				tab === "code" ? "w-[440px]" : "w-64",
			)}
		>
			<Tabs value={tab} onValueChange={(value) => onTabChange(value as InspectorTab)} className="gap-0">
				<div className="flex h-10 shrink-0 items-center border-b px-2">
					<TabsList variant="line" className="h-8!">
						<TabsTrigger value="design" className="px-2 text-[13px]">
							Design
						</TabsTrigger>
						<Tooltip>
							<TooltipTrigger asChild>
								<TabsTrigger value="code" className="px-2 text-[13px]">
									Code
								</TabsTrigger>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								Code view <Kbd>{CODE_VIEW_KEYS}</Kbd>
							</TooltipContent>
						</Tooltip>
					</TabsList>
				</div>
			</Tabs>

			{tab === "code" ? (
				single ? (
					<CodeView path={single.file} source={files[single.file]} />
				) : (
					<p className="p-4 text-[13px] text-subtle-foreground">
						{selected.length ? "Select a single screen to see its code." : "Select a screen to see its code."}
					</p>
				)
			) : (
				<>
					{single ? <FrameDetails frame={single} {...props} /> : null}
					{selected.length > 1 ? <MultiDetails count={selected.length} {...props} /> : null}

					<div className={cn("flex min-h-0 flex-1 flex-col", selected.length > 0 && "border-t")}>
						<div className="px-4 pt-4 pb-2 text-xs font-medium text-subtle-foreground">Screens</div>
						<div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-3">
							{frames.length === 0 ? (
								<p className="px-2 text-[13px] text-subtle-foreground">No screens yet.</p>
							) : (
								frames.map((frame) => {
									const Icon = frame.device === "mobile" ? Smartphone : Monitor;
									return (
										<button
											key={frame.file}
											type="button"
											title={frame.file}
											onClick={(event) => onSelect(frame.file, event.shiftKey)}
											className={cn(
												"flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
												selectedSet.has(frame.file) && "bg-accent font-medium text-accent-foreground",
											)}
										>
											<Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
											<span className="truncate">{frame.name}</span>
										</button>
									);
								})
							)}
						</div>
					</div>
				</>
			)}
		</aside>
	);
}

function FrameDetails({ frame, onChange, onEndStep, onDuplicate, onDelete }: InspectorProps & { frame: Frame }) {
	const field = useFieldSteps(frame.file);
	return (
		<div className="flex flex-col gap-4 p-4">
			<Section title="Screen">
				<input
					value={frame.name}
					onFocus={field.begin}
					onBlur={onEndStep}
					onChange={(event) => onChange(frame.file, { name: event.target.value }, field.key("name"))}
					className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none focus:border-ring"
					aria-label="Screen name"
				/>
				<span className="truncate font-mono text-[11px] text-subtle-foreground" title={frame.file}>
					{frame.file}
				</span>
			</Section>
			<Section title="Frame">
				<div className="grid grid-cols-2 gap-2">
					{(["x", "y", "width", "height"] as const).map((key) => (
						<NumberField
							key={key}
							label={key === "width" ? "W" : key === "height" ? "H" : key.toUpperCase()}
							value={frame[key]}
							min={key === "width" || key === "height" ? 1 : undefined}
							onFocus={field.begin}
							onBlur={onEndStep}
							onChange={(value) => onChange(frame.file, { [key]: value }, field.key(key))}
						/>
					))}
				</div>
				<div className="flex items-center justify-between">
					<span className="text-xs text-muted-foreground">Device</span>
					<DeviceToggle
						device={frame.device}
						onDeviceChange={(device: Device) => device !== frame.device && onChange(frame.file, { device })}
					/>
				</div>
			</Section>
			<Separator />
			<SelectionActions label="screen" onDuplicate={onDuplicate} onDelete={onDelete} />
		</div>
	);
}

function MultiDetails({
	count,
	onAlign,
	onDistribute,
	onDuplicate,
	onDelete,
}: InspectorProps & { count: number }) {
	return (
		<div className="flex flex-col gap-4 p-4">
			<Section title={`${count} screens`}>
				<div className="flex items-center justify-between rounded-md border p-0.5">
					{ALIGN_SHORTCUTS.map((item) => (
						<IconAction
							key={item.alignment}
							icon={ALIGN_ICONS[item.alignment]}
							label={item.label}
							keys={item.keys}
							onClick={() => onAlign(item.alignment)}
						/>
					))}
				</div>
				<div className="flex items-center gap-0.5 rounded-md border p-0.5 self-start">
					{DISTRIBUTE_SHORTCUTS.map((item) => (
						<IconAction
							key={item.axis}
							icon={DISTRIBUTE_ICONS[item.axis]}
							label={count < 3 ? `${item.label} (needs 3 screens)` : item.label}
							keys={item.keys}
							disabled={count < 3}
							onClick={() => onDistribute(item.axis)}
						/>
					))}
				</div>
			</Section>
			<Separator />
			<SelectionActions label="screens" onDuplicate={onDuplicate} onDelete={onDelete} />
		</div>
	);
}

function SelectionActions({ label, onDuplicate, onDelete }: { label: string; onDuplicate: () => void; onDelete: () => void }) {
	return (
		<div className="flex gap-2">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="sm" className="flex-1" onClick={onDuplicate}>
						<Copy />
						Duplicate
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					Duplicate <Kbd>⌘D</Kbd>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label={`Delete ${label}`}
						className="text-destructive hover:text-destructive"
						onClick={onDelete}
					>
						<Trash2 />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					Delete {label} and {label === "screen" ? "its file" : "their files"} <Kbd>⌫</Kbd>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function IconAction({
	icon: Icon,
	label,
	keys,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	keys: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* The span keeps the tooltip working on a disabled button */}
				<span>
					<Button variant="ghost" size="icon-xs" className="size-7" aria-label={label} disabled={disabled} onClick={onClick}>
						<Icon className="size-4" strokeWidth={1.8} />
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{label} <Kbd>{keys}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * Undo-step keys for inspector fields: every focus starts a new burst, and
 * edits within it share one key (`onBlur` seals it).
 */
function useFieldSteps(file: string) {
	const burst = useRef(0);
	return {
		begin: () => {
			burst.current += 1;
		},
		key: (field: string) => `inspector:${file}:${field}:${burst.current}`,
	};
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-xs font-medium text-subtle-foreground">{title}</h3>
			{children}
		</section>
	);
}

/** Number input that tolerates partial text ("-", "") while typing and only reports valid numbers. */
function NumberField({
	label,
	value,
	min,
	onChange,
	onFocus,
	onBlur,
}: {
	label: string;
	value: number;
	min?: number;
	onChange: (value: number) => void;
	onFocus: () => void;
	onBlur: () => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<label className="flex h-8 items-center gap-2 rounded-md border bg-transparent px-2 text-[13px] focus-within:border-ring">
			<span className="w-3 text-xs text-subtle-foreground">{label}</span>
			<input
				inputMode="numeric"
				value={draft ?? String(value)}
				onFocus={(event) => {
					onFocus();
					event.currentTarget.select();
				}}
				onBlur={() => {
					setDraft(null);
					onBlur();
				}}
				onChange={(event) => {
					setDraft(event.target.value);
					const next = Math.round(Number(event.target.value));
					if (event.target.value.trim() !== "" && Number.isFinite(next) && (min === undefined || next >= min)) onChange(next);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
					else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
						const next = Math.max(min ?? -Infinity, value + step);
						setDraft(null);
						onChange(next);
					}
				}}
				className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
			/>
		</label>
	);
}
