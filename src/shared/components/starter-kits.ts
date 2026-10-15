// Kit components may import only what screens can: react, lucide-react, `cn`, the `UI_MODULES` and each other.
// They use theme classes, so they follow DESIGN.md. Every prop has a default, so a component renders as dropped.

export const KIT_IDS = ["shadcn", "dashboard", "marketing", "ios", "material"] as const;

export type KitId = (typeof KIT_IDS)[number];

export const isKitId = (value: string | null | undefined): value is KitId => KIT_IDS.some((id) => id === value);

export const DEFAULT_KIT: KitId = "shadcn";

export type StarterKit = {
	id: KitId;
	label: string;
	description: string;
	/** `components/<name>.tsx` → source */
	files: Record<string, string>;
};

const DASHBOARD = {
	"components/app-sidebar.tsx": `import { ChartColumn, FolderKanban, LayoutDashboard, Settings, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarItem = { label: string; icon: LucideIcon };

const ITEMS: SidebarItem[] = [
	{ label: "Overview", icon: LayoutDashboard },
	{ label: "Projects", icon: FolderKanban },
	{ label: "Reports", icon: ChartColumn },
	{ label: "Team", icon: Users },
	{ label: "Settings", icon: Settings },
];

type AppSidebarProps = {
	title?: string;
	items?: SidebarItem[];
	active?: number;
	className?: string;
};

export function AppSidebar({ title = "Acme", items = ITEMS, active = 0, className }: AppSidebarProps) {
	return (
		<aside className={cn("flex w-60 shrink-0 flex-col gap-1 border-r bg-muted/40 p-3", className)}>
			<div className="mb-4 flex items-center gap-2 px-2 py-1.5">
				<span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
					{title.charAt(0)}
				</span>
				<span className="text-sm font-semibold">{title}</span>
			</div>
			{items.map(({ label, icon: Icon }, index) => (
				<div
					key={label}
					className={cn(
						"flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
						index === active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground",
					)}
				>
					<Icon className="size-4" />
					{label}
				</div>
			))}
		</aside>
	);
}
`,
	"components/page-header.tsx": `import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
	title?: string;
	description?: string;
	children?: ReactNode;
	className?: string;
};

export function PageHeader({
	title = "Projects",
	description = "Everything your team is working on.",
	children,
	className,
}: PageHeaderProps) {
	return (
		<header className={cn("flex items-end justify-between gap-4 border-b pb-5", className)}>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			<div className="flex items-center gap-2">
				{children ?? (
					<Button>
						<Plus />
						New project
					</Button>
				)}
			</div>
		</header>
	);
}
`,
	"components/filter-bar.tsx": `import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterBarProps = {
	placeholder?: string;
	filters?: string[];
	active?: number;
	className?: string;
};

export function FilterBar({
	placeholder = "Search projects",
	filters = ["All", "Active", "Archived"],
	active = 0,
	className,
}: FilterBarProps) {
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<div className="relative max-w-xs flex-1">
				<Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input placeholder={placeholder} className="pl-8" />
			</div>
			<div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
				{filters.map((filter, index) => (
					<span
						key={filter}
						className={cn(
							"rounded-sm px-2.5 py-1 text-xs font-medium",
							index === active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
						)}
					>
						{filter}
					</span>
				))}
			</div>
			<Button variant="outline" size="sm" className="ml-auto">
				<ListFilter />
				Filter
			</Button>
		</div>
	);
}
`,
	"components/data-table.tsx": `import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Column = { key: string; label: string; align?: "left" | "right" };

type Row = Record<string, string>;

const COLUMNS: Column[] = [
	{ key: "name", label: "Name" },
	{ key: "owner", label: "Owner" },
	{ key: "status", label: "Status" },
	{ key: "updated", label: "Updated", align: "right" },
];

const ROWS: Row[] = [
	{ name: "Website redesign", owner: "Ana Costa", status: "Active", updated: "2h ago" },
	{ name: "Mobile onboarding", owner: "Leo Park", status: "In review", updated: "Yesterday" },
	{ name: "Billing migration", owner: "Sara Kim", status: "Active", updated: "3 days ago" },
	{ name: "Q3 report", owner: "Tom Reyes", status: "Archived", updated: "Last week" },
];

type DataTableProps = {
	columns?: Column[];
	rows?: Row[];
	statusKey?: string;
	className?: string;
};

export function DataTable({ columns = COLUMNS, rows = ROWS, statusKey = "status", className }: DataTableProps) {
	return (
		<div className={cn("overflow-hidden rounded-lg border", className)}>
			<table className="w-full text-sm">
				<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								className={cn("px-4 py-2.5 font-medium", column.align === "right" && "text-right")}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={index} className="border-t">
							{columns.map((column) => (
								<td
									key={column.key}
									className={cn(
										"px-4 py-3",
										column.align === "right" && "text-right text-muted-foreground",
										index === 0 && column === columns[0] && "font-medium",
									)}
								>
									{column.key === statusKey ? (
										<Badge variant={row[column.key] === "Active" ? "default" : "secondary"}>{row[column.key]}</Badge>
									) : (
										row[column.key]
									)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
`,
	"components/empty-state.tsx": `import { Inbox, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
	icon?: LucideIcon;
	title?: string;
	description?: string;
	action?: string;
	className?: string;
};

export function EmptyState({
	icon: Icon = Inbox,
	title = "No projects yet",
	description = "Create a project to start tracking work with your team.",
	action = "New project",
	className,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
				className,
			)}
		>
			<span className="flex size-10 items-center justify-center rounded-full bg-muted">
				<Icon className="size-5 text-muted-foreground" />
			</span>
			<div className="flex flex-col gap-1">
				<p className="font-medium">{title}</p>
				<p className="max-w-xs text-sm text-muted-foreground">{description}</p>
			</div>
			{action && (
				<Button size="sm" className="mt-1">
					<Plus />
					{action}
				</Button>
			)}
		</div>
	);
}
`,
};

