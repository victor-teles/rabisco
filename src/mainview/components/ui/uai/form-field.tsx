import { cva } from "class-variance-authority";
import { type ComponentProps, createContext, useContext, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/uai-utils";

export const FORM_FIELD_VARIANTS = ["outlined", "filled", "compact"] as const;

export type FormFieldVariant = (typeof FORM_FIELD_VARIANTS)[number];

export type FormFieldProps = ComponentProps<"div"> & {
	variant?: FormFieldVariant;
	inputId?: string;
	required?: boolean;
	invalid?: boolean;
	disabled?: boolean;
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	maxLength?: number;
};

type FieldContext = {
	id: string;
	variant: FormFieldVariant;
	required: boolean;
	invalid: boolean;
	disabled: boolean;
	value: string;
	maxLength?: number;
	change: (value: string) => void;
};

const Context = createContext<FieldContext | null>(null);

function useField() {
	const context = useContext(Context);

	if (!context) throw new Error("FormField children must be used within FormField");

	return context;
}

const formFieldVariants = cva("grid min-w-0 text-[13px]/[18px] text-foreground", {
	variants: {
		variant: {
			outlined: "gap-1.5",
			filled: "gap-1.5",
			compact: "gap-1",
		},
	},
});

const formFieldControlVariants = cva(
	[
		"box-border block h-auto w-full min-w-0 border text-foreground shadow-none outline-none",
		"transition-[border-color,background-color,box-shadow] duration-120 ease-[ease-out] motion-reduce:transition-none",
		"placeholder:text-subtle-foreground",
		"hover:enabled:not-focus:border-border-strong",
		"focus-visible:border-border-strong focus-visible:ring-3 focus-visible:ring-primary/24",
		"aria-invalid:border-destructive/70 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/22",
		"disabled:cursor-not-allowed disabled:opacity-55",
	],
	{
		variants: {
			variant: {
				outlined:
					"rounded-[10px] border-border bg-background px-3 py-2.25 text-[13px]/[18px] md:text-[13px]/[18px] dark:bg-background",
				filled:
					"rounded-[10px] border-transparent bg-muted px-3 py-2.25 text-[13px]/[18px] md:text-[13px]/[18px] dark:bg-muted",
				compact:
					"rounded-lg border-border bg-background px-2.5 py-1.5 text-[12.5px]/[18px] md:text-[12.5px]/[18px] dark:bg-background",
			},
		},
	},
);

export function FormField({
	variant = "outlined",
	inputId,
	required = false,
	invalid = false,
	disabled = false,
	value,
	defaultValue = "",
	onValueChange,
	maxLength,
	className,
	children,
	...props
}: FormFieldProps) {
	const generatedId = useId();
	const [internal, setInternal] = useState(defaultValue);

	const context: FieldContext = {
		id: inputId ?? generatedId,
		variant,
		required,
		invalid,
		disabled,
		value: value ?? internal,
		maxLength,
		change: (next) => {
			if (value === undefined) setInternal(next);
			onValueChange?.(next);
		},
	};

	return (
		<Context.Provider value={context}>
			<div
				data-slot="form-field"
				data-variant={variant}
				className={cn(formFieldVariants({ variant }), className)}
				{...props}
			>
				{children}
			</div>
		</Context.Provider>
	);
}

export function FormFieldLabel({ className, children, ...props }: ComponentProps<"label">) {
	const context = useField();

	return (
		<Label
			data-slot="form-field-label"
			className={cn(
				"block font-medium leading-[18px] select-auto",
				context.variant === "compact" ? "text-[12.5px]" : "text-[13px]",
				className,
			)}
			{...props}
			htmlFor={context.id}
		>
			{children}
			{context.required && <span className="text-[12px] font-normal text-subtle-foreground"> (required)</span>}
		</Label>
	);
}

function fieldControl(context: FieldContext) {
	return {
		id: context.id,
		required: context.required,
		disabled: context.disabled,
		value: context.value,
		maxLength: context.maxLength,
		"aria-invalid": context.invalid || undefined,
		"aria-describedby": `${context.id}-description ${context.id}-error ${context.id}-count`,
	};
}

export function FormFieldInput({
	onChange,
	className,
	...props
}: Omit<ComponentProps<"input">, "value" | "defaultValue" | "id" | "maxLength" | "required" | "disabled">) {
	const context = useField();

	return (
		<Input
			data-slot="form-field-input"
			className={cn(formFieldControlVariants({ variant: context.variant }), className)}
			{...props}
			{...fieldControl(context)}
			onChange={(event) => {
				onChange?.(event);

				if (!event.defaultPrevented) context.change(event.target.value);
			}}
		/>
	);
}

export function FormFieldTextarea({
	onChange,
	className,
	...props
}: Omit<ComponentProps<"textarea">, "value" | "defaultValue" | "id" | "maxLength" | "required" | "disabled">) {
	const context = useField();

	return (
		<Textarea
			rows={3}
			data-slot="form-field-textarea"
			className={cn(
				formFieldControlVariants({ variant: context.variant }),
				"field-sizing-fixed resize-y",
				context.variant === "compact" ? "min-h-14" : "min-h-19",
				className,
			)}
			{...props}
			{...fieldControl(context)}
			onChange={(event) => {
				onChange?.(event);

				if (!event.defaultPrevented) context.change(event.target.value);
			}}
		/>
	);
}

export function FormFieldDescription({ className, ...props }: ComponentProps<"p">) {
	const context = useField();

	return (
		<p
			data-slot="form-field-description"
			className={cn("m-0 text-xs/4 text-muted-foreground", className)}
			{...props}
			id={`${context.id}-description`}
		/>
	);
}

export function FormFieldError({ className, ...props }: ComponentProps<"p">) {
	const context = useField();

	if (!context.invalid) return null;

	return (
		<p
			role="alert"
			data-slot="form-field-error"
			className={cn(
				"m-0 text-xs/4 text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))] animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out-quint motion-reduce:animate-none",
				className,
			)}
			{...props}
			id={`${context.id}-error`}
		/>
	);
}

export function FormFieldCount({ className, ...props }: ComponentProps<"span">) {
	const context = useField();
	const { maxLength } = context;
	const length = context.value.length;
	const atLimit = maxLength !== undefined && length >= maxLength;
	const nearLimit = maxLength !== undefined && !atLimit && length >= maxLength * 0.9;

	return (
		<span
			data-slot="form-field-count"
			className={cn(
				"text-right text-[11.5px] text-subtle-foreground tabular-nums transition-colors duration-150 ease-out motion-reduce:transition-none",
				nearLimit && "text-warning",
				atLimit && "text-destructive",
				className,
			)}
			{...props}
			id={`${context.id}-count`}
		>
			{context.value.length}
			{context.maxLength === undefined ? " characters" : ` / ${context.maxLength} characters`}
		</span>
	);
}
