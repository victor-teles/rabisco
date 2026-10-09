"use client";

import { ArrowUpRight } from "lucide-react";
import { type ComponentProps, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const CITATION_VARIANTS = ["number", "chip", "underline"] as const;

export type CitationVariant = (typeof CITATION_VARIANTS)[number];

export type CitationProps = ComponentProps<"span"> & {
	variant?: CitationVariant;
	/** Source number shown by the default marker. */
	index?: number;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

type CitationContextValue = {
	id: string;
	index?: number;
	variant: CitationVariant;
	open: boolean;
	setOpen: (open: boolean) => void;
	registerTrigger: (node: HTMLButtonElement | null) => void;
};

const CitationContext = createContext<CitationContextValue | null>(null);

function useCitation(part: string) {
	const context = useContext(CitationContext);

	if (!context) throw new Error(`${part} must be used within Citation`);

	return context;
}

const CLOSE_DELAY = 120;

export function Citation({
	variant = "number",
	index,
	open,
	defaultOpen = false,
	onOpenChange,
	children,
	className,
	onPointerEnter,
	onPointerLeave,
	onBlur,
	onKeyDown,
	...props
}: CitationProps) {
	const id = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const closeTimer = useRef<number | undefined>(undefined);
	const [internal, setInternal] = useState(defaultOpen);
	const visible = open ?? internal;

	const setOpen = (next: boolean) => {
		window.clearTimeout(closeTimer.current);

		if (next === visible) return;

		if (open === undefined) setInternal(next);
		onOpenChange?.(next);
	};

	useEffect(() => () => window.clearTimeout(closeTimer.current), []);

	return (
		<CitationContext.Provider
			value={{
				id,
				index,
				variant,
				open: visible,
				setOpen,
				registerTrigger: (node) => {
					triggerRef.current = node;
				},
			}}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: hover and focus-out handlers coordinate the preview; the trigger is the interactive element. */}
			<span
				data-slot="citation"
				className={cn("relative inline", className)}
				{...props}
				data-variant={variant}
				data-state={visible ? "open" : "closed"}
				onPointerEnter={(event) => {
					onPointerEnter?.(event);

					if (event.pointerType !== "touch") setOpen(true);
				}}
				onPointerLeave={(event) => {
					onPointerLeave?.(event);

					if (event.pointerType === "touch") return;
					window.clearTimeout(closeTimer.current);
					closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
				}}
				onBlur={(event) => {
					onBlur?.(event);
					const next = event.relatedTarget;

					if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);

					if (event.defaultPrevented || event.key !== "Escape" || !visible) return;
					event.preventDefault();
					setOpen(false);
					triggerRef.current?.focus();
				}}
			>
				{children}
			</span>
		</CitationContext.Provider>
	);
}

export function CitationClaim({ className, ...props }: ComponentProps<"span">) {
	const context = useCitation("CitationClaim");
	const underline = context.variant === "underline";

	return (
		<span
			data-slot="citation-claim"
			className={cn(
				"rounded-[4px] decoration-dotted decoration-[1.5px] underline-offset-4",
				"[transition:background-color_120ms_ease-out,box-shadow_120ms_ease-out,text-decoration-color_120ms_ease-out]",
				underline && "underline",
				context.open ? "decoration-muted-foreground" : "decoration-border-strong",
				underline && context.open && "bg-foreground/7 ring-2 ring-foreground/7",
				className,
			)}
			{...props}
		/>
	);
}

