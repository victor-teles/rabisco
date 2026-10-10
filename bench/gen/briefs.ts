// Fixed briefs for the generation eval. Change them only together with a new baseline: scores compare across runs.
import { FRAME_SIZE } from "../../src/shared/project";
import type { Device, ProjectFiles } from "../../src/shared/types";

export type BriefDevice = Device;

/** `focus` is an edit of one element (point and prompt) */
export type BriefTask = "create" | "edit" | "focus" | "vary";

export type SeedScreen = { path: string; name: string; source: string };

/** PRODUCT.md and DESIGN.md of a themed project, and the components it already has */
export type Theme = { name: string; product: string; design: string; components: ProjectFiles };

export type Brief = {
	id: string;
	device: BriefDevice;
	task: BriefTask;
	prompt: string;
	theme?: Theme;
	seeds?: SeedScreen[];
	/** The seed screen an edit, focus or vary works on */
	target?: string;
	/** Start of the focused element's opening tag in `target`; must be unique in the file */
	focus?: string;
	/** `vary` only */
	variations?: number;
};

/** The app's frame sizes, so a brief is designed at the size its frame shows */
export const DEVICE_SIZE = FRAME_SIZE;

const LEDGER: Theme = {
	name: "Ledger",
	product: `# Product

Ledger is a mobile bank for freelancers in Brazil. It keeps business and personal money apart and sets tax aside on every payment.

## Audience

Freelance designers and developers in their first years on their own. They check the app between client work, often on the phone.

## Voice

Calm and direct. Numbers first. Say "R$ 1.240 set aside for taxes", never "You're crushing it!". Brazilian Portuguese names, amounts in R$.

## Constraints

Mobile first. No dark patterns around fees. Every money movement shows its fee before the user confirms.
`,
	design: `# Design

## Visual direction

Quiet and precise, like a good paper ledger. Warm off-white surfaces, deep ink text, one green brand color for money that is safe.

## Tokens

- background: #faf8f3
- foreground: #1c1b18
- card: #ffffff
- primary: #1f6f4a
- primary-foreground: #ffffff
- muted: #f0ede4
- muted-foreground: #6b675c
- border: #e4dfd2
- destructive: #b42318
- radius: 0.875rem
- font-sans: "Inter", system-ui, sans-serif
- color-brand: #1f6f4a
- color-brand-soft: #e3f1e8
- color-ink: #0f2a1f
- radius-card: 1.25rem
- font-display: "Fraunces", Georgia, serif
- text-amount: 2.5rem/1.1

### Dark

- background: #12110f
- foreground: #f2efe6
- card: #1b1a17
- color-brand-soft: #173326

## Typography

Amounts in font-display with text-amount and tabular-nums. Titles text-xl font-semibold. Body text-sm.

## Layout & spacing

16px page padding. Sections 24px apart. Cards use rounded-card and a 1px border, no shadow.

## Components

Lists use dividers, not cards. One primary action per screen. The tab bar has Home, Payments, Taxes and Profile.

## Do / Don't

- Do use bg-brand-soft behind positive amounts and badges.
- Don't use palette colors like green-600 for money: use the brand tokens.
`,
	components: {
		"components/app-tab-bar.tsx": `import { Home, Landmark, ReceiptText, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
	{ label: "Home", icon: Home },
	{ label: "Payments", icon: Landmark },
	{ label: "Taxes", icon: ReceiptText },
	{ label: "Profile", icon: User },
];

export function AppTabBar({ active = 0 }: { active?: number }) {
	return (
		<nav className="flex border-t border-border bg-card px-2 pb-6 pt-2">
			{TABS.map(({ label, icon: Icon }, index) => (
				<button
					key={label}
					className={cn(
						"flex flex-1 flex-col items-center gap-1 text-xs",
						index === active ? "text-brand" : "text-muted-foreground",
					)}
				>
					<Icon className="size-5" />
					{label}
				</button>
			))}
		</nav>
	);
}
`,
		"components/transaction-row.tsx": `import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

export function TransactionRow({ name, detail, amount }: { name: string; detail: string; amount: number }) {
	const incoming = amount > 0;
	const Icon = incoming ? ArrowDownLeft : ArrowUpRight;

	return (
		<div className="flex items-center gap-3 py-3">
			<div className="flex size-10 items-center justify-center rounded-full bg-muted">
				<Icon className="size-4 text-foreground" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{name}</p>
				<p className="text-xs text-muted-foreground">{detail}</p>
			</div>
			<p className={incoming ? "text-sm font-medium tabular-nums text-brand" : "text-sm tabular-nums"}>
				{incoming ? "+" : "−"} R$ {Math.abs(amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
			</p>
		</div>
	);
}
`,
	},
};

