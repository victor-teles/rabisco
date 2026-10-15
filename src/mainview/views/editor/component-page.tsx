import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Component, Monitor, Plus, Smartphone, Tablet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ScreenFrame } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { writeSlotText } from "@/lib/props";
import { cn } from "@/lib/utils";
import type { ComponentExport } from "../../../shared/components/api";
import { componentPageModule, componentStates, previewPath, variantAxes } from "../../../shared/components/preview";
import {
	clearSlot,
	componentSlots,
	slotCounts,
	slotUsages,
	type ComponentSlot,
	type SlotFill,
	type SlotUsage,
} from "../../../shared/components/slots";
import type { ProjectComponent } from "../../../shared/components/usages";
import {
	addVariantOption,
	optionCounts,
	optionError,
	optionName,
	removeVariantOption,
	setVariantClasses,
	tableFor,
	variantUsages,
	type VariantAxis,
	type VariantUsage,
} from "../../../shared/components/variant-edit";
import { isComponentFile, isScreenFile, screenNameFromPath } from "../../../shared/project";
import type { Device, Frame, ProjectFiles } from "../../../shared/types";
import { isTyping } from "./shortcuts";
import { SlotContent } from "./slot-fill";

const PAGE_WIDTH = 800;

const DEVICE_ICONS: Record<Device, typeof Monitor> = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export type ComponentPageProps = {
	component: ProjectComponent | null;
	files: ProjectFiles;
	frames: Frame[];
	onClose: () => void;
	/** One undo step */
	onChangeFile: (path: string, source: string) => void;
	onShowScreens: (files: string[]) => void;
	onSelectComponent: (path: string) => void;
	/** Shows the screen and selects the element in it */
	onSelectElement: (file: string, start: number) => void;
};

