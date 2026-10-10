import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Component, Monitor, Search, Smartphone, Sparkles, Tablet, X } from "lucide-react";
import { toast } from "sonner";
import { ScreenFrame } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateMedia,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { COMPONENT_MIME, componentDrag, type DragItem } from "@/lib/component-drop";
import { suggestionHover } from "@/lib/suggestion-hover";
import { cn } from "@/lib/utils";
import type { ComponentExport } from "../../../shared/components/api";
import { searchLibrary, type LibraryItem } from "../../../shared/components/library";
import {
	humanize,
	libraryPreviewModule,
	previewLayout,
	previewModule,
	previewPath,
	sampleProps,
	variantGridModule,
} from "../../../shared/components/preview";
import type { ProjectComponent } from "../../../shared/components/usages";
import type { DuplicateGroup } from "../../../shared/jsx";
import { isComponentFile, isScreenFile, screenNameFromPath } from "../../../shared/project";
import type { Device, Frame, ProjectFiles } from "../../../shared/types";

export type ComponentsPanelProps = {
	files: ProjectFiles;
	frames: Frame[];
	components: ProjectComponent[];
	selectedComponent: string | null;
	suggestions: DuplicateGroup[];
	busy: boolean;
	/** `null` clears the selection */
	onSelectComponent: (path: string | null) => void;
	onShowScreens: (files: string[]) => void;
	/** Returns why it failed, or null */
	onMakeComponent: (group: DuplicateGroup, name: string) => string | null;
	onDismissSuggestion: (key: string) => void;
};

const DEVICE_ICONS: Record<Device, typeof Monitor> = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

const THUMB = { width: 400, height: 260, scale: 0.5 };

const DETAIL_WIDTH = 640;

const DETAIL_SCALE = 0.6375;

type Entry = { path: string; component: ComponentExport; usedBy: string[] };

const matches = (query: string, ...texts: string[]) => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const haystack = texts.join(" ").toLowerCase();

	return words.every((word) => haystack.includes(word));
};

/** Stays the same object while those files don't change, so editing a screen never re-renders a preview */
function useDesignSystemFiles(files: ProjectFiles, include: (path: string) => boolean) {
	const next: ProjectFiles = {};

	for (const path of Object.keys(files)) if (include(path)) next[path] = files[path]!;
	const [previous, setPrevious] = useState(next);
	const keys = Object.keys(next);

	if (keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key])) return previous;
	setPrevious(next);

	return next;
}

const isSystemFile = (path: string) => isComponentFile(path) || path === "DESIGN.md";

const isDesignFile = (path: string) => path === "DESIGN.md";

function startDrag(event: React.DragEvent, item: DragItem, label: string) {
	componentDrag.start(item);
	event.dataTransfer.setData(COMPONENT_MIME, JSON.stringify(item));
	// WebKit only starts a drag that carries a standard type
	event.dataTransfer.setData("text/plain", label);
	event.dataTransfer.effectAllowed = "copy";
	// The drag layer is transparent: show a chip with the name instead
	const chip = document.createElement("div");
	chip.textContent = label;
	chip.className =
		"fixed -top-96 left-0 rounded-md border bg-popover px-2 py-1 text-[13px] font-medium text-popover-foreground shadow-sm";
	document.body.append(chip);
	event.dataTransfer.setDragImage(chip, 12, 12);
	requestAnimationFrame(() => chip.remove());
}

const endDrag = () => componentDrag.end();

/** WebKit cancels a drag whose source contains an iframe, so a transparent layer over the card is the draggable */
function DragCard({
	item,
	label,
	className,
	layer,
	children,
}: {
	item: DragItem;
	label: string;
	className?: string;
	layer?: React.HTMLAttributes<HTMLDivElement>;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("relative", className)}>
			{children}
			<div
				{...layer}
				draggable
				onDragStart={(event) => startDrag(event, item, label)}
				onDragEnd={endDrag}
				className="absolute inset-0 cursor-grab rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
			/>
		</div>
	);
}