const PULSE: Theme = {
	name: "Pulse",
	product: `# Product

Pulse is product analytics for small SaaS teams: events, funnels and retention without a data team.

## Audience

Founders and product managers at companies of 5 to 50 people. They open Pulse on a laptop in the weekly product review.

## Voice

Plain and confident. Short labels. Numbers have units and a comparison ("+12% vs last week").

## Constraints

Desktop first, 1280 px wide. Destructive actions always say what is lost and ask to type the workspace name.
`,
	design: `# Design

## Visual direction

Dense but calm, like Linear. Cool neutral surfaces, violet as the one accent, data in the chart colors.

## Tokens

- background: #fbfbfd
- foreground: #16161d
- card: #ffffff
- primary: oklch(0.52 0.2 285)
- primary-foreground: #ffffff
- muted: #f2f2f6
- muted-foreground: #6c6c7a
- border: #e6e6ee
- destructive: oklch(0.58 0.22 27)
- chart-1: oklch(0.52 0.2 285)
- chart-2: oklch(0.7 0.14 190)
- chart-3: oklch(0.78 0.15 80)
- radius: 0.5rem
- font-sans: "Geist", system-ui, sans-serif
- font-mono: "Geist Mono", ui-monospace, monospace
- color-sidebar: #f5f5f9
- color-danger-soft: #fdecec
- spacing-gutter: 2rem
- text-kpi: 1.875rem/1.2

## Typography

KPIs in text-kpi font-semibold tabular-nums. Page titles text-xl font-semibold. Table text-sm, ids in font-mono.

## Layout & spacing

Sidebar 240 px in bg-sidebar. Content padding p-gutter. Cards with a border, no shadow, rounded-lg.

## Components

Tables over cards for lists. Buttons are small (h-8). Destructive zones sit at the end of a page with bg-danger-soft.

## Do / Don't

- Do use chart-1 to chart-3 for series.
- Don't use red-500 or violet-600: use destructive and primary.
`,
	components: {
		"components/sidebar-nav.tsx": `import { BarChart3, Filter, Gauge, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
	{ label: "Overview", icon: Gauge },
	{ label: "Events", icon: BarChart3 },
	{ label: "Funnels", icon: Filter },
	{ label: "People", icon: Users },
	{ label: "Settings", icon: Settings },
];

export function SidebarNav({ active = 0 }: { active?: number }) {
	return (
		<aside className="flex h-full w-60 flex-col gap-1 border-r border-border bg-sidebar p-3">
			<p className="px-2 pb-3 text-sm font-semibold">Pulse</p>
			{ITEMS.map(({ label, icon: Icon }, index) => (
				<a
					key={label}
					className={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
						index === active ? "bg-card font-medium shadow-xs" : "text-muted-foreground",
					)}
				>
					<Icon className="size-4" />
					{label}
				</a>
			))}
		</aside>
	);
}
`,
		"components/page-header.tsx": `import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
	return (
		<header className="flex items-end justify-between gap-4 border-b border-border pb-4">
			<div>
				<h1 className="text-xl font-semibold">{title}</h1>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			{actions && <div className="flex gap-2">{actions}</div>}
		</header>
	);
}
`,
	},
};

