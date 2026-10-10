import { Fragment, useCallback, useRef } from "react";
import {
	ChevronDown,
	ListChecks,
	Monitor,
	Settings2,
	Smartphone,
	Square,
	Tablet,
	Undo2,
	WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
import {
	PromptComposer,
	PromptComposerActions,
	PromptComposerAdd,
	PromptComposerFileItem,
	PromptComposerInput,
	PromptComposerSubmit,
	type PromptComposerVariant,
} from "@/components/ui/uai/prompt-composer";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SlashMenu, type SlashKeyHandler } from "@/components/app/slash-menu";
import { StylePicker } from "@/components/app/style-picker";
import type { ChatCommand } from "@/lib/chat-commands";
import { IMPROVE_PROMPT_KEYS, isImprovePrompt, useImprovePrompt } from "@/hooks/use-improve-prompt";
import { isPlanModeToggle, PLAN_MODE_KEYS } from "@/hooks/use-plan-mode";
import { modelLabel, openSettings, selectModel, useProviders, type ModelOption } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";
import type { StyleChoice } from "../../../shared/context/styles";
import { isDevice } from "../../../shared/project";
import type { Device } from "../../../shared/types";
import { MAX_VARIATIONS } from "../../../shared/variations";

/** The image types every provider takes */
const PROMPT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const isPromptImage = (file: File) => PROMPT_IMAGE_TYPES.includes(file.type);

export type DesignComposerProps = {
	value?: string;
	onValueChange?: (value: string) => void;
	/** Uncontrolled starting prompt and images */
	defaultValue?: string;
	defaultFiles?: File[];
	device: Device;
	onDeviceChange: (device: Device) => void;
	/** `false` keeps the prompt in the composer */
	onSubmit: (prompt: string, files: File[]) => void | boolean;
	busy?: boolean;
	onStop?: () => void;
	placeholder?: string;
	variant?: PromptComposerVariant;
	/** The picker shows only when `onVariationsChange` is set. */
	variations?: number;
	onVariationsChange?: (variations: number) => void;
	/** Why the count doesn't apply right now; dims the picker. */
	variationsHint?: string;
	planMode?: boolean;
	onPlanModeChange?: (on: boolean) => void;
	planModeHint?: string;
	/** The starting style of a new project; the picker shows only when `onDesignStyleChange` is set */
	designStyle?: StyleChoice;
	onDesignStyleChange?: (style: StyleChoice) => void;
	inlineOptions?: boolean;
	/** The prompt on its own row, with the options in a toolbar under it (Home) */
	stacked?: boolean;
	className?: string;
	/** Typing `/` lists them */
	commands?: readonly ChatCommand[];
	/** A command picked from the list; `false` keeps the prompt */
	onRunCommand?: (command: ChatCommand) => boolean | void;
	improve?: { projectPath?: string };
};

const keepValue = () => {};

