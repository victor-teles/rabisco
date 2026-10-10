"use client";

import { cva } from "class-variance-authority";
import { Search } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type KeyboardEvent,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/uai-utils";

export const COMMAND_MENU_VARIANTS = ["panel", "floating", "compact"] as const;

export type CommandMenuVariant = (typeof COMMAND_MENU_VARIANTS)[number];

export type CommandMenuProps = Omit<ComponentProps<"div">, "defaultValue"> & {
	variant?: CommandMenuVariant;
	/** The search query. */
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	/** Called when Escape is pressed with an empty query, for closing a surrounding dialog. */
	onDismiss?: () => void;
	/** Label for the result listbox. */
	label?: string;
};

type MenuContext = {
	id: string;
	query: string;
	setQuery: (value: string) => void;
	activeId: string | null;
	setActiveId: (id: string | null) => void;
	empty: boolean;
	label: string;
	variant: CommandMenuVariant;
	listRef: React.RefObject<HTMLDivElement | null>;
	onDismiss?: () => void;
};

const Context = createContext<MenuContext | null>(null);

function useMenu(part: string) {
	const context = useContext(Context);

	if (!context) throw new Error(`${part} must be used within CommandMenu`);

	return context;
}

const GroupContext = createContext<string | null>(null);

// The app only renders in the browser
const useIsomorphicLayoutEffect = useLayoutEffect;