const ledgerAccount: SeedScreen = {
	path: "screens/account.tsx",
	name: "Account",
	source: `import { AppTabBar } from "../components/app-tab-bar";
import { TransactionRow } from "../components/transaction-row";

const TRANSACTIONS = [
	{ name: "Estúdio Faro", detail: "Today · Invoice #212", amount: 4800 },
	{ name: "Adobe", detail: "Today · Subscription", amount: -124.9 },
	{ name: "Mercado Pão Doce", detail: "Yesterday · Card", amount: -86.4 },
	{ name: "Taxes jar", detail: "Yesterday · Auto transfer", amount: -720 },
	{ name: "Lumen Labs", detail: "Mon · Invoice #209", amount: 3200 },
];

export default function Account() {
	return (
		<div className="flex h-full flex-col bg-background pt-12">
			<main className="flex-1 overflow-y-auto px-4">
				<p className="text-sm text-muted-foreground">Business account</p>
				<p className="font-display text-amount tabular-nums">R$ 18.430,12</p>
				<section className="mt-6">
					<h2 className="text-sm font-semibold">Activity</h2>
					<div className="divide-y divide-border">
						{TRANSACTIONS.map((t) => (
							<TransactionRow key={t.name + t.detail} {...t} />
						))}
					</div>
				</section>
			</main>
			<AppTabBar active={0} />
		</div>
	);
}
`,
};

const pulseSettings: SeedScreen = {
	path: "screens/workspace-settings.tsx",
	name: "Workspace settings",
	source: `import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "../components/page-header";
import { SidebarNav } from "../components/sidebar-nav";

export default function WorkspaceSettings() {
	return (
		<div className="flex h-full bg-background">
			<SidebarNav active={4} />
			<main className="flex-1 overflow-y-auto p-gutter">
				<PageHeader title="Workspace settings" description="Acme Inc · Pro plan" />
				<section className="mt-6 max-w-xl space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="name">Workspace name</Label>
						<Input id="name" defaultValue="Acme Inc" />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="domain">Allowed email domain</Label>
						<Input id="domain" defaultValue="acme.io" />
					</div>
					<Button size="sm">Save changes</Button>
				</section>
				<section id="danger-zone" className="mt-10 max-w-xl space-y-2">
					<h2 className="text-sm font-semibold">Danger zone</h2>
					<p className="text-sm text-muted-foreground">Delete this workspace and all of its events.</p>
					<Button size="sm" variant="outline">
						Delete workspace
					</Button>
				</section>
			</main>
		</div>
	);
}
`,
};

const habitToday: SeedScreen = {
	path: "screens/today.tsx",
	name: "Today",
	source: `import { Check } from "lucide-react";

const HABITS = [
	{ name: "Read 20 pages", time: "Morning", done: true },
	{ name: "Walk 6,000 steps", time: "Afternoon", done: false },
	{ name: "No phone after 22:00", time: "Evening", done: false },
];

export default function Today() {
	return (
		<div className="min-h-full bg-white px-5 pt-14">
			<p className="text-sm text-gray-500">Tuesday, 14 October</p>
			<h1 className="text-2xl font-bold text-gray-900">Today</h1>
			<ul className="mt-6 space-y-3">
				{HABITS.map((habit) => (
					<li key={habit.name} className="flex items-center gap-3 rounded-xl border border-gray-200 p-4">
						<span className="flex size-6 items-center justify-center rounded-full border border-gray-300">
							{habit.done && <Check className="size-4 text-emerald-600" />}
						</span>
						<div>
							<p className="font-medium text-gray-900">{habit.name}</p>
							<p className="text-sm text-gray-500">{habit.time}</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
`,
};

const pricing: SeedScreen = {
	path: "screens/pricing.tsx",
	name: "Pricing",
	source: `import { Button } from "@/components/ui/button";

export default function Pricing() {
	return (
		<div className="min-h-full bg-background px-16 py-14">
			<h1 className="text-center text-3xl font-semibold tracking-tight">Plans for every inbox</h1>
			<p className="mt-2 text-center text-muted-foreground">Mailroom sorts support email for teams of any size.</p>
			<div className="mt-10 grid grid-cols-3 gap-6">
				<div className="rounded-xl border border-border p-6">
					<h2 className="font-semibold">Starter</h2>
					<p className="mt-2 text-3xl font-semibold">$0</p>
					<p className="mt-4 text-sm text-muted-foreground">1 inbox, 100 conversations a month.</p>
					<Button variant="outline" className="mt-6 w-full">
						Start free
					</Button>
				</div>
				<div id="plan-pro" className="rounded-xl border border-border p-6">
					<h2 className="font-semibold">Pro</h2>
					<p className="mt-2 text-3xl font-semibold">$24</p>
					<p className="mt-4 text-sm text-muted-foreground">5 inboxes, unlimited conversations, rules.</p>
					<Button variant="outline" className="mt-6 w-full">
						Try Pro
					</Button>
				</div>
				<div className="rounded-xl border border-border p-6">
					<h2 className="font-semibold">Business</h2>
					<p className="mt-2 text-3xl font-semibold">$79</p>
					<p className="mt-4 text-sm text-muted-foreground">Unlimited inboxes, SSO, audit log.</p>
					<Button variant="outline" className="mt-6 w-full">
						Talk to sales
					</Button>
				</div>
			</div>
		</div>
	);
}
`,
};