export function ComponentsPanel(props: ComponentsPanelProps) {
	const { files, components, selectedComponent, suggestions, onSelectComponent } = props;
	const [query, setQuery] = useState("");
	const search = useRef<HTMLInputElement>(null);
	const systemFiles = useDesignSystemFiles(files, isSystemFile);
	const designFiles = useDesignSystemFiles(files, isDesignFile);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			const typing = !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
			const find = (event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyF";

			if (event.defaultPrevented || (!find && (typing || event.key !== "/" || event.metaKey || event.ctrlKey))) return;
			event.preventDefault();
			search.current?.focus();
			search.current?.select();
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const entries = useMemo<Entry[]>(
		() => components.flatMap(({ path, exports, usedBy }) => exports.map((component) => ({ path, component, usedBy }))),
		[components],
	);

	const shown = entries.filter((entry) =>
		matches(query, entry.component.name, humanize(entry.component.name), entry.path),
	);

	const library = useMemo(() => searchLibrary(query), [query]);
	const shownSuggestions = suggestions.filter((group) => matches(query, group.suggestedName));
	const detail = selectedComponent ? components.find((c) => c.path === selectedComponent) : undefined;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
				<Search className="size-3.5 shrink-0 text-subtle-foreground" />
				<input
					ref={search}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.stopPropagation();

						if (query) setQuery("");
						else event.currentTarget.blur();
					}}
					placeholder="Search components"
					aria-label="Search components"
					className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle-foreground"
				/>
				{query ? (
					<Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
						<X />
					</Button>
				) : (
					<Kbd>/</Kbd>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{detail ? (
					<ComponentDetail
						key={detail.path}
						component={detail}
						systemFiles={systemFiles}
						{...props}
						onBack={() => onSelectComponent(null)}
					/>
				) : (
					<div className="flex flex-col gap-6 p-4">
						{shownSuggestions.length ? <Suggestions groups={shownSuggestions} {...props} /> : null}

						<PanelSection title="Project" count={entries.length ? shown.length : undefined}>
							{entries.length === 0 ? (
								<PanelEmpty icon={<Component />} title="No components yet">
									Rabisco creates them as it generates screens, or select repeated structure and use{" "}
									<span className="text-foreground">Make component</span>.
									{suggestions.length ? " The suggestions above are a good start." : ""}
								</PanelEmpty>
							) : shown.length === 0 ? (
								<PanelEmpty title={`No project components match “${query}”.`} />
							) : (
								<div className="grid grid-cols-2 gap-x-2 gap-y-3">
									{shown.map((entry) => (
										<ComponentCard
											key={`${entry.path}#${entry.component.name}`}
											entry={entry}
											systemFiles={systemFiles}
											selected={selectedComponent === entry.path}
											onSelect={onSelectComponent}
										/>
									))}
								</div>
							)}
						</PanelSection>

						<PanelSection title="Library" count={library.length}>
							{library.length === 0 ? (
								<PanelEmpty title={`No library components match “${query}”.`} />
							) : (
								<div className="grid grid-cols-2 gap-x-2 gap-y-3">
									{library.map((item) => (
										<LibraryCard key={item.id} item={item} designFiles={designFiles} />
									))}
								</div>
							)}
						</PanelSection>
					</div>
				)}
			</div>
		</div>
	);
}

function PanelEmpty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
	return (
		<EmptyState variant="compact">
			{icon ? <EmptyStateMedia>{icon}</EmptyStateMedia> : null}
			<EmptyStateContent>
				<EmptyStateHeader>
					<EmptyStateTitle>{title}</EmptyStateTitle>
					{children ? <EmptyStateDescription>{children}</EmptyStateDescription> : null}
				</EmptyStateHeader>
			</EmptyStateContent>
		</EmptyState>
	);
}

function PanelSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-center gap-1.5 text-xs font-medium text-subtle-foreground">
				{title}
				{count !== undefined ? <span className="font-normal tabular-nums">{count}</span> : null}
			</h3>
			{children}
		</section>
	);
}

/** Off-screen previews mount nothing */
function useNearViewport<T extends Element>() {
	const ref = useRef<T>(null);
	const [near, setNear] = useState(false);
	useEffect(() => {
		const element = ref.current;

		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), { rootMargin: "200px 0px" });
		observer.observe(element);

		return () => observer.disconnect();
	}, []);

	return [ref, near] as const;
}

/** Memoized: same files, no re-render */
const Preview = memo(function Preview({
	entry,
	files,
	width,
	height,
	scale,
	className,
	onContentHeight,
}: {
	entry: string;
	files: ProjectFiles;
	width: number;
	height: number;
	scale: number;
	className?: string;
	onContentHeight?: (height: number) => void;
}) {
	const [ref, near] = useNearViewport<HTMLDivElement>();

	return (
		<div
			ref={ref}
			className={cn("relative overflow-hidden rounded-md bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.07)]", className)}
			style={{ width: width * scale, height: height * scale }}
		>
			{near ? (
				<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
					<ScreenFrame entry={entry} files={files} width={width} height={height} onContentHeight={onContentHeight} />
				</div>
			) : null}
		</div>
	);
});

function useComponentPreview(path: string, component: ComponentExport, systemFiles: ProjectFiles, variants = false) {
	const entry = previewPath(variants ? `${component.name}Variants` : component.name);

	const module = useMemo(
		() =>
			(variants && variantGridModule({ componentPath: path, component })) ||
			previewModule({
				componentPath: path,
				exportName: component.name,
				props: sampleProps(component),
				layout: previewLayout(component.name),
			}),
		[path, component, variants],
	);

	const files = useMemo(() => ({ ...systemFiles, [entry]: module }), [systemFiles, entry, module]);

	return { entry, files };
}

function usageLabel(usedBy: string[]) {
	const screens = usedBy.filter(isScreenFile).length;
	const others = usedBy.length - screens;

	const parts = [
		screens ? `${screens} ${screens === 1 ? "screen" : "screens"}` : "",
		others ? `${others} ${others === 1 ? "component" : "components"}` : "",
	];

	const text = parts.filter(Boolean).join(", ");

	return text ? `Used by ${text}` : "Not used yet";
}

const cardClass = "group/card flex flex-col gap-1.5 rounded-lg p-1 text-left";

function ComponentCard({
	entry,
	systemFiles,
	selected,
	onSelect,
}: {
	entry: Entry;
	systemFiles: ProjectFiles;
	selected: boolean;
	onSelect: (path: string) => void;
}) {
	const { path, component, usedBy } = entry;
	const preview = useComponentPreview(path, component, systemFiles);

	return (
		<DragCard
			item={{ kind: "component", path, name: component.name }}
			label={component.name}
			className={cn(cardClass, "hover:bg-accent", selected && "bg-accent")}
			layer={{
				role: "button",
				tabIndex: 0,
				title: `${component.name}: click to edit, drag onto a screen to add`,
				"aria-label": `${component.name}, ${usageLabel(usedBy)}`,
				"aria-pressed": selected,
				onClick: () => onSelect(path),
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onSelect(path);
					}
				},
			}}
		>
			<Preview entry={preview.entry} files={preview.files} {...THUMB} />
			<div className="flex min-w-0 flex-col px-0.5">
				<span className="truncate text-[13px] font-medium">{component.name}</span>
				<span className="truncate text-xs text-subtle-foreground">{usageLabel(usedBy)}</span>
			</div>
		</DragCard>
	);
}

