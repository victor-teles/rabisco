import { cva } from "class-variance-authority";
import { Check, Circle, CircleAlert } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const ORDER_STATUS_VARIANTS = ["card", "plain", "compact"] as const;

export const ORDER_STATUS_STEP_STATUSES = ["complete", "current", "upcoming", "issue"] as const;

export const ORDER_STATUS_BADGE_TONES = ["neutral", "progress", "success", "warning"] as const;

export type OrderStatusVariant = (typeof ORDER_STATUS_VARIANTS)[number];

export type OrderStatusStepStatus = (typeof ORDER_STATUS_STEP_STATUSES)[number];

export type OrderStatusBadgeTone = (typeof ORDER_STATUS_BADGE_TONES)[number];

export type OrderStatusProps = ComponentProps<"section"> & {
	variant?: OrderStatusVariant;
};

function orderStatusChrome(variant: OrderStatusVariant) {
	const compact = variant === "compact";

	return {
		headerClass: compact ? "mb-4" : "mb-5",
		titleClass: compact ? "text-[13px]/[18px]" : "text-[15px]/5",
		descriptionClass: compact ? "mt-0.5 text-[11.5px]/4" : "mt-1 text-[12.5px]/[18px]",
		stepClass: compact ? "grid-cols-[18px_minmax(0,1fr)] gap-2.5 pb-3.5" : "grid-cols-[22px_minmax(0,1fr)] gap-3 pb-4",
		markerClass: compact ? "size-[18px]" : "size-[22px]",
		markerIconClass: compact ? "size-2.5" : "size-3",
		connectorClass: compact ? "left-[8.5px] top-[22px]" : "left-[10.5px] top-[26px]",
		stepLabelClass: compact ? "text-[10.5px]/3" : "text-[11px]/4",
		stepTitleClass: compact ? "text-[12.5px]/4" : "text-[13px]/[18px]",
		stepDescriptionClass: compact ? "mt-0.5 text-[11px]/4" : "mt-0.5 text-xs/4",
		detailsClass: compact ? "mt-4 gap-2.5 pt-3.5" : "mt-5 gap-3 pt-4",
		detailClass: compact ? "text-xs/4" : "text-[12.5px]/[18px]",
		detailLabelClass: compact ? "text-[11px]/4" : "text-[11.5px]/4",
		actionsClass: compact ? "mt-4 gap-1.5" : "mt-5 gap-2",
		actionClass: compact ? "h-7 px-3 text-[12px] has-[>svg]:px-3" : "h-8 px-3.5 text-[12.5px] has-[>svg]:px-3.5",
	};
}

const orderStatusVariants = cva("w-full text-card-foreground", {
	variants: {
		variant: {
			card: "rounded-[14px] border border-border/60 bg-card p-[18px]",
			plain: "rounded-none bg-transparent p-0",
			compact: "rounded-xl border border-border/60 bg-card p-3",
		},
	},
});

type OrderStatusContextValue = {
	titleId: string;
	chrome: ReturnType<typeof orderStatusChrome>;
};

const OrderStatusContext = createContext<OrderStatusContextValue | null>(null);

function useOrderStatus(name: string) {
	const context = useContext(OrderStatusContext);

	if (!context) throw new Error(`${name} must be used within OrderStatus`);

	return context;
}

export function OrderStatus({
	variant = "card",
	children,
	className,
	"aria-labelledby": ariaLabelledby,
	...props
}: OrderStatusProps) {
	const titleId = useId();
	const chrome = orderStatusChrome(variant);

	return (
		<OrderStatusContext.Provider value={{ titleId, chrome }}>
			<section
				data-slot="order-status"
				className={cn(orderStatusVariants({ variant }), className)}
				{...props}
				data-variant={variant}
				aria-labelledby={ariaLabelledby ?? titleId}
			>
				{children}
			</section>
		</OrderStatusContext.Provider>
	);
}

export type OrderStatusHeaderProps = ComponentProps<"header">;

export function OrderStatusHeader({ children, className, ...props }: OrderStatusHeaderProps) {
	const context = useOrderStatus("OrderStatusHeader");

	return (
		<header
			data-slot="order-status-header"
			className={cn("flex items-start justify-between gap-4", context.chrome.headerClass, className)}
			{...props}
		>
			{children}
		</header>
	);
}

export type OrderStatusTitleProps = ComponentProps<"h2">;

