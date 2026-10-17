"use client";

import { cva } from "class-variance-authority";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/uai-utils";

export const PAGE_TABS_VARIANTS = ["underline", "pill", "segmented"] as const;

export type PageTabsVariant = (typeof PAGE_TABS_VARIANTS)[number];

export type PageTabsProps = Omit<ComponentProps<"div">, "defaultValue" | "dir"> & {
	variant?: PageTabsVariant;
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
};

type TabsContext = {
	id: string;
	value: string;
	variant: PageTabsVariant;
	select: (value: string) => void;
};

const Context = createContext<TabsContext | null>(null);

function useTabs(part: string) {
	const context = useContext(Context);

	if (!context) throw new Error(`${part} must be used within PageTabs`);

	return context;
}

const TabContext = createContext<boolean | null>(null);

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Fades whichever edge of a scroller still hides content.
const scrollEdgeFade =
	"data-overflow-start:[mask-image:linear-gradient(to_right,transparent,black_24px)] data-overflow-end:[mask-image:linear-gradient(to_left,transparent,black_24px)] data-overflow-start:data-overflow-end:[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]";

function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
	useEffect(() => {
		const element = ref.current;

		if (!element) return;

		const update = () => {
			const max = element.scrollWidth - element.clientWidth;
			element.toggleAttribute("data-overflow-start", element.scrollLeft > 1);
			element.toggleAttribute("data-overflow-end", element.scrollLeft < max - 1);
		};

		update();
		element.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(element);

		for (const child of element.children) observer.observe(child);

		return () => {
			element.removeEventListener("scroll", update);
			observer.disconnect();
		};
	}, [ref]);
}

function slug(value: string) {
	return value.replace(/[^\w-]/g, "_");
}

export function PageTabs({
	variant = "underline",
	value,
	defaultValue = "",
	onValueChange,
	className,
	...props
}: PageTabsProps) {
	const id = useId();
	const [internal, setInternal] = useState(defaultValue);
	const current = value ?? internal;

	const select = (next: string) => {
		if (next === current) return;

		if (value === undefined) setInternal(next);
		onValueChange?.(next);
	};

	return (
		<Context.Provider value={{ id, value: current, variant, select }}>
			<Tabs
				data-slot="page-tabs"
				data-variant={variant}
				value={current}
				onValueChange={select}
				className={cn("grid min-w-0 gap-4 text-[13px]/[18px] text-foreground", className)}
				{...props}
			/>
		</Context.Provider>
	);
}

/** Lays out the tab list beside page actions. */
export function PageTabsBar({ className, ...props }: ComponentProps<"div">) {
	const context = useTabs("PageTabsBar");

	return (
		<div
			data-slot="page-tabs-bar"
			className={cn("flex min-w-0 items-center gap-3", context.variant === "underline" && "border-b", className)}
			{...props}
		/>
	);
}

type Thumb = { left: number; top: number; width: number; height: number };

const ListContext = createContext(false);

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

const pageTabsThumbVariants = cva(
	"pointer-events-none absolute left-0 -z-1 transition-[transform,width] duration-240 ease-out-quint motion-reduce:transition-none",
	{
		variants: {
			variant: {
				underline: "h-0.5 rounded-[2px] bg-foreground",
				pill: "rounded-full bg-accent",
				segmented: "rounded-[9px] bg-card shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.08)]",
			},
		},
	},
);

function thumbStyle(variant: PageTabsVariant, thumb: Thumb): React.CSSProperties {
	if (variant === "underline") {
		return {
			top: thumb.top + thumb.height - 2,
			width: Math.max(0, thumb.width - 16),
			transform: `translateX(${thumb.left + 8}px)`,
		};
	}

	return {
		top: thumb.top,
		width: thumb.width,
		height: thumb.height,
		transform: `translateX(${thumb.left}px)`,
	};
}

export function PageTabsList({ className, children, ...props }: ComponentProps<"div">) {
	const context = useTabs("PageTabsList");
	const ref = useRef<HTMLDivElement>(null);
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const [settled, setSettled] = useState(false);
	useScrollEdges(ref);
	// Measure the selected tab so a single thumb can slide between tabs.
	useIsomorphicLayoutEffect(() => {
		const list = ref.current;

		if (!list) return;

		const measure = () => {
			const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');

			if (!tab) return setThumb(null);

			const next = {
				left: tab.offsetLeft,
				top: tab.offsetTop,
				width: tab.offsetWidth,
				height: tab.offsetHeight,
			};

			setThumb((current) =>
				current &&
				current.left === next.left &&
				current.top === next.top &&
				current.width === next.width &&
				current.height === next.height
					? current
					: next,
			);
		};

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(list);

		for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab);

		return () => observer.disconnect();
	}, [context.value]);
	// Skip the slide on first paint so the thumb does not fly in from the left edge.
	useEffect(() => {
		if (!thumb || settled) return;
		const frame = requestAnimationFrame(() => setSettled(true));

		return () => cancelAnimationFrame(frame);
	}, [thumb, settled]);

	// Radix owns arrow, Home, and End navigation through roving focus.
	return (
		<TabsList
			data-slot="page-tabs-list"
			// The Uai variant replaces the shadcn list variant so its active-tab shadow and line styles stay off.
			data-variant={context.variant}
			className={cn(
				"relative isolate flex h-auto w-auto min-w-0 flex-[1_1_auto] items-center justify-start overflow-x-auto overscroll-x-contain [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:h-auto",
				context.variant === "underline" ? "gap-1" : "gap-0.5",
				scrollEdgeFade,
				context.variant === "segmented" ? "rounded-xl bg-muted p-0.75" : "rounded-none bg-transparent p-0",
				className,
			)}
			{...props}
			ref={ref}
		>
			{thumb ? (
				<span
					aria-hidden="true"
					data-page-tabs-thumb=""
					data-slot="page-tabs-thumb"
					className={cn(pageTabsThumbVariants({ variant: context.variant }), !settled && "transition-none")}
					style={thumbStyle(context.variant, thumb)}
				/>
			) : null}
			<ListContext.Provider value={thumb !== null}>{children}</ListContext.Provider>
		</TabsList>
	);
}

