"use client";

import { cva } from "class-variance-authority";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/uai-utils";

export const APP_SIDEBAR_VARIANTS = ["panel", "inset", "compact"] as const;

export type AppSidebarVariant = (typeof APP_SIDEBAR_VARIANTS)[number];

export type AppSidebarProps = Omit<ComponentProps<"div">, "defaultValue"> & {
	variant?: AppSidebarVariant;
	/** The active item value. */
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	collapsed?: boolean;
	defaultCollapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
	/** Mobile disclosure state. */
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Media query that switches to the mobile disclosure. */
	mobileQuery?: string;
};

type SidebarContext = {
	id: string;
	variant: AppSidebarVariant;
	value: string;
	select: (value: string) => void;
	collapsed: boolean;
	setCollapsed: (collapsed: boolean) => void;
	mobile: boolean;
	open: boolean;
	setOpen: (open: boolean) => void;
};

const Context = createContext<SidebarContext | null>(null);

function useSidebar(part: string) {
	const context = useContext(Context);

	if (!context) throw new Error(`${part} must be used within AppSidebar`);

	return context;
}

const GroupContext = createContext<string | null>(null);

type SubmenuContext = { id: string; open: boolean; setOpen: (open: boolean) => void };

const Submenu = createContext<SubmenuContext | null>(null);

const ItemContext = createContext(false);

function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(false);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener?.("change", update);

		return () => media.removeEventListener?.("change", update);
	}, [query]);

	return matches;
}

function useControllable<T>(value: T | undefined, initial: T, onChange?: (value: T) => void) {
	const [internal, setInternal] = useState(initial);
	const current = value ?? internal;

	const set = (next: T) => {
		if (Object.is(next, current)) return;

		if (value === undefined) setInternal(next);
		onChange?.(next);
	};

	return [current, set] as const;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const mobileReveal = "animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out-quint motion-reduce:animate-none";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Fades a disclosure in when it opens. Skips the first render and reduced motion. */
function useReveal(ref: React.RefObject<HTMLElement | null>, open: boolean) {
	const mounted = useRef(false);
	useIsomorphicLayoutEffect(() => {
		if (!mounted.current) {
			mounted.current = true;

			return;
		}

		const element = ref.current;

		if (!open || !element) return;

		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		element.animate(
			[
				{ opacity: 0, transform: "translateY(-4px)" },
				{ opacity: 1, transform: "none" },
			],
			{ duration: 220, easing: easeOut },
		);
	}, [open]);
}

// Press feedback and focus for rows and icon buttons. Idle rows add their own hover tint.
const rowInteraction =
	"[transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_cubic-bezier(0.23,1,0.32,1)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100";

// Labels fade while the width animates instead of vanishing on the first frame.
const labelFade = "transition-opacity duration-150 ease-out motion-reduce:transition-none";

const rowIdle = "bg-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground";

function iconButtonClass(variant: AppSidebarVariant) {
	return cn(
		"grid flex-none cursor-pointer place-items-center border-0 bg-transparent p-0 text-muted-foreground",
		"transition-[background-color,color,scale] duration-140 ease-out-quint hover:bg-accent hover:text-foreground active:scale-[0.97] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-accent",
		variant === "compact" ? "size-6 rounded-[7px]" : "size-7 rounded-lg",
	);
}

function rowClass(context: SidebarContext, active: boolean, nested: boolean) {
	const compact = context.variant === "compact";

	return cn(
		"flex w-full min-w-0 cursor-pointer items-center border-0 text-left font-medium no-underline",
		rowInteraction,
		compact ? "h-6.5 gap-2 rounded-md text-[12px]" : "h-7.5 gap-2.5 rounded-[7px] text-[12.5px]",
		// Rows stay start-aligned while the width animates; collapsed padding centres the icon.
		"justify-start",
		context.collapsed
			? cn("pr-0", compact ? "pl-2" : "pl-[11px]")
			: nested
				? cn("pr-2", compact ? "pl-7.5" : "pl-9")
				: "px-2",
		active
			? cn(
					"text-foreground",
					context.variant === "inset"
						? "bg-card shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.06)]"
						: "bg-accent",
				)
			: rowIdle,
	);
}

const appSidebarVariants = cva(
	"flex min-w-0 flex-col overflow-hidden text-[13px]/[18px] text-foreground transition-[width] duration-200 ease-out-quint motion-reduce:transition-none",
	{
		variants: {
			variant: {
				panel: "gap-3 rounded-[14px] border bg-card p-2",
				inset: "gap-3 rounded-[14px] border-0 bg-background p-2 shadow-[inset_0_0_0_1px_var(--border)]",
				compact: "gap-2 rounded-xl border-0 bg-card p-1.5",
			},
		},
	},
);

export function AppSidebar({
	variant = "panel",
	value,
	defaultValue = "",
	onValueChange,
	collapsed,
	defaultCollapsed = false,
	onCollapsedChange,
	open,
	defaultOpen = false,
	onOpenChange,
	mobileQuery = "(max-width: 767px)",
	className,
	...props
}: AppSidebarProps) {
	const id = useId();
	const mobile = useMediaQuery(mobileQuery);
	const [active, select] = useControllable(value, defaultValue, onValueChange);
	const [isCollapsed, setCollapsed] = useControllable(collapsed, defaultCollapsed, onCollapsedChange);
	const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);
	const showCollapsed = isCollapsed && !mobile;
	const compact = variant === "compact";
	// Escape closes the mobile disclosure and returns focus to its trigger.
	useEffect(() => {
		if (!mobile || !isOpen) return;

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const root = document.querySelector(`[data-app-sidebar="${id}"]`);

			if (!root?.contains(document.activeElement)) return;
			event.preventDefault();
			setOpen(false);
			document.getElementById(`${id}-trigger`)?.focus();
		};

		document.addEventListener("keydown", onKey);

		return () => document.removeEventListener("keydown", onKey);
	}, [mobile, isOpen, id, setOpen]);

	return (
		<Context.Provider
			value={{
				id,
				variant,
				value: active,
				select: (next) => {
					select(next);

					if (mobile) setOpen(false);
				},
				collapsed: showCollapsed,
				setCollapsed,
				mobile,
				open: isOpen,
				setOpen,
			}}
		>
			<div
				data-slot="app-sidebar"
				data-variant={variant}
				data-collapsed={showCollapsed || undefined}
				data-mobile={mobile || undefined}
				className={cn(
					appSidebarVariants({ variant }),
					mobile ? "h-auto w-full" : "h-full",
					!mobile && (showCollapsed ? (compact ? "w-11" : "w-14") : compact ? "w-54" : "w-62"),
					className,
				)}
				{...props}
				data-app-sidebar={id}
			/>
		</Context.Provider>
	);
}

