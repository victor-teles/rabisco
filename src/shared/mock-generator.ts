import { validateToken, type DesignTokens } from "./context/tokens";
import { FRAME_GAP, FRAME_SIZE, uniqueScreenPath } from "./project";
import type { Device, FileChange, Frame, GenerateScreensResult } from "./types";

export const GENERATION_STEPS = [
	{ label: "Reading your brief" },
	{ label: "Choosing layout and type scale" },
	{ label: "Drafting screens" },
	{ label: "Polishing details" },
];

/** Full class names appear in the generated source so Tailwind sees them. */
const ACCENTS = ["blue", "violet", "emerald", "orange", "rose"] as const;

type Accent = (typeof ACCENTS)[number];

function hash(text: string) {
	let h = 0;

	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;

	return Math.abs(h);
}

const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"app",
	"that",
	"this",
	"design",
	"create",
	"make",
	"build",
	"page",
	"screen",
	"screens",
	"mobile",
	"desktop",
	"website",
	"landing",
]);

function titleFromPrompt(prompt: string) {
	const words = prompt
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

	const picked = words.slice(0, 2).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());

	return picked.join(" ") || "Untitled";
}

function jsxText(text: string) {
	const clean = text.replace(/\s+/g, " ").trim();

	return /[{}<>&]/.test(clean) ? `{${JSON.stringify(clean)}}` : clean;
}

type Draft = { name: string; source: string };

type Context = { title: string; brief: string; accent: Accent };

