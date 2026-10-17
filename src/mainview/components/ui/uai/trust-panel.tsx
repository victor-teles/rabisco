"use client";

import { cva } from "class-variance-authority";
import { ShieldCheck, Star } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/uai-utils";

export const TRUST_PANEL_VARIANTS = ["card", "plain", "compact"] as const;

export type TrustPanelVariant = (typeof TRUST_PANEL_VARIANTS)[number];

export type TrustPanelProps = ComponentProps<"section"> & { variant?: TrustPanelVariant };

type TrustContext = { id: string; variant: TrustPanelVariant; revealed: boolean };

const Context = createContext<TrustContext | null>(null);

function useTrust(part: string) {
	const context = useContext(Context);

	if (!context) throw new Error(`${part} must be used within TrustPanel`);

	return context;
}

/** Flips to true once, when 30% of the element is on screen. */
function useRevealOnce(ref: RefObject<Element | null>, enabled = true) {
	const [revealed, setRevealed] = useState(false);
	useEffect(() => {
		const element = ref.current;

		if (!enabled || !element) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setRevealed(true);
					observer.disconnect();
				}
			},
			{ threshold: 0.3 },
		);

		observer.observe(element);

		return () => observer.disconnect();
	}, [ref, enabled]);

	return revealed;
}

const trustPanelVariants = cva(
	"@container/trust-panel box-border grid min-w-0 text-[13px]/[18px] text-card-foreground",
	{
		variants: {
			variant: {
				card: "gap-[18px] rounded-[14px] border bg-card p-5",
				plain: "gap-4",
				compact: "gap-3 rounded-xl border bg-card p-3",
			},
		},
	},
);

export function TrustPanel({ variant = "card", className, children, ...props }: TrustPanelProps) {
	const id = useId();
	const ref = useRef<HTMLElement>(null);
	const revealed = useRevealOnce(ref);

	return (
		<Context.Provider value={{ id, variant, revealed }}>
			<section
				ref={ref}
				aria-labelledby={`${id}-title`}
				data-slot="trust-panel"
				className={cn(trustPanelVariants({ variant }), className)}
				{...props}
				data-variant={variant}
				data-revealed={revealed || undefined}
			>
				{children}
			</section>
		</Context.Provider>
	);
}

/** Put the proof number in a `<b>` to lift it to the foreground: `<b>2,400</b> teams …`. */
export function TrustPanelTitle({ className, ...props }: ComponentProps<"h2">) {
	const context = useTrust("TrustPanelTitle");

	return (
		<h2
			data-slot="trust-panel-title"
			className={cn(
				"m-0 font-medium tracking-[-0.01em] text-balance text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground [&_b]:tabular-nums",
				context.variant === "compact" ? "text-xs/[18px]" : "text-[15px]/5",
				className,
			)}
			{...props}
			id={`${context.id}-title`}
		/>
	);
}

export function TrustPanelLogos({ className, ...props }: ComponentProps<"ul">) {
	const context = useTrust("TrustPanelLogos");

	return (
		<ul
			data-slot="trust-panel-logos"
			className={cn(
				"m-0 min-w-0 list-none p-0",
				context.variant === "card" &&
					"grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] border-y py-3 @max-[44rem]/trust-panel:grid-cols-3 @max-[26rem]/trust-panel:grid-cols-2",
				context.variant === "plain" && "flex flex-wrap gap-x-6",
				context.variant === "compact" && "flex flex-wrap gap-1.5",
				className,
			)}
			{...props}
		/>
	);
}

const trustPanelLogoVariants = cva(
	[
		"relative flex items-center whitespace-nowrap text-muted-foreground transition-colors duration-120 ease-out has-[a:hover]:text-foreground",
		"[&_a]:rounded-md [&_a]:text-inherit [&_a]:no-underline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-ring",
		"[&_svg]:flex-none [&_svg]:opacity-90 [&_svg]:transition-opacity [&_svg]:duration-120 [&_svg]:ease-out has-[a:hover]:[&_svg]:opacity-100",
		"data-[enter=true]:animate-in data-[enter=true]:fade-in-0 data-[enter=true]:slide-in-from-bottom-1 data-[enter=true]:duration-240 data-[enter=true]:ease-out-quint data-[enter=true]:fill-mode-both motion-reduce:animate-none",
		"nth-2:[animation-delay:40ms] nth-3:[animation-delay:80ms] nth-4:[animation-delay:120ms] nth-5:[animation-delay:160ms] nth-[n+6]:[animation-delay:200ms]",
	],
	{
		variants: {
			variant: {
				card: "h-11 justify-center gap-[7px] text-[14.5px]/none font-semibold tracking-[-0.02em] [&_svg]:size-[15px]",
				plain: "h-8 justify-start gap-[7px] text-[14.5px]/none font-semibold tracking-[-0.02em] [&_svg]:size-[15px]",
				compact: "h-7 justify-center gap-1.5 rounded-full bg-muted px-2.5 text-xs [&_svg]:size-3.5",
			},
		},
	},
);