/** Top row for the workspace switcher, toggles, and mobile trigger. */
export function AppSidebarHeader({ className, ...props }: ComponentProps<"div">) {
	const context = useSidebar("AppSidebarHeader");

	return (
		<div
			data-slot="app-sidebar-header"
			className={cn(
				"relative flex min-w-0 items-center gap-1.5",
				context.collapsed ? "flex-col" : "flex-row",
				className,
			)}
			{...props}
		/>
	);
}

/** Text that hides when the sidebar collapses, such as a workspace name. */
export function AppSidebarTitle({ className, ...props }: ComponentProps<"span">) {
	const context = useSidebar("AppSidebarTitle");

	return (
		<span
			data-slot="app-sidebar-title"
			className={cn(
				"min-w-0 flex-1 truncate font-medium tracking-[-0.005em]",
				context.variant === "compact" ? "pl-1 text-[12.5px]" : "pl-1.5 text-[13px]",
				labelFade,
				// Leaves the column layout at once, then fades out behind the narrowing edge.
				context.collapsed && "pointer-events-none absolute opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

export function AppSidebarCollapseToggle({ className, onClick, ...props }: ComponentProps<"button">) {
	const context = useSidebar("AppSidebarCollapseToggle");

	if (context.mobile) return null;
	const Icon = context.collapsed ? PanelLeftOpen : PanelLeftClose;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={context.collapsed ? "Expand sidebar" : "Collapse sidebar"}
			data-slot="app-sidebar-collapse-toggle"
			className={cn(iconButtonClass(context.variant), className)}
			{...props}
			aria-expanded={!context.collapsed}
			aria-controls={`${context.id}-nav`}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) context.setCollapsed(!context.collapsed);
			}}
		>
			<Icon size={16} strokeWidth={1.75} aria-hidden="true" />
		</Button>
	);
}