/** Every variant and state of a component side by side, its variants as editable classes, and every usage */
export function ComponentPage({ component, onClose, ...props }: ComponentPageProps) {
	return (
		<Dialog open={!!component} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="flex h-[min(48rem,90vh)] flex-col gap-0 p-0 sm:max-w-6xl"
				// Esc in a field puts its value back; it closes the page only from outside one
				onEscapeKeyDown={(event) => {
					if (event.target instanceof HTMLElement && isTyping(event.target)) event.preventDefault();
				}}
			>
				{component ? <PageBody key={component.path} component={component} onClose={onClose} {...props} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function PageBody({
	component,
	files,
	frames,
	onClose,
	onChangeFile,
	onShowScreens,
	onSelectComponent,
	onSelectElement,
}: ComponentPageProps & { component: ProjectComponent }) {
	const [exportName, setExportName] = useState(component.exports[0]?.name ?? "");
	const exp = component.exports.find((e) => e.name === exportName) ?? component.exports[0];
	const source = files[component.path] ?? "";

	return (
		<>
			<div className="flex h-12 shrink-0 items-center gap-3 border-b pr-12 pl-4">
				<DialogTitle className="text-sm font-medium">{exp?.name ?? screenNameFromPath(component.path)}</DialogTitle>
				<DialogDescription className="truncate font-mono text-[11px] text-subtle-foreground">
					{component.path}
				</DialogDescription>
				<div className="flex-1" />
				{component.exports.length > 1 ? (
					<div role="tablist" aria-label="Exports" className="flex gap-0.5 rounded-md bg-muted p-0.5">
						{component.exports.map((e) => (
							<button
								key={e.name}
								type="button"
								role="tab"
								aria-selected={e.name === exp?.name}
								onClick={() => setExportName(e.name)}
								className={cn(
									"h-6 rounded-[5px] px-2 text-xs text-muted-foreground",
									e.name === exp?.name && "bg-background text-foreground shadow-xs",
								)}
							>
								{e.name}
							</button>
						))}
					</div>
				) : null}
			</div>

			{exp ? (
				<div className="flex min-h-0 flex-1">
					<PagePreview path={component.path} component={exp} files={files} />
					<aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
						<VariantsEditor
							path={component.path}
							source={source}
							component={exp}
							files={files}
							onChangeFile={onChangeFile}
						/>
						<SlotsEditor
							files={files}
							frames={frames}
							path={component.path}
							component={exp}
							onChangeFile={onChangeFile}
							onSelectElement={(file, start) => {
								onClose();
								onSelectElement(file, start);
							}}
						/>
						<Usages
							files={files}
							frames={frames}
							path={component.path}
							component={exp}
							onOpen={(file) => {
								onClose();

								if (isComponentFile(file)) onSelectComponent(file);
								else onShowScreens([file]);
							}}
						/>
					</aside>
				</div>
			) : (
				<p className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
					This file exports no components Rabisco can show.
				</p>
			)}

			<div className="flex h-9 shrink-0 items-center gap-1.5 border-t px-4 text-[11px] text-subtle-foreground">
				Edits write {component.path}, and every screen that uses it updates. Each one is a single undo step:
				<Kbd>⌘Z</Kbd>
			</div>
		</>
	);
}

/** Scales the page down to fit the pane, never up */
function useFitScale(width: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	useEffect(() => {
		const element = ref.current;

		if (!element) return;

		const observer = new ResizeObserver(([entry]) => {
			if (entry) setScale(Math.min(1, (entry.contentRect.width - 1) / width));
		});

		observer.observe(element);

		return () => observer.disconnect();
	}, [width]);

	return [ref, scale] as const;
}

function PagePreview({ path, component, files }: { path: string; component: ComponentExport; files: ProjectFiles }) {
	const entry = previewPath(`${component.name}Page`);
	const [contentHeight, setContentHeight] = useState(400);
	const [ref, scale] = useFitScale(PAGE_WIDTH);
	const height = Math.min(4000, Math.max(320, contentHeight));
	const module = useMemo(() => componentPageModule({ componentPath: path, component }), [path, component]);

	const pageFiles = useMemo(() => {
		const next: ProjectFiles = { [entry]: module };

		for (const [file, text] of Object.entries(files))
			if (isComponentFile(file) || file === "DESIGN.md") next[file] = text;

		return next;
	}, [files, entry, module]);

	return (
		<div className="min-w-0 flex-1 overflow-y-auto bg-muted/40 p-6">
			<div ref={ref} className="w-full">
				<div
					className="relative overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.07)]"
					style={{ width: PAGE_WIDTH * scale, height: height * scale }}
				>
					<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
						<ScreenFrame
							entry={entry}
							files={pageFiles}
							width={PAGE_WIDTH}
							height={height}
							onContentHeight={setContentHeight}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function PanelHeading({ children, count }: { children: React.ReactNode; count?: number }) {
	return (
		<h3 className="flex items-center gap-1.5 text-xs font-medium text-subtle-foreground">
			{children}
			{count !== undefined ? <span className="font-normal tabular-nums">{count}</span> : null}
		</h3>
	);
}

function VariantsEditor({
	path,
	source,
	component,
	files,
	onChangeFile,
}: {
	path: string;
	source: string;
	component: ComponentExport;
	files: ProjectFiles;
	onChangeFile: (path: string, source: string) => void;
}) {
	const axes = variantAxes(component);
	const states = componentStates(component);
	const table = useMemo(() => tableFor(source, Object.keys(component.variants)), [source, component]);

	const usages = useMemo(
		() =>
			variantUsages(
				files,
				path,
				component.name,
				variantAxes(component).map((axis) => axis.name),
			),
		[files, path, component],
	);

	const write = (next: string | null, message: string) => {
		if (next === null || next === source) return;
		onChangeFile(path, next);
		toast(message, { id: "component-page", description: "Press ⌘Z to undo." });
	};

	return (
		<section aria-label="Variants" className="flex flex-col gap-4 border-b p-4">
			<PanelHeading count={axes.length || undefined}>Variants</PanelHeading>
			{!axes.length ? (
				<p className="text-xs text-muted-foreground">
					{component.name} has no variants. Ask the chat to add a <span className="font-mono">cva</span> table, then
					edit its options here.
				</p>
			) : !table ? (
				<p className="text-xs text-muted-foreground">
					These come from the props type. Variants in a <span className="font-mono">cva</span> table can be edited here.
				</p>
			) : null}

			{table
				? table.axes.map((axis) => (
						<AxisEditor
							key={axis.name}
							axis={axis}
							counts={optionCounts(usages, axis.name, axis.default)}
							onSetClasses={(option, classes) =>
								write(
									setVariantClasses(source, table.name, axis.name, option, classes),
									`Updated ${axis.name} ${option}`,
								)
							}
							onAdd={(option, classes) =>
								write(
									addVariantOption(source, table.name, axis.name, option, classes),
									`Added ${optionName(option)} to ${axis.name}`,
								)
							}
							onRemove={(option) =>
								write(removeVariantOption(source, table.name, axis.name, option), `Removed ${axis.name} ${option}`)
							}
						/>
					))
				: axes.map((axis) => (
						<div key={axis.name} className="flex flex-col gap-1">
							<span className="text-[13px] font-medium">{axis.name}</span>
							<span className="font-mono text-[11px] text-muted-foreground">{axis.options.join(" · ")}</span>
						</div>
					))}

			{states.length ? (
				<div className="flex flex-col gap-1">
					<span className="text-[13px] font-medium">States</span>
					<span className="font-mono text-[11px] text-muted-foreground">{states.join(" · ")}</span>
				</div>
			) : null}
		</section>
	);
}

function AxisEditor({
	axis,
	counts,
	onSetClasses,
	onAdd,
	onRemove,
}: {
	axis: VariantAxis;
	counts: Map<string, number>;
	onSetClasses: (option: string, classes: string) => void;
	onAdd: (option: string, classes: string) => void;
	onRemove: (option: string) => void;
}) {
	const [adding, setAdding] = useState(false);
	const dynamic = counts.get("*") ?? 0;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<span className="text-[13px] font-medium">{axis.name}</span>
				{dynamic ? (
					<span className="text-[11px] text-subtle-foreground">{plural(dynamic, "usage")} set by code</span>
				) : null}
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground"
					aria-label={`Add an option to ${axis.name}`}
					aria-pressed={adding}
					onClick={() => setAdding((on) => !on)}
				>
					<Plus />
				</Button>
			</div>
			<ul className="flex flex-col gap-2" aria-label={`${axis.name} options`}>
				{axis.options.map((option) => (
					<OptionRow
						key={option.name}
						name={option.name}
						classes={option.classes}
						isDefault={axis.default === option.name}
						count={counts.get(option.name) ?? 0}
						onSetClasses={(classes) => onSetClasses(option.name, classes)}
						onRemove={() => onRemove(option.name)}
					/>
				))}
			</ul>
			{adding ? (
				<AddOptionForm
					axis={axis}
					onAdd={(option, classes) => {
						onAdd(option, classes);
						setAdding(false);
					}}
					onClose={() => setAdding(false)}
				/>
			) : null}
		</div>
	);
}

function OptionRow({
	name,
	classes,
	isDefault,
	count,
	onSetClasses,
	onRemove,
}: {
	name: string;
	classes: string | null;
	isDefault: boolean;
	count: number;
	onSetClasses: (classes: string) => void;
	onRemove: () => void;
}) {
	const [draft, setDraft] = useState(classes ?? "");
	const [prior, setPrior] = useState(classes);

	if (prior !== classes) {
		setPrior(classes);
		setDraft(classes ?? "");
	}

	const commit = () => {
		if (classes !== null && draft.trim() !== classes.trim()) onSetClasses(draft);
	};

	const removable = !isDefault && count === 0;

	const why = isDefault
		? "The default option can't be removed"
		: count
			? `${plural(count, "usage")} pick it. Change them first`
			: `Remove ${name}`;

	return (
		<li className="group/option flex flex-col gap-1">
			<div className="flex items-center gap-1.5">
				<span className="truncate font-mono text-xs">{name}</span>
				{isDefault ? <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">default</span> : null}
				<div className="flex-1" />
				<span className="text-[11px] text-subtle-foreground tabular-nums">
					{count ? plural(count, "use") : "Unused"}
				</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="opacity-0 group-hover/option:opacity-100 focus-within:opacity-100">
							<Button
								variant="ghost"
								size="icon-xs"
								className="text-muted-foreground"
								aria-label={`Remove ${name}`}
								disabled={!removable}
								onClick={onRemove}
							>
								<Trash2 />
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent side="left">{why}</TooltipContent>
				</Tooltip>
			</div>
			{classes === null ? (
				<p className="text-[11px] text-subtle-foreground">Set by an expression. Edit it in the code view.</p>
			) : (
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
						else if (event.key === "Escape") setDraft(classes);
					}}
					aria-label={`${name} classes`}
					spellCheck={false}
					placeholder="No classes"
					className="h-7 font-mono text-[11px] md:text-[11px]"
				/>
			)}
		</li>
	);
}

function AddOptionForm({
	axis,
	onAdd,
	onClose,
}: {
	axis: VariantAxis;
	onAdd: (option: string, classes: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [classes, setClasses] = useState("");
	const [touched, setTouched] = useState(false);
	const error = optionError(axis, name);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setTouched(true);

		if (!error) onAdd(name, classes);
	};

	return (
		<form
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
			className="flex flex-col gap-1.5 rounded-md bg-accent/60 p-2"
		>
			<Input
				autoFocus
				value={name}
				onChange={(event) => setName(event.target.value)}
				aria-label="Option name"
				aria-invalid={touched && !!error}
				placeholder="Option name, like ghost"
				spellCheck={false}
				className="h-7 text-xs md:text-xs"
			/>
			<Input
				value={classes}
				onChange={(event) => setClasses(event.target.value)}
				aria-label="Option classes"
				placeholder="Classes, like bg-transparent hover:bg-accent"
				spellCheck={false}
				className="h-7 font-mono text-[11px] md:text-[11px]"
			/>
			<div className="flex items-center gap-1">
				{touched && error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}
				<div className="flex-1" />
				<Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" size="xs">
					Add
				</Button>
			</div>
		</form>
	);
}

const FILL_WORDS: Record<SlotFill["kind"], string> = {
	text: "text",
	elements: "elements",
	code: "code",
	empty: "empty",
};

function usageLabel(file: string, frames: Frame[]) {
	return (
		frames.find((f) => f.file === file)?.name ??
		(isComponentFile(file) ? file.replace(/^components\//, "") : screenNameFromPath(file))
	);
}

function SlotsEditor({
	files,
	frames,
	path,
	component,
	onChangeFile,
	onSelectElement,
}: {
	files: ProjectFiles;
	frames: Frame[];
	path: string;
	component: ComponentExport;
	onChangeFile: (path: string, source: string) => void;
	onSelectElement: (file: string, start: number) => void;
}) {
	const slots = componentSlots(component);
	const usages = useMemo(() => slotUsages(files, path, component), [files, path, component]);

	const write = (usage: SlotUsage, next: string | null, message: string) => {
		const source = files[usage.path];

		if (next === null || source === undefined || next === source) return;
		onChangeFile(usage.path, next);
		toast(message, { id: "component-page", description: "Press ⌘Z to undo." });
	};

	return (
		<section aria-label="Slots" className="flex flex-col gap-4 border-b p-4">
			<PanelHeading count={slots.length || undefined}>Slots</PanelHeading>
			{!slots.length ? (
				<p className="text-xs text-muted-foreground">
					{component.name} takes no content. A <span className="font-mono">children</span> or{" "}
					<span className="font-mono">ReactNode</span> prop is a slot each usage fills in.
				</p>
			) : (
				slots.map((slot) => (
					<SlotRow
						key={slot.name}
						slot={slot}
						usages={usages}
						frames={frames}
						onWriteText={(usage, text) =>
							write(
								usage,
								writeSlotText(files[usage.path] ?? "", usage.start, slot.name, text),
								`Updated ${slot.name} in ${usageLabel(usage.path, frames)}`,
							)
						}
						onClear={(usage) =>
							write(
								usage,
								clearSlot(files[usage.path] ?? "", usage.start, slot.name),
								`Emptied ${slot.name} in ${usageLabel(usage.path, frames)}`,
							)
						}
						onSelectElement={onSelectElement}
					/>
				))
			)}
		</section>
	);
}

function SlotRow({
	slot,
	usages,
	frames,
	onWriteText,
	onClear,
	onSelectElement,
}: {
	slot: ComponentSlot;
	usages: SlotUsage[];
	frames: Frame[];
	onWriteText: (usage: SlotUsage, text: string) => void;
	onClear: (usage: SlotUsage) => void;
	onSelectElement: (file: string, start: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const counts = slotCounts(usages, slot.name);

	const summary = (["text", "elements", "code", "empty"] as const).flatMap((kind) =>
		counts[kind] ? [`${counts[kind]} ${FILL_WORDS[kind]}`] : [],
	);

	return (
		<div className="flex flex-col gap-1.5">
			<button
				type="button"
				aria-expanded={open}
				disabled={!usages.length}
				onClick={() => setOpen((on) => !on)}
				className="-mx-1 flex items-center gap-1.5 rounded-md px-1 text-left enabled:hover:bg-accent/60"
			>
				<ChevronRight
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
						!usages.length && "opacity-0",
					)}
				/>
				<span className="truncate font-mono text-xs">{slot.name}</span>
				{!slot.optional ? (
					<span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">required</span>
				) : null}
				<div className="flex-1" />
				<span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">
					{usages.length ? summary.join(" · ") : "Unused"}
				</span>
			</button>
			{open ? (
				<ul className="flex flex-col gap-1.5 pl-4" aria-label={`${slot.name} in each usage`}>
					{usages.map((usage) => (
						<SlotUsageRow
							key={`${usage.path}:${usage.start}`}
							slot={slot.name}
							usage={usage}
							label={usageLabel(usage.path, frames)}
							onWriteText={(text) => onWriteText(usage, text)}
							onClear={() => onClear(usage)}
							onSelectElement={(start) => onSelectElement(usage.path, start)}
						/>
					))}
				</ul>
			) : null}
		</div>
	);
}

function SlotUsageRow({
	slot,
	usage,
	label,
	onWriteText,
	onClear,
	onSelectElement,
}: {
	slot: string;
	usage: SlotUsage;
	label: string;
	onWriteText: (text: string) => void;
	onClear: () => void;
	onSelectElement: (start: number) => void;
}) {
	const fill = usage.fills[slot] ?? { kind: "empty" };
	const text = fill.kind === "text" ? fill.text : "";
	const [draft, setDraft] = useState(text);
	const [prior, setPrior] = useState(text);

	if (prior !== text) {
		setPrior(text);
		setDraft(text);
	}

	const commit = () => {
		if (draft.trim() !== text) onWriteText(draft.trim());
	};

	return (
		<li className="flex flex-col gap-1">
			<button
				type="button"
				title={`${usage.path}, line ${usage.line}`}
				onClick={() => onSelectElement(usage.start)}
				className="flex min-w-0 items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
			>
				<span className="truncate">{label}</span>
				<span className="shrink-0 text-subtle-foreground tabular-nums">line {usage.line}</span>
			</button>
			{fill.kind === "elements" || fill.kind === "code" ? (
				<SlotContent slot={slot} fill={fill} onSelect={(element) => onSelectElement(element.start)} onClear={onClear} />
			) : (
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
						else if (event.key === "Escape") setDraft(text);
					}}
					aria-label={`${slot} in ${label}, line ${usage.line}`}
					placeholder="Empty"
					className="h-7 text-xs md:text-xs"
				/>
			)}
		</li>
	);
}

function Usages({
	files,
	frames,
	path,
	component,
	onOpen,
}: {
	files: ProjectFiles;
	frames: Frame[];
	path: string;
	component: ComponentExport;
	onOpen: (file: string) => void;
}) {
	const usages = useMemo(() => variantUsages(files, path, component.name, []), [files, path, component]);

	const byFile = useMemo(() => {
		const counts = new Map<string, VariantUsage[]>();

		for (const usage of usages) {
			const list = counts.get(usage.path) ?? [];
			list.push(usage);
			counts.set(usage.path, list);
		}

		return [...counts];
	}, [usages]);

	return (
		<section aria-label="Usages" className="flex flex-col gap-2 p-4">
			<PanelHeading count={usages.length}>Usages</PanelHeading>
			{!byFile.length ? (
				<p className="text-xs text-muted-foreground">No screen uses {component.name} yet. Drag it onto a screen.</p>
			) : (
				<div className="-mx-2 flex flex-col gap-0.5">
					{byFile.map(([file, found]) => {
						const frame = frames.find((f) => f.file === file);
						const Icon = !isScreenFile(file) ? Component : DEVICE_ICONS[frame?.device ?? "mobile"];

						const label =
							frame?.name ?? (isComponentFile(file) ? file.replace(/^components\//, "") : screenNameFromPath(file));

						return (
							<button
								key={file}
								type="button"
								title={file}
								onClick={() => onOpen(file)}
								className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								<Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
								<span className="flex-1 truncate">{label}</span>
								<span className="text-[11px] text-subtle-foreground tabular-nums">{found.length}</span>
							</button>
						);
					})}
				</div>
			)}
		</section>
	);
}
