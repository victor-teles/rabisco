/**
 * The `@/components/ui/*` modules a frame can import, with their exports.
 * Mirrors `src/mainview/runtime/externals.ts` (importing it here would pull
 * React DOM components into the main process); a test keeps them in sync.
 */
const MODULE_EXPORTS = {
	avatar: ["Avatar", "AvatarImage", "AvatarFallback", "AvatarBadge", "AvatarGroup", "AvatarGroupCount"],
	badge: ["Badge", "badgeVariants"],
	button: ["Button", "buttonVariants"],
	card: ["Card", "CardHeader", "CardFooter", "CardTitle", "CardAction", "CardDescription", "CardContent"],
	collapsible: ["Collapsible", "CollapsibleTrigger", "CollapsibleContent"],
	dialog: [
		"Dialog",
		"DialogClose",
		"DialogContent",
		"DialogDescription",
		"DialogFooter",
		"DialogHeader",
		"DialogOverlay",
		"DialogPortal",
		"DialogTitle",
		"DialogTrigger",
	],
	"dropdown-menu": [
		"DropdownMenu",
		"DropdownMenuPortal",
		"DropdownMenuTrigger",
		"DropdownMenuContent",
		"DropdownMenuGroup",
		"DropdownMenuLabel",
		"DropdownMenuItem",
		"DropdownMenuCheckboxItem",
		"DropdownMenuRadioGroup",
		"DropdownMenuRadioItem",
		"DropdownMenuSeparator",
		"DropdownMenuShortcut",
		"DropdownMenuSub",
		"DropdownMenuSubTrigger",
		"DropdownMenuSubContent",
	],
	input: ["Input"],
	kbd: ["Kbd", "KbdGroup"],
	popover: [
		"Popover",
		"PopoverTrigger",
		"PopoverContent",
		"PopoverAnchor",
		"PopoverHeader",
		"PopoverTitle",
		"PopoverDescription",
	],
	progress: ["Progress"],
	"scroll-area": ["ScrollArea", "ScrollBar"],
	separator: ["Separator"],
	tabs: ["Tabs", "TabsList", "TabsTrigger", "TabsContent", "tabsListVariants"],
	textarea: ["Textarea"],
	toggle: ["Toggle", "toggleVariants"],
	"toggle-group": ["ToggleGroup", "ToggleGroupItem"],
	tooltip: ["Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider"],
} satisfies Record<string, readonly string[]>;

export type UiModule = keyof typeof MODULE_EXPORTS;

export const UI_MODULES: Readonly<Record<UiModule, readonly string[]>> = MODULE_EXPORTS;

export function isUiModule(name: string): name is UiModule {
	return Object.hasOwn(UI_MODULES, name);
}
