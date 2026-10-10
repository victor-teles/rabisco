import { cva } from "class-variance-authority";
import { LoaderCircle, Search, X } from "lucide-react";
import { type ComponentProps, createContext, useContext, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/uai-utils";

export const SEARCH_FIELD_VARIANTS = ["rounded", "pill", "compact"] as const;

export type SearchFieldVariant = (typeof SEARCH_FIELD_VARIANTS)[number];

export type SearchFieldStatus = "idle" | "loading" | "empty" | "error";

export type SearchFieldProps = ComponentProps<"div"> & {
	variant?: SearchFieldVariant;
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	status?: SearchFieldStatus;
	disabled?: boolean;
};

type SearchContext = {
	id: string;
	value: string;
	change: (value: string) => void;
	focus: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
	status: SearchFieldStatus;
	disabled: boolean;
	variant: SearchFieldVariant;
};

const Context = createContext<SearchContext | null>(null);

const searchFieldVariants = cva("grid min-w-0 gap-2 text-[13px]/[18px] text-foreground", {
	variants: { variant: { rounded: "", pill: "", compact: "" } },
});

function useSearch() {
	const context = useContext(Context);

	if (!context) throw new Error("SearchField children must be used within SearchField");

	return context;
}

export function SearchField({
	variant = "rounded",
	value,
	defaultValue = "",
	onValueChange,
	status = "idle",
	disabled = false,
	children,
	className,
	...props
}: SearchFieldProps) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [internal, setInternal] = useState(defaultValue);

	const context: SearchContext = {
		id,
		inputRef,
		value: value ?? internal,
		status,
		disabled,
		variant,
		focus: () => inputRef.current?.focus(),
		change: (next) => {
			if (disabled) return;

			if (value === undefined) setInternal(next);
			onValueChange?.(next);
		},
	};

	return (
		<Context.Provider value={context}>
			<div
				data-slot="search-field"
				className={cn(searchFieldVariants({ variant }), className)}
				{...props}
				data-variant={variant}
			>
				{children}
			</div>
		</Context.Provider>
	);
}

export function SearchFieldLabel({ children, className, ...props }: ComponentProps<"label">) {
	const context = useSearch();

	return (
		<Label
			data-slot="search-field-label"
			className={cn("block text-[length:inherit] leading-[inherit] font-medium select-auto", className)}
			{...props}
			htmlFor={context.id}
		>
			{children}
		</Label>
	);
}

export function SearchFieldControl({ className, children, ...props }: ComponentProps<"div">) {
	const context = useSearch();
	const compact = context.variant === "compact";

	return (
		<div
			data-slot="search-field-control"
			className={cn(
				"flex items-center border bg-background text-subtle-foreground transition-[border-color,box-shadow,color] duration-120 ease-[ease-out] hover:border-border-strong focus-within:border-border-strong focus-within:text-muted-foreground focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_24%,transparent)] data-[status=error]:border-destructive/70 motion-reduce:transition-none",
				compact ? "gap-1.5 py-0.5 pr-1 pl-2.5" : "gap-2 py-1 pr-1.5 pl-3",
				context.variant === "pill" ? "rounded-full" : compact ? "rounded-lg" : "rounded-[10px]",
				context.disabled ? "opacity-55" : "opacity-100",
				className,
			)}
			{...props}
			data-status={context.status}
		>
			<span
				key={context.status === "loading" ? "loading" : "idle"}
				className="inline-flex shrink-0 animate-in fade-in-0 zoom-in-75 duration-150 ease-out-quint motion-reduce:animate-none"
			>
				{context.status === "loading" ? (
					<LoaderCircle
						className="animate-[spin_0.8s_linear_infinite] motion-reduce:animate-none"
						size={compact ? 14 : 16}
						strokeWidth={1.75}
						aria-hidden="true"
					/>
				) : (
					<Search size={compact ? 14 : 16} strokeWidth={1.75} aria-hidden="true" />
				)}
			</span>
			{children}
		</div>
	);
}

