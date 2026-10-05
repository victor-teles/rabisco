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
	Check,
	ChevronDown,
	Columns2,
	Copy,
	Monitor,
	Shuffle,
	Smartphone,
	Trash2,
	type LucideIcon,
} from "lucide-react";
import { DeviceToggle, VariationsPicker } from "@/components/app/design-composer";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVariations } from "@/hooks/use-variations";
import type { Alignment, Axis } from "@/lib/align";
import { cn } from "@/lib/utils";
import { variationName } from "@/lib/variations";
import { isScreenFile } from "../../../shared/project";
import type { Device, Frame, ProjectFiles } from "../../../shared/types";
import { groupOf, isAlternate } from "../../../shared/variations";
import { ALIGN_SHORTCUTS, CODE_VIEW_KEYS, COMPARE_KEYS, COMPONENTS_VIEW_KEYS, CONTEXT_VIEW_KEYS, DISTRIBUTE_SHORTCUTS } from "./shortcuts";

export type InspectorTab = "design" | "code" | "context" | "components";

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
	/** A generation runs: AI actions wait */
	busy: boolean;
	/** Makes an alternate the picked version (undoable) */
	onPick: (file: string) => void;
	/** Opens compare mode on a variation group */
	onCompare: (base: string) => void;
	/** "Vary this": `count` new alternates of `target`, with an optional direction */
	onVary: (target: string, direction: string, count: number) => void;
	/** Takes `section` of `source` into `receiver` */
	onMix: (receiver: string, source: string, section: string) => void;
	/** Content of the Context tab (PRODUCT.md and DESIGN.md) */
	contextPanel: React.ReactNode;
	/** Content of the Components tab */
	componentsPanel: React.ReactNode;
	/** Content of the Code tab: the selected file's structure and source */
	codePanel: React.ReactNode;
	/** Top of the Design tab: props of the element selected in the structure */
	propsPanel?: React.ReactNode;
	/** Suggestions the user hasn't seen yet, shown on the Components tab */
	componentsBadge?: number;
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
	const { frames, selection, tab, onTabChange, onSelect } = props;
	const selectedSet = new Set(selection);
	const selected = frames.filter((frame) => selectedSet.has(frame.file));
	const single = selected.length === 1 ? selected[0]! : null;

	return (
		<aside
			className={cn(
				"flex shrink-0 flex-col border-l bg-background transition-[width] duration-150",
				tab === "design" ? "w-72" : "w-[440px]",
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
						<Tooltip>
							<TooltipTrigger asChild>
								<TabsTrigger value="context" className="px-2 text-[13px]">
									Context
								</TabsTrigger>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								PRODUCT.md and DESIGN.md <Kbd>{CONTEXT_VIEW_KEYS}</Kbd>
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<TabsTrigger value="components" className="gap-1 px-2 text-[13px]">
									Components
									{props.componentsBadge ? (
										<span
											className="min-w-4 rounded-full bg-primary/12 px-1 text-[11px] leading-4 font-medium text-primary tabular-nums"
											aria-label={`${props.componentsBadge} new ${props.componentsBadge === 1 ? "suggestion" : "suggestions"}`}
										>
											{props.componentsBadge}
										</span>
									) : null}
								</TabsTrigger>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								Project components and the library <Kbd>{COMPONENTS_VIEW_KEYS}</Kbd>
							</TooltipContent>
						</Tooltip>
					</TabsList>
				</div>
			</Tabs>

			{tab === "context" ? (
				props.contextPanel
			) : tab === "components" ? (
				props.componentsPanel
			) : tab === "code" ? (
				props.codePanel
			) : (
				// One scroll for the whole tab, so long props lists never push the screens away
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
					{props.propsPanel}
					{single ? <FrameDetails frame={single} {...props} /> : null}
					{selected.length > 1 ? <MultiDetails count={selected.length} {...props} /> : null}

					<div className={cn("flex flex-col", selected.length > 0 && "border-t")}>
						<div className="px-4 pt-4 pb-2 text-xs font-medium text-subtle-foreground">Screens</div>
						<div className="flex flex-col gap-0.5 px-2 pb-3">
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
				</div>
			)}
		</aside>
	);
}

function FrameDetails(props: InspectorProps & { frame: Frame }) {
	const { frame, onChange, onEndStep, onDuplicate, onDelete } = props;
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
			{isScreenFile(frame.file) ? <Variations key={frame.file} {...props} /> : null}
			<Separator />
			<SelectionActions label="screen" onDuplicate={onDuplicate} onDelete={onDelete} />
		</div>
	);
}