const MARKETING = {
	"components/site-header.tsx": `import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
	brand?: string;
	links?: string[];
	cta?: string;
	className?: string;
};

export function SiteHeader({
	brand = "Acme",
	links = ["Product", "Pricing", "Customers", "Docs"],
	cta = "Get started",
	className,
}: SiteHeaderProps) {
	return (
		<header className={cn("flex h-16 items-center gap-8 border-b px-8", className)}>
			<span className="text-base font-semibold tracking-tight">{brand}</span>
			<nav className="flex items-center gap-6 text-sm text-muted-foreground">
				{links.map((link) => (
					<span key={link}>{link}</span>
				))}
			</nav>
			<div className="ml-auto flex items-center gap-2">
				<Button variant="ghost" size="sm">
					Sign in
				</Button>
				<Button size="sm">{cta}</Button>
			</div>
		</header>
	);
}
`,
	"components/hero.tsx": `import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HeroProps = {
	eyebrow?: string;
	title?: string;
	description?: string;
	primary?: string;
	secondary?: string;
	className?: string;
};

export function Hero({
	eyebrow = "New: automations",
	title = "Ship the work, not the busywork",
	description = "Plan, track and release in one place. Your team sees what matters and skips the status meetings.",
	primary = "Start free",
	secondary = "Book a demo",
	className,
}: HeroProps) {
	return (
		<section className={cn("flex flex-col items-center gap-6 px-8 py-24 text-center", className)}>
			<Badge variant="secondary" className="rounded-full px-3">
				{eyebrow}
			</Badge>
			<h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance">{title}</h1>
			<p className="max-w-xl text-lg text-muted-foreground text-pretty">{description}</p>
			<div className="flex items-center gap-3">
				<Button size="lg">
					{primary}
					<ArrowRight />
				</Button>
				<Button size="lg" variant="outline">
					{secondary}
				</Button>
			</div>
		</section>
	);
}
`,
	"components/feature-grid.tsx": `import { Gauge, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Feature = { icon: LucideIcon; title: string; description: string };

const FEATURES: Feature[] = [
	{ icon: Workflow, title: "Automations", description: "Move work forward when a status changes, with no scripts." },
	{ icon: Gauge, title: "Fast by default", description: "Every view loads in under 100 ms, even with 10,000 items." },
	{ icon: ShieldCheck, title: "Secure", description: "SSO, audit logs and roles that match how your team works." },
];

type FeatureGridProps = {
	title?: string;
	description?: string;
	features?: Feature[];
	className?: string;
};

export function FeatureGrid({
	title = "Everything in one place",
	description = "The tools your team uses every day, built to work together.",
	features = FEATURES,
	className,
}: FeatureGridProps) {
	return (
		<section className={cn("flex flex-col gap-10 px-8 py-20", className)}>
			<div className="flex max-w-xl flex-col gap-2">
				<h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
				<p className="text-muted-foreground">{description}</p>
			</div>
			<div className="grid grid-cols-3 gap-8">
				{features.map(({ icon: Icon, title: name, description: text }) => (
					<div key={name} className="flex flex-col gap-3">
						<span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
							<Icon className="size-5" />
						</span>
						<p className="font-medium">{name}</p>
						<p className="text-sm text-muted-foreground">{text}</p>
					</div>
				))}
			</div>
		</section>
	);
}
`,
	"components/pricing-card.tsx": `import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PricingCardProps = {
	name?: string;
	price?: string;
	period?: string;
	description?: string;
	features?: string[];
	cta?: string;
	featured?: boolean;
	className?: string;
};

export function PricingCard({
	name = "Team",
	price = "$12",
	period = "per user / month",
	description = "For teams that ship every week.",
	features = ["Unlimited projects", "Automations", "Guest access", "Priority support"],
	cta = "Start free trial",
	featured = false,
	className,
}: PricingCardProps) {
	return (
		<Card className={cn("w-80", featured && "border-primary ring-1 ring-primary", className)}>
			<CardHeader>
				<CardTitle>{name}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<p className="flex items-baseline gap-1.5">
					<span className="text-4xl font-semibold tracking-tight">{price}</span>
					<span className="text-sm text-muted-foreground">{period}</span>
				</p>
				<ul className="flex flex-col gap-2 text-sm">
					{features.map((feature) => (
						<li key={feature} className="flex items-center gap-2">
							<Check className="size-4 text-primary" />
							{feature}
						</li>
					))}
				</ul>
			</CardContent>
			<CardFooter>
				<Button className="w-full" variant={featured ? "default" : "outline"}>
					{cta}
				</Button>
			</CardFooter>
		</Card>
	);
}
`,
	"components/testimonial.tsx": `import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type TestimonialProps = {
	quote?: string;
	name?: string;
	role?: string;
	className?: string;
};

export function Testimonial({
	quote = "We cut our weekly status meeting. Everyone already knows where things stand.",
	name = "Maya Lin",
	role = "Head of Product, Northwind",
	className,
}: TestimonialProps) {
	const initials = name
		.split(" ")
		.map((part) => part.charAt(0))
		.join("");

	return (
		<figure className={cn("flex max-w-md flex-col gap-5 rounded-xl border bg-card p-6", className)}>
			<blockquote className="text-lg text-pretty">{quote}</blockquote>
			<figcaption className="flex items-center gap-3">
				<Avatar>
					<AvatarFallback>{initials}</AvatarFallback>
				</Avatar>
				<div className="flex flex-col">
					<span className="text-sm font-medium">{name}</span>
					<span className="text-sm text-muted-foreground">{role}</span>
				</div>
			</figcaption>
		</figure>
	);
}
`,
	"components/site-footer.tsx": `import { cn } from "@/lib/utils";

type FooterColumn = { title: string; links: string[] };

const COLUMNS: FooterColumn[] = [
	{ title: "Product", links: ["Features", "Pricing", "Changelog"] },
	{ title: "Company", links: ["About", "Careers", "Blog"] },
	{ title: "Resources", links: ["Docs", "Guides", "Status"] },
];

type SiteFooterProps = {
	brand?: string;
	columns?: FooterColumn[];
	className?: string;
};

export function SiteFooter({ brand = "Acme", columns = COLUMNS, className }: SiteFooterProps) {
	return (
		<footer className={cn("flex gap-16 border-t px-8 py-12 text-sm", className)}>
			<div className="flex flex-1 flex-col gap-2">
				<span className="text-base font-semibold tracking-tight">{brand}</span>
				<span className="text-muted-foreground">© 2026 {brand} Inc.</span>
			</div>
			{columns.map((column) => (
				<div key={column.title} className="flex flex-col gap-2">
					<span className="font-medium">{column.title}</span>
					{column.links.map((link) => (
						<span key={link} className="text-muted-foreground">
							{link}
						</span>
					))}
				</div>
			))}
		</footer>
	);
}
`,
};