const pageTabsTabVariants = cva(
	"relative inline-flex flex-none cursor-pointer items-center justify-start gap-1.5 border-0 bg-transparent py-0 font-medium whitespace-nowrap transition-[color,background-color,scale] duration-140 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring enabled:active:scale-[0.97] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none motion-reduce:active:scale-100",
	{
		variants: {
			variant: {
				underline: "h-10 rounded-none px-2 text-[13px]",
				pill: "h-7 rounded-full px-3 text-[12.5px]",
				segmented: "h-7 rounded-[9px] px-3 text-[12.5px]",
			},
			fallback: {
				true: "",
				false: "data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent",
			},
		},
		compoundVariants: [
			{
				variant: "underline",
				fallback: true,
				className:
					"shadow-[inset_0_-2px_0_var(--foreground)] data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent",
			},
			{
				variant: "pill",
				fallback: true,
				className: "data-[state=active]:bg-accent dark:data-[state=active]:bg-accent",
			},
			{
				variant: "segmented",
				fallback: true,
				className:
					"shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.08)] data-[state=active]:bg-card dark:data-[state=active]:bg-card",
			},
		],
	},
);

export function PageTabsTab({
	value,
	children,
	className,
	onClick,
	...props
}: Omit<ComponentProps<"button">, "value"> & { value: string }) {
	const context = useTabs("PageTabsTab");
	// The list paints a sliding thumb once it has measured; until then the tab paints itself.
	const thumb = useContext(ListContext);
	const selected = context.value === value;
	const { variant } = context;
	const fallback = selected && !thumb;

	return (
		<TabContext.Provider value={selected}>
			<TabsTrigger
				type="button"
				data-slot="page-tabs-tab"
				className={cn(
					pageTabsTabVariants({ variant, fallback }),
					selected
						? "text-foreground hover:text-foreground dark:text-foreground dark:hover:text-foreground"
						: "text-subtle-foreground hover:text-muted-foreground dark:text-subtle-foreground dark:hover:text-muted-foreground",
					className,
				)}
				{...props}
				value={value}
				id={`${context.id}-tab-${slug(value)}`}
				aria-controls={`${context.id}-panel-${slug(value)}`}
				// Keep the selected tab in the tab order before the list has been focused.
				tabIndex={selected ? 0 : -1}
				onClick={(event) => {
					onClick?.(event);

					if (event.defaultPrevented) return;
					event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
				}}
			>
				{children}
			</TabsTrigger>
		</TabContext.Provider>
	);
}

export function PageTabsCount({ className, ...props }: ComponentProps<"span">) {
	const selected = useContext(TabContext);
	useTabs("PageTabsCount");

	if (selected === null) throw new Error("PageTabsCount must be used within PageTabsTab");

	return (
		<span
			data-slot="page-tabs-count"
			className={cn(
				"min-w-[18px] rounded-full px-1.5 text-center text-[11px]/[17px] font-medium tabular-nums transition-[background-color,color] duration-120 ease-[ease-out]",
				selected ? "bg-foreground/10 text-foreground" : "bg-foreground/6 text-subtle-foreground",
				className,
			)}
			{...props}
		/>
	);
}

/** Page-level actions that sit beside the tabs. They are not part of the tab list. */
export function PageTabsActions({ className, ...props }: ComponentProps<"div">) {
	return (
		<div data-slot="page-tabs-actions" className={cn("flex flex-none items-center gap-1.5", className)} {...props} />
	);
}

export function PageTabsPanel({
	value,
	className,
	...props
}: Omit<ComponentProps<"div">, "value"> & { value: string }) {
	const context = useTabs("PageTabsPanel");
	const selected = context.value === value;
	const ref = useRef<HTMLDivElement>(null);
	const shown = useRef(selected);
	// Fade the incoming panel so switching tabs reads as one continuous motion.
	useIsomorphicLayoutEffect(() => {
		const wasShown = shown.current;
		shown.current = selected;
		const panel = ref.current;

		if (!selected || wasShown || !panel) return;

		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		panel.animate(
			[
				{ opacity: 0, transform: "translateY(4px)" },
				{ opacity: 1, transform: "none" },
			],
			{ duration: 220, easing: easeOut },
		);
	}, [selected]);

	return (
		<TabsContent
			// Inactive panels stay mounted so their state survives tab switches.
			forceMount
			data-slot="page-tabs-panel"
			className={cn(
				"min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
				className,
			)}
			{...props}
			value={value}
			id={`${context.id}-panel-${slug(value)}`}
			aria-labelledby={`${context.id}-tab-${slug(value)}`}
			ref={ref}
			hidden={!selected}
		/>
	);
}