const signIn: SeedScreen = {
	path: "screens/sign-in.tsx",
	name: "Sign in",
	source: `import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignIn() {
	return (
		<div className="flex min-h-full flex-col justify-center bg-background px-6">
			<h1 className="text-2xl font-semibold">Welcome back to Trailmate</h1>
			<p className="mt-1 text-sm text-muted-foreground">Plan hikes with friends and share the route.</p>
			<div className="mt-8 space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor="email">Email</Label>
					<Input id="email" type="email" placeholder="ana@example.com" />
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="password">Password</Label>
					<Input id="password" type="password" />
				</div>
				<Button className="w-full">Sign in</Button>
			</div>
			<p className="mt-6 text-center text-sm text-muted-foreground">New here? Create an account</p>
		</div>
	);
}
`,
};

export const BRIEFS: Brief[] = [
	{
		id: "bank-home",
		device: "mobile",
		task: "create",
		theme: LEDGER,
		prompt:
			"Home screen of the banking app: business balance, quick actions (send, request, pay a boleto), the taxes set aside this month, and the latest transactions.",
	},
	{
		id: "bank-send-flow",
		device: "mobile",
		task: "create",
		theme: LEDGER,
		prompt: "The flow to send a Pix: pick a recipient, enter the amount, review with the fee, and a success screen.",
	},
	{
		id: "habit-onboarding",
		device: "mobile",
		task: "create",
		prompt:
			"Onboarding for a habit tracker app: a welcome screen, a screen to pick up to three starter habits, and a screen to set a daily reminder time.",
	},
	{
		id: "analytics-dashboard",
		device: "desktop",
		task: "create",
		prompt:
			"An analytics dashboard for a SaaS product: KPIs for active users, MRR, churn and trial conversion, a signups chart for the last 30 days, top acquisition channels, and a table of recent upgrades.",
	},
	{
		id: "pulse-funnels",
		device: "desktop",
		task: "create",
		theme: PULSE,
		prompt:
			"The Funnels page: a list of saved funnels with their conversion and trend, and the selected funnel's steps as horizontal bars with drop-off between steps.",
	},
	{
		id: "clinic-schedule",
		device: "tablet",
		task: "create",
		prompt:
			"An iPad screen for the front desk of a physiotherapy clinic: today's appointments per therapist in columns, with check-in status, and a panel for the selected patient.",
	},
	{
		id: "bank-statements-tablet",
		device: "tablet",
		task: "create",
		theme: LEDGER,
		prompt:
			"An iPad screen for monthly statements: a month picker, income and expenses by category, and the list of the month's transactions.",
	},
	{
		id: "settings-danger-zone",
		device: "desktop",
		task: "edit",
		theme: PULSE,
		seeds: [pulseSettings],
		target: pulseSettings.path,
		prompt: "Make the danger zone clearer.",
	},
	{
		id: "habit-today-edit",
		device: "mobile",
		task: "edit",
		seeds: [habitToday],
		target: habitToday.path,
		prompt: "Add a week strip under the title that shows which days were complete, and make finished habits look done.",
	},
	{
		id: "pricing-focus",
		device: "desktop",
		task: "focus",
		seeds: [pricing],
		target: pricing.path,
		focus: '<div id="plan-pro"',
		prompt: "Make this the recommended plan: highlight it and add a “Most popular” badge.",
	},
	{
		id: "bank-activity-focus",
		device: "mobile",
		task: "focus",
		theme: LEDGER,
		seeds: [ledgerAccount],
		target: ledgerAccount.path,
		focus: '<section className="mt-6">',
		prompt: "Group these transactions by day, with a date header and the day's total.",
	},
	{
		id: "sign-in-vary",
		device: "mobile",
		task: "vary",
		seeds: [signIn],
		target: signIn.path,
		variations: 2,
		prompt: "Try a warmer, more outdoorsy look.",
	},
];
