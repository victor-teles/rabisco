"use client";

import { cva } from "class-variance-authority";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type ComponentProps, createContext, useContext, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/uai-utils";

export const SIGN_IN_CARD_VARIANTS = ["card", "split", "compact"] as const;

export const SIGN_IN_CARD_STATUSES = ["idle", "submitting", "error"] as const;

export type SignInCardVariant = (typeof SIGN_IN_CARD_VARIANTS)[number];

export type SignInCardStatus = (typeof SIGN_IN_CARD_STATUSES)[number];

export type SignInCardProps = ComponentProps<"form"> & {
	variant?: SignInCardVariant;
	status?: SignInCardStatus;
};

type SignInCardChrome = {
	headerClass: string;
	titleClass: string;
	descriptionClass: string;
	bodyClass: string;
	groupGapClass: string;
	controlClass: string;
	controlRadiusClass: string;
	footerClass: string;
};

const signInCardVariants = cva("w-full border bg-card text-card-foreground", {
	variants: {
		variant: {
			card: "rounded-[14px] p-5",
			split: "rounded-[14px] p-6",
			compact: "rounded-xl p-3.5",
		},
	},
});

function signInCardChrome(variant: SignInCardVariant): SignInCardChrome {
	const compact = variant === "compact";

	return {
		headerClass: compact ? "mb-4" : "mb-5",
		titleClass: compact ? "text-[15px] leading-5" : "text-[17px] leading-6",
		descriptionClass: compact ? "mt-1 text-[12.5px] leading-[18px]" : "mt-1.5 text-[13px] leading-[18px]",
		bodyClass:
			variant === "split"
				? "grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch sm:gap-6"
				: "grid gap-4",
		groupGapClass: compact ? "gap-2.5" : "gap-3",
		controlClass: compact ? "h-[34px] py-0 text-[12.5px] md:text-[12.5px]" : "h-[38px] py-0 text-[13px] md:text-[13px]",
		controlRadiusClass: compact ? "rounded-lg" : "rounded-[10px]",
		footerClass: compact ? "mt-4 pt-3.5" : "mt-5 pt-4",
	};
}

type SignInCardContextValue = {
	variant: SignInCardVariant;
	status: SignInCardStatus;
	submitting: boolean;
	titleId: string;
	errorId: string;
	chrome: SignInCardChrome;
};

const SignInCardContext = createContext<SignInCardContextValue | null>(null);

function useSignInCard(name: string) {
	const context = useContext(SignInCardContext);

	if (!context) throw new Error(`${name} must be used within SignInCard`);

	return context;
}

export function SignInCard({
	variant = "card",
	status = "idle",
	children,
	className,
	"aria-labelledby": ariaLabelledby,
	"aria-describedby": ariaDescribedby,
	...props
}: SignInCardProps) {
	const titleId = useId();
	const errorId = useId();
	const submitting = status === "submitting";
	const chrome = signInCardChrome(variant);

	const context: SignInCardContextValue = {
		variant,
		status,
		submitting,
		titleId,
		errorId,
		chrome,
	};

	return (
		<SignInCardContext.Provider value={context}>
			<form
				data-slot="sign-in-card"
				className={cn(signInCardVariants({ variant }), className)}
				{...props}
				data-variant={variant}
				aria-busy={submitting || undefined}
				aria-labelledby={ariaLabelledby ?? titleId}
				aria-describedby={ariaDescribedby ?? (status === "error" ? errorId : undefined)}
			>
				{children}
			</form>
		</SignInCardContext.Provider>
	);
}

export type SignInCardHeaderProps = ComponentProps<"header">;

export function SignInCardHeader({ children, className, ...props }: SignInCardHeaderProps) {
	const { chrome } = useSignInCard("SignInCardHeader");

	return (
		<header data-slot="sign-in-card-header" className={cn(chrome.headerClass, className)} {...props}>
			{children}
		</header>
	);
}

export type SignInCardTitleProps = ComponentProps<"h2">;

