import { useState, type KeyboardEvent } from "react";
import { ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { GenerationPlan } from "../../../shared/ai/contract";
import { renamePlanScreen, selectPlan } from "../../../shared/ai/plan";
import type { ProjectFiles } from "../../../shared/types";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function ScreenName({
	name,
	onRename,
	disabled,
}: {
	name: string;
	onRename: (name: string) => void;
	disabled: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);

	if (editing) {
		const commit = () => {
			setEditing(false);
			onRename(draft);
		};

		return (
			<Input
				autoFocus
				aria-label="Screen name"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					// The card's own ↵ and Esc would generate or cancel the plan
					event.stopPropagation();

					if (event.key === "Enter") commit();
					else if (event.key === "Escape") {
						setDraft(name);
						setEditing(false);
					}
				}}
				className="h-6 px-1.5 py-0 text-[13px] font-medium"
			/>
		);
	}

	return (
		<span className="group/name flex min-w-0 items-center gap-1">
			<span className={cn("truncate font-medium", disabled && "text-subtle-foreground line-through")}>{name}</span>
			<Button
				variant="ghost"
				size="icon-xs"
				className="text-subtle-foreground opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100"
				aria-label={`Rename ${name}`}
				title="Rename"
				onClick={() => {
					setDraft(name);
					setEditing(true);
				}}
			>
				<Pencil />
			</Button>
		</span>
	);
}

/**
 * The plan of a create, before anything is written (decisions 0015 and 0020). It waits for the user:
 * ↵ generates and Esc cancels while it has focus.
 */
export function PlanCard({
	plan: proposed,
	files,
	onGenerate,
	onCancel,
}: {
	plan: GenerationPlan;
	/** New screen names must not take an existing path */
	files: ProjectFiles;
	onGenerate: (plan: GenerationPlan) => void;
	onCancel: () => void;
}) {
	const [plan, setPlan] = useState(proposed);
	const [offScreens, setOffScreens] = useState<ReadonlySet<number>>(new Set());
	const [offComponents, setOffComponents] = useState<ReadonlySet<number>>(new Set());

	const chosen = selectPlan(plan, {
		screens: plan.screens.flatMap((screen, index) => (offScreens.has(index) ? [] : [screen.path])),
		components: plan.components.flatMap((component, index) => (offComponents.has(index) ? [] : [component.path])),
	});

	const ready = chosen.screens.length > 0;

	const toggle = (set: ReadonlySet<number>, index: number) => {
		const next = new Set(set);

		if (!next.delete(index)) next.add(index);

		return next;
	};

	const keys = (event: KeyboardEvent<HTMLElement>) => {
		// A checkbox or button handles its own keys; ↵ elsewhere in the card generates
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
		} else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && ready) {
			event.preventDefault();
			onGenerate(chosen);
		}
	};

	const names = new Map(plan.screens.map((screen) => [screen.path, screen.name]));
	const ticked = new Set(chosen.screens.map((screen) => screen.path));
	const nameOf = (path: string) => names.get(path) ?? path.replace(/^screens\//, "").replace(/\.tsx$/, "");

	return (
		<section
			aria-label="Plan"
			tabIndex={0}
			onKeyDown={keys}
			className="min-w-0 rounded-xl border bg-card/60 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		>
			<header className="flex min-h-10 items-center gap-2 px-3">
				<h3 className="shrink-0 font-medium">Plan</h3>
				<span className="min-w-0 truncate text-xs text-subtle-foreground">
					{plural(chosen.screens.length, "screen")}
					{chosen.components.length ? ` · ${plural(chosen.components.length, "shared component")}` : ""}
				</span>
			</header>

			<div className="grid min-w-0 grid-cols-1 gap-3 px-3 pb-3">
				<ul aria-label="Screens" className="grid min-w-0 gap-1">
					{plan.screens.map((screen, index) => {
						const off = offScreens.has(index);

						return (
							<li key={index} className="flex min-w-0 items-start gap-2.5">
								<Checkbox
									className="mt-0.5"
									checked={!off}
									aria-label={`Include ${screen.name}`}
									onCheckedChange={() => {
										setOffScreens((set) => toggle(set, index));
									}}
								/>
								<div className="grid min-w-0 flex-1 gap-0.5">
									<ScreenName
										name={screen.name}
										disabled={off}
										onRename={(name) => {
											setPlan((current) => renamePlanScreen(current, screen.path, name, files));
										}}
									/>
									{screen.purpose ? (
										<span className="truncate text-xs text-muted-foreground" title={screen.purpose}>
											{screen.purpose}
										</span>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>

				{plan.components.length ? (
					<div className="grid min-w-0 gap-1">
						<p className="text-xs text-subtle-foreground">Shared, written first so every screen matches</p>
						<ul aria-label="Shared components" className="grid min-w-0 gap-1">
							{plan.components.map((component, index) => {
								const off = offComponents.has(index);
								// Only the screens still ticked
								const users = component.usedBy.flatMap((path) => (ticked.has(path) ? [nameOf(path)] : [])).join(", ");

								return (
									<li key={component.path} className="flex min-w-0 items-start gap-2.5">
										<Checkbox
											className="mt-0.5"
											checked={!off}
											aria-label={`Include ${component.name}`}
											onCheckedChange={() => {
												setOffComponents((set) => toggle(set, index));
											}}
										/>
										<div className="grid min-w-0 flex-1 gap-0.5">
											<span
												className={cn("truncate font-mono text-[12px]", off && "text-subtle-foreground line-through")}
											>
												{component.name}
											</span>
											<span
												className="truncate text-xs text-muted-foreground"
												title={[component.purpose, users && `Used by ${users}`].filter(Boolean).join(" · ")}
											>
												{component.purpose}
												{users ? <span className="text-subtle-foreground"> · {users}</span> : null}
											</span>
										</div>
									</li>
								);
							})}
						</ul>
					</div>
				) : null}

				{chosen.links.length ? (
					<p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-subtle-foreground">
						{chosen.links.map((link) => (
							<span key={`${link.from}>${link.to}`} className="inline-flex max-w-full min-w-0 items-center gap-1">
								<span className="truncate">{nameOf(link.from)}</span>
								<ArrowRight className="size-3 shrink-0" aria-label="to" />
								<span className="truncate">{nameOf(link.to)}</span>
							</span>
						))}
					</p>
				) : null}
			</div>

			<footer className="flex min-w-0 items-center gap-1.5 border-t py-1.5 pr-1.5 pl-3">
				<span className="min-w-0 truncate text-xs text-subtle-foreground">
					{ready ? "Waiting for you" : "Tick a screen to generate"}
				</span>
				<span className="ml-auto flex shrink-0 items-center gap-1">
					<Button variant="ghost" size="xs" onClick={onCancel}>
						Cancel
					</Button>
					<Button size="xs" disabled={!ready} onClick={() => onGenerate(chosen)}>
						Generate
						<Kbd className="h-4 min-w-4 bg-primary-foreground/15 px-0.5 text-[11px] text-primary-foreground">↵</Kbd>
					</Button>
				</span>
			</footer>
		</section>
	);
}
