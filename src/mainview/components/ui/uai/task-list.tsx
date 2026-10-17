"use client";

import { cva } from "class-variance-authority";
import { Check, Circle, LoaderCircle } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/uai-utils";

export const TASK_LIST_VARIANTS = ["card", "timeline", "compact"] as const;

export const TASK_LIST_STATUSES = ["complete", "active", "pending"] as const;

export type TaskListVariant = (typeof TASK_LIST_VARIANTS)[number];

export type TaskStatus = (typeof TASK_LIST_STATUSES)[number];

const statusCopy: Record<TaskStatus, string> = {
	complete: "Complete",
	active: "In progress",
	pending: "Pending",
};

const statusIcons: Record<TaskStatus, typeof Check> = {
	complete: Check,
	active: LoaderCircle,
	pending: Circle,
};

const taskListVariants = cva("m-0 w-full list-none p-0 text-foreground", {
	variants: {
		variant: {
			card: "rounded-[14px]",
			timeline: "grid rounded-none bg-transparent",
			compact: "rounded-xl",
		},
	},
	compoundVariants: [
		{
			variant: ["card", "compact"],
			className: "divide-y divide-border overflow-hidden border bg-card",
		},
	],
});

const taskListItemVariants = cva(
	"animate-in duration-240 ease-out-quint fill-mode-backwards fade-in-0 slide-in-from-bottom-1 nth-2:[animation-delay:40ms] nth-3:[animation-delay:80ms] nth-4:[animation-delay:120ms] nth-5:[animation-delay:160ms] nth-6:[animation-delay:200ms] motion-reduce:animate-none [&:last-child>span:first-child]:hidden",
	{
		variants: {
			variant: {
				card: "grid min-h-16 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3",
				timeline: "relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3 pb-6 last:pb-0",
				compact: "grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2",
			},
		},
	},
);

const taskListMarkerVariants = cva(
	"relative z-10 inline-flex shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
	{
		variants: {
			status: {
				complete: "border-transparent bg-success/16 text-success-ink",
				active: "border-transparent bg-muted text-foreground",
				pending: "border-dashed border-subtle-foreground/70 bg-transparent text-transparent",
			},
		},
	},
);

const taskListStatusVariants = cva(
	"shrink-0 gap-0 rounded-full border-0 py-0 font-medium whitespace-nowrap tabular-nums",
	{
		variants: {
			status: {
				complete: "bg-success/14 text-success-ink",
				active: "bg-muted text-foreground",
				pending: "bg-transparent text-subtle-foreground",
			},
		},
	},
);

type TaskListContextValue = { variant: TaskListVariant };

const TaskListContext = createContext<TaskListContextValue | null>(null);

function useTaskList(name: string) {
	const context = useContext(TaskListContext);

	if (!context) throw new Error(`${name} must be used within TaskList`);

	return context;
}

export type TaskListProps = ComponentProps<"ol"> & {
	variant?: TaskListVariant;
};

export function TaskList({ variant = "card", className, children, ...props }: TaskListProps) {
	return (
		<TaskListContext.Provider value={{ variant }}>
			<ol
				data-slot="task-list"
				data-variant={variant}
				className={cn(taskListVariants({ variant }), className)}
				{...props}
			>
				{children}
			</ol>
		</TaskListContext.Provider>
	);
}

export type TaskListItemProps = ComponentProps<"li"> & {
	status: TaskStatus;
	statusLabel?: ReactNode;
};

export function TaskListItem({
	status,
	statusLabel,
	className,
	children,
	"aria-current": ariaCurrent,
	...props
}: TaskListItemProps) {
	const { variant } = useTaskList("TaskListItem");
	const StatusIcon = statusIcons[status];
	const compact = variant === "compact";
	const timeline = variant === "timeline";

	return (
		<li
			data-slot="task-list-item"
			data-status={status}
			aria-current={ariaCurrent ?? (status === "active" ? "step" : undefined)}
			className={cn(taskListItemVariants({ variant }), className)}
			{...props}
		>
			<span
				className={timeline ? "absolute top-8 bottom-1 left-[11.5px] block w-px bg-border" : "hidden"}
				aria-hidden="true"
			/>
			<span className={cn(taskListMarkerVariants({ status }), compact ? "size-5" : "size-6")} aria-hidden="true">
				<StatusIcon
					key={status}
					strokeWidth={status === "complete" ? 2.5 : 2}
					className={cn(
						compact ? "size-3" : "size-3.5",
						status === "active" && "motion-safe:animate-spin",
						status === "complete" &&
							"animate-in duration-200 ease-out-quint fade-in-0 zoom-in-50 motion-reduce:animate-none",
					)}
				/>
			</span>
			<span className={timeline ? "min-w-0 pt-0.75" : "min-w-0"}>{children}</span>
			<Badge
				variant="secondary"
				className={cn(
					taskListStatusVariants({ status }),
					compact ? "min-h-5 px-1.5 text-[11px]/4" : "min-h-5.5 px-2 text-[11.5px]/4",
				)}
			>
				{status === "active" ? (
					<span className="shimmer-text">{statusLabel ?? statusCopy[status]}</span>
				) : (
					(statusLabel ?? statusCopy[status])
				)}
			</Badge>
		</li>
	);
}

export type TaskListTitleProps = ComponentProps<"span"> & { children: ReactNode };

export function TaskListTitle({ className, children, ...props }: TaskListTitleProps) {
	const { variant } = useTaskList("TaskListTitle");

	return (
		<span
			data-slot="task-list-title"
			className={cn(
				"block font-medium wrap-anywhere in-data-[status=pending]:text-muted-foreground",
				variant === "compact" ? "text-[12.5px]/[17px]" : "text-[13px]/[18px]",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

export type TaskListDescriptionProps = ComponentProps<"span"> & { children: ReactNode };

export function TaskListDescription({ className, children, ...props }: TaskListDescriptionProps) {
	const { variant } = useTaskList("TaskListDescription");

	return (
		<span
			data-slot="task-list-description"
			className={cn(
				"block text-subtle-foreground wrap-anywhere",
				variant === "compact" ? "mt-px text-[11.5px]/4" : "mt-0.5 text-xs/[17px]",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}
