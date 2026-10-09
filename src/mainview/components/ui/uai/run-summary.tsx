"use client";

import { cva } from "class-variance-authority";
import {
	ArrowRight,
	CircleAlert,
	CircleCheck,
	type LucideIcon,
	Minus,
	PencilLine,
	Plus,
	TriangleAlert,
} from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const RUN_SUMMARY_VARIANTS = ["card", "plain", "compact"] as const;

export const RUN_SUMMARY_OUTCOMES = ["success", "partial", "failed"] as const;

export type RunSummaryVariant = (typeof RUN_SUMMARY_VARIANTS)[number];

export type RunSummaryOutcome = (typeof RUN_SUMMARY_OUTCOMES)[number];

export type RunSummaryProps = ComponentProps<"section"> & {
	variant?: RunSummaryVariant;
	outcome?: RunSummaryOutcome;
};

type RunSummaryContextValue = {
	id: string;
	variant: RunSummaryVariant;
	outcome: RunSummaryOutcome;
};

const RunSummaryContext = createContext<RunSummaryContextValue | null>(null);

function useRunSummary(part: string) {
	const context = useContext(RunSummaryContext);

	if (!context) throw new Error(`${part} must be used within RunSummary`);

	return context;
}

const dangerText = "text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]";

const outcomeDetails: Record<RunSummaryOutcome, { label: string; icon: LucideIcon; className: string }> = {
	success: { label: "Completed", icon: CircleCheck, className: "bg-success/14 text-success" },
	partial: {
		label: "Completed with warnings",
		icon: TriangleAlert,
		className: "bg-warning/14 text-warning",
	},
	failed: { label: "Failed", icon: CircleAlert, className: cn("bg-destructive/14", dangerText) },
};

const runSummaryVariants = cva(
	[
		"grid min-w-0 text-[13px]/[18px] text-foreground",
		"*:animate-in *:fade-in-0 *:slide-in-from-bottom-1 *:duration-240 *:ease-out-quint *:fill-mode-backwards *:motion-reduce:animate-none",
		"*:nth-2:[animation-delay:40ms] *:nth-3:[animation-delay:80ms] *:nth-4:[animation-delay:120ms] *:nth-5:[animation-delay:160ms] *:nth-[n+6]:[animation-delay:200ms]",
	],
	{
		variants: {
			variant: {
				card: "gap-4.5 rounded-[14px] border bg-card p-4",
				plain: "gap-4.5 rounded-[14px] border-0 bg-transparent p-0",
				compact: "gap-3 rounded-xl border bg-card p-3",
			},
		},
	},
);

export function RunSummary({ variant = "card", outcome = "success", className, children, ...props }: RunSummaryProps) {
	const id = useId();

	return (
		<RunSummaryContext.Provider value={{ id, variant, outcome }}>
			<section
				aria-labelledby={`${id}-title`}
				data-slot="run-summary"
				data-variant={variant}
				data-outcome={outcome}
				className={cn(runSummaryVariants({ variant }), className)}
				{...props}
			>
				{children}
			</section>
		</RunSummaryContext.Provider>
	);
}

export function RunSummaryHeader({ className, children, ...props }: ComponentProps<"div">) {
	const context = useRunSummary("RunSummaryHeader");
	const { icon: Icon, className: outcomeClass, label } = outcomeDetails[context.outcome];
	const compact = context.variant === "compact";

	return (
		<div
			data-slot="run-summary-header"
			className={cn("flex min-w-0 items-start", compact ? "gap-2.5" : "gap-3", className)}
			{...props}
		>
			<span
				className={cn(
					"grid flex-none place-items-center",
					compact ? "size-6 rounded-lg" : "size-7 rounded-[10px]",
					outcomeClass,
				)}
			>
				<Icon size={compact ? 13 : 15} strokeWidth={1.75} aria-hidden="true" />
				<span className="sr-only">{label}</span>
			</span>
			<div className="grid min-w-0 flex-1 gap-0.5">{children}</div>
		</div>
	);
}

