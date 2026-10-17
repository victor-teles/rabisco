"use client";

import { cva } from "class-variance-authority";
import { type ComponentProps, createContext, useContext, useId } from "react";
import { cn } from "@/lib/uai-utils";

export const ACTIVITY_TIMELINE_VARIANTS = ["rail", "card", "compact"] as const;

export type ActivityTimelineVariant = (typeof ACTIVITY_TIMELINE_VARIANTS)[number];

const VariantContext = createContext<ActivityTimelineVariant | null>(null);

const GroupContext = createContext<string | null>(null);

function useVariant(part: string) {
	const variant = useContext(VariantContext);

	if (!variant) throw new Error(`${part} must be used within ActivityTimeline`);

	return variant;
}

const activityTimelineVariants = cva(
	"grid min-w-0 text-[13px]/[18px] text-foreground [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border-strong [&_a]:underline-offset-3 [&_a]:transition-[text-decoration-color] [&_a]:duration-120 [&_a]:ease-out [&_a]:hover:decoration-current motion-reduce:[&_a]:transition-none",
	{
		variants: {
			variant: {
				rail: "gap-5",
				card: "gap-5",
				compact: "gap-3.5",
			},
		},
	},
);

export function ActivityTimeline({
	variant = "rail",
	children,
	className,
	...props
}: ComponentProps<"div"> & { variant?: ActivityTimelineVariant }) {
	return (
		<VariantContext.Provider value={variant}>
			<div
				data-slot="activity-timeline"
				data-variant={variant}
				className={cn(activityTimelineVariants({ variant }), className)}
				{...props}
			>
				{children}
			</div>
		</VariantContext.Provider>
	);
}

export function ActivityTimelineGroup({ className, ...props }: ComponentProps<"section">) {
	const variant = useVariant("ActivityTimelineGroup");
	const id = useId();

	return (
		<GroupContext.Provider value={id}>
			<section
				aria-labelledby={id}
				data-slot="activity-timeline-group"
				className={cn(
					"grid min-w-0 rounded-[14px]",
					variant === "compact" ? "gap-1.5" : "gap-3",
					variant === "card" ? "border bg-card p-4" : "border-0 bg-transparent p-0",
					className,
				)}
				{...props}
			/>
		</GroupContext.Provider>
	);
}

export function ActivityTimelineDate({ className, ...props }: ComponentProps<"h3">) {
	const id = useContext(GroupContext);

	if (!id) throw new Error("ActivityTimelineDate must be used within ActivityTimelineGroup");

	return (
		<h3
			data-slot="activity-timeline-date"
			className={cn("m-0 text-[11.5px]/4 font-medium text-subtle-foreground", className)}
			{...props}
			id={id}
		/>
	);
}

export function ActivityTimelineEvents({ className, ...props }: ComponentProps<"ol">) {
	return (
		<ol data-slot="activity-timeline-events" className={cn("m-0 grid list-none gap-0 p-0", className)} {...props} />
	);
}

export function ActivityTimelineEvent({ className, ...props }: ComponentProps<"li">) {
	const variant = useVariant("ActivityTimelineEvent");

	return (
		<li
			data-slot="activity-timeline-event"
			className={cn(
				"group/event relative grid min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-240 ease-out-quint fill-mode-both nth-2:[animation-delay:40ms] nth-3:[animation-delay:80ms] nth-4:[animation-delay:120ms] nth-5:[animation-delay:160ms] nth-6:[animation-delay:200ms] motion-reduce:animate-none",
				variant === "compact"
					? "grid-cols-[16px_minmax(0,1fr)] gap-x-2 pb-2"
					: "grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-3.5",
				className,
			)}
			{...props}
		/>
	);
}

export function ActivityTimelineMarker({ children, className, ...props }: ComponentProps<"span">) {
	const variant = useVariant("ActivityTimelineMarker");
	const compact = variant === "compact";

	return (
		<span
			aria-hidden="true"
			data-slot="activity-timeline-marker"
			className={cn("relative grid justify-items-center self-stretch", className)}
			{...props}
		>
			<span
				className={cn(
					"absolute left-1/2 w-px -translate-x-[0.5px] bg-border group-last/event:hidden",
					compact ? "top-4 -bottom-2" : "top-7 -bottom-3.5",
				)}
			/>
			<span
				className={cn(
					"grid place-items-center rounded-full text-muted-foreground",
					compact ? "size-4" : "size-7",
					children ? "bg-muted ring-1 ring-foreground/6" : "bg-transparent",
				)}
			>
				{children ?? <span className="size-[7px] rounded-full bg-border-strong ring-3 ring-muted" />}
			</span>
		</span>
	);
}

export function ActivityTimelineContent({ className, ...props }: ComponentProps<"div">) {
	const variant = useVariant("ActivityTimelineContent");

	return (
		<div
			data-slot="activity-timeline-content"
			className={cn("grid min-w-0", variant === "compact" ? "gap-0.5 pt-0" : "gap-0.75 pt-1.25", className)}
			{...props}
		/>
	);
}

export function ActivityTimelineTitle({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="activity-timeline-title"
			className={cn("m-0 text-pretty wrap-anywhere text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function ActivityTimelineActor({ className, ...props }: ComponentProps<"strong">) {
	return (
		<strong data-slot="activity-timeline-actor" className={cn("font-medium text-foreground", className)} {...props} />
	);
}

export function ActivityTimelineTime({ className, ...props }: ComponentProps<"time">) {
	return (
		<time
			data-slot="activity-timeline-time"
			className={cn("text-[11.5px]/4 text-subtle-foreground tabular-nums", className)}
			{...props}
		/>
	);
}

export function ActivityTimelineMeta({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="activity-timeline-meta"
			className={cn("flex flex-wrap items-center gap-1.5 text-[11.5px]/4 text-subtle-foreground", className)}
			{...props}
		/>
	);
}
