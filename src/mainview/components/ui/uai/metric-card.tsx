import { cva } from "class-variance-authority";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type Ref,
	type RefCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
} from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/uai-utils";

export const METRIC_CARD_VARIANTS = ["card", "plain", "compact"] as const;

export type MetricCardVariant = (typeof METRIC_CARD_VARIANTS)[number];

export type MetricCardTrendDirection = "up" | "down" | "flat";

export type MetricCardTrendSentiment = "positive" | "negative" | "neutral";

export type MetricCardProps = ComponentProps<"div"> & { variant?: MetricCardVariant };

type MetricContext = { labelId: string; variant: MetricCardVariant };

const Context = createContext<MetricContext | null>(null);

function useMetric(part: string) {
	const context = useContext(Context);

	if (!context) throw new Error(`${part} must be used within MetricCard`);

	return context;
}

const metricCardVariants = cva("grid min-w-0 content-start text-[13px]/[18px] text-card-foreground", {
	variants: {
		variant: {
			card: "gap-1.5 rounded-[14px] border bg-card p-4",
			plain: "gap-1.5 bg-transparent p-0",
			compact: "gap-1 rounded-xl border bg-card p-3",
		},
	},
});

export function MetricCard({ variant = "card", className, children, ...props }: MetricCardProps) {
	const labelId = useId();

	return (
		<Context.Provider value={{ labelId, variant }}>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this labels a metric summary. */}
			<div
				role="group"
				aria-labelledby={labelId}
				data-slot="metric-card"
				data-variant={variant}
				className={cn(metricCardVariants({ variant }), className)}
				{...props}
			>
				{children}
			</div>
		</Context.Provider>
	);
}

export function MetricCardLabel({ className, ...props }: ComponentProps<"span">) {
	const context = useMetric("MetricCardLabel");

	return (
		<span
			data-slot="metric-card-label"
			className={cn(
				"text-[12.5px]/4 font-medium text-muted-foreground",
				context.variant === "compact" && "text-xs/4",
				className,
			)}
			{...props}
			id={context.labelId}
		/>
	);
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Ticks the value in when its text changes. Skips the first render and reduced motion. */
function useValueTick(ref: React.RefObject<HTMLElement | null>) {
	const previous = useRef<string | null>(null);
	useIsomorphicLayoutEffect(() => {
		const element = ref.current;

		if (!element) return;
		const text = element.textContent;
		const changed = previous.current !== null && previous.current !== text;
		previous.current = text;

		if (!changed) return;

		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		element.animate(
			[
				{ opacity: 0.4, transform: "translateY(3px)" },
				{ opacity: 1, transform: "none" },
			],
			{ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
		);
	});
}

function isCallbackRef<T>(ref: Ref<T>): ref is RefCallback<T> {
	return typeof ref === "function";
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
	if (!ref) return;

	if (isCallbackRef(ref)) ref(value);
	else ref.current = value;
}

export function MetricCardValue({ className, ref, ...props }: ComponentProps<"p">) {
	const context = useMetric("MetricCardValue");
	const element = useRef<HTMLParagraphElement | null>(null);
	useValueTick(element);

	return (
		<p
			data-slot="metric-card-value"
			className={cn(
				"m-0 font-semibold tabular-nums wrap-anywhere",
				context.variant === "compact" ? "text-xl/[26px] tracking-[-0.015em]" : "text-[28px]/[34px] tracking-[-0.025em]",
				className,
			)}
			{...props}
			ref={(node) => {
				element.current = node;
				assignRef(ref, node);
			}}
		/>
	);
}

const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

const trendWords = { up: "Increased", down: "Decreased", flat: "Unchanged" };

const metricCardTrendVariants = cva(
	"w-fit gap-0.75 rounded-full border-0 py-0.5 pr-2 pl-1.25 text-[11.5px]/4 font-medium tabular-nums [&>svg]:size-[13px]",
	{
		variants: {
			sentiment: {
				positive: "bg-success/14 text-success",
				negative: "bg-destructive/14 text-destructive",
				neutral: "bg-foreground/7 text-muted-foreground",
			},
		},
	},
);

export function MetricCardTrend({
	direction,
	sentiment = direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral",
	className,
	children,
	...props
}: ComponentProps<"span"> & {
	direction: MetricCardTrendDirection;
	sentiment?: MetricCardTrendSentiment;
}) {
	useMetric("MetricCardTrend");
	const Icon = trendIcons[direction];

	return (
		<Badge
			variant="secondary"
			data-slot="metric-card-trend"
			data-direction={direction}
			data-sentiment={sentiment}
			className={cn(metricCardTrendVariants({ sentiment }), className)}
			{...props}
		>
			<Icon size={13} className="size-[13px]" strokeWidth={2} aria-hidden="true" />
			<span className="sr-only">{trendWords[direction]} </span>
			{children}
		</Badge>
	);
}

export function MetricCardComparison({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="metric-card-comparison"
			className={cn("m-0 text-[12px] text-subtle-foreground tabular-nums", className)}
			{...props}
		/>
	);
}

export function MetricCardDescription({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="metric-card-description"
			className={cn("mt-1 mb-0 border-t pt-2.5 text-[12.5px] text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function MetricCardHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="metric-card-header"
			className={cn("flex flex-wrap items-center justify-between gap-2", className)}
			{...props}
		/>
	);
}
