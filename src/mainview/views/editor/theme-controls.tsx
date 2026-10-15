import { Check } from "lucide-react";
import {
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { optionLabel, SCHEME_GROUP } from "../../../shared/modes";

const AUTO = "auto";

type ThemeChoice = {
	value: string | undefined;
	inherited: string;
	onChange: (option: string | undefined) => void;
};

const autoLabel = (inherited: string) => `Auto (${optionLabel(inherited)})`;

export function ThemeToggle({ value, inherited, onChange }: ThemeChoice) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-muted-foreground">Theme</span>
			<ToggleGroup
				type="single"
				size="sm"
				variant="outline"
				value={value ?? AUTO}
				onValueChange={(next) => {
					if (next) onChange(next === AUTO ? undefined : next);
				}}
				aria-label="Theme"
			>
				<ToggleGroupItem value={AUTO} className="h-7 px-2.5 text-xs" title={autoLabel(inherited)}>
					Auto
				</ToggleGroupItem>
				{SCHEME_GROUP.options.map((option) => (
					<ToggleGroupItem key={option} value={option} className="h-7 px-2.5 text-xs">
						{optionLabel(option)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}

export function ThemeMenu({ value, inherited, onChange }: ThemeChoice) {
	const items = [
		{ option: undefined, label: autoLabel(inherited) },
		...SCHEME_GROUP.options.map((option) => ({ option, label: optionLabel(option) })),
	];

	return (
		<ContextMenuSub>
			<ContextMenuSubTrigger>Theme</ContextMenuSubTrigger>
			<ContextMenuSubContent>
				{items.map(({ option, label }) => (
					<ContextMenuItem key={option ?? AUTO} onSelect={() => onChange(option)}>
						{label}
						{option === value ? <Check className="ml-auto" /> : null}
					</ContextMenuItem>
				))}
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}