export function SignInCardTitle({ children, className, ...props }: SignInCardTitleProps) {
	const { titleId, chrome } = useSignInCard("SignInCardTitle");

	return (
		<h2
			data-slot="sign-in-card-title"
			className={cn("font-semibold tracking-[-0.015em] text-balance", chrome.titleClass, className)}
			{...props}
			id={titleId}
		>
			{children}
		</h2>
	);
}

export type SignInCardDescriptionProps = ComponentProps<"p">;

export function SignInCardDescription({ children, className, ...props }: SignInCardDescriptionProps) {
	const { chrome } = useSignInCard("SignInCardDescription");

	return (
		<p
			data-slot="sign-in-card-description"
			className={cn("max-w-[52ch] text-muted-foreground wrap-anywhere", chrome.descriptionClass, className)}
			{...props}
		>
			{children}
		</p>
	);
}

export type SignInCardBodyProps = ComponentProps<"div">;

export function SignInCardBody({ children, className, ...props }: SignInCardBodyProps) {
	const { chrome } = useSignInCard("SignInCardBody");

	return (
		<div data-slot="sign-in-card-body" className={cn(chrome.bodyClass, className)} {...props}>
			{children}
		</div>
	);
}

export type SignInCardProvidersProps = ComponentProps<"fieldset">;

export function SignInCardProviders({
	children,
	className,
	"aria-label": ariaLabel = "Sign-in providers",
	...props
}: SignInCardProvidersProps) {
	const { chrome } = useSignInCard("SignInCardProviders");

	return (
		<fieldset
			data-slot="sign-in-card-providers"
			className={cn("m-0 grid min-w-0 content-start border-0 p-0", chrome.groupGapClass, className)}
			{...props}
		>
			<legend className="sr-only">{ariaLabel}</legend>
			{children}
		</fieldset>
	);
}

export type SignInCardProviderProps = ComponentProps<"button">;

export function SignInCardProvider({
	children,
	className,
	type = "button",
	disabled,
	...props
}: SignInCardProviderProps) {
	const { chrome, submitting } = useSignInCard("SignInCardProvider");

	return (
		<Button
			data-slot="sign-in-card-provider"
			variant="secondary"
			{...props}
			type={type}
			disabled={disabled || submitting}
			className={cn(
				"w-full gap-2 rounded-full border-0 px-3.5 transition-[background-color,scale] duration-140 ease-out-quint hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 has-[>svg]:px-3.5",
				chrome.controlClass,
				className,
			)}
		>
			{children}
		</Button>
	);
}

export type SignInCardDividerProps = ComponentProps<"div">;

export function SignInCardDivider({ children, className, ...props }: SignInCardDividerProps) {
	const { variant } = useSignInCard("SignInCardDivider");
	const label = children ?? (variant === "split" ? "or" : "or continue with email");

	const dividerRuleClass = cn(
		"flex-1 data-[orientation=horizontal]:w-auto",
		variant === "split" &&
			"sm:data-[orientation=horizontal]:h-auto sm:data-[orientation=horizontal]:min-h-6 sm:data-[orientation=horizontal]:w-px",
	);

	return (
		<div
			data-slot="sign-in-card-divider"
			className={cn(
				"flex items-center gap-3 text-center text-[11.5px] leading-4 text-subtle-foreground",
				variant === "split" && "sm:flex-col sm:gap-2",
				className,
			)}
			{...props}
		>
			<Separator className={dividerRuleClass} aria-hidden="true" />
			<span className="shrink-0">{label}</span>
			<Separator className={dividerRuleClass} aria-hidden="true" />
		</div>
	);
}

export type SignInCardFieldsProps = ComponentProps<"div">;

export function SignInCardFields({ children, className, ...props }: SignInCardFieldsProps) {
	const { chrome } = useSignInCard("SignInCardFields");

	return (
		<div
			data-slot="sign-in-card-fields"
			className={cn("grid content-start", chrome.groupGapClass, className)}
			{...props}
		>
			{children}
		</div>
	);
}

type SignInCardFieldContextValue = {
	controlId: string;
	messageId: string;
	invalid: boolean;
};

