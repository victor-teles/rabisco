import { useState } from "react";
import { ChevronDown, CircleAlert, CornerUpLeft, ExternalLink, Hash, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { findElement, parseJsx } from "../../../shared/jsx";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import {
	anchorIds,
	BACK,
	effectiveTransition,
	hasExpressionLink,
	isUrl,
	linkOfElement,
	linkSettingsOfElement,
	resolveLink,
	type ElementRef,
	type LinkEdit,
} from "../../../shared/prototype/links";
import {
	EASINGS,
	parseDuration,
	parseEasing,
	TRANSITION_MS,
	TRANSITIONS,
	type LinkTransition,
	type OverlayMode,
} from "../../../shared/prototype/transitions";
import {
	DEFAULT_DELAY_MS,
	DEFAULT_KEY,
	keyLabel,
	type LinkTrigger,
	type TriggerKind,
} from "../../../shared/prototype/triggers";
import type { Frame, ProjectFiles } from "../../../shared/types";

export type LinkControlProps = {
	files: ProjectFiles;
	frames: Frame[];
	/** Nothing renders without one */
	element: ElementRef | null;
	onChange: (element: ElementRef, edit: LinkEdit) => void;
	disabled?: boolean;
};

const NONE = "";

const NAVIGATE = "navigate";

const DEFAULT = "default";

const ANCHOR_PREFIX = "#";

const MODE_LABELS: Record<OverlayMode | typeof NAVIGATE, string> = {
	navigate: "Navigate",
	overlay: "Overlay",
	sheet: "Sheet",
};

const TRANSITION_LABELS: Record<LinkTransition, string> = {
	instant: "Instant",
	dissolve: "Dissolve",
	slide: "Slide",
	push: "Push",
};

const TRIGGER_LABELS: Record<TriggerKind, string> = {
	click: "On click",
	hover: "On hover",
	press: "On press",
	after: "After delay",
	key: "Key press",
};

const EASING_LABELS: Record<keyof typeof EASINGS | typeof DEFAULT, string> = {
	default: "Default",
	linear: "Linear",
	"ease-in": "Ease in",
	"ease-out": "Ease out",
	"ease-in-out": "Ease in and out",
};

const DURATIONS = [100, 150, 200, 300, 500, 800];

const DELAYS = [300, 500, 800, 1000, 2000, 3000, 5000];

const ms = (value: number) => `${value} ms`;

const msKey = (value: number) => `${value}ms`;

/** Presets, plus the written value when it isn't one */
function msLabels(presets: number[], current: number | null, fallback?: string) {
	const values = [...new Set([...presets, ...(current === null ? [] : [current])])].sort((a, b) => a - b);
	// `150ms`, not `150`: integer-like keys would sort before "default"
	const entries = values.map((value) => [msKey(value), ms(value)]);

	return Object.fromEntries(fallback ? [[DEFAULT, fallback], ...entries] : entries);
}

const isMode = (value: string): value is OverlayMode => value === "overlay" || value === "sheet";

const isTransitionName = (value: string): value is LinkTransition => TRANSITIONS.some((name) => name === value);

const isTriggerKind = (value: string): value is TriggerKind => Object.hasOwn(TRIGGER_LABELS, value);

function triggerOf(kind: TriggerKind, current: LinkTrigger): LinkTrigger {
	if (kind === current.kind) return current;

	if (kind === "after") return { kind, ms: DEFAULT_DELAY_MS };

	return kind === "key" ? { kind, key: DEFAULT_KEY } : { kind };
}

/** Writes `data-link-to` (decision 0007); a link written as code is read-only */
export function LinkControl(props: LinkControlProps) {
	const { files, element } = props;
	const source = element ? files[element.file] : undefined;
	const node = element && source !== undefined ? findElement(parseJsx(source), element.start) : null;

	if (!element || !node || node.name === null) return null;

	return (
		<section className="flex flex-col gap-2 border-b p-4">
			<h3 className="text-xs font-medium text-subtle-foreground">Prototype</h3>
			<LinkFields {...props} />
		</section>
	);
}

/** The inspector's Prototype rows, also shown in the popover of a connector selected on the canvas */
export function LinkFields({ files, frames, element, onChange, disabled }: LinkControlProps) {
	/** "Open URL…" shows the field before there is a URL to write */
	const [urlDraft, setUrlDraft] = useState<{ element: ElementRef; value: string } | null>(null);
	const source = element ? files[element.file] : undefined;
	const node = element && source !== undefined ? findElement(parseJsx(source), element.start) : null;

	if (!element || !node || node.name === null || source === undefined) return null;

	const written = linkOfElement(node);
	const target = written === null ? null : resolveLink(written, files);

	const value = !target
		? NONE
		: target.kind === "screen"
			? target.file
			: target.kind === "back"
				? BACK
				: target.kind === "anchor"
					? `${ANCHOR_PREFIX}${target.id}`
					: written!;

	const screens = frames.filter(
		(frame) => isScreenFile(frame.file) && files[frame.file] !== undefined && frame.file !== element.file,
	);

	const anchors = anchorIds(source);
	const nameOf = (file: string) => frames.find((frame) => frame.file === file)?.name || screenNameFromPath(file);

	const label = !target
		? "None"
		: target.kind === "screen"
			? nameOf(target.file)
			: target.kind === "back"
				? "Back"
				: target.kind === "anchor"
					? `Scroll to #${target.id}`
					: target.kind === "url"
						? "Open URL"
						: `Missing: ${target.to}`;

	const draft =
		urlDraft && urlDraft.element.file === element.file && urlDraft.element.start === element.start ? urlDraft : null;

	const code = hasExpressionLink(node);
	const settings = linkSettingsOfElement(node);
	const mode = settings.mode ?? NAVIGATE;
	const transition = effectiveTransition(settings);
	const screenLink = !code && target?.kind === "screen";
	const timing = screenLink && transition !== "instant";
	const { trigger } = settings;

	const link = (to: string | null) => {
		setUrlDraft(null);
		onChange(element, { to });
	};

	const commitUrl = (url: string) => {
		const next = url.trim();

		if (isUrl(next) && next !== written) link(next);
		else if (!next && target?.kind === "url") link(null);
		else setUrlDraft(null);
	};

	return (
		<>
			<div className="flex min-h-8 items-center gap-2">
				<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">Link to</span>
				<div className="flex min-w-0 flex-1 items-center">
					{code ? (
						<span
							className="truncate font-mono text-[11px] text-subtle-foreground"
							title="Written as code: edit it in the Code tab"
						>
							Set in code
						</span>
					) : (
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button
									variant="outline"
									size="xs"
									disabled={disabled}
									aria-label="Link to"
									title={target?.kind === "broken" ? `${target.to} is not a screen of this project` : undefined}
									className="h-7 w-full min-w-0 justify-between gap-1 px-2 text-xs font-normal"
								>
									<span className="flex min-w-0 items-center gap-1.5">
										{target?.kind === "broken" ? (
											<CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
										) : target?.kind === "back" ? (
											<CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : target?.kind === "anchor" ? (
											<Hash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : target?.kind === "url" || draft ? (
											<ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : target ? (
											<Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : null}
										<span className={cn("truncate", !target && !draft && "text-subtle-foreground")}>
											{draft && target?.kind !== "url" ? "Open URL" : label}
										</span>
									</span>
									<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="max-h-80 min-w-44">
								<DropdownMenuRadioGroup
									value={value}
									onValueChange={(next) => next !== value && link(next === NONE ? null : next)}
								>
									<DropdownMenuRadioItem value={NONE} className="text-[13px]">
										None
									</DropdownMenuRadioItem>
									<DropdownMenuSeparator />
									{screens.length === 0 ? (
										<p className="px-2 py-1.5 text-xs text-subtle-foreground">No other screens yet</p>
									) : null}
									{screens.map((screen) => (
										<DropdownMenuRadioItem key={screen.file} value={screen.file} className="text-[13px]">
											<span className="truncate">{nameOf(screen.file)}</span>
										</DropdownMenuRadioItem>
									))}
									{target?.kind === "broken" ? (
										<DropdownMenuRadioItem value={value} className="text-[13px] text-muted-foreground">
											<span className="truncate">Missing: {target.to}</span>
										</DropdownMenuRadioItem>
									) : null}
									<DropdownMenuSeparator />
									<DropdownMenuRadioItem value={BACK} className="text-[13px]">
										Back
										<span className="ml-auto pl-3 text-xs text-subtle-foreground">previous screen</span>
									</DropdownMenuRadioItem>
									{anchors.length ? (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
												Scroll to
											</DropdownMenuLabel>
											{anchors.map((id) => (
												<DropdownMenuRadioItem
													key={id}
													value={`${ANCHOR_PREFIX}${id}`}
													className="font-mono text-[12px]"
												>
													<span className="truncate">#{id}</span>
												</DropdownMenuRadioItem>
											))}
										</>
									) : null}
								</DropdownMenuRadioGroup>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-[13px]"
									onSelect={() =>
										setUrlDraft({
											element,
											value: target?.kind === "url" ? target.url : "https://",
										})
									}
								>
									Open URL…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
			{!code && (target?.kind === "url" || draft) ? (
				<div className="flex min-h-8 items-center gap-2">
					<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">URL</span>
					<Input
						key={`${element.file}:${element.start}:${written}`}
						aria-label="URL"
						autoFocus={!!draft}
						disabled={disabled}
						defaultValue={draft ? draft.value : target?.kind === "url" ? target.url : ""}
						placeholder="https://"
						spellCheck={false}
						className="h-7 min-w-0 flex-1 px-2 font-mono text-[12px]"
						onBlur={(event) => commitUrl(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") commitUrl(event.currentTarget.value);
							else if (event.key === "Escape") {
								event.stopPropagation();
								setUrlDraft(null);
								event.currentTarget.blur();
							}
						}}
					/>
				</div>
			) : null}
			{!code && target !== null ? (
				<>
					<OptionRow
						label="Trigger"
						value={trigger.kind}
						labels={TRIGGER_LABELS}
						disabled={disabled}
						onChange={(next) => isTriggerKind(next) && onChange(element, { trigger: triggerOf(next, trigger) })}
					/>
					{trigger.kind === "after" ? (
						<OptionRow
							label="Delay"
							value={msKey(trigger.ms)}
							labels={msLabels(DELAYS, trigger.ms)}
							disabled={disabled}
							onChange={(next) =>
								onChange(element, { trigger: { kind: "after", ms: parseDuration(next) ?? DEFAULT_DELAY_MS } })
							}
						/>
					) : null}
					{trigger.kind === "key" ? (
						<KeyRow
							value={trigger.key}
							disabled={disabled}
							onChange={(key) => onChange(element, { trigger: { kind: "key", key } })}
						/>
					) : null}
				</>
			) : null}
			{screenLink ? (
				<>
					<OptionRow
						label="Open as"
						value={mode}
						labels={MODE_LABELS}
						disabled={disabled}
						onChange={(next) => onChange(element, { mode: isMode(next) ? next : null })}
					/>
					<OptionRow
						label="Animation"
						value={transition}
						labels={TRANSITION_LABELS}
						disabled={disabled}
						onChange={(next) => isTransitionName(next) && onChange(element, { transition: next })}
					/>
				</>
			) : null}
			{timing ? (
				<>
					<OptionRow
						label="Duration"
						value={settings.duration === null ? DEFAULT : msKey(settings.duration)}
						labels={msLabels(DURATIONS, settings.duration, `Default · ${ms(TRANSITION_MS)}`)}
						disabled={disabled}
						onChange={(next) => onChange(element, { duration: parseDuration(next) })}
					/>
					<OptionRow
						label="Easing"
						value={settings.easing ?? DEFAULT}
						labels={EASING_LABELS}
						disabled={disabled}
						onChange={(next) => onChange(element, { easing: parseEasing(next) })}
					/>
				</>
			) : null}
		</>
	);
}

/** Focus it and press a key; Tab and Escape keep their usual meaning */
function KeyRow({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (key: string) => void }) {
	const [listening, setListening] = useState(false);

	return (
		<div className="flex min-h-8 items-center gap-2">
			<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">Key</span>
			<Button
				variant="outline"
				size="xs"
				disabled={disabled}
				aria-label="Key"
				className={cn(
					"h-7 min-w-0 flex-1 justify-start px-2 text-xs font-normal",
					listening && "border-primary text-muted-foreground",
				)}
				onClick={() => setListening(true)}
				onBlur={() => setListening(false)}
				onKeyDown={(event) => {
					if (!listening || event.key === "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
					event.preventDefault();
					event.stopPropagation();
					setListening(false);

					if (event.key !== "Escape" && event.key !== "Shift") onChange(event.key);
				}}
			>
				{listening ? "Press a key…" : keyLabel(value)}
			</Button>
		</div>
	);
}

function OptionRow<T extends string>({
	label,
	value,
	labels,
	disabled,
	onChange,
}: {
	label: string;
	value: T;
	labels: Record<T, string>;
	disabled?: boolean;
	onChange: (next: string) => void;
}) {
	const entries: [string, string][] = Object.entries(labels);

	return (
		<div className="flex min-h-8 items-center gap-2">
			<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">{label}</span>
			<div className="flex min-w-0 flex-1 items-center">
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="xs"
							disabled={disabled}
							aria-label={label}
							className="h-7 w-full min-w-0 justify-between gap-1 px-2 text-xs font-normal"
						>
							<span className="truncate">{labels[value]}</span>
							<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-36">
						<DropdownMenuRadioGroup value={value} onValueChange={(next) => next !== value && onChange(next)}>
							{entries.map(([key, text]) => (
								<DropdownMenuRadioItem key={key} value={key} className="text-[13px]">
									{text}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
