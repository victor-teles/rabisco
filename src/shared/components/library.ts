/**
 * The shadcn/ui pieces Rabisco offers in the components panel: small,
 * realistic JSX snippets to insert into a screen, with the imports they need.
 * Snippets use only the exports in `UI_MODULES`, lucide icons and theme classes.
 */

export type LibraryImport = { from: string; names: string[] };

export type LibraryItem = {
	/** Stable id, e.g. `button-outline` */
	id: string;
	title: string;
	/** The `@/components/ui/<module>` it showcases */
	module: string;
	description: string;
	/** JSX to insert (one or more sibling elements) */
	snippet: string;
	imports: LibraryImport[];
	keywords: string[];
};

const ui = (module: string, ...names: string[]): LibraryImport => ({ from: `@/components/ui/${module}`, names });

const icons = (...names: string[]): LibraryImport => ({ from: "lucide-react", names });

const button = (variant: string, label: string, keywords: string[]): LibraryItem => ({
	id: `button-${variant}`,
	title: `Button (${variant})`,
	module: "button",
	description: `A ${variant} button.`,
	snippet: `<Button variant="${variant}">${label}</Button>`,
	imports: [ui("button", "Button")],
	keywords: ["button", "action", variant, ...keywords],
});

export const LIBRARY: LibraryItem[] = [
	{
		id: "button",
		title: "Button",
		module: "button",
		description: "The primary action of a section.",
		snippet: `<Button>\n\tContinue\n\t<ArrowRight />\n</Button>`,
		imports: [ui("button", "Button"), icons("ArrowRight")],
		keywords: ["button", "cta", "action", "primary", "submit"],
	},
	button("secondary", "Save draft", ["secondary"]),
	button("outline", "Cancel", ["border"]),
	button("ghost", "Skip for now", ["subtle", "text"]),
	button("destructive", "Delete project", ["danger", "remove"]),
	{
		id: "button-icon",
		title: "Icon button",
		module: "button",
		description: "A square button with only an icon.",
		snippet: `<Button variant="outline" size="icon" aria-label="Notifications">\n\t<Bell />\n</Button>`,
		imports: [ui("button", "Button"), icons("Bell")],
		keywords: ["button", "icon", "toolbar"],
	},
	{
		id: "badge",
		title: "Badge",
		module: "badge",
		description: "A short status or count label.",
		snippet: `<div className="flex items-center gap-2">\n\t<Badge>New</Badge>\n\t<Badge variant="secondary">In review</Badge>\n\t<Badge variant="outline">Draft</Badge>\n</div>`,
		imports: [ui("badge", "Badge")],
		keywords: ["badge", "tag", "chip", "status", "label", "pill"],
	},
	{
		id: "card",
		title: "Card",
		module: "card",
		description: "A surface with a header, title, description and content.",
		snippet: `<Card className="w-full max-w-sm">\n\t<CardHeader>\n\t\t<CardTitle>Monthly plan</CardTitle>\n\t\t<CardDescription>Renews on April 2</CardDescription>\n\t</CardHeader>\n\t<CardContent>\n\t\t<p className="text-3xl font-semibold tracking-tight">$12</p>\n\t\t<p className="text-sm text-muted-foreground">per seat, billed monthly</p>\n\t</CardContent>\n</Card>`,
		imports: [ui("card", "Card", "CardHeader", "CardTitle", "CardDescription", "CardContent")],
		keywords: ["card", "panel", "surface", "container", "tile"],
	},
	{
		id: "input",
		title: "Input",
		module: "input",
		description: "A labelled text field.",
		snippet: `<label className="grid w-full max-w-sm gap-1.5 text-sm font-medium">\n\tEmail\n\t<Input type="email" placeholder="ana@studio.com" />\n</label>`,
		imports: [ui("input", "Input")],
		keywords: ["input", "field", "text", "form", "email"],
	},
	{
		id: "textarea",
		title: "Textarea",
		module: "textarea",
		description: "A multi-line text field.",
		snippet: `<label className="grid w-full max-w-sm gap-1.5 text-sm font-medium">\n\tNotes\n\t<Textarea placeholder="Anything we should know before the call?" />\n</label>`,
		imports: [ui("textarea", "Textarea")],
		keywords: ["textarea", "multiline", "message", "comment", "form"],
	},
	{
		id: "avatar",
		title: "Avatar",
		module: "avatar",
		description: "A person's avatar with initials as fallback.",
		snippet: `<div className="flex items-center gap-3">\n\t<Avatar>\n\t\t<AvatarFallback>MR</AvatarFallback>\n\t</Avatar>\n\t<div>\n\t\t<p className="text-sm font-medium">Marta Ribeiro</p>\n\t\t<p className="text-xs text-muted-foreground">Product designer</p>\n\t</div>\n</div>`,
		imports: [ui("avatar", "Avatar", "AvatarFallback")],
		keywords: ["avatar", "user", "profile", "person", "initials"],
	},
	{
		id: "separator",
		title: "Separator",
		module: "separator",
		description: "A thin line between sections.",
		snippet: `<div className="w-full max-w-sm">\n\t<p className="text-sm font-medium">Account</p>\n\t<Separator className="my-3" />\n\t<p className="text-sm text-muted-foreground">Billing</p>\n</div>`,
		imports: [ui("separator", "Separator")],
		keywords: ["separator", "divider", "line", "rule"],
	},
	{
		id: "progress",
		title: "Progress",
		module: "progress",
		description: "A progress bar with a label.",
		snippet: `<div className="grid w-full max-w-sm gap-2">\n\t<div className="flex justify-between text-sm">\n\t\t<span className="font-medium">Storage</span>\n\t\t<span className="text-muted-foreground">6.4 of 10 GB</span>\n\t</div>\n\t<Progress value={64} />\n</div>`,
		imports: [ui("progress", "Progress")],
		keywords: ["progress", "bar", "loading", "meter", "usage"],
	},
	{
		id: "tabs",
		title: "Tabs",
		module: "tabs",
		description: "Switch between views of the same content.",
		snippet: `<Tabs defaultValue="overview" className="w-full max-w-sm">\n\t<TabsList>\n\t\t<TabsTrigger value="overview">Overview</TabsTrigger>\n\t\t<TabsTrigger value="activity">Activity</TabsTrigger>\n\t\t<TabsTrigger value="settings">Settings</TabsTrigger>\n\t</TabsList>\n\t<TabsContent value="overview" className="text-sm text-muted-foreground">\n\t\t12 tasks due this week.\n\t</TabsContent>\n</Tabs>`,
		imports: [ui("tabs", "Tabs", "TabsList", "TabsTrigger", "TabsContent")],
		keywords: ["tabs", "segmented", "navigation", "switch", "views"],
	},
	{
		id: "toggle",
		title: "Toggle",
		module: "toggle",
		description: "A two-state button.",
		snippet: `<Toggle variant="outline" aria-label="Bold">\n\t<Bold />\n</Toggle>`,
		imports: [ui("toggle", "Toggle"), icons("Bold")],
		keywords: ["toggle", "switch", "pressed", "formatting"],
	},
	{
		id: "toggle-group",
		title: "Toggle group",
		module: "toggle-group",
		description: "A set of toggles where one option is picked.",
		snippet: `<ToggleGroup type="single" defaultValue="week" variant="outline">\n\t<ToggleGroupItem value="day">Day</ToggleGroupItem>\n\t<ToggleGroupItem value="week">Week</ToggleGroupItem>\n\t<ToggleGroupItem value="month">Month</ToggleGroupItem>\n</ToggleGroup>`,
		imports: [ui("toggle-group", "ToggleGroup", "ToggleGroupItem")],
		keywords: ["toggle", "group", "segmented", "filter", "radio"],
	},
	{
		id: "kbd",
		title: "Keyboard shortcut",
		module: "kbd",
		description: "Keys of a shortcut.",
		snippet: `<KbdGroup>\n\t<Kbd>⌘</Kbd>\n\t<Kbd>K</Kbd>\n</KbdGroup>`,
		imports: [ui("kbd", "Kbd", "KbdGroup")],
		keywords: ["kbd", "keyboard", "shortcut", "hotkey"],
	},
	{
		id: "dialog",
		title: "Dialog",
		module: "dialog",
		description: "A modal dialog opened by a button (closed).",
		snippet: `<Dialog>\n\t<DialogTrigger asChild>\n\t\t<Button variant="outline">Invite people</Button>\n\t</DialogTrigger>\n\t<DialogContent>\n\t\t<DialogHeader>\n\t\t\t<DialogTitle>Invite to workspace</DialogTitle>\n\t\t\t<DialogDescription>They get access to every project in Acme.</DialogDescription>\n\t\t</DialogHeader>\n\t\t<DialogFooter>\n\t\t\t<Button>Send invite</Button>\n\t\t</DialogFooter>\n\t</DialogContent>\n</Dialog>`,
		imports: [
			ui(
				"dialog",
				"Dialog",
				"DialogTrigger",
				"DialogContent",
				"DialogHeader",
				"DialogTitle",
				"DialogDescription",
				"DialogFooter",
			),
			ui("button", "Button"),
		],
		keywords: ["dialog", "modal", "overlay", "popup"],
	},
	{
		id: "popover",
		title: "Popover",
		module: "popover",
		description: "Floating content anchored to a button (closed).",
		snippet: `<Popover>\n\t<PopoverTrigger asChild>\n\t\t<Button variant="outline">Filters</Button>\n\t</PopoverTrigger>\n\t<PopoverContent>\n\t\t<PopoverHeader>\n\t\t\t<PopoverTitle>Filters</PopoverTitle>\n\t\t\t<PopoverDescription>Show tasks assigned to you.</PopoverDescription>\n\t\t</PopoverHeader>\n\t</PopoverContent>\n</Popover>`,
		imports: [
			ui(
				"popover",
				"Popover",
				"PopoverTrigger",
				"PopoverContent",
				"PopoverHeader",
				"PopoverTitle",
				"PopoverDescription",
			),
			ui("button", "Button"),
		],
		keywords: ["popover", "floating", "flyout", "filter"],
	},
	{
		id: "dropdown-menu",
		title: "Dropdown menu",
		module: "dropdown-menu",
		description: "A menu of actions opened by a button (closed).",
		snippet: `<DropdownMenu>\n\t<DropdownMenuTrigger asChild>\n\t\t<Button variant="ghost" size="icon" aria-label="More actions">\n\t\t\t<Ellipsis />\n\t\t</Button>\n\t</DropdownMenuTrigger>\n\t<DropdownMenuContent align="end">\n\t\t<DropdownMenuLabel>Project</DropdownMenuLabel>\n\t\t<DropdownMenuItem>Rename</DropdownMenuItem>\n\t\t<DropdownMenuItem>Duplicate</DropdownMenuItem>\n\t\t<DropdownMenuSeparator />\n\t\t<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>\n\t</DropdownMenuContent>\n</DropdownMenu>`,
		imports: [
			ui(
				"dropdown-menu",
				"DropdownMenu",
				"DropdownMenuTrigger",
				"DropdownMenuContent",
				"DropdownMenuLabel",
				"DropdownMenuItem",
				"DropdownMenuSeparator",
			),
			ui("button", "Button"),
			icons("Ellipsis"),
		],
		keywords: ["dropdown", "menu", "actions", "more", "context"],
	},
	{
		id: "tooltip",
		title: "Tooltip",
		module: "tooltip",
		description: "A hint shown on hover (closed).",
		snippet: `<TooltipProvider>\n\t<Tooltip>\n\t\t<TooltipTrigger asChild>\n\t\t\t<Button variant="outline" size="icon" aria-label="Share">\n\t\t\t\t<Share />\n\t\t\t</Button>\n\t\t</TooltipTrigger>\n\t\t<TooltipContent>Share with your team</TooltipContent>\n\t</Tooltip>\n</TooltipProvider>`,
		imports: [
			ui("tooltip", "TooltipProvider", "Tooltip", "TooltipTrigger", "TooltipContent"),
			ui("button", "Button"),
			icons("Share"),
		],
		keywords: ["tooltip", "hint", "hover", "help"],
	},
	{
		id: "scroll-area",
		title: "Scroll area",
		module: "scroll-area",
		description: "A fixed-height list that scrolls.",
		snippet: `<ScrollArea className="h-48 w-full max-w-xs rounded-md border">\n\t<div className="p-4">\n\t\t<p className="mb-3 text-sm font-medium">Releases</p>\n\t\t{["v2.4.0", "v2.3.2", "v2.3.1", "v2.3.0", "v2.2.0", "v2.1.4", "v2.1.0", "v2.0.0"].map((tag) => (\n\t\t\t<p key={tag} className="border-b py-2 text-sm last:border-0">{tag}</p>\n\t\t))}\n\t</div>\n</ScrollArea>`,
		imports: [ui("scroll-area", "ScrollArea")],
		keywords: ["scroll", "list", "overflow", "area"],
	},
	{
		id: "collapsible",
		title: "Collapsible",
		module: "collapsible",
		description: "A section that expands and collapses.",
		snippet: `<Collapsible defaultOpen className="w-full max-w-sm rounded-lg border p-4">\n\t<CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium">\n\t\tShipping details\n\t\t<ChevronDown className="size-4 text-muted-foreground" />\n\t</CollapsibleTrigger>\n\t<CollapsibleContent className="pt-3 text-sm text-muted-foreground">\n\t\tArrives Thursday, March 14 by 8 pm.\n\t</CollapsibleContent>\n</Collapsible>`,
		imports: [ui("collapsible", "Collapsible", "CollapsibleTrigger", "CollapsibleContent"), icons("ChevronDown")],
		keywords: ["collapsible", "accordion", "expand", "disclosure", "details"],
	},
];

/** Library items matching `query` (title, module, keywords), in catalog order. */
export function searchLibrary(query: string): LibraryItem[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (!words.length) return LIBRARY;

	return LIBRARY.filter((item) => {
		const haystack = [item.title, item.module, item.description, ...item.keywords].join(" ").toLowerCase();

		return words.every((word) => haystack.includes(word));
	});
}