export function DesignComposer({
	value,
	onValueChange,
	defaultValue,
	defaultFiles,
	device,
	onDeviceChange,
	onSubmit,
	busy,
	onStop,
	placeholder = "Describe a screen, flow or change…",
	variant = "rounded",
	variations = 1,
	onVariationsChange,
	variationsHint,
	planMode = false,
	onPlanModeChange,
	planModeHint,
	designStyle = null,
	onDesignStyleChange,
	inlineOptions = true,
	stacked = false,
	className,
	commands,
	onRunCommand,
	improve,
}: DesignComposerProps) {
	const slashKeys = useRef<SlashKeyHandler | null>(null);
	const formRef = useRef<HTMLFormElement>(null);

	const setSlashKeys = useCallback((handler: SlashKeyHandler | null) => {
		slashKeys.current = handler;
	}, []);

	const focusPrompt = useCallback(() => {
		requestAnimationFrame(() => {
			const input = formRef.current?.querySelector("textarea");

			if (!input) return;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			input.scrollTop = 0;
		});
	}, []);

	const improver = useImprovePrompt({
		value: value ?? "",
		onChange: onValueChange ?? keepValue,
		device,
		projectPath: improve?.projectPath,
		onDone: focusPrompt,
	});

	const canImprove = Boolean(improve && onValueChange && value !== undefined);
	const stoppable = improver.improving || Boolean(busy && onStop);

	return (
		<PromptComposer
			ref={formRef}
			variant={variant}
			busy={busy || improver.improving}
			value={value}
			onValueChange={onValueChange}
			defaultValue={defaultValue}
			defaultFiles={defaultFiles}
			onSubmit={(prompt, files) => onSubmit(prompt, files)}
			acceptFile={isPromptImage}
			stacked={stacked}
			className={className}
		>
			<PromptComposerAdd>
				<PromptComposerFileItem
					label="Add reference images"
					description="Or paste or drop them here"
					accept={PROMPT_IMAGE_TYPES.join(",")}
				/>
			</PromptComposerAdd>
			{commands?.length && onRunCommand ? (
				<SlashMenu commands={commands} onKeys={setSlashKeys} onRun={onRunCommand} />
			) : null}
			<PromptComposerInput
				placeholder={placeholder}
				onKeyDown={(event) => {
					slashKeys.current?.(event);

					if (event.defaultPrevented) return;

					if (onPlanModeChange && isPlanModeToggle(event)) {
						event.preventDefault();

						if (!planModeHint) onPlanModeChange(!planMode);

						return;
					}

					if (!canImprove) return;

					if (isImprovePrompt(event)) {
						event.preventDefault();
						void improver.improve();
					} else if (improver.improved && isUndo(event)) {
						event.preventDefault();
						improver.undo();
					}
				}}
				className={cn(stacked && "max-h-60 min-h-14 px-2 pt-2 text-[15px]/6 md:text-[15px]/6")}
			/>
			<PromptComposerActions className={cn(stacked && "justify-self-stretch")}>
				{inlineOptions ? (
					<>
						<DeviceToggle device={device} onDeviceChange={onDeviceChange} />
						{onDesignStyleChange ? <StylePicker value={designStyle} onChange={onDesignStyleChange} /> : null}
						{onVariationsChange ? (
							<VariationsPicker value={variations} onChange={onVariationsChange} hint={variationsHint} />
						) : null}
						{onPlanModeChange ? <PlanModeToggle on={planMode} onChange={onPlanModeChange} hint={planModeHint} /> : null}
						<ModelPicker className={cn(stacked && "ml-auto")} />
					</>
				) : null}
				{canImprove ? (
					<ImprovePromptButton
						improved={improver.improved}
						disabled={busy || improver.improving || !value?.trim()}
						onImprove={() => void improver.improve()}
						onUndo={() => {
							improver.undo();
							focusPrompt();
						}}
					/>
				) : null}
				{stoppable ? (
					<Button
						type="button"
						size="icon"
						aria-label={improver.improving ? "Stop improving" : "Stop generating"}
						onClick={improver.improving ? improver.stop : onStop}
						className="size-8 rounded-full bg-foreground text-card hover:bg-foreground/90"
					>
						<Square className="size-3 fill-current" />
					</Button>
				) : (
					<PromptComposerSubmit />
				)}
			</PromptComposerActions>
		</PromptComposer>
	);
}

const isUndo = (event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) =>
	event.code === "KeyZ" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

