// Snippets may use only the exports in `UI_MODULES`, lucide icons and theme classes.

export type LibraryImport = { from: string; names: string[] };

export type LibraryItem = {
	id: string;
	title: string;
	/** `@/components/ui/<module>` */
	module: string;
	description: string;
	/** One or more sibling elements */
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
	{
		id: "label",
		title: "Label",
		module: "label",
		description: "A label tied to a form control.",
		snippet: `<div className="grid w-full max-w-sm gap-1.5">\n\t<Label htmlFor="workspace">Workspace name</Label>\n\t<Input id="workspace" placeholder="Northwind" />\n</div>`,
		imports: [ui("label", "Label"), ui("input", "Input")],
		keywords: ["label", "field", "form"],
	},
	{
		id: "metric-card",
		title: "Metric card",
		module: "uai/metric-card",
		description: "A KPI with its label, value, trend and comparison.",
		snippet: `<MetricCard className="w-full max-w-xs">\n\t<MetricCardHeader>\n\t\t<MetricCardLabel>Monthly revenue</MetricCardLabel>\n\t\t<MetricCardTrend direction="up">12.4%</MetricCardTrend>\n\t</MetricCardHeader>\n\t<MetricCardValue className="text-2xl">$48,210</MetricCardValue>\n\t<MetricCardComparison>vs $42,890 last month</MetricCardComparison>\n</MetricCard>`,
		imports: [
			ui(
				"uai/metric-card",
				"MetricCard",
				"MetricCardHeader",
				"MetricCardLabel",
				"MetricCardTrend",
				"MetricCardValue",
				"MetricCardComparison",
			),
		],
		keywords: ["metric", "kpi", "stat", "dashboard", "trend", "number", "uai"],
	},
	{
		id: "status-banner",
		title: "Status banner",
		module: "uai/status-banner",
		description: "An info, success, warning or error notice with actions.",
		snippet: `<StatusBanner tone="warning" className="w-full max-w-md">\n\t<StatusBannerIcon />\n\t<StatusBannerContent>\n\t\t<StatusBannerTitle>Your trial ends in 3 days</StatusBannerTitle>\n\t\t<StatusBannerDescription>Add a payment method to keep your projects.</StatusBannerDescription>\n\t</StatusBannerContent>\n\t<StatusBannerActions>\n\t\t<StatusBannerAction>Add card</StatusBannerAction>\n\t</StatusBannerActions>\n\t<StatusBannerDismiss />\n</StatusBanner>`,
		imports: [
			ui(
				"uai/status-banner",
				"StatusBanner",
				"StatusBannerIcon",
				"StatusBannerContent",
				"StatusBannerTitle",
				"StatusBannerDescription",
				"StatusBannerActions",
				"StatusBannerAction",
				"StatusBannerDismiss",
			),
		],
		keywords: ["banner", "alert", "notice", "status", "warning", "error", "success", "uai"],
	},
	{
		id: "step-indicator",
		title: "Step indicator",
		module: "uai/step-indicator",
		description: "The steps of a multi-step flow and where the user is.",
		snippet: `<StepIndicator className="w-full max-w-lg">\n\t<StepIndicatorStep status="complete">\n\t\t<StepIndicatorTitle>Account</StepIndicatorTitle>\n\t</StepIndicatorStep>\n\t<StepIndicatorStep status="current">\n\t\t<StepIndicatorTitle>Workspace</StepIndicatorTitle>\n\t\t<StepIndicatorDescription>Name and members</StepIndicatorDescription>\n\t</StepIndicatorStep>\n\t<StepIndicatorStep>\n\t\t<StepIndicatorTitle>Billing</StepIndicatorTitle>\n\t</StepIndicatorStep>\n</StepIndicator>`,
		imports: [
			ui("uai/step-indicator", "StepIndicator", "StepIndicatorStep", "StepIndicatorTitle", "StepIndicatorDescription"),
		],
		keywords: ["steps", "stepper", "progress", "wizard", "onboarding", "uai"],
	},
	{
		id: "search-field",
		title: "Search field",
		module: "uai/search-field",
		description: "A search input with a clear button, status message and recent searches.",
		snippet: `<SearchField className="w-full max-w-sm">\n\t<SearchFieldLabel>Search orders</SearchFieldLabel>\n\t<SearchFieldControl>\n\t\t<SearchFieldInput placeholder="Order number or customer" />\n\t\t<SearchFieldClear />\n\t</SearchFieldControl>\n\t<SearchFieldRecent>\n\t\t<SearchFieldRecentItem value="#10492">#10492</SearchFieldRecentItem>\n\t\t<SearchFieldRecentItem value="Ana Souza">Ana Souza</SearchFieldRecentItem>\n\t</SearchFieldRecent>\n</SearchField>`,
		imports: [
			ui(
				"uai/search-field",
				"SearchField",
				"SearchFieldLabel",
				"SearchFieldControl",
				"SearchFieldInput",
				"SearchFieldClear",
				"SearchFieldRecent",
				"SearchFieldRecentItem",
			),
		],
		keywords: ["search", "find", "filter", "query", "input", "uai"],
	},
	{
		id: "form-field",
		title: "Form field",
		module: "uai/form-field",
		description: "A labelled input with a hint, an error and a character count.",
		snippet: `<FormField required maxLength={60} defaultValue="Acme Studio" className="w-full max-w-sm">\n\t<FormFieldLabel>Company name</FormFieldLabel>\n\t<FormFieldInput />\n\t<FormFieldDescription>Shown on invoices.</FormFieldDescription>\n\t<FormFieldCount />\n</FormField>`,
		imports: [
			ui("uai/form-field", "FormField", "FormFieldLabel", "FormFieldInput", "FormFieldDescription", "FormFieldCount"),
		],
		keywords: ["form", "field", "input", "label", "validation", "uai"],
	},
	{
		id: "form-error-summary",
		title: "Form error summary",
		module: "uai/form-error-summary",
		description: "The fields a form submission failed on, with links to them.",
		snippet: `<FormErrorSummary className="w-full max-w-sm">\n\t<FormErrorSummaryTitle>Fix 2 fields to continue</FormErrorSummaryTitle>\n\t<FormErrorSummaryList>\n\t\t<FormErrorSummaryLink fieldId="email">Enter a valid email</FormErrorSummaryLink>\n\t\t<FormErrorSummaryLink fieldId="password">Use at least 8 characters</FormErrorSummaryLink>\n\t</FormErrorSummaryList>\n</FormErrorSummary>`,
		imports: [
			ui(
				"uai/form-error-summary",
				"FormErrorSummary",
				"FormErrorSummaryTitle",
				"FormErrorSummaryList",
				"FormErrorSummaryLink",
			),
		],
		keywords: ["form", "errors", "validation", "summary", "uai"],
	},
	{
		id: "message",
		title: "Chat message",
		module: "uai/message",
		description: "A chat message from the user or an assistant, with actions.",
		snippet: `<div className="grid w-full max-w-md gap-4">\n\t<Message from="user">\n\t\t<MessageBody>\n\t\t\t<MessageContent>Summarize this week's support tickets.</MessageContent>\n\t\t</MessageBody>\n\t</Message>\n\t<Message from="assistant">\n\t\t<MessageBody>\n\t\t\t<MessageContent>42 tickets came in. Most were about billing, and 3 are still open.</MessageContent>\n\t\t\t<MessageActions>\n\t\t\t\t<MessageCopy />\n\t\t\t</MessageActions>\n\t\t</MessageBody>\n\t</Message>\n</div>`,
		imports: [ui("uai/message", "Message", "MessageBody", "MessageContent", "MessageActions", "MessageCopy")],
		keywords: ["message", "chat", "assistant", "ai", "conversation", "uai"],
	},
	{
		id: "prompt-composer",
		title: "Prompt composer",
		module: "uai/prompt-composer",
		description: "The prompt bar of an AI app, with a send button.",
		snippet: `<PromptComposer className="w-full max-w-md">\n\t<PromptComposerInput placeholder="Ask anything" />\n\t<PromptComposerActions>\n\t\t<PromptComposerSubmit />\n\t</PromptComposerActions>\n</PromptComposer>`,
		imports: [
			ui(
				"uai/prompt-composer",
				"PromptComposer",
				"PromptComposerInput",
				"PromptComposerActions",
				"PromptComposerSubmit",
			),
		],
		keywords: ["prompt", "composer", "chat", "ai", "input", "send", "uai"],
	},
	{
		id: "thinking",
		title: "Thinking",
		module: "uai/thinking",
		description: "An AI's reasoning steps, collapsible.",
		snippet: `<Thinking status="complete" className="w-full max-w-md">\n\t<ThinkingTrigger duration="12s" />\n\t<ThinkingContent>\n\t\t<ThinkingActivity type="search" query="refund policy">Searched the help center</ThinkingActivity>\n\t\t<ThinkingActivity type="progress">Compared the 3 plans</ThinkingActivity>\n\t</ThinkingContent>\n</Thinking>`,
		imports: [ui("uai/thinking", "Thinking", "ThinkingTrigger", "ThinkingContent", "ThinkingActivity")],
		keywords: ["thinking", "reasoning", "ai", "agent", "steps", "uai"],
	},
];

export function searchLibrary(query: string): LibraryItem[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (!words.length) return LIBRARY;

	return LIBRARY.filter((item) => {
		const haystack = [item.title, item.module, item.description, ...item.keywords].join(" ").toLowerCase();

		return words.every((word) => haystack.includes(word));
	});
}
