"use client";

import { cva } from "class-variance-authority";
import { Menu, Search, X } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/uai-utils";

export const APP_HEADER_VARIANTS = ["bar", "floating", "compact"] as const;

export type AppHeaderVariant = (typeof APP_HEADER_VARIANTS)[number];

export type AppHeaderProps = ComponentProps<"header"> & {
	variant?: AppHeaderVariant;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

function appHeaderChrome(variant: AppHeaderVariant) {
	const compact = variant === "compact";

	return {
		gapClass: compact ? "gap-1.5" : "gap-2.5",
		brandClass: compact ? "h-7 gap-1.5 px-1 text-[12.5px]" : "h-8 gap-2 px-1 text-[13px]",
		overflowClass: compact ? "gap-2 md:gap-3" : "gap-3 md:gap-5",
		navClass: compact ? "gap-0.5" : "gap-1",
		navItemClass: compact ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
		searchClass: compact ? "h-7 md:w-36" : "h-8 md:w-48 lg:w-56",
		actionClass: compact ? "size-7 text-[11px]" : "size-8 text-[11.5px]",
	};
}

const appHeaderVariants = cva("flex w-full flex-wrap items-center bg-card text-foreground", {
	variants: {
		variant: {
			bar: "min-h-14 gap-2.5 rounded-none border-b px-4 py-0",
			floating:
				"min-h-14 gap-2.5 rounded-[14px] p-2 shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.06),0_12px_28px_-20px_oklch(0_0_0/0.4)]",
			compact: "min-h-11 gap-1.5 rounded-xl border px-1.5 py-1",
		},
	},
});

type AppHeaderContextValue = {
	chrome: ReturnType<typeof appHeaderChrome>;
	open: boolean;
	overflowId: string;
	setOpen: (open: boolean) => void;
};

const AppHeaderContext = createContext<AppHeaderContextValue | null>(null);

function useAppHeader(name: string) {
	const context = useContext(AppHeaderContext);

	if (!context) throw new Error(`${name} must be used within AppHeader`);

	return context;
}

export function AppHeader({
	variant = "bar",
	open,
	defaultOpen = false,
	onOpenChange,
	children,
	className,
	...props
}: AppHeaderProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const resolvedOpen = open ?? uncontrolledOpen;
	const overflowId = useId();
	const chrome = appHeaderChrome(variant);

	function setOpen(nextOpen: boolean) {
		if (open === undefined) setUncontrolledOpen(nextOpen);
		onOpenChange?.(nextOpen);
	}

	return (
		<AppHeaderContext.Provider value={{ chrome, open: resolvedOpen, overflowId, setOpen }}>
			<header
				data-slot="app-header"
				data-variant={variant}
				data-open={resolvedOpen || undefined}
				className={cn(appHeaderVariants({ variant }), className)}
				{...props}
			>
				{children}
			</header>
		</AppHeaderContext.Provider>
	);
}

export type AppHeaderBrandProps = ComponentProps<"a">;

export function AppHeaderBrand({ children, className, ...props }: AppHeaderBrandProps) {
	const context = useAppHeader("AppHeaderBrand");

	return (
		<a
			data-slot="app-header-brand"
			className={cn(
				"inline-flex min-w-0 shrink-0 items-center rounded-lg font-medium tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
				context.chrome.brandClass,
				className,
			)}
			{...props}
		>
			{children}
		</a>
	);
}

export type AppHeaderOverflowProps = Omit<ComponentProps<"div">, "id">;

export function AppHeaderOverflow({ children, className, ...props }: AppHeaderOverflowProps) {
	const context = useAppHeader("AppHeaderOverflow");

	return (
		<div
			data-slot="app-header-overflow"
			data-state={context.open ? "open" : "closed"}
			className={cn(
				"order-4 min-w-0 basis-full flex-col border-t pt-2 md:order-none md:flex md:basis-auto md:flex-row md:items-center md:border-0 md:pt-0",
				context.open ? "flex" : "hidden",
				// The mobile panel eases in each time it opens; desktop keeps it static.
				"max-md:animate-in max-md:fade-in-0 max-md:slide-in-from-top-1 max-md:duration-200 max-md:ease-out-quint motion-reduce:animate-none",
				context.chrome.overflowClass,
				className,
			)}
			{...props}
			id={context.overflowId}
		>
			{children}
		</div>
	);
}

export type AppHeaderNavProps = ComponentProps<"nav">;

export function AppHeaderNav({
	children,
	className,
	"aria-label": ariaLabel = "Primary navigation",
	...props
}: AppHeaderNavProps) {
	const context = useAppHeader("AppHeaderNav");

	return (
		<nav data-slot="app-header-nav" aria-label={ariaLabel} className={cn("min-w-0", className)} {...props}>
			<ul className={cn("flex list-none flex-col p-0 md:flex-row", context.chrome.navClass)}>{children}</ul>
		</nav>
	);
}

export type AppHeaderNavItemProps = ComponentProps<"a"> & {
	active?: boolean;
};

export function AppHeaderNavItem({
	active = false,
	children,
	className,
	"aria-current": ariaCurrent,
	...props
}: AppHeaderNavItemProps) {
	const context = useAppHeader("AppHeaderNavItem");

	return (
		<li className="min-w-0">
			<a
				data-slot="app-header-nav-item"
				data-active={active || undefined}
				aria-current={ariaCurrent ?? (active ? "page" : undefined)}
				className={cn(
					"flex min-w-0 items-center rounded-full font-medium whitespace-nowrap outline-none transition-[background-color,color,scale] duration-[120ms] ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
					active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
					context.chrome.navItemClass,
					className,
				)}
				{...props}
			>
				{children}
			</a>
		</li>
	);
}

export type AppHeaderSearchProps = Omit<ComponentProps<"input">, "type"> & {
	label?: ReactNode;
};

export function AppHeaderSearch({
	label = "Search",
	className,
	placeholder = "Search",
	id,
	...props
}: AppHeaderSearchProps) {
	const context = useAppHeader("AppHeaderSearch");
	const generatedId = useId();
	const inputId = id ?? generatedId;

	return (
		<label
			htmlFor={inputId}
			data-slot="app-header-search"
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-full border border-transparent bg-muted px-3 text-subtle-foreground transition-[border-color,background-color,color] duration-[120ms] ease-out hover:text-muted-foreground focus-within:border-border-strong focus-within:bg-card focus-within:text-muted-foreground md:ml-auto motion-reduce:transition-none",
				context.chrome.searchClass,
			)}
		>
			<Search className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
			<span className="sr-only">{label}</span>
			<Input
				type="search"
				data-slot="app-header-search-input"
				className={cn(
					"h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[12.5px] text-foreground shadow-none outline-none placeholder:text-subtle-foreground focus-visible:border-0 focus-visible:ring-0 md:text-[12.5px] dark:bg-transparent [&::-webkit-search-cancel-button]:hidden",
					className,
				)}
				placeholder={placeholder}
				{...props}
				id={inputId}
			/>
		</label>
	);
}