export function TrustPanelLogo({
	name,
	children,
	className,
	onErrorCapture,
	...props
}: ComponentProps<"li"> & { name: string; children?: ReactNode }) {
	const context = useTrust("TrustPanelLogo");
	const [failed, setFailed] = useState(false);

	return (
		<li
			data-slot="trust-panel-logo"
			data-enter={context.revealed}
			data-fallback={failed || undefined}
			className={cn(trustPanelLogoVariants({ variant: context.variant }), className)}
			onErrorCapture={(event) => {
				onErrorCapture?.(event);

				if (event.target instanceof HTMLImageElement) setFailed(true);
			}}
			{...props}
		>
			{failed ? (
				name
			) : (
				<>
					<span aria-hidden="true" className="contents">
						{children}
					</span>
					<span className="sr-only">{name}</span>
				</>
			)}
		</li>
	);
}

const STAR_SIZE = 14;

const STAR_GAP = 2;

function Stars({ max, className }: { max: number; className?: string }) {
	return (
		<span className={cn("inline-flex flex-none gap-0.5", className)}>
			{Array.from({ length: max }, (_, index) => (
				<Star
					// biome-ignore lint/suspicious/noArrayIndexKey: stars are positional and static.
					key={index}
					size={STAR_SIZE}
					strokeWidth={0}
					fill="currentColor"
					className="flex-none"
				/>
			))}
		</span>
	);
}

export function TrustPanelRating({
	value,
	max = 5,
	children,
	className,
	...props
}: ComponentProps<"p"> & { value: number; max?: number }) {
	const context = useContext(Context);
	const ref = useRef<HTMLParagraphElement>(null);
	const ownReveal = useRevealOnce(ref, !context);
	const revealed = context ? context.revealed : ownReveal;
	const compact = context?.variant === "compact";
	const clamped = Math.min(Math.max(value, 0), max);
	const trackWidth = max * STAR_SIZE + (max - 1) * STAR_GAP;
	const fillWidth = Math.round((clamped / max) * trackWidth * 10) / 10;

	return (
		<p
			ref={ref}
			data-slot="trust-panel-rating"
			className={cn(
				"m-0 tabular-nums",
				compact ? "flex flex-wrap items-center gap-x-2 gap-y-0.5" : "grid content-start justify-items-start gap-0.5",
				className,
			)}
			{...props}
		>
			<span className="inline-flex items-center gap-2">
				<span
					className={cn(
						"font-semibold text-foreground",
						compact ? "text-[13px]/[18px]" : "text-xl/6 tracking-[-0.02em]",
					)}
				>
					{clamped.toFixed(1)}
					<span className="sr-only"> out of {max}</span>
				</span>
				<span aria-hidden="true" className="relative inline-flex">
					<Stars max={max} className="text-foreground/18" />
					<span
						data-slot="trust-panel-rating-fill"
						className="absolute inset-y-0 left-0 overflow-hidden"
						style={{ width: fillWidth }}
					>
						<span
							className={cn(
								"flex h-full overflow-hidden",
								revealed &&
									"animate-in slide-in-from-left-full duration-480 ease-out-quint fill-mode-both [animation-delay:120ms] motion-reduce:animate-none",
							)}
						>
							<span
								className={cn(
									"flex h-full",
									revealed &&
										"animate-in slide-in-from-right-full duration-480 ease-out-quint fill-mode-both [animation-delay:120ms] motion-reduce:animate-none",
								)}
							>
								<Stars max={max} className="text-foreground" />
							</span>
						</span>
					</span>
				</span>
			</span>
			{children ? <span className="text-[11.5px]/4 text-subtle-foreground">{children}</span> : null}
		</p>
	);
}

export function TrustPanelBadges({ className, ...props }: ComponentProps<"ul">) {
	return (
		<ul
			data-slot="trust-panel-badges"
			className={cn("m-0 flex list-none flex-wrap gap-1.5 p-0", className)}
			{...props}
		/>
	);
}

/** Put the claim in a `<b>` to lift it to the foreground: `<b>SOC 2 Type II</b> report on request`. */
export function TrustPanelBadge({
	icon = <ShieldCheck size={13} className="size-[13px]" strokeWidth={1.75} aria-hidden="true" />,
	children,
	className,
	...props
}: ComponentProps<"li"> & { icon?: ReactNode }) {
	return (
		<Badge
			asChild
			variant="secondary"
			className={cn(
				"min-h-[26px] justify-start gap-1.5 rounded-full border-0 bg-muted py-0 pr-2.5 pl-2 text-xs/4 font-normal whitespace-normal text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&>span>svg]:size-[13px]",
				"has-[a]:transition-[background-color,scale] has-[a]:duration-120 has-[a]:ease-out has-[a:hover]:bg-[color-mix(in_oklab,var(--muted)_85%,var(--foreground))] has-[a:active]:scale-[0.97] has-[a:active]:duration-140 has-[a:active]:ease-out-quint motion-reduce:has-[a:active]:scale-100",
				"[&_a]:text-inherit [&_a]:no-underline [&_a]:outline-none [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:rounded-full has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring relative",
				className,
			)}
		>
			<li data-slot="trust-panel-badge" {...props}>
				<span aria-hidden="true" className="inline-flex flex-none text-success">
					{icon}
				</span>
				{children}
			</li>
		</Badge>
	);
}