/**
 * The selected screen's variation group (decision 0004): pick, compare, vary
 * and mix. Groups follow from file names, so a screen without alternates just
 * offers "Vary this".
 */
function Variations({ frame, frames, files, busy, onSelect, onPick, onCompare, onVary, onMix }: InspectorProps & { frame: Frame }) {
	const group = groupOf(frame.file, Object.keys(files));
	const [preferred] = useVariations();
	const [direction, setDirection] = useState("");
	const [count, setCount] = useState(preferred > 1 ? preferred : 2);
	const others = group?.files.filter((file) => file !== frame.file) ?? [];
	const [source, setSource] = useState<string | null>(null);
	const [section, setSection] = useState("");
	const mixSource = source && others.includes(source) ? source : (others[0] ?? null);

	const vary = () => {
		onVary(frame.file, direction, count);
		setDirection("");
	};
	const mix = () => {
		if (!mixSource || !section.trim()) return;
		onMix(frame.file, mixSource, section);
		setSection("");
	};

	return (
		<>
			<Separator />
			<section className="flex flex-col gap-2">
				<div className="flex h-5 items-center justify-between">
					<h3 className="text-xs font-medium text-subtle-foreground">Variations</h3>
					{group ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground" onClick={() => onCompare(group.base)}>
									<Columns2 />
									Compare
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								Compare side by side <Kbd>{COMPARE_KEYS}</Kbd>
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>

				{group ? (
					<div className="flex flex-col gap-0.5">
						{group.files.map((file) => {
							const picked = file === group.picked;
							return (
								<div
									key={file}
									className={cn(
										"group/row flex h-7 items-center gap-1 rounded-md pr-0.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground",
										file === frame.file && "bg-accent text-accent-foreground",
									)}
								>
									<button
										type="button"
										title={file}
										onClick={() => onSelect(file, false)}
										className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
									>
										<Check className={cn("size-3.5 shrink-0", !picked && "invisible")} aria-label={picked ? "Picked" : undefined} />
										<span className="truncate">{variationName(file, frames)}</span>
									</button>
									{isAlternate(file) ? (
										<Button
											variant="ghost"
											size="xs"
											disabled={busy}
											onClick={() => onPick(file)}
											title={`Make this ${group.picked ? `${variationName(group.base, frames)}; the current one becomes an alternate` : "the screen again"}`}
											className="h-6 px-1.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
										>
											Pick
										</Button>
									) : null}
								</div>
							);
						})}
						{group.picked ? null : (
							<p className="px-2 pt-1 text-xs text-subtle-foreground">The picked version was deleted. Pick one to take its place.</p>
						)}
					</div>
				) : null}

				<div className="flex flex-col gap-1.5">
					<input
						value={direction}
						onChange={(event) => setDirection(event.target.value)}
						onKeyDown={(event) => event.key === "Enter" && !busy && vary()}
						placeholder="bolder, denser…"
						aria-label="Direction for new variations (optional)"
						className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
					/>
					<div className="flex items-center gap-1">
						<VariationsPicker value={count} onChange={setCount} />
						<Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={vary}>
							<Shuffle />
							Vary this
						</Button>
					</div>
				</div>

				{group && mixSource ? (
					<div className="flex flex-col gap-1.5 pt-1">
						<span className="text-xs text-muted-foreground">Mix in a section</span>
						<div className="flex items-center gap-1">
							<input
								value={section}
								onChange={(event) => setSection(event.target.value)}
								onKeyDown={(event) => event.key === "Enter" && !busy && mix()}
								placeholder="header"
								aria-label="Section to take"
								className="h-8 w-20 min-w-0 shrink-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
							/>
							<span className="text-xs text-subtle-foreground">from</span>
							<DropdownMenu modal={false}>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="xs" className="h-8 min-w-0 flex-1 justify-between gap-1 px-2 text-[13px] text-muted-foreground" aria-label="Variation to take it from">
										<span className="truncate">{variationName(mixSource, frames)}</span>
										<ChevronDown className="size-3 shrink-0" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-44">
									<DropdownMenuRadioGroup value={mixSource} onValueChange={setSource}>
										{others.map((file) => (
											<DropdownMenuRadioItem key={file} value={file} className="text-[13px]">
												{variationName(file, frames)}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
						<Button variant="outline" size="sm" disabled={busy || !section.trim()} onClick={mix}>
							<span className="truncate">Mix into {variationName(frame.file, frames)}</span>
						</Button>
					</div>
				) : null}
			</section>
		</>
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