const SignInCardFieldContext = createContext<SignInCardFieldContextValue | null>(null);

function useSignInCardField(name: string) {
	const context = useContext(SignInCardFieldContext);

	if (!context) throw new Error(`${name} must be used within SignInCardField`);

	return context;
}

export type SignInCardFieldProps = ComponentProps<"div"> & {
	invalid?: boolean;
};

export function SignInCardField({ invalid = false, children, className, ...props }: SignInCardFieldProps) {
	useSignInCard("SignInCardField");
	const controlId = useId();
	const messageId = useId();

	return (
		<SignInCardFieldContext.Provider value={{ controlId, messageId, invalid }}>
			<div data-slot="sign-in-card-field" className={cn("grid gap-1.5", className)} {...props}>
				{children}
			</div>
		</SignInCardFieldContext.Provider>
	);
}

export type SignInCardLabelProps = ComponentProps<"label">;

export function SignInCardLabel({ children, className, htmlFor, ...props }: SignInCardLabelProps) {
	useSignInCard("SignInCardLabel");
	const { controlId } = useSignInCardField("SignInCardLabel");

	return (
		<Label
			data-slot="sign-in-card-label"
			htmlFor={htmlFor ?? controlId}
			className={cn("block text-[12.5px] leading-4 font-medium select-auto", className)}
			{...props}
		>
			{children}
		</Label>
	);
}

export type SignInCardInputProps = Omit<ComponentProps<"input">, "size"> & {
	revealable?: boolean;
};

export function SignInCardInput({
	revealable = false,
	className,
	id,
	disabled,
	"aria-describedby": ariaDescribedby,
	"aria-invalid": ariaInvalid,
	type,
	...props
}: SignInCardInputProps) {
	const { chrome, submitting } = useSignInCard("SignInCardInput");
	const { controlId, messageId, invalid } = useSignInCardField("SignInCardInput");
	const [revealed, setRevealed] = useState(false);
	const inputType = revealable ? (revealed ? "text" : "password") : type;

	const input = (
		<Input
			data-slot="sign-in-card-input"
			{...props}
			id={id ?? controlId}
			type={inputType}
			disabled={disabled || submitting}
			className={cn(
				"w-full min-w-0 bg-transparent px-3 text-foreground shadow-none outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent",
				!revealable &&
					"border border-border bg-background transition-[border-color,box-shadow] duration-120 ease-out hover:border-border-strong focus-visible:border-border-strong focus-visible:ring-3 focus-visible:ring-primary/24 motion-reduce:transition-none aria-invalid:border-destructive/70 dark:bg-background",
				!revealable &&
					invalid &&
					"border-destructive/70 hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive/22 aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/22 dark:aria-invalid:ring-destructive/22",
				!revealable && chrome.controlRadiusClass,
				revealable && "rounded-none border-0 pr-10 focus-visible:ring-0 aria-invalid:ring-0 dark:aria-invalid:ring-0",
				chrome.controlClass,
				className,
			)}
			aria-describedby={ariaDescribedby ?? (invalid ? messageId : undefined)}
			aria-invalid={ariaInvalid ?? (invalid || undefined)}
		/>
	);

	if (!revealable) return input;

	return (
		<div
			className={cn(
				"relative border bg-background transition-[border-color,box-shadow] duration-120 ease-out hover:border-border-strong focus-within:border-border-strong focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_24%,transparent)] motion-reduce:transition-none",
				invalid &&
					"border-destructive/70 hover:border-destructive focus-within:border-destructive focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_22%,transparent)]",
				chrome.controlRadiusClass,
			)}
		>
			{input}
			<Toggle
				type="button"
				className="absolute inset-y-0 right-0 h-auto w-10 min-w-0 rounded-[inherit] px-0 text-subtle-foreground transition-colors duration-120 ease-out hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-3px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:bg-transparent data-[state=on]:text-subtle-foreground data-[state=on]:hover:text-foreground motion-reduce:transition-none [&_svg]:stroke-[1.75]"
				disabled={disabled || submitting}
				aria-label={revealed ? "Hide password" : "Show password"}
				pressed={revealed}
				onPressedChange={setRevealed}
			>
				{revealed ? (
					<EyeOff
						key="hide"
						className="size-4 animate-in fade-in-0 zoom-in-75 duration-150 ease-out-quint motion-reduce:animate-none"
						aria-hidden="true"
					/>
				) : (
					<Eye
						key="show"
						className="size-4 animate-in fade-in-0 zoom-in-75 duration-150 ease-out-quint motion-reduce:animate-none"
						aria-hidden="true"
					/>
				)}
			</Toggle>
		</div>
	);
}

