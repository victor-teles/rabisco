import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ToolItem = {
	key: string;
	label: string;
	shortcut: string;
	icon: LucideIcon;
	active: boolean;
	onSelect: () => void;
};

const activeTool = "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";

/** One toolbar button for a single tool */
export function ToolButton({ item }: { item: ToolItem }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={item.label}
					aria-pressed={item.active}
					onClick={item.onSelect}
					className={cn(item.active && activeTool)}
				>
					<item.icon />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">
				{item.label} <Kbd>{item.shortcut}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

/** Figma's tool flyout: the button shows the last tool used from the group, the chevron lists the rest */
export function ToolGroup({ label, items }: { label: string; items: ToolItem[] }) {
	const active = items.find((item) => item.active);
	const [lastKey, setLastKey] = useState(items[0]?.key);

	if (active && active.key !== lastKey) setLastKey(active.key);

	const face = active ?? items.find((item) => item.key === lastKey) ?? items[0];

	if (!face) return null;

	return (
		<div className="flex items-center">
			<ToolButton item={face} />
			<DropdownMenu modal={false}>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={label}
								className="w-4 rounded-sm text-muted-foreground data-[state=open]:bg-accent"
							>
								<ChevronDown className="size-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="top">{label}</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					side="top"
					align="start"
					sideOffset={10}
					className="w-48"
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					{items.map((item) => (
						<DropdownMenuItem
							key={item.key}
							onSelect={() => {
								setLastKey(item.key);
								item.onSelect();
							}}
						>
							<item.icon />
							{item.label}
							<DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
