"use client";

import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { type ComponentProps, createContext, useContext } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const FILTER_BAR_VARIANTS = ["toolbar", "panel", "compact"] as const;

export type FilterBarVariant = (typeof FILTER_BAR_VARIANTS)[number];

export type FilterBarProps = ComponentProps<"div"> & {
	variant?: FilterBarVariant;
	activeCount?: number;
	onReset?: () => void;
	disabled?: boolean;
};

type FilterContext = {
	variant: FilterBarVariant;
	activeCount: number;
	onReset?: () => void;
	disabled: boolean;
};

const Context = createContext<FilterContext | null>(null);

function useFilter() {
	const context = useContext(Context);

	if (!context) throw new Error("FilterBar children must be used within FilterBar");

	return context;
}

const filterBarVariants = cva("flex min-w-0 flex-wrap border text-foreground", {
	variants: {
		variant: {
			toolbar: "flex-row items-center gap-3 rounded-[14px] border-transparent bg-card px-3 py-2.5 text-[13px]/[18px]",
			panel: "flex-col items-stretch gap-3.5 rounded-[14px] bg-card p-4 text-[13px]/[18px]",
			compact: "flex-row items-center gap-2 rounded-xl bg-transparent px-2 py-1.5 text-[12.5px]/[18px]",
		},
	},
});

// Ghost Button overrides: the neutral hover and pointer-event resets keep hover feedback on
// enabled controls only and preserve the not-allowed cursor when disabled.
const actionButton =
	"cursor-pointer border-0 bg-transparent transition-[background-color,color,scale] duration-[120ms,120ms,140ms] ease-[ease-out,ease-out,cubic-bezier(0.23,1,0.32,1)] hover:bg-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid enabled:active:scale-[0.97] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none motion-reduce:enabled:active:scale-100 dark:hover:bg-transparent";

export function FilterBar({
	variant = "toolbar",
	activeCount = 0,
	onReset,
	disabled = false,
	className,
	children,
	...props
}: FilterBarProps) {
	return (
		<Context.Provider value={{ variant, activeCount, onReset, disabled }}>
			<div
				data-slot="filter-bar"
				data-variant={variant}
				className={cn(filterBarVariants({ variant }), className)}
				{...props}
			>
				{children}
			</div>
		</Context.Provider>
	);
}

export function FilterBarControls({ className, ...props }: ComponentProps<"div">) {
	return (
		<div data-slot="filter-bar-controls" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
	);
}

export function FilterBarChips({ className, ...props }: ComponentProps<"div">) {
	return (
		<div data-slot="filter-bar-chips" className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />
	);
}

export function FilterBarChip({
	children,
	onRemove,
	disabled,
	className,
	...props
}: ComponentProps<"span"> & { onRemove: () => void; disabled?: boolean }) {
	const context = useFilter();

	return (
		<Badge
			variant="secondary"
			data-slot="filter-bar-chip"
			className={cn(
				"box-border inline-flex min-h-6.5 w-auto max-w-full shrink justify-start items-center gap-0.5 overflow-visible rounded-full border-0 bg-muted py-0 pr-0.75 pl-2.5 text-[12px] font-medium whitespace-normal text-foreground",
				"animate-in fade-in-0 zoom-in-96 duration-180 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none",
				className,
			)}
			{...props}
		>
			<span className="wrap-anywhere">{children}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				disabled={context.disabled || disabled}
				onClick={onRemove}
				className={cn(
					actionButton,
					"grid size-5 shrink-0 place-items-center rounded-full p-0 text-subtle-foreground hover:text-subtle-foreground enabled:hover:bg-foreground/10 enabled:hover:text-foreground [&_svg:not([class*='size-'])]:size-3",
				)}
			>
				<X size={12} className="size-3" strokeWidth={2} aria-hidden="true" />
				<span className="sr-only">Remove {children} filter</span>
			</Button>
		</Badge>
	);
}

export function FilterBarCount({ children, className, ...props }: ComponentProps<"span">) {
	return (
		<span
			role="status"
			data-slot="filter-bar-count"
			className={cn("text-[12px] text-subtle-foreground tabular-nums", className)}
			{...props}
		>
			{children}
		</span>
	);
}

export function FilterBarReset({ children = "Reset filters", onClick, className, ...props }: ComponentProps<"button">) {
	const context = useFilter();

	return (
		<Button
			data-slot="filter-bar-reset"
			variant="ghost"
			className={cn(
				actionButton,
				"h-7 rounded-full px-3 py-0 text-[12.5px] font-medium text-muted-foreground hover:text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground has-[>svg]:px-3",
				context.variant === "panel" ? "ml-0 self-start" : "ml-auto",
				className,
			)}
			{...props}
			type="button"
			disabled={context.disabled || !context.activeCount || props.disabled}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) context.onReset?.();
			}}
		>
			{children}
		</Button>
	);
}