export function AppSidebarMobileTrigger({ className, onClick, ...props }: ComponentProps<"button">) {
	const context = useSidebar("AppSidebarMobileTrigger");

	if (!context.mobile) return null;
	const Icon = context.open ? X : Menu;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={context.open ? "Close navigation" : "Open navigation"}
			data-slot="app-sidebar-mobile-trigger"
			className={cn(iconButtonClass(context.variant), "ml-auto", className)}
			{...props}
			id={`${context.id}-trigger`}
			aria-expanded={context.open}
			aria-controls={`${context.id}-nav`}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) context.setOpen(!context.open);
			}}
		>
			<Icon
				key={context.open ? "close" : "open"}
				size={16}
				strokeWidth={1.75}
				aria-hidden="true"
				className="animate-in fade-in-0 zoom-in-75 duration-150 ease-out-quint motion-reduce:animate-none"
			/>
		</Button>
	);
}

export function AppSidebarNav({ className, ...props }: ComponentProps<"nav">) {
	const context = useSidebar("AppSidebarNav");
	const hiddenOnMobile = context.mobile && !context.open;

	return (
		<nav
			aria-label="Main"
			data-slot="app-sidebar-nav"
			className={cn(
				"min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
				hiddenOnMobile ? "hidden" : "flex",
				context.mobile && mobileReveal,
				context.variant === "compact" ? "gap-2.5" : "gap-4",
				className,
			)}
			{...props}
			id={`${context.id}-nav`}
			hidden={hiddenOnMobile}
		/>
	);
}

export function AppSidebarGroup({ className, ...props }: ComponentProps<"div">) {
	useSidebar("AppSidebarGroup");
	const labelId = useId();

	return (
		<GroupContext.Provider value={labelId}>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this labels a set of links. */}
			<div
				role="group"
				aria-labelledby={labelId}
				data-slot="app-sidebar-group"
				className={cn("grid gap-px", className)}
				{...props}
			/>
		</GroupContext.Provider>
	);
}

export function AppSidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
	const labelId = useContext(GroupContext);
	const context = useSidebar("AppSidebarGroupLabel");

	if (!labelId) throw new Error("AppSidebarGroupLabel must be used within AppSidebarGroup");

	return (
		<div
			data-slot="app-sidebar-group-label"
			className={cn(
				"px-2 pt-0.5 pb-1 text-[11.5px]/4 font-normal text-subtle-foreground",
				context.collapsed && "sr-only",
				className,
			)}
			{...props}
			id={labelId}
		/>
	);
}

export function AppSidebarList({ className, ...props }: ComponentProps<"ul">) {
	return <ul data-slot="app-sidebar-list" className={cn("m-0 grid list-none gap-px p-0", className)} {...props} />;
}

export type AppSidebarItemProps = Omit<ComponentProps<"a">, "children"> & {
	value: string;
	/** Accessible name and tooltip when collapsed. Defaults to the label text. */
	label?: string;
	children: React.ReactNode;
};

export function AppSidebarItem({ value, label, href, children, className, onClick, ...props }: AppSidebarItemProps) {
	const context = useSidebar("AppSidebarItem");
	const submenu = useContext(Submenu);
	const active = context.value === value;

	return (
		<li className="min-w-0">
			<ItemContext.Provider value={true}>
				<a
					href={href ?? `#${value}`}
					title={context.collapsed ? label : undefined}
					data-slot="app-sidebar-item"
					className={cn(rowClass(context, active, Boolean(submenu)), className)}
					{...props}
					aria-current={active ? "page" : undefined}
					data-active={active || undefined}
					onClick={(event) => {
						onClick?.(event);
						context.select(value);
					}}
				>
					{children}
				</a>
			</ItemContext.Provider>
		</li>
	);
}

export function AppSidebarItemIcon({ className, ...props }: ComponentProps<"span">) {
	const context = useSidebar("AppSidebarItemIcon");

	return (
		<span
			aria-hidden="true"
			data-slot="app-sidebar-item-icon"
			className={cn(
				"grid flex-none place-items-center opacity-90",
				context.variant === "compact" ? "size-4" : "size-4.5",
				className,
			)}
			{...props}
		/>
	);
}

