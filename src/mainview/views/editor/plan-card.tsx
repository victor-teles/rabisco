import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { GenerationPlan } from "../../../shared/ai/contract";
import { renamePlanScreen, selectPlan } from "../../../shared/ai/plan";
import type { ProjectFiles } from "../../../shared/types";

/** Long enough to read the plan, short enough that a glance-and-go user isn't kept waiting */
export const PLAN_COUNTDOWN_S = 5;

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
 * The plan of a create, before anything is written (decision 0015). It starts by itself after a short countdown,
 * which stops for good as soon as the user touches the card; ↵ generates and Esc cancels while it has focus.
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
	const [seconds, setSeconds] = useState<number | null>(PLAN_COUNTDOWN_S);

	const chosen = selectPlan(plan, {
		screens: plan.screens.flatMap((screen, index) => (offScreens.has(index) ? [] : [screen.path])),
		components: plan.components.flatMap((component, index) => (offComponents.has(index) ? [] : [component.path])),
	});

	const ready = chosen.screens.length > 0;

	// The timer reads the latest plan without restarting on every render of the editor
	const latest = useRef({ chosen, ready, onGenerate });

	useEffect(() => {
		latest.current = { chosen, ready, onGenerate };
	});

	useEffect(() => {
		if (seconds === null) return;

		if (seconds <= 0) {
			if (latest.current.ready) latest.current.onGenerate(latest.current.chosen);

			return;
		}

		const timer = setTimeout(() => setSeconds((s) => (s === null ? null : s - 1)), 1000);

		return () => clearTimeout(timer);
	}, [seconds]);

	const hold = () => setSeconds(null);

	const toggle = (set: ReadonlySet<number>, index: number) => {
		const next = new Set(set);

		if (!next.delete(index)) next.add(index);

		return next;
	};

	const keys = (event: KeyboardEvent<HTMLElement>) => {
		hold();

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
			onPointerDown={hold}
			onKeyDown={keys}
			className="min-w-0 rounded-xl border bg-card/60 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		>
			<header className="flex min-h-10 items-center gap-2 px-3">
				<h3 className="font-medium">Plan</h3>
				<span className="truncate text-xs text-subtle-foreground">
					{plural(chosen.screens.length, "screen")}
					{chosen.components.length ? ` · ${plural(chosen.components.length, "shared component")}` : ""}
				</span>
			</header>

			<div className="grid gap-3 px-3 pb-3">
				<ul aria-label="Screens" className="grid gap-1">
					{plan.screens.map((screen, index) => {
						const off = offScreens.has(index);

						return (
							<li key={index} className="flex items-start gap-2.5">
								<Checkbox
									className="mt-0.5"
									checked={!off}
									aria-label={`Include ${screen.name}`}
									onCheckedChange={() => {
										hold();
										setOffScreens((set) => toggle(set, index));
									}}
								/>
								<div className="grid min-w-0 flex-1 gap-0.5">
									<ScreenName
										name={screen.name}
										disabled={off}
										onRename={(name) => {
											hold();
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
					<div className="grid gap-1">
						<p className="text-xs text-subtle-foreground">Shared, written first so every screen matches</p>
						<ul aria-label="Shared components" className="grid gap-1">
							{plan.components.map((component, index) => {
								const off = offComponents.has(index);
								// Only the screens still ticked
								const users = component.usedBy.flatMap((path) => (ticked.has(path) ? [nameOf(path)] : [])).join(", ");

								return (
									<li key={component.path} className="flex items-start gap-2.5">
										<Checkbox
											className="mt-0.5"
											checked={!off}
											aria-label={`Include ${component.name}`}
											onCheckedChange={() => {
												hold();
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
					<p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-subtle-foreground">
						{chosen.links.map((link) => (
							<span key={`${link.from}>${link.to}`} className="inline-flex items-center gap-1">
								{nameOf(link.from)}
								<ArrowRight className="size-3" aria-label="to" />
								{nameOf(link.to)}
							</span>
						))}
					</p>
				) : null}
			</div>

			<footer className="flex items-center gap-1.5 border-t py-1.5 pr-1.5 pl-3">
				<span className="min-w-0 truncate text-xs text-subtle-foreground">
					{!ready
						? "Tick a screen to generate"
						: seconds !== null
							? `Starts in ${seconds} s`
							: "Untick what you don't need"}
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