function LibraryCard({ item, designFiles }: { item: LibraryItem; designFiles: ProjectFiles }) {
	const entry = previewPath(`library ${item.id}`);
	const files = useMemo(() => ({ ...designFiles, [entry]: libraryPreviewModule(item) }), [designFiles, entry, item]);

	return (
		<DragCard
			item={{ kind: "library", id: item.id }}
			label={item.title}
			className={cn(cardClass, "hover:bg-accent")}
			layer={{
				title: `${item.description} Drag onto a screen to add it.`,
				onClick: () => toast(`Drag ${item.title} onto a screen to add it`, { id: "library-hint" }),
			}}
		>
			<Preview entry={entry} files={files} {...THUMB} />
			<div className="flex min-w-0 flex-col px-0.5">
				<span className="truncate text-[13px] font-medium">{item.title}</span>
				<span className="truncate text-xs text-subtle-foreground">{item.description}</span>
			</div>
		</DragCard>
	);
}

function ComponentDetail({
	component,
	systemFiles,
	frames,
	onBack,
	onSelectComponent,
	onShowScreens,
}: ComponentsPanelProps & { component: ProjectComponent; systemFiles: ProjectFiles; onBack: () => void }) {
	const name = component.exports[0]?.name ?? screenNameFromPath(component.path);

	return (
		<div className="flex flex-col gap-5 p-4">
			<div className="flex flex-col gap-1">
				<Button variant="ghost" size="xs" className="-ml-1.5 self-start text-muted-foreground" onClick={onBack}>
					<ArrowLeft />
					Components
				</Button>
				<span className="truncate font-mono text-[11px] text-subtle-foreground" title={component.path}>
					{component.path}
				</span>
			</div>

			{component.exports.length === 0 ? (
				<PanelEmpty title="This file exports no components Rabisco can preview." />
			) : (
				component.exports.map((exp) => (
					<ExportPreview key={exp.name} path={component.path} component={exp} systemFiles={systemFiles} />
				))
			)}

			<section className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-subtle-foreground">Used by</h3>
				{component.usedBy.length === 0 ? (
					<PanelEmpty title="No screen uses it yet">Drag it onto a screen to add it.</PanelEmpty>
				) : (
					<div className="-mx-2 flex flex-col gap-0.5">
						{component.usedBy.map((file) => {
							const frame = frames.find((f) => f.file === file);
							const Icon = !isScreenFile(file) ? Component : DEVICE_ICONS[frame?.device ?? "mobile"];

							const label =
								frame?.name ?? (isComponentFile(file) ? file.replace(/^components\//, "") : screenNameFromPath(file));

							return (
								<button
									key={file}
									type="button"
									title={file}
									onClick={() => (isComponentFile(file) ? onSelectComponent(file) : onShowScreens([file]))}
									className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
								>
									<Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
									<span className="truncate">{label}</span>
								</button>
							);
						})}
					</div>
				)}
			</section>

			<div className="flex gap-2.5 rounded-lg border p-3 text-[13px] text-muted-foreground">
				<Sparkles className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
				<p>
					<span className="font-medium text-foreground">Edit with AI.</span> Describe a change in the chat and Rabisco
					edits {name}. Every screen that uses it updates.
				</p>
			</div>
		</div>
	);
}

function ExportPreview({
	path,
	component,
	systemFiles,
}: {
	path: string;
	component: ComponentExport;
	systemFiles: ProjectFiles;
}) {
	const preview = useComponentPreview(path, component, systemFiles, true);
	const [contentHeight, setContentHeight] = useState(240);
	const height = Math.min(1200, Math.max(240, contentHeight));

	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-[13px] font-medium">{component.name}</h3>
			<DragCard
				item={{ kind: "component", path, name: component.name }}
				label={component.name}
				layer={{ title: `Drag ${component.name} onto a screen to add it` }}
			>
				<Preview
					entry={preview.entry}
					files={preview.files}
					width={DETAIL_WIDTH}
					height={height}
					scale={DETAIL_SCALE}
					onContentHeight={setContentHeight}
				/>
			</DragCard>
		</section>
	);
}

function Suggestions({
	groups,
	busy,
	onMakeComponent,
	onDismissSuggestion,
	onShowScreens,
}: ComponentsPanelProps & { groups: DuplicateGroup[] }) {
	return (
		<PanelSection title="Suggestions">
			<div className="-mx-2 flex flex-col gap-0.5">
				{groups.map((group) => (
					<SuggestionRow
						key={group.key}
						group={group}
						busy={busy}
						onMake={(name) => onMakeComponent(group, name)}
						onDismiss={() => onDismissSuggestion(group.key)}
						onShow={() => onShowScreens([...new Set(group.occurrences.map((o) => o.path))].filter(isScreenFile))}
					/>
				))}
			</div>
		</PanelSection>
	);
}

function occurrenceLabel(group: DuplicateGroup) {
	const paths = new Set(group.occurrences.map((o) => o.path));
	const allScreens = [...paths].every(isScreenFile);
	const noun = allScreens ? (paths.size === 1 ? "screen" : "screens") : paths.size === 1 ? "file" : "files";

	return `${group.occurrences.length} times in ${paths.size} ${noun}`;
}

function SuggestionRow({
	group,
	busy,
	onMake,
	onDismiss,
	onShow,
}: {
	group: DuplicateGroup;
	busy: boolean;
	onMake: (name: string) => string | null;
	onDismiss: () => void;
	onShow: () => void;
}) {
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState(group.suggestedName);
	const [error, setError] = useState<string | null>(null);
	const [pointing, setPointing] = useState(false);
	const [focused, setFocused] = useState(false);
	const showing = pointing || focused || naming;

	useEffect(() => {
		if (!showing) return;
		suggestionHover.set(group);

		return () => suggestionHover.clear(group.key);
	}, [showing, group]);

	const make = () => {
		if (!name.trim()) return;
		const reason = onMake(name.trim());
		setError(reason);

		if (!reason) setNaming(false);
	};

	if (naming) {
		return (
			<div
				className="flex flex-col gap-1.5 rounded-md bg-accent/60 p-2"
				onPointerEnter={() => setPointing(true)}
				onPointerLeave={() => setPointing(false)}
			>
				<div className="flex items-center gap-1">
					<input
						autoFocus
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						onFocus={(event) => event.currentTarget.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !busy) make();
							else if (event.key === "Escape") {
								event.stopPropagation();
								setNaming(false);
								setError(null);
							}
						}}
						aria-label="Component name"
						aria-invalid={!!error}
						className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13px] outline-none focus:border-ring aria-invalid:border-destructive"
					/>
					<Button size="xs" className="h-7" disabled={busy || !name.trim()} onClick={make}>
						Make
					</Button>
					<Button variant="ghost" size="xs" className="h-7 text-muted-foreground" onClick={() => setNaming(false)}>
						Cancel
					</Button>
				</div>
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : (
					<p className="text-xs text-subtle-foreground">
						Moves it to components/ and replaces all {group.occurrences.length} copies.
					</p>
				)}
			</div>
		);
	}

	return (
		<div
			className="group/row flex items-center gap-1 rounded-md pr-1 hover:bg-accent"
			onPointerEnter={() => setPointing(true)}
			onPointerLeave={() => setPointing(false)}
			onFocus={() => setFocused(true)}
			onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
		>
			<button
				type="button"
				onClick={onShow}
				title="Show the screens it repeats in"
				className="flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				<span className="truncate text-[13px] font-medium">{group.suggestedName}</span>
				<span className="truncate text-xs text-subtle-foreground">{occurrenceLabel(group)}</span>
			</button>
			<Button
				variant="outline"
				size="xs"
				disabled={busy}
				onClick={() => {
					setFocused(false);
					setNaming(true);
				}}
			>
				Make component
			</Button>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
						aria-label={`Dismiss ${group.suggestedName}`}
						onClick={onDismiss}
					>
						<X />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Dismiss</TooltipContent>
			</Tooltip>
		</div>
	);
}