/** Row label. It stays in the accessibility tree when collapsed. */
export function AppSidebarItemLabel({ className, ...props }: ComponentProps<"span">) {
	const context = useSidebar("AppSidebarItemLabel");

	if (!useContext(ItemContext)) {
		throw new Error("AppSidebarItemLabel must be used within AppSidebarItem or AppSidebarSubmenu");
	}

	return (
		<span
			data-slot="app-sidebar-item-label"
			className={cn("min-w-0 flex-1 truncate", labelFade, context.collapsed && "opacity-0", className)}
			{...props}
		/>
	);
}

/** A trailing count or status beside a row label. Hidden when collapsed. */
export function AppSidebarItemBadge({ className, ...props }: ComponentProps<"span">) {
	const context = useSidebar("AppSidebarItemBadge");

	return (
		<span
			data-slot="app-sidebar-item-badge"
			aria-hidden={context.collapsed || undefined}
			className={cn(
				"ml-auto min-w-4.5 rounded-full bg-foreground/7 px-1.5 text-center text-[11px]/[17px] font-medium text-muted-foreground tabular-nums",
				labelFade,
				context.collapsed && "opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

export function AppSidebarSubmenu({
	open,
	defaultOpen = false,
	onOpenChange,
	className,
	...props
}: ComponentProps<"li"> & {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const context = useSidebar("AppSidebarSubmenu");
	const id = useId();
	const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);

	return (
		<Submenu.Provider value={{ id, open: isOpen, setOpen }}>
			<Collapsible
				asChild
				open={isOpen && !context.collapsed}
				onOpenChange={(next) => {
					// A collapsed sidebar expands first so the nested list has room to show.
					if (context.collapsed) context.setCollapsed(false);
					setOpen(next);
				}}
			>
				<li data-slot="app-sidebar-submenu" className={cn("grid min-w-0 gap-px", className)} {...props} />
			</Collapsible>
		</Submenu.Provider>
	);
}

function useSubmenu(part: string) {
	const context = useContext(Submenu);

	if (!context) throw new Error(`${part} must be used within AppSidebarSubmenu`);

	return context;
}

export function AppSidebarSubmenuTrigger({
	label,
	children,
	className,
	onClick,
	...props
}: ComponentProps<"button"> & { label?: string }) {
	const context = useSidebar("AppSidebarSubmenuTrigger");
	const submenu = useSubmenu("AppSidebarSubmenuTrigger");
	const expanded = submenu.open && !context.collapsed;

	return (
		<ItemContext.Provider value={true}>
			<CollapsibleTrigger
				type="button"
				title={context.collapsed ? label : undefined}
				data-slot="app-sidebar-submenu-trigger"
				className={cn(rowClass(context, false, false), className)}
				{...props}
				aria-expanded={expanded}
				aria-controls={`${submenu.id}-list`}
				onClick={onClick}
			>
				{children}
				{context.collapsed ? null : (
					<ChevronDown
						size={14}
						strokeWidth={1.75}
						aria-hidden="true"
						className={cn(
							"size-3.5",
							"ml-auto flex-none text-subtle-foreground transition-transform duration-180 ease-out-quint motion-reduce:transition-none",
							expanded && "rotate-180",
						)}
					/>
				)}
			</CollapsibleTrigger>
		</ItemContext.Provider>
	);
}

export function AppSidebarSubmenuList({ className, ...props }: ComponentProps<"ul">) {
	const context = useSidebar("AppSidebarSubmenuList");
	const submenu = useSubmenu("AppSidebarSubmenuList");
	const ref = useRef<HTMLUListElement>(null);
	useReveal(ref, submenu.open && !context.collapsed);

	return (
		<CollapsibleContent asChild>
			<ul
				data-slot="app-sidebar-submenu-list"
				className={cn("m-0 grid list-none gap-px p-0", className)}
				{...props}
				ref={ref}
				id={`${submenu.id}-list`}
			/>
		</CollapsibleContent>
	);
}

/** Bottom row for account or settings links. */
export function AppSidebarFooter({ className, ...props }: ComponentProps<"div">) {
	const context = useSidebar("AppSidebarFooter");

	if (context.mobile && !context.open) return null;

	return (
		<div
			data-slot="app-sidebar-footer"
			className={cn("grid gap-px border-t pt-2", context.mobile && mobileReveal, className)}
			{...props}
		/>
	);
}
