"use client";

import { cva } from "class-variance-authority";
import { type ComponentProps, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const DESCRIPTION_LIST_VARIANTS = ["inline", "stacked", "grid"] as const;

export type DescriptionListVariant = (typeof DESCRIPTION_LIST_VARIANTS)[number];

export type DescriptionListProps = ComponentProps<"dl"> & { variant?: DescriptionListVariant };

const Context = createContext<DescriptionListVariant | null>(null);

function useVariant(part: string) {
	const variant = useContext(Context);

	if (!variant) throw new Error(`${part} must be used within DescriptionList`);

	return variant;
}

const descriptionListVariants = cva("m-0 grid min-w-0 text-[13px]/[18px] text-foreground", {
	variants: {
		variant: {
			inline: "grid-cols-[minmax(0,1fr)] gap-0",
			stacked: "grid-cols-[minmax(0,1fr)] gap-0",
			grid: "grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2",
		},
	},
});

export function DescriptionList({ variant = "inline", className, ...props }: DescriptionListProps) {
	return (
		<Context.Provider value={variant}>
			<dl
				data-slot="description-list"
				data-variant={variant}
				className={cn(descriptionListVariants({ variant }), className)}
				{...props}
			/>
		</Context.Provider>
	);
}

const descriptionListItemVariants = cva("flex min-w-0 flex-wrap gap-x-4", {
	variants: {
		variant: {
			inline: "flex-row items-baseline gap-y-1 rounded-none border-b bg-transparent py-2.25 last:border-b-0",
			stacked: "flex-col items-stretch gap-y-0.5 rounded-none border-b bg-transparent py-2.5 last:border-b-0",
			grid: "flex-col items-stretch gap-y-1 rounded-[10px] bg-muted px-3 py-2.5",
		},
	},
});

export function DescriptionListItem({ className, ...props }: ComponentProps<"div">) {
	const variant = useVariant("DescriptionListItem");

	return (
		<div
			data-slot="description-list-item"
			className={cn(descriptionListItemVariants({ variant }), className)}
			{...props}
		/>
	);
}

export function DescriptionListTerm({ className, ...props }: ComponentProps<"dt">) {
	const variant = useVariant("DescriptionListTerm");

	return (
		<dt
			data-slot="description-list-term"
			className={cn(
				"font-normal",
				variant === "inline"
					? "max-w-50 flex-[1_1_140px] text-[12.5px]/[18px] text-muted-foreground"
					: "text-[11.5px]/4 text-subtle-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function DescriptionListDetails({ className, ...props }: ComponentProps<"dd">) {
	const variant = useVariant("DescriptionListDetails");

	return (
		<dd
			data-slot="description-list-details"
			className={cn(
				"m-0 flex min-w-0 items-center justify-between gap-2 font-medium wrap-anywhere",
				variant === "inline" && "min-h-7 flex-[999_1_220px]",
				className,
			)}
			{...props}
		/>
	);
}

export function DescriptionListAction({ className, ...props }: ComponentProps<"button">) {
	return (
		<Button
			variant="ghost"
			size="sm"
			data-slot="description-list-action"
			className={cn(
				"inline-flex h-6.5 min-w-6.5 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-[12px] font-medium text-muted-foreground transition-[background-color,color,scale] duration-[120ms,120ms,140ms] ease-[ease-out,ease-out,cubic-bezier(0.23,1,0.32,1)] hover:bg-accent hover:text-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid active:scale-[0.97] has-[>svg]:px-2.5 motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-auto",
				className,
			)}
			{...props}
			type="button"
		/>
	);
}