function matches(query: string, text: string) {
	const haystack = text.toLowerCase();

	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

function options(list: HTMLElement | null) {
	return Array.from(list?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);
}

const commandMenuVariants = cva(
	"flex min-w-0 origin-top flex-col overflow-hidden bg-popover text-[13px]/[18px] text-popover-foreground",
	{
		variants: {
			variant: {
				panel: "rounded-[14px] border p-0",
				floating:
					"rounded-[14px] border-0 p-1 shadow-[0_0_0_1px_var(--border-strong),0_16px_32px_-12px_oklch(0_0_0/0.32),0_4px_8px_-4px_oklch(0_0_0/0.12)]",
				compact: "rounded-xl border p-0",
			},
		},
	},
);

export function CommandMenu({
	variant = "panel",
	value,
	defaultValue = "",
	onValueChange,
	onDismiss,
	label = "Commands",
	children,
	className,
	...props
}: CommandMenuProps) {
	const id = useId();
	const listRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [internal, setInternal] = useState(defaultValue);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [empty, setEmpty] = useState(false);
	const query = value ?? internal;
	// Keep the active option valid after filtering and when the result set changes.
	useIsomorphicLayoutEffect(() => {
		const visible = options(listRef.current);
		const nextEmpty = !listRef.current?.querySelector('[role="option"]');

		if (nextEmpty !== empty) setEmpty(nextEmpty);

		if (!visible.some((option) => option.id === activeId)) setActiveId(visible[0]?.id ?? null);
	});
	const lastQuery = useRef(query);
	useIsomorphicLayoutEffect(() => {
		if (lastQuery.current === query) return;
		lastQuery.current = query;
		setActiveId(options(listRef.current)[0]?.id ?? null);
	}, [query]);
	const floating = variant === "floating";
	const reduceMotion = useRef(false);
	useEffect(() => {
		reduceMotion.current = "matchMedia" in window && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		if (!floating || reduceMotion.current) return;
		rootRef.current?.animate?.(
			[
				{ opacity: 0, transform: "scale(0.96)" },
				{ opacity: 1, transform: "scale(1)" },
			],
			{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
		);
	}, [floating]);

	return (
		<Context.Provider
			value={{
				id,
				query,
				setQuery: (next) => {
					if (value === undefined) setInternal(next);
					onValueChange?.(next);
				},
				activeId,
				setActiveId,
				empty,
				label,
				variant,
				listRef,
				onDismiss,
			}}
		>
			<div
				data-slot="command-menu"
				data-variant={variant}
				className={cn(commandMenuVariants({ variant }), className)}
				{...props}
				ref={rootRef}
			>
				{children}
			</div>
		</Context.Provider>
	);
}

/**
 * Arrow keys, Home, End, Enter and Escape for the menu, for a field outside it too (a composer that opens
 * the menu on `/`). Handled keys are `preventDefault`ed. Rabisco addition: upstream keeps this inside the input.
 */
export function useCommandMenuKeyDown() {
	const context = useMenu("useCommandMenuKeyDown");

	return (event: KeyboardEvent<HTMLElement>) => {
		const list = options(context.listRef.current);
		const index = list.findIndex((option) => option.id === context.activeId);
		let target: HTMLElement | undefined;

		if (event.key === "ArrowDown") target = list[(index + 1) % list.length];
		else if (event.key === "ArrowUp") target = list[(index - 1 + list.length) % list.length];
		else if (event.key === "Home") target = list[0];
		else if (event.key === "End") target = list[list.length - 1];
		else if (event.key === "Enter") {
			if (event.nativeEvent.isComposing) return;
			event.preventDefault();
			list[index]?.click();

			return;
		} else if (event.key === "Escape") {
			event.preventDefault();

			if (context.query) context.setQuery("");
			else context.onDismiss?.();

			return;
		} else return;
		event.preventDefault();

		if (!target) return;
		context.setActiveId(target.id);
		target.scrollIntoView?.({ block: "nearest" });
	};
}

export function CommandMenuInput({
	className,
	onChange,
	onKeyDown,
	placeholder = "Search commands…",
	...props
}: Omit<ComponentProps<"input">, "value" | "defaultValue">) {
	const context = useMenu("CommandMenuInput");
	const compact = context.variant === "compact";

	const move = useCommandMenuKeyDown();

	return (
		<div
			className={cn(
				"flex items-center border-b text-subtle-foreground",
				compact
					? "gap-2 px-2.5 py-1.5"
					: context.variant === "floating"
						? "gap-2.5 px-2.5 py-2"
						: "gap-2.5 px-3.5 py-2.5",
			)}
		>
			<Search size={compact ? 14 : 16} strokeWidth={1.75} aria-hidden="true" />
			<input
				type="text"
				role="combobox"
				aria-label={context.label}
				autoComplete="off"
				spellCheck={false}
				placeholder={placeholder}
				data-slot="command-menu-input"
				className={cn(
					"min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none placeholder:text-subtle-foreground",
					compact ? "h-6 text-[12.5px]/[18px]" : "h-7 text-[13px]/[18px]",
					className,
				)}
				{...props}
				value={context.query}
				aria-expanded={!context.empty}
				aria-controls={`${context.id}-list`}
				aria-autocomplete="list"
				aria-activedescendant={context.activeId ?? undefined}
				onChange={(event) => {
					onChange?.(event);

					if (!event.defaultPrevented) context.setQuery(event.target.value);
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);

					if (!event.defaultPrevented) move(event);
				}}
			/>
		</div>
	);
}

export function CommandMenuList({ className, ...props }: ComponentProps<"div">) {
	const { label, id, listRef } = useMenu("CommandMenuList");

	return (
		<div
			role="listbox"
			aria-label={label}
			data-slot="command-menu-list"
			className={cn("max-h-80 overflow-y-auto overscroll-contain scroll-py-1 p-1", className)}
			{...props}
			ref={listRef}
			id={`${id}-list`}
		/>
	);
}

export function CommandMenuGroup({ className, children, ...props }: ComponentProps<"div">) {
	useMenu("CommandMenuGroup");
	const labelId = useId();
	const ref = useRef<HTMLDivElement>(null);
	const [hidden, setHidden] = useState(false);
	useIsomorphicLayoutEffect(() => {
		const next = !ref.current?.querySelector('[role="option"]');

		if (next !== hidden) setHidden(next);
	});

	return (
		<GroupContext.Provider value={labelId}>
			{/* biome-ignore lint/a11y/useSemanticElements: APG listbox groups use role="group"; a fieldset is not allowed in a listbox. */}
			<div
				role="group"
				aria-labelledby={labelId}
				data-slot="command-menu-group"
				className={cn(hidden ? "hidden" : "grid", "gap-px pb-0.5", className)}
				{...props}
				ref={ref}
				hidden={hidden}
			>
				{children}
			</div>
		</GroupContext.Provider>
	);
}

export function CommandMenuGroupLabel({ className, ...props }: ComponentProps<"div">) {
	const labelId = useContext(GroupContext);

	if (!labelId) throw new Error("CommandMenuGroupLabel must be used within CommandMenuGroup");

	return (
		<div
			data-slot="command-menu-group-label"
			className={cn("px-2.5 pt-2 pb-1 text-[11.5px]/4 font-normal text-subtle-foreground", className)}
			{...props}
			id={labelId}
		/>
	);
}

export type CommandMenuItemProps = Omit<ComponentProps<"div">, "onSelect"> & {
	/** Text matched against the query. */
	value: string;
	/** Extra search terms, such as synonyms. */
	keywords?: readonly string[];
	disabled?: boolean;
	onSelect?: () => void;
};

export function CommandMenuItem({
	value,
	keywords = [],
	disabled = false,
	onSelect,
	onClick,
	onPointerMove,
	className,
	...props
}: CommandMenuItemProps) {
	const context = useMenu("CommandMenuItem");
	const id = useId();

	if (!matches(context.query, [value, ...keywords].join(" "))) return null;
	const active = context.activeId === id;
	const compact = context.variant === "compact";

	return (
		// biome-ignore lint/a11y/useFocusableInteractive: options are navigated with aria-activedescendant from the combobox input.
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the combobox input.
		<div
			role="option"
			data-slot="command-menu-item"
			className={cn(
				"flex items-center font-medium transition-[background-color] duration-120 ease-out select-none motion-reduce:transition-none [&>svg]:shrink-0 [&>svg]:text-muted-foreground data-[active]:[&>svg]:text-foreground",
				compact ? "min-h-7 gap-2 rounded-[7px] px-2 text-[12.5px]" : "min-h-8 gap-2.5 rounded-lg px-2.5 text-[13px]",
				active ? "bg-accent" : "bg-transparent",
				disabled ? "cursor-not-allowed text-muted-foreground opacity-45" : "cursor-pointer text-foreground",
				className,
			)}
			{...props}
			id={id}
			aria-selected={active}
			aria-disabled={disabled || undefined}
			data-active={active || undefined}
			onPointerMove={(event) => {
				onPointerMove?.(event);

				if (!disabled && !active) context.setActiveId(id);
			}}
			onClick={(event) => {
				onClick?.(event);

				if (!disabled && !event.defaultPrevented) onSelect?.();
			}}
		/>
	);
}

export function CommandMenuShortcut({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="command-menu-shortcut"
			className={cn(
				"ml-auto min-w-5 rounded-md bg-foreground/6 px-1.25 text-center [font-family:inherit] text-[11px]/[18px] font-medium tracking-[0.02em] text-subtle-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function CommandMenuEmpty({ className, children, ...props }: ComponentProps<"div">) {
	const context = useMenu("CommandMenuEmpty");

	return (
		<div
			role="status"
			data-slot="command-menu-empty"
			className={cn(
				context.empty ? "block" : "hidden",
				"px-3 py-6 text-center text-[12.5px] text-subtle-foreground",
				className,
			)}
			{...props}
		>
			{context.empty ? (children ?? `No results for “${context.query}”.`) : null}
		</div>
	);
}