function ImprovePromptButton({
	improved,
	disabled,
	onImprove,
	onUndo,
}: {
	improved: boolean;
	disabled: boolean;
	onImprove: () => void;
	onUndo: () => void;
}) {
	if (improved) {
		return (
			<Button type="button" variant="ghost" size="xs" className="h-7 gap-1 text-muted-foreground" onClick={onUndo}>
				<Undo2 />
				Undo improve
			</Button>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Improve prompt"
					aria-keyshortcuts="Meta+I"
					disabled={disabled}
					onClick={onImprove}
					className="size-7 rounded-lg text-muted-foreground"
				>
					<WandSparkles className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">
				Improve prompt <Kbd>{IMPROVE_PROMPT_KEYS}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

export function DeviceToggle({ device, onDeviceChange }: { device: Device; onDeviceChange: (device: Device) => void }) {
	return (
		<ToggleGroup
			type="single"
			size="sm"
			value={device}
			onValueChange={(next) => {
				if (isDevice(next)) onDeviceChange(next);
			}}
			aria-label="Target device"
			className="h-7"
		>
			<ToggleGroupItem value="mobile" aria-label="Mobile" className="h-7 px-2">
				<Smartphone className="size-3.5" />
			</ToggleGroupItem>
			<ToggleGroupItem value="tablet" aria-label="Tablet" className="h-7 px-2">
				<Tablet className="size-3.5" />
			</ToggleGroupItem>
			<ToggleGroupItem value="desktop" aria-label="Desktop" className="h-7 px-2">
				<Monitor className="size-3.5" />
			</ToggleGroupItem>
		</ToggleGroup>
	);
}

export function PlanModeToggle({
	on,
	onChange,
	hint,
}: {
	on: boolean;
	onChange: (on: boolean) => void;
	hint?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Toggle
					size="sm"
					pressed={on}
					onPressedChange={(next) => {
						if (!hint) onChange(next);
					}}
					aria-label="Plan first"
					aria-keyshortcuts="Shift+Meta+P"
					aria-disabled={hint ? true : undefined}
					className={cn(
						"h-7 min-w-7 gap-1 px-1.5 text-xs text-muted-foreground data-[state=on]:text-foreground",
						hint && "opacity-40 hover:bg-transparent",
					)}
				>
					<ListChecks className="size-3.5" />
					{on ? "Plan" : null}
				</Toggle>
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-56">
				{hint ?? (
					<>
						{on ? "Plan first is on" : "Plan first"} <Kbd>{PLAN_MODE_KEYS}</Kbd>
					</>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

const COUNTS = Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1);

export function VariationsPicker({
	value,
	onChange,
	hint,
	className,
}: {
	value: number;
	onChange: (value: number) => void;
	hint?: string;
	className?: string;
}) {
	const trigger = (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			aria-label={`Variations: ${value}`}
			aria-disabled={hint ? true : undefined}
			className={cn(
				"h-7 gap-0.5 px-1.5 text-muted-foreground tabular-nums",
				hint && "opacity-40 hover:bg-transparent",
				className,
			)}
		>
			{value}×{hint ? null : <ChevronDown className="size-3 shrink-0" />}
		</Button>
	);

	if (hint) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{trigger}</TooltipTrigger>
				<TooltipContent side="top" className="max-w-56">
					{hint}
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<DropdownMenu modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Variations</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" side="top" className="min-w-40">
				<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
					Variations per screen
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={String(value)} onValueChange={(next) => onChange(Number(next))}>
					{COUNTS.map((count) => (
						<DropdownMenuRadioItem key={count} value={String(count)} className="text-[13px]">
							{count === 1 ? "1 version" : `${count} variations`}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ModelPicker({ className }: { className?: string }) {
	const { models, model, loading } = useProviders();
	const groups = new Map<string, ModelOption[]>();

	for (const option of models) groups.set(option.providerLabel, [...(groups.get(option.providerLabel) ?? []), option]);

	if (!loading && models.length === 0) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className={cn("h-7 gap-1 text-muted-foreground", className)}
				onClick={() => openSettings()}
			>
				<Settings2 />
				Set up a model
			</Button>
		);
	}

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					aria-label="Choose model"
					className={cn("h-7 max-w-44 gap-1 text-muted-foreground", className)}
				>
					<span className="truncate">{loading && !model ? "Loading…" : modelLabel(model)}</span>
					<ChevronDown className="size-3 shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" side="top" className="max-h-80 min-w-52">
				<DropdownMenuRadioGroup value={model ?? ""} onValueChange={selectModel}>
					{[...groups].map(([provider, options], index) => (
						<Fragment key={provider}>
							{index > 0 ? <DropdownMenuSeparator /> : null}
							<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">{provider}</DropdownMenuLabel>
							{options.map((option) => (
								<DropdownMenuRadioItem key={option.id} value={option.id} className="text-[13px]">
									{option.label}
								</DropdownMenuRadioItem>
							))}
						</Fragment>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem className="text-[13px]" onSelect={() => openSettings()}>
					<Settings2 />
					Manage providers…
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
