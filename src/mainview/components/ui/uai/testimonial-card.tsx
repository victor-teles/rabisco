"use client";

import { cva } from "class-variance-authority";
import { ArrowUpRight } from "lucide-react";
import { type ComponentProps, createContext, useContext } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/uai-utils";

export const TESTIMONIAL_CARD_VARIANTS = ["card", "editorial", "compact"] as const;

export type TestimonialCardVariant = (typeof TESTIMONIAL_CARD_VARIANTS)[number];

export type TestimonialCardProps = ComponentProps<"figure"> & {
	variant?: TestimonialCardVariant;
};

const Context = createContext<TestimonialCardVariant | null>(null);

function useVariant(part: string) {
	const variant = useContext(Context);

	if (!variant) throw new Error(`${part} must be used within TestimonialCard`);

	return variant;
}

const testimonialCardVariants = cva("m-0 grid min-w-0 text-[13px]/[18px] text-card-foreground", {
	variants: {
		variant: {
			card: "gap-4 rounded-[14px] border bg-card p-5",
			editorial: "gap-5 py-0.5 pr-0 pl-5 shadow-[inset_2px_0_0_var(--border-strong)]",
			compact: "gap-3 rounded-xl border bg-card p-3.5",
		},
	},
});

const testimonialCardQuoteVariants = cva("m-0 grid gap-2 text-pretty text-card-foreground", {
	variants: {
		variant: {
			card: "text-[15px]/[22px] font-normal",
			editorial: "text-xl/7 font-medium tracking-[-0.012em]",
			compact: "text-[13px]/[19px] font-normal",
		},
	},
});

export function TestimonialCard({ variant = "card", className, children, ...props }: TestimonialCardProps) {
	return (
		<Context.Provider value={variant}>
			<figure
				data-slot="testimonial-card"
				data-variant={variant}
				className={cn(testimonialCardVariants({ variant }), className)}
				{...props}
			>
				{children}
			</figure>
		</Context.Provider>
	);
}

export function TestimonialCardQuote({ className, ...props }: ComponentProps<"blockquote">) {
	const variant = useVariant("TestimonialCardQuote");

	return (
		<blockquote
			data-slot="testimonial-card-quote"
			className={cn(testimonialCardQuoteVariants({ variant }), className)}
			{...props}
		/>
	);
}

export function TestimonialCardAuthor({ className, ...props }: ComponentProps<"figcaption">) {
	return (
		<figcaption
			data-slot="testimonial-card-author"
			className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center", className)}
			{...props}
		/>
	);
}

export function TestimonialCardAvatar({
	src,
	children,
	className,
	...props
}: ComponentProps<typeof Avatar> & { src?: string }) {
	const variant = useVariant("TestimonialCardAvatar");
	const size = variant === "compact" ? 24 : variant === "editorial" ? 36 : 32;

	return (
		<Avatar
			aria-hidden="true"
			data-slot="testimonial-card-avatar"
			className={cn(
				"row-[1/span_3] grid place-items-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground shadow-[0_0_0_1px_oklch(1_0_0/0.08)] select-auto",
				variant === "compact" && "mr-2 size-6 text-[10.5px]",
				variant === "editorial" && "mr-2.5 size-9 text-[11.5px]",
				variant === "card" && "mr-2.5 size-8 text-[11.5px]",
				className,
			)}
			{...props}
		>
			{src ? <AvatarImage src={src} alt="" width={size} height={size} className="object-cover" /> : null}
			<AvatarFallback className="bg-transparent text-[length:inherit] text-inherit">{children}</AvatarFallback>
		</Avatar>
	);
}

const line = "col-start-2 block min-w-0";

export function TestimonialCardName({ className, ...props }: ComponentProps<"span">) {
	return <span data-slot="testimonial-card-name" className={cn(line, "font-medium", className)} {...props} />;
}

export function TestimonialCardRole({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="testimonial-card-role"
			className={cn(line, "text-xs/4 text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function TestimonialCardOrganization({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="testimonial-card-organization"
			className={cn(line, "text-xs/4 text-subtle-foreground", className)}
			{...props}
		/>
	);
}

export function TestimonialCardProof({ children, className, ...props }: ComponentProps<"a">) {
	return (
		<a
			data-slot="testimonial-card-proof"
			className={cn(
				"inline-flex items-center justify-self-start gap-1 text-[12.5px] font-medium text-muted-foreground no-underline transition-colors duration-120 ease-[ease-out] hover:text-foreground focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
				"[&_svg]:transition-transform [&_svg]:duration-140 [&_svg]:ease-out-quint hover:[&_svg]:translate-x-px hover:[&_svg]:-translate-y-px motion-reduce:[&_svg]:transition-none",
				className,
			)}
			{...props}
		>
			{children}
			<ArrowUpRight size={14} className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
		</a>
	);
}