export function CitationTrigger({
	children,
	onClick,
	onFocus,
	onPointerDown,
	className,
	...props
}: ComponentProps<"button">) {
	const context = useCitation("CitationTrigger");
	const press = useRef<{ pointerType: string; wasOpen: boolean } | null>(null);
	const chip = context.variant === "chip";

	return (
		<Button
			type="button"
			variant="ghost"
			data-slot="citation-trigger"
			aria-label={children === undefined ? `Source ${context.index ?? ""}`.trim() : undefined}
			className={cn(
				"relative mx-0.5 inline-flex shrink cursor-pointer items-center justify-center gap-1 border-0 bg-muted py-0 font-medium text-muted-foreground tabular-nums after:absolute after:-inset-1 after:content-['']",
				"transition-[background-color,color,scale] duration-[120ms,120ms,140ms] ease-[ease-out,ease-out,cubic-bezier(0.23,1,0.32,1)]",
				"hover:bg-[color-mix(in_oklab,var(--muted)_80%,var(--foreground))] hover:text-foreground aria-expanded:bg-[color-mix(in_oklab,var(--muted)_80%,var(--foreground))] aria-expanded:text-foreground dark:hover:bg-[color-mix(in_oklab,var(--muted)_80%,var(--foreground))]",
				"focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-94",
				"motion-reduce:transition-none motion-reduce:active:scale-100",
				chip
					? "h-5 rounded-md px-[7px] align-[1px] font-mono text-[11px]/none has-[>svg]:px-[7px]"
					: "h-[17px] min-w-[17px] rounded-full px-[5px] align-[2px] text-[10.5px]/none has-[>svg]:px-[5px]",
				className,
			)}
			{...props}
			ref={(node) => context.registerTrigger(node)}
			aria-expanded={context.open}
			aria-controls={`${context.id}-source`}
			onFocus={(event) => {
				onFocus?.(event);

				if (!event.defaultPrevented) context.setOpen(true);
			}}
			onPointerDown={(event) => {
				onPointerDown?.(event);
				press.current = { pointerType: event.pointerType, wasOpen: context.open };
			}}
			onClick={(event) => {
				onClick?.(event);
				const pointer = press.current;
				press.current = null;

				if (event.defaultPrevented) return;

				// Mouse hover already previews the source, so a click keeps it open.
				if (pointer?.pointerType === "mouse") context.setOpen(true);
				else if (pointer) context.setOpen(!pointer.wasOpen);
				else context.setOpen(!context.open);
			}}
		>
			{children ?? context.index}
		</Button>
	);
}

export function CitationPopover({ children, className, ...props }: ComponentProps<"span">) {
	const context = useCitation("CitationPopover");

	return (
		// biome-ignore lint/a11y/useSemanticElements: the preview sits inside phrasing content, where a fieldset is invalid.
		<span
			role="group"
			aria-labelledby={`${context.id}-title`}
			data-slot="citation-popover"
			className={cn(
				"absolute top-[calc(100%+8px)] left-0 z-20 w-[300px] max-w-[calc(100vw-32px)] origin-top-left gap-1 rounded-[14px] bg-popover p-1 text-left text-[13px]/[18px] font-normal whitespace-normal text-popover-foreground",
				"shadow-[0_0_0_1px_var(--border-strong),0_16px_32px_-12px_rgb(0_0_0/0.28),0_4px_8px_-4px_rgb(0_0_0/0.12)]",
				context.open
					? "grid animate-in fade-in-0 zoom-in-96 duration-180 ease-out-quint motion-reduce:animate-none"
					: "hidden",
				className,
			)}
			{...props}
			id={`${context.id}-source`}
			hidden={!context.open}
		>
			{children}
		</span>
	);
}

export function CitationSource({ className, ...props }: ComponentProps<"span">) {
	useCitation("CitationSource");

	return (
		<span
			data-slot="citation-source"
			className={cn(
				"flex items-center gap-1.5 px-2 pt-2 text-[11.5px]/4 text-subtle-foreground tabular-nums",
				className,
			)}
			{...props}
		/>
	);
}

export function CitationTitle({ className, ...props }: ComponentProps<"span">) {
	const context = useCitation("CitationTitle");

	return (
		<span
			data-slot="citation-title"
			className={cn("block px-2 text-[13px]/[18px] font-medium text-balance", className)}
			{...props}
			id={`${context.id}-title`}
		/>
	);
}

export function CitationExcerpt({ className, ...props }: ComponentProps<"span">) {
	useCitation("CitationExcerpt");

	return (
		<span
			data-slot="citation-excerpt"
			className={cn("mx-2 mb-1.5 line-clamp-3 max-h-[54px] text-[12.5px]/[18px] text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function CitationLink({ children, className, ...props }: ComponentProps<"a">) {
	useCitation("CitationLink");

	return (
		<a
			data-slot="citation-link"
			className={cn(
				"flex min-h-8 items-center justify-between gap-2 rounded-[10px] bg-secondary pr-2 pl-2.5 text-[12.5px] font-medium text-secondary-foreground no-underline",
				"transition-[background-color] duration-120 ease-[ease-out] hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]",
				"focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none",
				className,
			)}
			{...props}
		>
			<span className="min-w-0 overflow-hidden text-ellipsis">{children ?? "Open source"}</span>
			<ArrowUpRight
				size={14}
				strokeWidth={1.75}
				aria-hidden="true"
				className="flex-none text-muted-foreground size-3.5"
			/>
		</a>
	);
}
