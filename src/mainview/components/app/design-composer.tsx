import { Fragment } from "react";
import { ChevronDown, Monitor, Settings2, Smartphone, Square } from "lucide-react";
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
import {
	PromptComposer,
	PromptComposerActions,
	PromptComposerAdd,
	PromptComposerFileItem,
	PromptComposerInput,
	PromptComposerSubmit,
	type PromptComposerVariant,
} from "@/components/ui/uai/prompt-composer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { modelLabel, openSettings, selectModel, useProviders, type ModelOption } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";
import type { Device } from "../../../shared/types";
import { MAX_VARIATIONS } from "../../../shared/variations";

export type DesignComposerProps = {
	value?: string;
	onValueChange?: (value: string) => void;
	device: Device;
	onDeviceChange: (device: Device) => void;
	/** Reference images come along as files */
	onSubmit: (prompt: string, files: File[]) => void;
	busy?: boolean;
	/** Shown instead of the send button while busy */
	onStop?: () => void;
	placeholder?: string;
	variant?: PromptComposerVariant;
	/** How many variations a create generates (1–MAX_VARIATIONS); the picker shows when `onVariationsChange` is set */
	variations?: number;
	onVariationsChange?: (variations: number) => void;
	/** Why the count doesn't apply right now (e.g. editing selected screens); dims the picker */
	variationsHint?: string;
	/** Render the device, variations and model pickers inside the composer; narrow layouts place them outside */
	inlineOptions?: boolean;
	className?: string;
};

/** The uai prompt composer, extended with the device and model pickers Rabisco needs. */
export function DesignComposer({
	value,
	onValueChange,
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
	inlineOptions = true,
	className,
}: DesignComposerProps) {
	return (
		<PromptComposer
			variant={variant}
			busy={busy}
			value={value}
			onValueChange={onValueChange}
			onSubmit={(prompt, files) => onSubmit(prompt, files)}
			className={className}
		>
			<PromptComposerAdd>
				<PromptComposerFileItem
					label="Add reference images"
					description="Screenshots, sketches, moodboards"
					accept="image/*"
				/>
			</PromptComposerAdd>
			<PromptComposerInput placeholder={placeholder} />
			<PromptComposerActions>
				{inlineOptions ? (
					<>
						<DeviceToggle device={device} onDeviceChange={onDeviceChange} />
						{onVariationsChange ? (
							<VariationsPicker value={variations} onChange={onVariationsChange} hint={variationsHint} />
						) : null}
						<ModelPicker />
					</>
				) : null}
				{busy && onStop ? (
					<Button
						type="button"
						size="icon"
						aria-label="Stop generating"
						onClick={onStop}
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

const isDevice = (value: string): value is Device => value === "mobile" || value === "desktop";

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
			<ToggleGroupItem value="desktop" aria-label="Desktop" className="h-7 px-2">
				<Monitor className="size-3.5" />
			</ToggleGroupItem>
		</ToggleGroup>
	);
}

const COUNTS = Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1);

/**
 * How many variations to generate: `1×` … `4×`. With a `hint` the count
 * doesn't apply (edits change the selected screens), so it dims and says why.
 */
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

/** Models of every working provider, grouped by provider, plus a way into Settings. */
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