const IOS = {
	"components/large-title.tsx": `import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type LargeTitleProps = {
	title?: string;
	back?: string;
	trailing?: ReactNode;
	className?: string;
};

export function LargeTitle({ title = "Inbox", back, trailing, className }: LargeTitleProps) {
	return (
		<header className={cn("flex flex-col gap-1 bg-background px-4 pt-2 pb-2", className)}>
			<div className="flex h-11 items-center justify-between text-primary">
				{back ? (
					<span className="-ml-2 flex items-center text-[17px]">
						<ChevronLeft className="size-6" />
						{back}
					</span>
				) : (
					<span />
				)}
				<span className="text-[17px]">{trailing ?? "Edit"}</span>
			</div>
			<h1 className="text-[34px] leading-tight font-bold tracking-tight">{title}</h1>
		</header>
	);
}
`,
	"components/grouped-list.tsx": `import type { ReactNode } from "react";
import { Bell, ChevronRight, Lock, Moon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type GroupedListRowProps = {
	icon?: LucideIcon;
	iconClassName?: string;
	label?: string;
	value?: string;
	chevron?: boolean;
	className?: string;
};

export function GroupedListRow({
	icon: Icon,
	iconClassName,
	label = "Notifications",
	value,
	chevron = true,
	className,
}: GroupedListRowProps) {
	return (
		<div className={cn("flex min-h-11 items-center gap-3 pl-4", className)}>
			{Icon && (
				<span
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
						iconClassName,
					)}
				>
					<Icon className="size-4" />
				</span>
			)}
			<div className="flex flex-1 items-center gap-2 self-stretch border-b border-border/60 pr-4">
				<span className="flex-1 text-[17px]">{label}</span>
				{value && <span className="text-[17px] text-muted-foreground">{value}</span>}
				{chevron && <ChevronRight className="size-5 text-muted-foreground/60" />}
			</div>
		</div>
	);
}

type GroupedListProps = {
	header?: string;
	footer?: string;
	children?: ReactNode;
	className?: string;
};

export function GroupedList({ header = "Settings", footer, children, className }: GroupedListProps) {
	return (
		<section className={cn("flex flex-col gap-1.5 px-4", className)}>
			{header && <p className="px-4 text-[13px] text-muted-foreground uppercase">{header}</p>}
			<div className="overflow-hidden rounded-xl bg-card [&>*:last-child>div]:border-b-0">
				{children ?? (
					<>
						<GroupedListRow icon={Bell} iconClassName="bg-destructive" label="Notifications" />
						<GroupedListRow icon={Moon} label="Focus" value="Off" />
						<GroupedListRow icon={Lock} iconClassName="bg-muted-foreground" label="Privacy" />
					</>
				)}
			</div>
			{footer && <p className="px-4 text-[13px] text-muted-foreground">{footer}</p>}
		</section>
	);
}
`,
	"components/segmented-control.tsx": `import { cn } from "@/lib/utils";

type SegmentedControlProps = {
	options?: string[];
	active?: number;
	className?: string;
};

export function SegmentedControl({ options = ["Day", "Week", "Month"], active = 0, className }: SegmentedControlProps) {
	return (
		<div className={cn("flex h-8 rounded-lg bg-muted p-0.5", className)}>
			{options.map((option, index) => (
				<span
					key={option}
					className={cn(
						"flex flex-1 items-center justify-center rounded-md text-[13px] font-medium",
						index === active ? "bg-background shadow-sm" : "text-foreground/80",
					)}
				>
					{option}
				</span>
			))}
		</div>
	);
}
`,
	"components/ios-tab-bar.tsx": `import { Clock, Search, Star, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { label: string; icon: LucideIcon };

const TABS: Tab[] = [
	{ label: "Favorites", icon: Star },
	{ label: "Recents", icon: Clock },
	{ label: "Search", icon: Search },
	{ label: "Profile", icon: User },
];

type IosTabBarProps = {
	tabs?: Tab[];
	active?: number;
	className?: string;
};

export function IosTabBar({ tabs = TABS, active = 0, className }: IosTabBarProps) {
	return (
		<nav
			className={cn(
				"flex h-[83px] items-start justify-around border-t border-border/60 bg-background/90 pt-1.5 backdrop-blur",
				className,
			)}
		>
			{tabs.map(({ label, icon: Icon }, index) => (
				<span
					key={label}
					className={cn(
						"flex w-16 flex-col items-center gap-0.5 text-[10px] font-medium",
						index === active ? "text-primary" : "text-muted-foreground",
					)}
				>
					<Icon className="size-6" />
					{label}
				</span>
			))}
		</nav>
	);
}
`,
	"components/action-sheet.tsx": `import { cn } from "@/lib/utils";

type SheetAction = { label: string; destructive?: boolean };

type ActionSheetProps = {
	title?: string;
	actions?: SheetAction[];
	cancel?: string;
	className?: string;
};

export function ActionSheet({
	title = "This photo will be deleted from all your devices.",
	actions = [{ label: "Delete Photo", destructive: true }],
	cancel = "Cancel",
	className,
}: ActionSheetProps) {
	return (
		<div className={cn("flex flex-col gap-2 p-2", className)}>
			<div className="overflow-hidden rounded-xl bg-card/95 text-center backdrop-blur">
				{title && <p className="border-b border-border/60 px-4 py-3 text-[13px] text-muted-foreground">{title}</p>}
				{actions.map((action) => (
					<p
						key={action.label}
						className={cn(
							"border-b border-border/60 py-4 text-[20px] last:border-b-0",
							action.destructive ? "text-destructive" : "text-primary",
						)}
					>
						{action.label}
					</p>
				))}
			</div>
			<p className="rounded-xl bg-card py-4 text-center text-[20px] font-semibold text-primary">{cancel}</p>
		</div>
	);
}
`,
};

