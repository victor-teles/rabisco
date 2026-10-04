import { Monitor, Smartphone } from "lucide-react";
import {
	PromptComposer,
	PromptComposerActions,
	PromptComposerAdd,
	PromptComposerFileItem,
	PromptComposerInput,
	PromptComposerModelSelect,
	PromptComposerSubmit,
	type PromptComposerVariant,
} from "@/components/ui/uai/prompt-composer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Device } from "../../../shared/types";

export const MODELS = [
	{ id: "claude-opus-5-5", label: "Opus 5.5" },
	{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
	{ id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

export type DesignComposerProps = {
	value?: string;
	onValueChange?: (value: string) => void;
	device: Device;
	onDeviceChange: (device: Device) => void;
	model: string;
	onModelChange: (model: string) => void;
	onSubmit: (prompt: string) => void;
	busy?: boolean;
	placeholder?: string;
	variant?: PromptComposerVariant;
	/** Render the device and model pickers inside the composer; narrow layouts place them outside */
	inlineOptions?: boolean;
	className?: string;
};

/** The uai prompt composer, extended with the device and model pickers Rabisco needs. */
export function DesignComposer({
	value,
	onValueChange,
	device,
	onDeviceChange,
	model,
	onModelChange,
	onSubmit,
	busy,
	placeholder = "Describe a screen, flow or change…",
	variant = "rounded",
	inlineOptions = true,
	className,
}: DesignComposerProps) {
	return (
		<PromptComposer
			variant={variant}
			busy={busy}
			value={value}
			onValueChange={onValueChange}
			onSubmit={(prompt) => onSubmit(prompt)}
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
						<PromptComposerModelSelect models={MODELS} value={model} onValueChange={onModelChange} />
					</>
				) : null}
				<PromptComposerSubmit />
			</PromptComposerActions>
		</PromptComposer>
	);
}

export function DeviceToggle({
	device,
	onDeviceChange,
}: {
	device: Device;
	onDeviceChange: (device: Device) => void;
}) {
	return (
		<ToggleGroup
			type="single"
			size="sm"
			value={device}
			onValueChange={(next) => next && onDeviceChange(next as Device)}
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