export function SearchFieldInput({
	className,
	onChange,
	onKeyDown,
	...props
}: Omit<ComponentProps<"input">, "value" | "defaultValue" | "id" | "disabled">) {
	const context = useSearch();
	const { inputRef } = context;

	return (
		<Input
			type="search"
			data-slot="search-field-input"
			className={cn(
				"h-auto w-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-foreground shadow-none outline-none placeholder:text-subtle-foreground focus-visible:ring-0 disabled:cursor-default disabled:opacity-100 dark:bg-transparent [&::-webkit-search-cancel-button]:appearance-none",
				context.variant === "compact" ? "text-[12.5px]/6 md:text-[12.5px]/6" : "text-[13px]/7 md:text-[13px]/7",
				className,
			)}
			{...props}
			id={context.id}
			ref={inputRef}
			value={context.value}
			disabled={context.disabled}
			aria-busy={context.status === "loading"}
			aria-invalid={context.status === "error" || undefined}
			aria-describedby={`${context.id}-message`}
			onChange={(event) => {
				onChange?.(event);

				if (!event.defaultPrevented) context.change(event.target.value);
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);

				if (!event.defaultPrevented && event.key === "Escape") {
					event.preventDefault();
					context.change("");
				}
			}}
		/>
	);
}

export function SearchFieldClear({
	children = <X size={14} className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
	onClick,
	className,
	...props
}: ComponentProps<"button">) {
	const context = useSearch();

	if (!context.value) return null;

	return (
		<Button
			aria-label="Clear search"
			data-slot="search-field-clear"
			variant="ghost"
			size="icon"
			className={cn(
				"grid shrink-0 cursor-pointer animate-in place-items-center border-0 bg-transparent p-0 text-subtle-foreground duration-180 ease-[cubic-bezier(0.16,1,0.3,1)] [transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_var(--ease-out-quint)] fade-in-0 zoom-in-80 hover:bg-accent hover:text-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid active:scale-[0.92] disabled:opacity-100 motion-reduce:animate-none motion-reduce:transition-none dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-3.5",
				context.variant === "compact" ? "size-6" : "size-7",
				context.variant === "pill" ? "rounded-full" : "rounded-lg",
				className,
			)}
			{...props}
			type="button"
			disabled={context.disabled || props.disabled}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) {
					context.change("");
					context.focus();
				}
			}}
		>
			{children}
		</Button>
	);
}

export function SearchFieldMessage({ children, className, ...props }: ComponentProps<"p">) {
	const context = useSearch();

	const copy = {
		idle: "",
		loading: "Searching…",
		empty: "No results found. Try another search.",
		error: "Search failed. Please try again.",
	};

	return (
		<p
			data-slot="search-field-message"
			className={cn(
				"m-0 text-xs/4",
				context.status === "error"
					? "text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]"
					: "text-subtle-foreground",
				className,
			)}
			{...props}
			id={`${context.id}-message`}
			role={context.status === "error" ? "alert" : "status"}
		>
			{children ?? copy[context.status]}
		</p>
	);
}

export function SearchFieldRecent({ className, ...props }: ComponentProps<"fieldset">) {
	const context = useSearch();

	if (context.value || context.status !== "idle") return null;

	return (
		<fieldset
			aria-label="Recent searches"
			data-slot="search-field-recent"
			className={cn("m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0", className)}
			{...props}
		/>
	);
}

export function SearchFieldRecentItem({
	value,
	children,
	onClick,
	className,
	...props
}: Omit<ComponentProps<"button">, "value"> & { value: string }) {
	const context = useSearch();

	return (
		<Button
			data-slot="search-field-recent-item"
			variant="secondary"
			size="sm"
			className={cn(
				"cursor-pointer gap-1.5 rounded-full border-0 bg-secondary px-3 py-0 text-[12.5px] font-medium text-muted-foreground [transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_var(--ease-out-quint)] hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))] hover:text-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid active:scale-[0.97] has-[>svg]:px-3 motion-reduce:transition-none",
				context.variant === "compact" ? "h-6" : "h-7",
				className,
			)}
			{...props}
			type="button"
			disabled={context.disabled || props.disabled}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) {
					context.change(value);
					context.focus();
				}
			}}
		>
			{children ?? value}
		</Button>
	);
}