export function RunSummaryTitle({ className, ...props }: ComponentProps<"h3">) {
	const context = useRunSummary("RunSummaryTitle");

	return (
		<h3
			data-slot="run-summary-title"
			className={cn(
				"m-0 font-medium tracking-[-0.005em] text-balance",
				context.variant === "compact" ? "pt-0.5 text-[13.5px]/5" : "pt-1 text-[14.5px]/5",
				className,
			)}
			{...props}
			id={`${context.id}-title`}
		/>
	);
}

export function RunSummaryDescription({ className, ...props }: ComponentProps<"p">) {
	useRunSummary("RunSummaryDescription");

	return (
		<p
			data-slot="run-summary-description"
			className={cn("m-0 text-[12.5px]/[18px] text-muted-foreground tabular-nums", className)}
			{...props}
		/>
	);
}

export function RunSummaryStats({ className, ...props }: ComponentProps<"dl">) {
	const context = useRunSummary("RunSummaryStats");

	return (
		<dl
			data-slot="run-summary-stats"
			className={cn(
				"m-0 grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))]",
				context.variant === "compact" ? "gap-1" : "gap-1.5",
				className,
			)}
			{...props}
		/>
	);
}

export type RunSummaryStatProps = ComponentProps<"div"> & { label: ReactNode };

export function RunSummaryStat({ label, children, className, ...props }: RunSummaryStatProps) {
	const context = useRunSummary("RunSummaryStat");
	const compact = context.variant === "compact";

	return (
		<div
			data-slot="run-summary-stat"
			className={cn(
				"flex flex-col gap-0.5",
				compact ? "rounded-lg px-2.5 py-1.5" : "rounded-[10px] px-3 py-2.5",
				context.variant === "plain" ? "bg-muted" : "bg-muted/60",
				className,
			)}
			{...props}
		>
			<dt className="text-[11.5px]/4 text-subtle-foreground">{label}</dt>
			<dd className={cn("m-0 font-semibold tracking-[-0.01em] tabular-nums", compact ? "text-sm/5" : "text-[17px]/6")}>
				{children}
			</dd>
		</div>
	);
}

export type RunSummaryListProps = ComponentProps<"div"> & {
	/** Heading for the list. */
	label?: ReactNode;
};

function SummaryList({
	part,
	slot,
	defaultLabel,
	ordered = false,
	label,
	className,
	children,
	...props
}: RunSummaryListProps & {
	part: string;
	slot: string;
	defaultLabel: string;
	ordered?: boolean;
}) {
	const context = useRunSummary(part);
	const headingId = useId();
	const List = ordered ? "ol" : "ul";

	return (
		<div data-slot={slot} className={cn("grid min-w-0 gap-1.5", className)} {...props}>
			<h4 id={headingId} className="m-0 text-[11.5px]/4 font-medium text-subtle-foreground">
				{label ?? defaultLabel}
			</h4>
			<List
				aria-labelledby={headingId}
				className={cn("m-0 grid list-none p-0", context.variant === "compact" ? "gap-0" : "gap-0.5")}
			>
				{children}
			</List>
		</div>
	);
}

export function RunSummaryArtifacts(props: RunSummaryListProps) {
	return (
		<SummaryList {...props} part="RunSummaryArtifacts" slot="run-summary-artifacts" defaultLabel="Changed files" />
	);
}

export type RunSummaryArtifactChange = "added" | "modified" | "deleted";

const changeDetails: Record<RunSummaryArtifactChange, { label: string; icon: LucideIcon; className: string }> = {
	added: { label: "Added", icon: Plus, className: "text-success" },
	modified: { label: "Modified", icon: PencilLine, className: "text-muted-foreground" },
	deleted: { label: "Deleted", icon: Minus, className: dangerText },
};

export type RunSummaryArtifactProps = ComponentProps<"li"> & {
	change?: RunSummaryArtifactChange;
};