export type AppHeaderActionsProps = ComponentProps<"div">;

export function AppHeaderActions({ children, className, ...props }: AppHeaderActionsProps) {
	const context = useAppHeader("AppHeaderActions");

	return (
		<div
			data-slot="app-header-actions"
			className={cn("ml-auto flex shrink-0 items-center", context.chrome.gapClass, className)}
			{...props}
		>
			{children}
		</div>
	);
}

export type AppHeaderActionProps = ComponentProps<"button"> & {
	emphasis?: "primary" | "secondary";
};

export function AppHeaderAction({
	emphasis = "secondary",
	type = "button",
	children,
	className,
	...props
}: AppHeaderActionProps) {
	const context = useAppHeader("AppHeaderAction");

	return (
		<Button
			type={type}
			data-slot="app-header-action"
			data-emphasis={emphasis}
			variant={emphasis === "primary" ? "default" : "ghost"}
			size="icon"
			className={cn(
				"gap-0 font-medium tabular-nums transition-[background-color,color,filter,scale] duration-[120ms] ease-out focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
				emphasis === "primary"
					? "rounded-full bg-primary text-primary-foreground shadow-[0_0_0_1px_oklch(1_0_0_/_0.08)] hover:bg-primary hover:brightness-[1.08]"
					: "rounded-lg bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent",
				context.chrome.actionClass,
				className,
			)}
			{...props}
		>
			{children}
		</Button>
	);
}

export type AppHeaderMenuButtonProps = Omit<ComponentProps<"button">, "aria-controls" | "aria-expanded">;

export function AppHeaderMenuButton({
	type = "button",
	className,
	onClick,
	"aria-label": ariaLabel,
	...props
}: AppHeaderMenuButtonProps) {
	const context = useAppHeader("AppHeaderMenuButton");
	const Icon = context.open ? X : Menu;

	return (
		<Button
			data-slot="app-header-menu-button"
			variant="ghost"
			size="icon"
			className={cn(
				"rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-[120ms] ease-out hover:bg-accent hover:text-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] md:hidden motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-accent",
				context.chrome.actionClass,
				className,
			)}
			{...props}
			type={type}
			aria-label={ariaLabel ?? (context.open ? "Close navigation" : "Open navigation")}
			aria-controls={context.overflowId}
			aria-expanded={context.open}
			onClick={(event) => {
				context.setOpen(!context.open);
				onClick?.(event);
			}}
		>
			<Icon
				key={context.open ? "close" : "open"}
				className="size-4 animate-in fade-in-0 zoom-in-75 duration-150 ease-out-quint motion-reduce:animate-none"
				strokeWidth={1.8}
				aria-hidden="true"
			/>
		</Button>
	);
}