export function OrderStatusTitle({ children, className, ...props }: OrderStatusTitleProps) {
	const context = useOrderStatus("OrderStatusTitle");

	return (
		<h2
			data-slot="order-status-title"
			className={cn("font-medium tracking-[-0.01em]", context.chrome.titleClass, className)}
			{...props}
			id={context.titleId}
		>
			{children}
		</h2>
	);
}

export type OrderStatusDescriptionProps = ComponentProps<"p">;

export function OrderStatusDescription({ children, className, ...props }: OrderStatusDescriptionProps) {
	const context = useOrderStatus("OrderStatusDescription");

	return (
		<p
			data-slot="order-status-description"
			className={cn(
				"max-w-[48ch] text-muted-foreground text-pretty wrap-anywhere",
				context.chrome.descriptionClass,
				className,
			)}
			{...props}
		>
			{children}
		</p>
	);
}

export type OrderStatusBadgeProps = ComponentProps<"span"> & {
	tone?: OrderStatusBadgeTone;
};

const orderStatusBadgeToneClass: Record<OrderStatusBadgeTone, string> = {
	neutral: "bg-muted text-muted-foreground",
	progress: "bg-primary/16 text-primary-ink",
	success: "bg-success/14 text-success-ink",
	warning: "bg-warning/14 text-warning-ink",
};

export function OrderStatusBadge({ tone = "neutral", children, className, ...props }: OrderStatusBadgeProps) {
	useOrderStatus("OrderStatusBadge");

	return (
		<Badge
			variant="secondary"
			data-slot="order-status-badge"
			data-tone={tone}
			className={cn(
				"h-[22px] shrink-0 gap-1.5 rounded-full border-0 px-2 py-0 text-[11.5px]/4 font-medium whitespace-nowrap tabular-nums before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
				orderStatusBadgeToneClass[tone],
				className,
			)}
			{...props}
		>
			{children}
		</Badge>
	);
}

export type OrderStatusProgressProps = ComponentProps<"ol">;

export function OrderStatusProgress({
	children,
	className,
	"aria-label": ariaLabel = "Order progress",
	...props
}: OrderStatusProgressProps) {
	useOrderStatus("OrderStatusProgress");

	return (
		<ol
			data-slot="order-status-progress"
			aria-label={ariaLabel}
			className={cn("grid list-none p-0", className)}
			{...props}
		>
			{children}
		</ol>
	);
}

export type OrderStatusStepProps = ComponentProps<"li"> & {
	status?: OrderStatusStepStatus;
};

const orderStatusStepLabel: Record<OrderStatusStepStatus, string> = {
	complete: "Complete",
	current: "Current",
	upcoming: "Upcoming",
	issue: "Needs attention",
};

const orderStatusStepTextClass: Record<OrderStatusStepStatus, string> = {
	complete: "text-subtle-foreground",
	current: "text-primary-ink",
	upcoming: "text-subtle-foreground",
	issue: "text-destructive-ink",
};

const orderStatusStepTitleClass: Record<OrderStatusStepStatus, string> = {
	complete: "[&_h3]:text-muted-foreground",
	current: "[&_h3]:text-card-foreground",
	upcoming: "[&_h3]:text-muted-foreground",
	issue: "[&_h3]:text-card-foreground",
};

function OrderStatusMarker({
	status,
	className,
	iconClassName,
}: {
	status: OrderStatusStepStatus;
	className: string;
	iconClassName: string;
}) {
	const markerClass = {
		complete: "border-transparent bg-[color-mix(in_oklab,var(--success)_16%,var(--card))] text-success-ink",
		current:
			"border-transparent bg-[color-mix(in_oklab,var(--primary)_18%,var(--card))] text-primary-ink ring-3 ring-primary/10 motion-safe:animate-ring-pulse",
		upcoming: "border-border bg-card text-subtle-foreground",
		issue: "border-transparent bg-[color-mix(in_oklab,var(--destructive)_16%,var(--card))] text-destructive-ink",
	}[status];

	const Icon = status === "complete" ? Check : status === "issue" ? CircleAlert : Circle;

	return (
		<span
			className={cn(
				"relative z-10 inline-flex items-center justify-center rounded-full border",
				markerClass,
				className,
			)}
			aria-hidden="true"
		>
			<Icon
				className={cn(iconClassName, status === "current" && "size-2 fill-current")}
				strokeWidth={status === "current" ? 0 : 2.25}
			/>
		</span>
	);
}