export function RunSummaryArtifact({ change = "modified", className, children, ...props }: RunSummaryArtifactProps) {
	const context = useRunSummary("RunSummaryArtifact");
	const { icon: Icon, className: changeClass, label } = changeDetails[change];

	return (
		<li
			data-slot="run-summary-artifact"
			className={cn(
				"-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2",
				"transition-[background-color] duration-120 ease-[ease-out] hover:bg-accent/50 motion-reduce:transition-none",
				context.variant === "compact" ? "min-h-6.5" : "min-h-7.5",
				className,
			)}
			{...props}
			data-change={change}
		>
			<Icon size={13} strokeWidth={2} aria-hidden="true" className={cn("size-[13px]", "flex-none", changeClass)} />
			<span className="sr-only">{label}: </span>
			<span
				className={cn(
					"flex min-w-0 flex-1 items-baseline gap-2 decoration-border-strong",
					change === "deleted" && "line-through",
				)}
			>
				{children}
			</span>
		</li>
	);
}

export function RunSummaryArtifactName({ className, ...props }: ComponentProps<"span">) {
	useRunSummary("RunSummaryArtifactName");

	return (
		<span
			data-slot="run-summary-artifact-name"
			className={cn("min-w-0 truncate font-mono text-[12px]", className)}
			{...props}
		/>
	);
}

export function RunSummaryArtifactMeta({ className, ...props }: ComponentProps<"span">) {
	useRunSummary("RunSummaryArtifactMeta");

	return (
		<span
			data-slot="run-summary-artifact-meta"
			className={cn("ml-auto flex-none font-mono text-[11.5px] text-subtle-foreground tabular-nums", className)}
			{...props}
		/>
	);
}

export function RunSummaryWarnings(props: RunSummaryListProps) {
	return <SummaryList {...props} part="RunSummaryWarnings" slot="run-summary-warnings" defaultLabel="Warnings" />;
}

export function RunSummaryWarning({ className, children, ...props }: ComponentProps<"li">) {
	useRunSummary("RunSummaryWarning");

	return (
		<li
			data-slot="run-summary-warning"
			className={cn("flex items-start gap-2 rounded-[10px] bg-warning/10 px-2.5 py-2 text-[12.5px]/[18px]", className)}
			{...props}
		>
			<TriangleAlert size={14} aria-hidden="true" className="mt-0.5 flex-none text-warning size-3.5" />
			<span className="min-w-0 wrap-anywhere">{children}</span>
		</li>
	);
}

export function RunSummaryNextSteps(props: RunSummaryListProps) {
	return (
		<SummaryList
			{...props}
			part="RunSummaryNextSteps"
			slot="run-summary-next-steps"
			defaultLabel="Next steps"
			ordered
		/>
	);
}

export function RunSummaryNextStep({ className, children, ...props }: ComponentProps<"li">) {
	useRunSummary("RunSummaryNextStep");

	return (
		<li
			data-slot="run-summary-next-step"
			className={cn("flex min-w-0 items-start gap-2 py-0.75", className)}
			{...props}
		>
			<ArrowRight
				size={13}
				strokeWidth={1.75}
				aria-hidden="true"
				className="mt-0.75 flex-none text-subtle-foreground size-[13px]"
			/>
			<span className="min-w-0">{children}</span>
		</li>
	);
}

export function RunSummaryActions({ className, ...props }: ComponentProps<"div">) {
	useRunSummary("RunSummaryActions");

	return (
		<div
			data-slot="run-summary-actions"
			className={cn("flex flex-wrap justify-end gap-2 pt-0.5", className)}
			{...props}
		/>
	);
}

export type RunSummaryActionProps = ComponentProps<"button"> & {
	/** Primary actions use the accent fill. */
	primary?: boolean;
};

export function RunSummaryAction({ primary = false, className, ...props }: RunSummaryActionProps) {
	const context = useRunSummary("RunSummaryAction");
	const compact = context.variant === "compact";

	return (
		<Button
			type="button"
			variant={primary ? "default" : "secondary"}
			data-slot="run-summary-action"
			data-emphasis={primary ? "primary" : "secondary"}
			className={cn(
				"cursor-pointer rounded-full py-0",
				"[transition:background-color_120ms_ease-out,filter_120ms_ease-out,scale_140ms_cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
				"focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
				compact ? "h-7 px-3 text-[12.5px] has-[>svg]:px-3" : "h-8 px-3.5 text-[13px] has-[>svg]:px-3.5",
				primary
					? "bg-primary text-primary-foreground hover:bg-primary hover:brightness-[1.08]"
					: "bg-secondary text-foreground hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]",
				className,
			)}
			{...props}
		/>
	);
}
