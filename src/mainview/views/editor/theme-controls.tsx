import { Check } from "lucide-react";
import { Fragment } from "react";
import {
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { groupLabel, optionLabel, type ModeGroup, type ResolvedMode } from "../../../shared/modes";
import type { ModeChoices } from "../../../shared/types";

const AUTO = "auto";

type ThemeChoices = {
	groups: readonly ModeGroup[];
	value: ModeChoices | undefined;
	inherited: ResolvedMode;
	onChange: (group: string, option: string | undefined) => void;
};

const autoLabel = (inherited: string | undefined) => (inherited ? `Auto (${optionLabel(inherited)})` : "Auto");

export function ThemeToggles({ groups, value, inherited, onChange }: ThemeChoices) {
	return groups.map((group) => (
		<div key={group.name} className="flex items-center justify-between gap-2">
			<span className="truncate text-xs text-muted-foreground">{groupLabel(group.name)}</span>
			<ToggleGroup
				type="single"
				size="sm"
				variant="outline"
				value={value?.[group.name] ?? AUTO}
				onValueChange={(next) => {
					if (next) onChange(group.name, next === AUTO ? undefined : next);
				}}
				aria-label={groupLabel(group.name)}
			>
				<ToggleGroupItem value={AUTO} className="h-7 px-2.5 text-xs" title={autoLabel(inherited[group.name])}>
					Auto
				</ToggleGroupItem>
				{group.options.map((option) => (
					<ToggleGroupItem key={option} value={option} className="h-7 px-2.5 text-xs">
						{optionLabel(option)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	));
}

export function ThemeMenu({ groups, value, inherited, onChange }: ThemeChoices) {
	return (
		<ContextMenuSub>
			<ContextMenuSubTrigger>Theme</ContextMenuSubTrigger>
			<ContextMenuSubContent>
				{groups.map((group, index) => (
					<Fragment key={group.name}>
						{index > 0 ? (
							<>
								<ContextMenuSeparator />
								<ContextMenuLabel>{groupLabel(group.name)}</ContextMenuLabel>
							</>
						) : null}
						{[undefined, ...group.options].map((option) => (
							<ContextMenuItem key={option ?? AUTO} onSelect={() => onChange(group.name, option)}>
								{option ? optionLabel(option) : autoLabel(inherited[group.name])}
								{option === value?.[group.name] ? <Check className="ml-auto" /> : null}
							</ContextMenuItem>
						))}
					</Fragment>
				))}
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}

export function DuplicateWithModeMenu({
	groups,
	current,
	onPick,
}: {
	groups: readonly ModeGroup[];
	current: ResolvedMode;
	onPick: (group: string, option: string) => void;
}) {
	return (
		<ContextMenuSub>
			<ContextMenuSubTrigger>Duplicate with mode</ContextMenuSubTrigger>
			<ContextMenuSubContent>
				{groups.map((group, index) => (
					<Fragment key={group.name}>
						{index > 0 ? <ContextMenuSeparator /> : null}
						<ContextMenuLabel>{groupLabel(group.name)}</ContextMenuLabel>
						{group.options.map((option) => (
							<ContextMenuItem
								key={option}
								disabled={option === current[group.name]}
								onSelect={() => onPick(group.name, option)}
							>
								{optionLabel(option)}
							</ContextMenuItem>
						))}
					</Fragment>
				))}
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}
