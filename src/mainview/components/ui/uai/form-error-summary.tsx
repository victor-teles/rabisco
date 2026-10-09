import { cva } from "class-variance-authority";
import { CircleAlert } from "lucide-react";
import { type ComponentProps, createContext, useContext, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/uai-utils";

export const FORM_ERROR_SUMMARY_VARIANTS = ["card", "plain", "compact"] as const;

export type FormErrorSummaryVariant = (typeof FORM_ERROR_SUMMARY_VARIANTS)[number];

export type FormErrorSummaryProps = ComponentProps<"section"> & {
	variant?: FormErrorSummaryVariant;
	focusOnMount?: boolean;
};

const Context = createContext<string | null>(null);

const formErrorSummaryVariants = cva(
	"border-solid border-destructive/30 border-l-destructive text-foreground outline-none marker:text-destructive/70 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
	{
		variants: {
			variant: {
				card: "rounded-[14px] border border-l-3 bg-[color-mix(in_oklab,var(--destructive)_7%,var(--card))] p-4 text-[13px]/[18px]",
				plain: "rounded-none border-0 border-l-3 bg-transparent py-0.5 pr-0 pl-3.5 text-[13px]/[18px]",
				compact:
					"rounded-xl border border-l-3 bg-[color-mix(in_oklab,var(--destructive)_7%,var(--card))] p-3 text-[12.5px]/[18px]",
			},
		},
	},
);

export function FormErrorSummary({
	variant = "card",
	focusOnMount = false,
	children,
	className,
	...props
}: FormErrorSummaryProps) {
	const id = useId();
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		if (focusOnMount) ref.current?.focus();
	}, [focusOnMount]);

	return (
		<Context.Provider value={id}>
			<section
				role="alert"
				data-slot="form-error-summary"
				data-variant={variant}
				className={cn(
					formErrorSummaryVariants({ variant }),
					"animate-in fade-in-0 slide-in-from-top-1 duration-240 ease-out-quint motion-reduce:animate-none",
					className,
				)}
				{...props}
				ref={ref}
				tabIndex={-1}
				aria-labelledby={id}
			>
				{children}
			</section>
		</Context.Provider>
	);
}

export function FormErrorSummaryTitle({
	children = "Check the following fields",
	className,
	...props
}: ComponentProps<"h2">) {
	const id = useContext(Context);

	if (!id) throw new Error("FormErrorSummaryTitle must be used within FormErrorSummary");

	return (
		<h2
			data-slot="form-error-summary-title"
			className={cn("m-0 flex items-center gap-2 text-sm/5 font-medium", className)}
			{...props}
			id={id}
		>
			<CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-destructive" />
			{children}
		</h2>
	);
}

export function FormErrorSummaryList({ className, ...props }: ComponentProps<"ul">) {
	return (
		<ul data-slot="form-error-summary-list" className={cn("m-0 mt-2 grid gap-1 pl-[42px]", className)} {...props} />
	);
}

export function FormErrorSummaryLink({
	fieldId,
	onClick,
	className,
	...props
}: Omit<ComponentProps<"a">, "href"> & { fieldId: string }) {
	return (
		<li data-slot="form-error-summary-item">
			<a
				data-slot="form-error-summary-link"
				className={cn(
					"text-foreground underline decoration-foreground/30 decoration-1 underline-offset-3 transition-[text-decoration-color,color] duration-120 ease-[ease-out] hover:decoration-current focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
					className,
				)}
				{...props}
				href={`#${encodeURIComponent(fieldId)}`}
				onClick={(event) => {
					onClick?.(event);

					if (event.defaultPrevented) return;
					const field = document.getElementById(fieldId);

					if (field) {
						event.preventDefault();
						field.focus();
						field.scrollIntoView?.({ block: "center" });
					}
				}}
			/>
		</li>
	);
}