/** Never depend on the prompt, so an existing file is reused as is. */
const COMPONENTS = new Map(
	Object.entries({
		"components/stat-card.tsx": `import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
	label: string;
	value: string;
	change?: string;
	icon?: LucideIcon;
	className?: string;
};

export function StatCard({ label, value, change, icon: Icon, className }: StatCardProps) {
	return (
		<Card className={cn("gap-2 py-4", className)}>
			<CardContent className="px-4">
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>{label}</span>
					{Icon && <Icon className="size-4" />}
				</div>
				<p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
				{change && <p className="mt-1 text-xs text-muted-foreground">{change}</p>}
			</CardContent>
		</Card>
	);
}
`,
		"components/tab-bar.tsx": `import { Compass, Heart, House, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
	{ label: "Home", icon: House },
	{ label: "Explore", icon: Compass },
	{ label: "Saved", icon: Heart },
	{ label: "Profile", icon: User },
];

export function TabBar({ active = 0 }: { active?: number }) {
	return (
		<nav className="flex h-20 items-start justify-around border-t bg-background px-4 pt-3">
			{TABS.map(({ label, icon: Icon }, index) => (
				<div
					key={label}
					className={cn(
						"flex flex-col items-center gap-1 text-[11px] font-medium",
						index === active ? "text-foreground" : "text-muted-foreground",
					)}
				>
					<Icon className="size-5" />
					{label}
				</div>
			))}
		</nav>
	);
}
`,
		"components/sidebar-nav.tsx": `import { ChartColumn, FolderKanban, LayoutDashboard, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
	{ label: "Overview", icon: LayoutDashboard },
	{ label: "Projects", icon: FolderKanban },
	{ label: "Reports", icon: ChartColumn },
	{ label: "Team", icon: Users },
	{ label: "Settings", icon: Settings },
];

export function SidebarNav({ title, active = 0 }: { title: string; active?: number }) {
	return (
		<aside className="flex w-60 shrink-0 flex-col gap-1 border-r bg-muted/40 p-4">
			<p className="mb-6 px-3 text-base font-semibold">{title}</p>
			{ITEMS.map(({ label, icon: Icon }, index) => (
				<div
					key={label}
					className={cn(
						"flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
						index === active ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
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
	}),
);

function mobileDrafts({ title, brief, accent }: Context): Draft[] {
	return [
		{
			name: "Welcome",
			source: `import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Welcome() {
	return (
		<div className="flex min-h-full flex-col bg-background px-7 pt-20 pb-10 text-foreground">
			<div className="flex size-14 items-center justify-center rounded-2xl bg-${accent}-600 text-white shadow-lg shadow-${accent}-600/30">
				<Sparkles className="size-7" />
			</div>
			<div className="mt-auto">
				<h1 className="text-4xl leading-tight font-semibold tracking-tight">${jsxText(title)}</h1>
				<p className="mt-3 text-base leading-relaxed text-muted-foreground">${jsxText(brief)}</p>
			</div>
			<div className="mt-8 flex flex-col gap-3">
				<Button size="lg" className="h-12 rounded-xl bg-${accent}-600 text-white hover:bg-${accent}-700">
					Get started
					<ArrowRight />
				</Button>
				<Button size="lg" variant="ghost" className="h-12 rounded-xl">
					I already have an account
				</Button>
			</div>
		</div>
	);
}
`,
		},
		{
			name: "Home",
			source: `import { Bell, Clock, Flame, Target } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "../components/stat-card";
import { TabBar } from "../components/tab-bar";

const UP_NEXT = [
	{ title: "Morning session", time: "8:00", tag: "Today" },
	{ title: "Weekly review", time: "12:30", tag: "Today" },
	{ title: "Plan next steps", time: "18:00", tag: "Tomorrow" },
];

export default function Home() {
	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<div className="flex-1 overflow-hidden px-5 pt-16">
				<header className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Avatar className="size-10">
							<AvatarFallback className="bg-${accent}-100 text-${accent}-700">AL</AvatarFallback>
						</Avatar>
						<div>
							<p className="text-sm text-muted-foreground">Good morning</p>
							<p className="font-semibold">${jsxText(title)}</p>
						</div>
					</div>
					<Bell className="size-5 text-muted-foreground" />
				</header>

				<Card className="mt-6 border-0 bg-${accent}-600 text-white">
					<CardContent className="space-y-3">
						<p className="text-sm text-white/80">This week</p>
						<p className="text-4xl font-semibold tracking-tight">72%</p>
						<Progress value={72} className="bg-white/25 [&>div]:bg-white" />
					</CardContent>
				</Card>

				<div className="mt-4 grid grid-cols-2 gap-3">
					<StatCard label="Streak" value="12 days" icon={Flame} />
					<StatCard label="Goals" value="4 of 5" icon={Target} />
				</div>

				<h2 className="mt-7 mb-3 text-lg font-semibold">Up next</h2>
				<div className="space-y-2">
					{UP_NEXT.map((item) => (
						<div key={item.title} className="flex items-center gap-3 rounded-xl border p-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-${accent}-50 text-${accent}-600">
								<Clock className="size-5" />
							</div>
							<div className="flex-1">
								<p className="text-sm font-medium">{item.title}</p>
								<p className="text-xs text-muted-foreground">{item.time}</p>
							</div>
							<Badge variant="secondary">{item.tag}</Badge>
						</div>
					))}
				</div>
			</div>
			<TabBar active={0} />
		</div>
	);
}
`,
		},
		{
			name: "Details",
			source: `import { ChevronLeft, Gauge, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "../components/stat-card";

export default function Details() {
	return (
		<div className="flex min-h-full flex-col bg-background text-foreground">
			<div className="relative h-72 bg-gradient-to-br from-${accent}-500 to-${accent}-200">
				<Button size="icon" variant="secondary" className="absolute top-14 left-5 rounded-full">
					<ChevronLeft />
				</Button>
			</div>
			<div className="flex flex-1 flex-col px-5 pt-6 pb-10">
				<Badge className="w-fit bg-${accent}-100 text-${accent}-700">Featured</Badge>
				<h1 className="mt-3 text-2xl font-semibold tracking-tight">${jsxText(title)} details</h1>
				<p className="mt-2 text-sm leading-relaxed text-muted-foreground">${jsxText(brief)}</p>

				<div className="mt-5 grid grid-cols-2 gap-3">
					<StatCard label="Duration" value="25 min" icon={Timer} />
					<StatCard label="Level" value="Easy" icon={Gauge} />
				</div>

				<Tabs defaultValue="overview" className="mt-6">
					<TabsList className="w-full">
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="reviews">Reviews</TabsTrigger>
					</TabsList>
					<TabsContent value="overview" className="pt-2 text-sm text-muted-foreground">
						Everything you need to get going, in one short session.
					</TabsContent>
					<TabsContent value="reviews" className="pt-2 text-sm text-muted-foreground">
						Rated 4.8 by people who finished it.
					</TabsContent>
				</Tabs>

				<Button size="lg" className="mt-auto h-12 w-full rounded-xl bg-${accent}-600 text-white hover:bg-${accent}-700">
					Continue
				</Button>
			</div>
		</div>
	);
}
`,
		},
	];
}

function desktopDrafts({ title, brief, accent }: Context): Draft[] {
	return [
		{
			name: "Landing",
			source: `import { ArrowRight, TrendingUp, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCard } from "../components/stat-card";

export default function Landing() {
	return (
		<div className="flex min-h-full flex-col bg-background text-foreground">
			<header className="flex h-16 items-center justify-between border-b px-14">
				<span className="text-lg font-semibold">${jsxText(title)}</span>
				<nav className="flex items-center gap-7 text-sm text-muted-foreground">
					<span>Product</span>
					<span>Pricing</span>
					<span>Customers</span>
					<Button size="sm" className="bg-${accent}-600 text-white hover:bg-${accent}-700">
						Sign up
					</Button>
				</nav>
			</header>

			<main className="grid flex-1 grid-cols-[1.1fr_1fr] items-center gap-16 px-14">
				<section>
					<Badge variant="outline" className="border-${accent}-200 text-${accent}-700">
						New · Built with Rabisco
					</Badge>
					<h1 className="mt-5 text-6xl leading-none font-semibold tracking-tight">
						${jsxText(title)}, designed for the way you work
					</h1>
					<p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">${jsxText(brief)}</p>
					<div className="mt-8 flex max-w-md gap-2">
						<Input placeholder="you@company.com" className="h-11" />
						<Button className="h-11 bg-${accent}-600 text-white hover:bg-${accent}-700">
							Start free
							<ArrowRight />
						</Button>
					</div>
				</section>

				<Card className="shadow-xl">
					<CardHeader>
						<CardTitle>This month</CardTitle>
						<CardDescription>Your team at a glance</CardDescription>
					</CardHeader>
					<CardContent className="grid grid-cols-2 gap-3">
						<StatCard label="Active users" value="12,408" change="+8% vs last month" icon={Users} />
						<StatCard label="Growth" value="+24%" change="Best month so far" icon={TrendingUp} />
						<StatCard className="col-span-2" label="Automations run" value="1.2M" icon={Zap} />
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
`,
		},
		{
			name: "Dashboard",
			source: `import { DollarSign, Percent, Search, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "../components/sidebar-nav";
import { StatCard } from "../components/stat-card";

const BARS = ["h-[40%]", "h-[62%]", "h-[48%]", "h-[80%]", "h-[66%]", "h-[90%]", "h-[74%]", "h-[58%]", "h-[86%]", "h-[70%]", "h-[95%]", "h-[82%]"];

const ACTIVITY = [
	{ name: "Ana Lima", action: "upgraded to Pro", status: "Paid" },
	{ name: "Bruno Costa", action: "invited 3 teammates", status: "New" },
	{ name: "Carla Dias", action: "exported a report", status: "Done" },
];

export default function Dashboard() {
	return (
		<div className="flex h-full bg-background text-foreground">
			<SidebarNav title=${JSON.stringify(title)} active={0} />
			<main className="flex flex-1 flex-col gap-6 overflow-hidden p-8">
				<header className="flex items-center justify-between">
					<h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
					<div className="flex items-center gap-3">
						<div className="relative">
							<Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
							<Input placeholder="Search" className="w-64 pl-9" />
						</div>
						<Avatar>
							<AvatarFallback>AL</AvatarFallback>
						</Avatar>
					</div>
				</header>

				<div className="grid grid-cols-3 gap-4">
					<StatCard label="Revenue" value="$48.2k" change="+12% this month" icon={DollarSign} />
					<StatCard label="Active users" value="12,408" change="+3% this month" icon={Users} />
					<StatCard label="Conversion" value="3.9%" change="-0.4% this month" icon={Percent} />
				</div>

				<div className="grid flex-1 grid-cols-[2fr_1fr] gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Revenue</CardTitle>
						</CardHeader>
						<CardContent className="flex h-64 items-end gap-3">
							{BARS.map((height, index) => (
								<div key={index} className={\`flex-1 rounded-md bg-${accent}-500/80 \${height}\`} />
							))}
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>Recent activity</CardTitle>
						</CardHeader>
						<CardContent>
							{ACTIVITY.map((item, index) => (
								<div key={item.name}>
									{index > 0 && <Separator className="my-3" />}
									<div className="flex items-center justify-between gap-3 text-sm">
										<div>
											<p className="font-medium">{item.name}</p>
											<p className="text-muted-foreground">{item.action}</p>
										</div>
										<Badge variant="secondary">{item.status}</Badge>
									</div>
								</div>
							))}
						</CardContent>
					</Card>
				</div>
			</main>
		</div>
	);
}
`,
		},
	];
}

function importedComponents(source: string) {
	return [...source.matchAll(/from "\.\.\/(components\/[a-z0-9-]+)"/g)].map((m) => `${m[1]}.tsx`);
}

export function generateMockScreens(input: {
	prompt: string;
	device: Device;
	existingFiles?: string[];
}): GenerateScreensResult {
	const existing = new Set(input.existingFiles ?? []);

	const context: Context = {
		title: titleFromPrompt(input.prompt),
		brief: input.prompt.trim() || "A fresh idea, ready to shape.",
		accent: ACCENTS[hash(input.prompt) % ACCENTS.length]!,
	};

	const drafts = input.device === "mobile" ? mobileDrafts(context) : desktopDrafts(context);
	const size = FRAME_SIZE[input.device];

	const changes: FileChange[] = [];
	const frames: Frame[] = [];
	const taken = new Set(existing);
	const components = new Set<string>();
	drafts.forEach((draft, index) => {
		const file = uniqueScreenPath(draft.name, taken);
		taken.add(file);
		changes.push({ path: file, content: draft.source });
		frames.push({ file, name: draft.name, device: input.device, x: index * (size.width + FRAME_GAP), y: 0, ...size });

		for (const path of importedComponents(draft.source)) components.add(path);
	});

	for (const path of [...components].sort()) {
		const content = COMPONENTS.get(path);

		if (!existing.has(path) && content !== undefined) changes.push({ path, content });
	}

	return {
		changes,
		frames,
		reply: `I drafted ${frames.length} ${input.device} screens for ${context.title}: ${frames
			.map((f) => f.name)
			.join(", ")}. Select a frame to refine it, or tell me what to change.`,
	};
}

/** First match wins, so the specific roles come before the broad ones */
const MOCK_COLOR_ROLES: [string, RegExp][] = [
	["primary-foreground", /on[- ]primary|primary[- ]foreground|text on (?:the )?(?:primary|brand)/],
	["muted", /surface[- ]soft|subtle (?:background|surface)|muted (?:background|surface|fill)/],
	["muted-foreground", /muted|secondary text|caption|placeholder/],
	["primary", /primary|brand|accent|\bcta\b/],
	["border", /border|hairline|divider|outline|stroke/],
	["ring", /\bring\b|focus/],
	["destructive", /destructive|error|danger/],
	["success", /success|positive/],
	["warning", /warning|caution/],
	["foreground", /\bink\b|foreground|\btext\b|heading/],
	["background", /background|canvas|\bpage\b|surface/],
];

/** States and dark sections aren't the base light theme */
const MOCK_SKIP = /dark|night|disabled|hover|active|pressed/;

const SANS_FONTS = [
	"Inter",
	"Roboto",
	"Geist",
	"Manrope",
	"IBM Plex Sans",
	"DM Sans",
	"Poppins",
	"Open Sans",
	"Lato",
	"Montserrat",
	"Plus Jakarta Sans",
	"Figtree",
	"Work Sans",
	"Nunito",
	"SF Pro Text",
	"Helvetica Neue",
];

const MONO_FONTS = ["JetBrains Mono", "Geist Mono", "IBM Plex Mono", "Fira Code", "Roboto Mono", "SF Mono"];

function mostMentioned(text: string, names: string[]) {
	const counts = names.map((name) => ({
		name,
		count: text.match(new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "gi"))?.length ?? 0,
	}));

	const best = counts.reduce((a, b) => (b.count > a.count ? b : a));

	return best.count ? best.name : undefined;
}

/** Median of the radii mentioned, without pills and circles */
function mockRadius(text: string) {
	const sizes = text
		.split("\n")
		.filter((line) => /radius|rounded|corner/i.test(line))
		.flatMap((line) =>
			[...line.matchAll(/(\d*\.?\d+)(px|rem)\b/g)].map((m) => Number(m[1]) * (m[2] === "rem" ? 16 : 1)),
		)
		.filter((px) => px >= 1 && px <= 32)
		.sort((a, b) => a - b);

	return sizes.length ? `${sizes[Math.floor(sizes.length / 2)]}px` : undefined;
}

/** The mock `theme` task: hex colors named near a role word, the radius and fonts most mentioned. Light only. */
export function mockThemeTokens(design: string): DesignTokens {
	const light: Record<string, string> = {};

	for (const line of design.split("\n")) {
		let from = 0;

		for (const match of line.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
			const window = line.slice(Math.max(from, match.index - 80), match.index).toLowerCase();
			from = match.index + match[0].length;

			if (MOCK_SKIP.test(window)) continue;
			const role = MOCK_COLOR_ROLES.find(([, words]) => words.test(window))?.[0];

			if (role && !(role in light)) light[role] = match[0].toLowerCase();
		}
	}

	const radius = mockRadius(design);

	if (radius) light.radius = radius;
	const sans = mostMentioned(design, SANS_FONTS);

	if (sans) light["font-sans"] = `"${sans}", system-ui, sans-serif`;
	const mono = mostMentioned(design, MONO_FONTS);

	if (mono) light["font-mono"] = `"${mono}", ui-monospace, monospace`;

	return {
		light: Object.fromEntries(Object.entries(light).filter(([name, value]) => validateToken(name, value) === null)),
		dark: {},
	};
}
