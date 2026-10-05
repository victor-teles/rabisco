import { useEffect, useState } from "react";
import {
	FolderOpen,
	FolderSearch,
	FolderX,
	House,
	LayoutTemplate,
	MoreHorizontal,
	Palette,
	Plus,
	Settings,
	Trash2,
	X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DesignComposer } from "@/components/app/design-composer";
import { SettingsButton } from "@/components/app/settings-button";
import { Logo } from "@/components/app/logo";
import { ScreenPreview } from "@/components/app/screen-preview";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NoDrag, TitleBar } from "@/components/app/title-bar";
import type { Theme } from "@/hooks/use-theme";
import { useVariations } from "@/hooks/use-variations";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { Device, ProjectSummary } from "../../shared/types";

const SUGGESTIONS: { label: string; prompt: string; device: Device }[] = [
	{
		label: "Habit tracker",
		prompt: "A calm habit tracker app with streaks, daily check-ins and gentle reminders",
		device: "mobile",
	},
	{
		label: "Fintech onboarding",
		prompt: "Onboarding flow for a fintech app that opens a savings account in 3 steps",
		device: "mobile",
	},
	{
		label: "SaaS analytics",
		prompt: "Analytics dashboard for a SaaS product with revenue, churn and cohort charts",
		device: "desktop",
	},
	{
		label: "Coffee shop landing",
		prompt: "Landing page for a specialty coffee roaster with subscriptions",
		device: "desktop",
	},
];

export type StartDesign = (input: { prompt: string; device: Device; files?: File[]; variations?: number }) => void;

type HomeProps = {
	theme: Theme;
	onToggleTheme: () => void;
	onStart: StartDesign;
	onOpenProject: (path: string) => void;
};