export type SignInCardFieldMessageProps = ComponentProps<"p">;

export function SignInCardFieldMessage({ children, className, id, role, ...props }: SignInCardFieldMessageProps) {
	useSignInCard("SignInCardFieldMessage");
	const { messageId, invalid } = useSignInCardField("SignInCardFieldMessage");

	return (
		<p
			data-slot="sign-in-card-field-message"
			id={id ?? messageId}
			className={cn(
				"text-[11.5px] leading-4 wrap-anywhere",
				invalid ? "text-destructive-ink" : "text-subtle-foreground",
				className,
			)}
			role={role ?? (invalid ? "alert" : undefined)}
			{...props}
		>
			{children}
		</p>
	);
}

export type SignInCardOptionsProps = ComponentProps<"div">;

export function SignInCardOptions({ children, className, ...props }: SignInCardOptionsProps) {
	useSignInCard("SignInCardOptions");

	return (
		<div
			data-slot="sign-in-card-options"
			className={cn(
				"flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[12px] leading-4 text-muted-foreground [&_a]:font-medium [&_a]:text-primary-ink [&_a]:underline-offset-4 [&_a:hover]:underline [&_input]:size-3.5 [&_input]:accent-primary [&_label]:inline-flex [&_label]:items-center [&_label]:gap-2",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export type SignInCardErrorProps = ComponentProps<"div">;

export function SignInCardError({ children, className, id, ...props }: SignInCardErrorProps) {
	const { status, errorId } = useSignInCard("SignInCardError");

	if (status !== "error") return null;

	return (
		<div
			data-slot="sign-in-card-error"
			id={id ?? errorId}
			className={cn(
				"rounded-[10px] bg-destructive/10 px-3 py-2.5 text-[12px] leading-4 text-destructive-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_24%,transparent)] wrap-anywhere animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out-quint motion-reduce:animate-none",
				className,
			)}
			role="alert"
			{...props}
		>
			{children}
		</div>
	);
}

export type SignInCardSubmitProps = ComponentProps<"button">;

export function SignInCardSubmit({
	children = "Sign in",
	className,
	disabled,
	type = "submit",
	...props
}: SignInCardSubmitProps) {
	const { chrome, submitting } = useSignInCard("SignInCardSubmit");

	return (
		<Button
			data-slot="sign-in-card-submit"
			{...props}
			type={type}
			disabled={disabled || submitting}
			className={cn(
				"w-full gap-2 rounded-full border-0 px-4 transition-[filter,scale] duration-140 ease-out-quint hover:bg-primary hover:brightness-[1.08] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 has-[>svg]:px-4",
				chrome.controlClass,
				className,
			)}
			aria-busy={submitting || undefined}
		>
			{submitting ? (
				<LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
			) : null}
			{submitting ? "Signing in…" : children}
		</Button>
	);
}

export type SignInCardFooterProps = ComponentProps<"footer">;

export function SignInCardFooter({ children, className, ...props }: SignInCardFooterProps) {
	const { chrome } = useSignInCard("SignInCardFooter");

	return (
		<footer
			data-slot="sign-in-card-footer"
			className={cn(
				"border-t text-center text-[12px] leading-4 text-muted-foreground [&_a]:font-medium [&_a]:text-primary-ink [&_a]:underline-offset-4 [&_a:hover]:underline",
				chrome.footerClass,
				className,
			)}
			{...props}
		>
			{children}
		</footer>
	);
}