const MATERIAL = {
	"components/top-app-bar.tsx": `import { Menu, MoreVertical, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TopAppBarProps = {
	title?: string;
	className?: string;
};

export function TopAppBar({ title = "Inbox", className }: TopAppBarProps) {
	return (
		<header className={cn("flex h-16 items-center gap-1 bg-background px-1", className)}>
			<Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Menu">
				<Menu className="size-6" />
			</Button>
			<h1 className="flex-1 px-1 text-[22px]">{title}</h1>
			<Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Search">
				<Search className="size-6" />
			</Button>
			<Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="More">
				<MoreVertical className="size-6" />
			</Button>
		</header>
	);
}
`,
	"components/navigation-bar.tsx": `import { Bell, House, Mail, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Destination = { label: string; icon: LucideIcon };

const DESTINATIONS: Destination[] = [
	{ label: "Home", icon: House },
	{ label: "Mail", icon: Mail },
	{ label: "Alerts", icon: Bell },
	{ label: "Settings", icon: Settings },
];

type NavigationBarProps = {
	destinations?: Destination[];
	active?: number;
	className?: string;
};

export function NavigationBar({ destinations = DESTINATIONS, active = 0, className }: NavigationBarProps) {
	return (
		<nav className={cn("flex h-20 items-center justify-around bg-muted px-2", className)}>
			{destinations.map(({ label, icon: Icon }, index) => (
				<span key={label} className="flex flex-col items-center gap-1 text-xs font-medium">
					<span
						className={cn(
							"flex h-8 w-16 items-center justify-center rounded-full",
							index === active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground",
						)}
					>
						<Icon className="size-6" />
					</span>
					<span className={cn(index !== active && "text-muted-foreground")}>{label}</span>
				</span>
			))}
		</nav>
	);
}
`,
	"components/fab.tsx": `import { Pencil, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type FabProps = {
	icon?: LucideIcon;
	label?: string;
	className?: string;
};

export function Fab({ icon: Icon = Pencil, label = "Compose", className }: FabProps) {
	return (
		<button
			type="button"
			aria-label={label}
			className={cn(
				"flex h-14 items-center gap-3 rounded-2xl bg-primary px-4 text-primary-foreground shadow-lg",
				label ? "pr-5" : "w-14 justify-center",
				className,
			)}
		>
			<Icon className="size-6" />
			{label && <span className="text-sm font-medium">{label}</span>}
		</button>
	);
}
`,
	"components/chip.tsx": `import { Check, type LucideIcon } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva("inline-flex h-8 items-center gap-2 rounded-lg px-4 text-sm font-medium", {
	variants: {
		variant: {
			assist: "border border-border text-foreground",
			filter: "border border-border text-muted-foreground",
			selected: "bg-secondary pl-2 text-secondary-foreground",
		},
	},
	defaultVariants: { variant: "assist" },
});

type ChipProps = {
	label?: string;
	icon?: LucideIcon;
	variant?: "assist" | "filter" | "selected";
	className?: string;
};

export function Chip({ label = "Unread", icon: Icon, variant = "assist", className }: ChipProps) {
	return (
		<span className={cn(chipVariants({ variant }), Icon && "pl-2", className)}>
			{variant === "selected" ? <Check className="size-4" /> : Icon && <Icon className="size-4" />}
			{label}
		</span>
	);
}
`,
	"components/list-item.tsx": `import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ListItemProps = {
	headline?: string;
	supporting?: string;
	trailing?: ReactNode;
	initials?: string;
	className?: string;
};

export function ListItem({
	headline = "Ali Connors",
	supporting = "Brunch this weekend? I'll be in your neighborhood.",
	trailing = "10 min",
	initials = "AC",
	className,
}: ListItemProps) {
	return (
		<div className={cn("flex min-h-[72px] items-center gap-4 px-4 py-2", className)}>
			<Avatar className="size-10">
				<AvatarFallback className="bg-primary/15 text-primary">{initials}</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="text-base">{headline}</span>
				<span className="truncate text-sm text-muted-foreground">{supporting}</span>
			</div>
			<span className="self-start pt-1 text-xs text-muted-foreground">{trailing}</span>
		</div>
	);
}
`,
};

export const STARTER_KITS: readonly StarterKit[] = [
	{
		id: "shadcn",
		label: "shadcn",
		description: "shadcn/ui primitives and uai blocks",
		files: {},
	},
	{
		id: "dashboard",
		label: "Dashboard",
		description: "Sidebar, page header, filters, table, empty state",
		files: DASHBOARD,
	},
	{
		id: "marketing",
		label: "Marketing site",
		description: "Header, hero, features, pricing, testimonial, footer",
		files: MARKETING,
	},
	{
		id: "ios",
		label: "iOS",
		description: "Large title, grouped list, segmented control, tab bar, action sheet",
		files: IOS,
	},
	{
		id: "material",
		label: "Material",
		description: "Top app bar, navigation bar, FAB, chips, list item",
		files: MATERIAL,
	},
];

export const kitById = (id: KitId) => STARTER_KITS.find((kit) => kit.id === id)!;

/** The `components/` files a new project starts with; the shadcn primitives ship with every project */
export function kitFiles(id: KitId | null | undefined): Record<string, string> {
	return id ? { ...kitById(id).files } : {};
}