export function HomeView({ theme, onToggleTheme, onStart, onOpenProject }: HomeProps) {
	const [prompt, setPrompt] = useState("");
	const [device, setDevice] = useState<Device>("mobile");
	const [variations, setVariations] = useVariations();
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [trashTarget, setTrashTarget] = useState<ProjectSummary | null>(null);

	useEffect(() => {
		api.listRecents({}).then(setProjects, (error) => {
			setProjects([]);
			toast.error("Couldn't load recent projects", { description: String(error) });
		});
	}, []);

	const forget = (path: string) => setProjects((current) => current?.filter((p) => p.path !== path) ?? null);

	const openFolder = async () => {
		const path = await api.pickProjectFolder({});
		if (path) onOpenProject(path);
	};

	const removeRecent = async (path: string) => {
		await api.removeRecent({ path });
		forget(path);
	};

	const moveToTrash = async (project: ProjectSummary) => {
		setTrashTarget(null);
		try {
			await api.deleteProject({ path: project.path });
			forget(project.path);
			toast(`Moved “${project.name}” to the Trash`);
		} catch (error) {
			toast.error("Couldn't move the project to the Trash", { description: String(error) });
		}
	};

	const open = (project: ProjectSummary) => {
		if (!project.missing) return onOpenProject(project.path);
		toast("This folder was moved or deleted", {
			description: project.path,
			action: { label: "Remove", onClick: () => removeRecent(project.path) },
		});
	};

	return (
		<div className="flex h-full flex-col">
			<TitleBar className="border-b-0 bg-muted/40">
				<Logo />
				<div className="flex-1" />
				<NoDrag className="flex items-center gap-1">
					<SettingsButton />
					<ThemeToggle theme={theme} onToggle={onToggleTheme} />
				</NoDrag>
			</TitleBar>

			<div className="flex min-h-0 flex-1">
				<Sidebar onNew={() => onStart({ prompt: "", device })} onOpenFolder={openFolder} />

				<ScrollArea className="min-w-0 flex-1 rounded-tl-2xl border-t border-l bg-background">
					<main className="mx-auto flex max-w-5xl flex-col px-10 pb-16">
						<section className="flex flex-col items-center pt-[12vh] pb-14 text-center">
							<Badge variant="secondary" className="mb-5 rounded-full px-2.5 text-subtle-foreground">
								AI-first design canvas
							</Badge>
							<h1 className="text-[40px]/[1.1] font-semibold tracking-[-0.035em] text-balance">
								What should we sketch today?
							</h1>
							<p className="mt-3 max-w-md text-[15px]/6 text-muted-foreground text-pretty">
								Describe an app or a website. Rabisco drafts editable screens you can refine
								on the canvas.
							</p>

							<DesignComposer
								className="mt-8 w-full max-w-2xl text-left shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.12)]"
								value={prompt}
								onValueChange={setPrompt}
								device={device}
								onDeviceChange={setDevice}
								variations={variations}
								onVariationsChange={setVariations}
								placeholder="A meditation app with a soft, editorial feel…"
								onSubmit={(text, files) => onStart({ prompt: text, device, files, variations })}
							/>

							<div className="mt-4 flex flex-wrap justify-center gap-1.5">
								{SUGGESTIONS.map((s) => (
									<Button
										key={s.label}
										variant="outline"
										size="xs"
										className="rounded-full bg-transparent px-3 text-muted-foreground"
										onClick={() => {
											setPrompt(s.prompt);
											setDevice(s.device);
										}}
									>
										{s.label}
									</Button>
								))}
							</div>
						</section>

						<section>
							<div className="mb-4 flex items-center justify-between gap-3">
								<h2 className="text-sm font-medium">Recent designs</h2>
								<div className="flex items-center gap-3">
									{projects?.length ? (
										<span className="text-xs text-subtle-foreground tabular-nums">
											{projects.length} {projects.length === 1 ? "project" : "projects"}
										</span>
									) : null}
									<Button variant="ghost" size="xs" className="text-muted-foreground" onClick={openFolder}>
										<FolderOpen />
										Open folder…
									</Button>
								</div>
							</div>

							{projects === null ? null : projects.length === 0 ? (
								<div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-subtle-foreground">
									Your designs will show up here. You can also open any folder as a project.
								</div>
							) : (
								<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
									{projects.map((project) => (
										<ProjectCard
											key={project.path}
											project={project}
											onOpen={() => open(project)}
											onReveal={() => api.revealProject({ path: project.path })}
											onRemove={() => removeRecent(project.path)}
											onTrash={() => setTrashTarget(project)}
										/>
									))}
								</div>
							)}
						</section>
					</main>
				</ScrollArea>
			</div>

			<Dialog open={trashTarget !== null} onOpenChange={(open) => !open && setTrashTarget(null)}>
				<DialogContent className="sm:max-w-md" showCloseButton={false}>
					<DialogHeader>
						<DialogTitle className="text-base">Move “{trashTarget?.name}” to the Trash?</DialogTitle>
						<DialogDescription className="text-[13px] break-all">
							The folder {trashTarget?.path} and every file in it go to the Trash. You can restore it from there.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline" size="sm">
								Cancel
							</Button>
						</DialogClose>
						<Button variant="destructive" size="sm" onClick={() => trashTarget && moveToTrash(trashTarget)}>
							Move to Trash
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function Sidebar({ onNew, onOpenFolder }: { onNew: () => void; onOpenFolder: () => void }) {
	const items = [
		{ label: "Home", icon: House, active: true },
		{ label: "Projects", icon: FolderOpen },
		{ label: "Templates", icon: LayoutTemplate, soon: true },
		{ label: "Design systems", icon: Palette, soon: true },
	];

	return (
		<aside className="flex w-60 shrink-0 flex-col bg-muted/40 px-3 pb-3">
			<Button className="mt-1 justify-start" onClick={onNew}>
				<Plus />
				New design
			</Button>
			<Button variant="ghost" className="mt-1 justify-start text-muted-foreground" onClick={onOpenFolder}>
				<FolderOpen />
				Open folder…
			</Button>

			<nav className="mt-5 flex flex-col gap-0.5">
				{items.map((item) => (
					<button
						key={item.label}
						type="button"
						disabled={item.soon}
						className={cn(
							"flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none",
							item.active && "bg-accent font-medium text-accent-foreground",
						)}
					>
						<item.icon className="size-4" strokeWidth={1.8} />
						{item.label}
						{item.soon ? (
							<span className="ml-auto text-[11px] text-subtle-foreground">Soon</span>
						) : null}
					</button>
				))}
			</nav>

			<div className="mt-auto flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
				<Avatar className="size-7">
					<AvatarFallback className="text-[11px]">P</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1 text-[13px] font-medium">Personal</div>
				<Button variant="ghost" size="icon-sm" aria-label="Settings">
					<Settings />
				</Button>
			</div>
		</aside>
	);
}

function ProjectCard({
	project,
	onOpen,
	onReveal,
	onRemove,
	onTrash,
}: {
	project: ProjectSummary;
	onOpen: () => void;
	onReveal: () => void;
	onRemove: () => void;
	onTrash: () => void;
}) {
	return (
		<div className={cn("group relative", project.missing && "opacity-60")}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={onOpen}
						className="block w-full overflow-hidden rounded-xl border bg-card text-left transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.18)]"
					>
						<div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-muted/60">
							{project.missing ? (
								<span className="flex flex-col items-center gap-1.5 text-xs text-subtle-foreground">
									<FolderX className="size-5" strokeWidth={1.6} />
									Folder not found
								</span>
							) : project.cover ? (
								<ScreenPreview
									source={project.cover}
									maxWidth={project.cover.device === "mobile" ? 110 : 200}
									maxHeight={150}
								/>
							) : (
								<span className="text-xs text-subtle-foreground">Empty canvas</span>
							)}
						</div>
						<div className="px-3 py-2.5">
							<div className="truncate text-[13px] font-medium">{project.name}</div>
							<div className="mt-0.5 text-xs text-subtle-foreground">
								{project.missing
									? "Moved or deleted"
									: `${project.screenCount} ${project.screenCount === 1 ? "screen" : "screens"} · ${timeAgo(project.updatedAt)}`}
							</div>
						</div>
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-80 font-mono text-[11px] break-all">
					{project.path}
				</TooltipContent>
			</Tooltip>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="secondary"
						size="icon-xs"
						aria-label="Project actions"
						className="absolute top-2 right-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
					>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{isDesktop && !project.missing ? (
						<DropdownMenuItem onSelect={onReveal}>
							<FolderSearch />
							Reveal in Finder
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem onSelect={onRemove}>
						<X />
						Remove from recents
					</DropdownMenuItem>
					{project.missing ? null : (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={onTrash}>
								<Trash2 />
								Move to Trash
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function timeAgo(iso: string) {
	const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
	const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	if (seconds < 60) return "just now";
	if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
	if (seconds < 86400) return format.format(-Math.round(seconds / 3600), "hour");
	return format.format(-Math.round(seconds / 86400), "day");
}