export function OrderStatusStep({
	status = "upcoming",
	children,
	className,
	"aria-current": ariaCurrent,
	...props
}: OrderStatusStepProps) {
	const context = useOrderStatus("OrderStatusStep");
	const complete = status === "complete";

	return (
		<li
			data-slot="order-status-step"
			className={cn(
				"relative grid last:pb-0 [&:last-child>span:first-child]:hidden",
				context.chrome.stepClass,
				orderStatusStepTitleClass[status],
				className,
			)}
			aria-current={ariaCurrent ?? (status === "current" ? "step" : undefined)}
			data-status={status}
			{...props}
		>
			<span
				className={cn(
					"absolute bottom-0.5 w-px -translate-x-1/2 rounded-full",
					context.chrome.connectorClass,
					complete ? "bg-[color-mix(in_oklab,var(--success)_55%,var(--border))]" : "bg-border",
				)}
				aria-hidden="true"
			/>
			<OrderStatusMarker
				status={status}
				className={context.chrome.markerClass}
				iconClassName={context.chrome.markerIconClass}
			/>
			<div className="min-w-0 pt-px">
				<span
					className={cn("mb-0.5 block font-medium", context.chrome.stepLabelClass, orderStatusStepTextClass[status])}
				>
					{orderStatusStepLabel[status]}
				</span>
				{children}
			</div>
		</li>
	);
}

export type OrderStatusStepTitleProps = ComponentProps<"h3">;

export function OrderStatusStepTitle({ children, className, ...props }: OrderStatusStepTitleProps) {
	const context = useOrderStatus("OrderStatusStepTitle");

	return (
		<h3
			data-slot="order-status-step-title"
			className={cn("font-medium", context.chrome.stepTitleClass, className)}
			{...props}
		>
			{children}
		</h3>
	);
}

export type OrderStatusStepDescriptionProps = ComponentProps<"p">;

export function OrderStatusStepDescription({ children, className, ...props }: OrderStatusStepDescriptionProps) {
	const context = useOrderStatus("OrderStatusStepDescription");

	return (
		<p
			data-slot="order-status-step-description"
			className={cn("text-muted-foreground wrap-anywhere", context.chrome.stepDescriptionClass, className)}
			{...props}
		>
			{children}
		</p>
	);
}

export type OrderStatusDetailsProps = ComponentProps<"dl">;

export function OrderStatusDetails({ children, className, ...props }: OrderStatusDetailsProps) {
	const context = useOrderStatus("OrderStatusDetails");

	return (
		<dl
			data-slot="order-status-details"
			className={cn(
				"grid grid-cols-2 border-t border-border/60 max-[420px]:grid-cols-1",
				context.chrome.detailsClass,
				className,
			)}
			{...props}
		>
			{children}
		</dl>
	);
}

export type OrderStatusDetailProps = ComponentProps<"div"> & {
	label: ReactNode;
};

export function OrderStatusDetail({ label, children, className, ...props }: OrderStatusDetailProps) {
	const context = useOrderStatus("OrderStatusDetail");

	return (
		<div data-slot="order-status-detail" className={cn("min-w-0", context.chrome.detailClass, className)} {...props}>
			<dt className={cn("text-subtle-foreground", context.chrome.detailLabelClass)}>{label}</dt>
			<dd className="mt-0.5 font-medium tabular-nums wrap-anywhere">{children}</dd>
		</div>
	);
}

export type OrderStatusActionsProps = ComponentProps<"div">;

export function OrderStatusActions({ children, className, ...props }: OrderStatusActionsProps) {
	const context = useOrderStatus("OrderStatusActions");

	return (
		<div
			data-slot="order-status-actions"
			className={cn("flex flex-wrap", context.chrome.actionsClass, className)}
			{...props}
		>
			{children}
		</div>
	);
}

export type OrderStatusActionProps = ComponentProps<"a"> & {
	emphasis?: "primary" | "secondary";
};

export function OrderStatusAction({ emphasis = "secondary", children, className, ...props }: OrderStatusActionProps) {
	const context = useOrderStatus("OrderStatusAction");

	return (
		<Button
			asChild
			variant={emphasis === "primary" ? "default" : "secondary"}
			className={cn(
				"rounded-full py-0 no-underline transition-[scale,background-color,filter] duration-140 ease-out-quint focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-97 motion-reduce:transition-none motion-reduce:active:scale-100",
				context.chrome.actionClass,
				emphasis === "primary"
					? "bg-primary text-primary-foreground hover:bg-primary hover:brightness-[1.08]"
					: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]",
				className,
			)}
		>
			<a data-slot="order-status-action" data-emphasis={emphasis} {...props}>
				{children}
			</a>
		</Button>
	);
}
