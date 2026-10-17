"use client";

import { cva } from "class-variance-authority";
import { Upload } from "lucide-react";
import { type ComponentProps, createContext, useContext, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/uai-utils";

export const FILE_UPLOAD_VARIANTS = ["dropzone", "inline", "compact"] as const;

export type FileUploadVariant = (typeof FILE_UPLOAD_VARIANTS)[number];

export type FileUploadRejection = { file: File; reason: string };

export type FileUploadProps = ComponentProps<"div"> & {
	variant?: FileUploadVariant;
	accept?: string;
	maxSize?: number;
	maxFiles?: number;
	fileCount?: number;
	disabled?: boolean;
	multiple?: boolean;
	onFilesAccepted?: (files: File[]) => void;
	onFilesRejected?: (files: FileUploadRejection[]) => void;
};

type UploadContext = {
	id: string;
	variant: FileUploadVariant;
	disabled: boolean;
	accept?: string;
	multiple: boolean;
	inputRef: React.RefObject<HTMLInputElement | null>;
	receive: (files: File[]) => void;
};

const Context = createContext<UploadContext | null>(null);

const buttonBase =
	"cursor-pointer rounded-full border-0 py-0 font-medium [transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_cubic-bezier(0.23,1,0.32,1)] not-disabled:active:scale-[0.97] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const raisedButton =
	"bg-secondary text-foreground hover:bg-secondary not-disabled:hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]";

const actionClass = "h-6.5 justify-self-start px-2.5 text-[12px] has-[>svg]:px-2.5";

const dangerText = "text-destructive-ink";

function useUpload() {
	const context = useContext(Context);

	if (!context) throw new Error("FileUpload children must be used within FileUpload");

	return context;
}

function acceptsFile(file: File, accept?: string) {
	if (!accept) return true;

	return accept.split(",").some((entry) => {
		const rule = entry.trim().toLowerCase();

		if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);

		if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));

		return file.type.toLowerCase() === rule;
	});
}

export function FileUpload({
	variant = "dropzone",
	accept,
	maxSize = Infinity,
	maxFiles = Infinity,
	fileCount = 0,
	disabled = false,
	multiple = true,
	onFilesAccepted,
	onFilesRejected,
	children,
	className,
	...props
}: FileUploadProps) {
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [errors, setErrors] = useState<FileUploadRejection[]>([]);

	const receive = (files: File[]) => {
		if (disabled) return;
		const accepted: File[] = [];
		const rejected: FileUploadRejection[] = [];

		for (const file of files) {
			let reason = "";

			if (!acceptsFile(file, accept)) reason = "File type is not supported.";
			else if (file.size > maxSize) reason = "File exceeds the size limit.";
			else if (accepted.length + fileCount >= Math.min(maxFiles, multiple ? Infinity : 1))
				reason = "File count limit reached.";

			if (reason) rejected.push({ file, reason });
			else accepted.push(file);
		}

		setErrors(rejected);

		if (accepted.length) onFilesAccepted?.(accepted);

		if (rejected.length) onFilesRejected?.(rejected);
	};

	return (
		<Context.Provider value={{ id, variant, accept, multiple, disabled, inputRef, receive }}>
			<div
				data-slot="file-upload"
				className={cn("grid min-w-0 gap-2.5 text-[13px]/[18px] text-foreground", className)}
				{...props}
				data-variant={variant}
			>
				{children}
				<div role="alert" id={`${id}-errors`} className="grid gap-1">
					{errors.map((error) => (
						<p
							key={`${error.file.name}-${error.file.size}-${error.file.lastModified}`}
							className={cn(
								"m-0 animate-in text-xs/4 wrap-anywhere duration-200 ease-out-quint fade-in-0 slide-in-from-top-1 motion-reduce:animate-none",
								dangerText,
							)}
						>
							{error.file.name}: {error.reason}
						</p>
					))}
				</div>
			</div>
		</Context.Provider>
	);
}

const dropzoneVariants = cva(
	"group m-0 flex min-w-0 flex-wrap items-center border border-border-strong [transition:border-color_120ms_ease-out,background-color_120ms_ease-out] not-disabled:hover:border-[color-mix(in_oklab,var(--border-strong)_60%,var(--foreground))] data-dragging:border-primary data-dragging:bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))] motion-reduce:transition-none",
	{
		variants: {
			variant: {
				dropzone: "flex-col justify-center gap-2.5 rounded-[14px] border-dashed bg-card px-4 py-7",
				inline: "flex-row justify-start gap-3 rounded-[14px] border-solid bg-card py-3 pr-3 pl-3.5",
				compact: "flex-row justify-start gap-3 rounded-xl border-solid bg-background py-2 pr-2 pl-2.5",
			},
		},
	},
);

export function FileUploadDropzone({
	children,
	className,
	onDragOver,
	onDragLeave,
	onDrop,
	...props
}: ComponentProps<"fieldset">) {
	const context = useUpload();
	const [dragging, setDragging] = useState(false);

	return (
		<fieldset
			data-slot="file-upload-dropzone"
			className={cn(dropzoneVariants({ variant: context.variant }), context.disabled && "opacity-55", className)}
			{...props}
			aria-label="Upload files"
			data-dragging={dragging || undefined}
			onDragOver={(event) => {
				onDragOver?.(event);
				event.preventDefault();

				if (!context.disabled) setDragging(true);
			}}
			onDragLeave={(event) => {
				onDragLeave?.(event);

				if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
					setDragging(false);
			}}
			onDrop={(event) => {
				onDrop?.(event);
				const cancelled = event.defaultPrevented;
				event.preventDefault();
				setDragging(false);

				if (!cancelled) context.receive(Array.from(event.dataTransfer.files));
			}}
		>
			<span
				aria-hidden="true"
				className={cn(
					"grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [transition:color_120ms_ease-out,translate_180ms_cubic-bezier(0.23,1,0.32,1)] group-data-dragging:-translate-y-0.5 group-data-dragging:text-primary-ink motion-reduce:transition-none",
					context.variant === "compact" ? "size-7" : "size-9",
				)}
			>
				<Upload size={context.variant === "compact" ? 14 : 16} strokeWidth={1.75} />
			</span>
			{children}
		</fieldset>
	);
}

export function FileUploadInput({
	onChange,
	className,
	...props
}: Omit<ComponentProps<"input">, "type" | "multiple" | "accept" | "disabled" | "id">) {
	const context = useUpload();

	const { inputRef } = context;

	return (
		<input
			aria-label="Choose files"
			data-slot="file-upload-input"
			className={cn("sr-only", className)}
			{...props}
			type="file"
			id={context.id}
			ref={inputRef}
			tabIndex={-1}
			accept={context.accept}
			multiple={context.multiple}
			disabled={context.disabled}
			aria-describedby={`${context.id}-errors`}
			onChange={(event) => {
				onChange?.(event);

				if (!event.defaultPrevented) context.receive(Array.from(event.target.files ?? []));
				event.target.value = "";
			}}
		/>
	);
}

export function FileUploadTrigger({
	children = "Choose files",
	onClick,
	className,
	...props
}: ComponentProps<"button">) {
	const context = useUpload();

	return (
		<Button
			data-slot="file-upload-trigger"
			variant="secondary"
			className={cn(
				buttonBase,
				raisedButton,
				"shrink-0 px-3.5 text-[12.5px] has-[>svg]:px-3.5",
				context.variant === "compact" ? "h-7" : "h-7.5",
				className,
			)}
			{...props}
			type="button"
			disabled={context.disabled || props.disabled}
			onClick={(event) => {
				onClick?.(event);

				if (!event.defaultPrevented) context.inputRef.current?.click();
			}}
		>
			{children}
		</Button>
	);
}

export function FileUploadList({ className, ...props }: ComponentProps<"ul">) {
	return <ul data-slot="file-upload-list" className={cn("m-0 grid list-none gap-1.5 p-0", className)} {...props} />;
}

type FileItemContext = {
	status: "uploading" | "complete" | "error";
	progress: number;
	disabled: boolean;
};

const ItemContext = createContext<FileItemContext | null>(null);

function useItem() {
	const context = useContext(ItemContext);

	if (!context) throw new Error("FileUpload item children must be used within FileUploadItem");

	return context;
}

const statusTextClass: Record<FileItemContext["status"], string> = {
	uploading: "shimmer-text motion-reduce:text-subtle-foreground",
	complete: "text-success-ink",
	error: dangerText,
};

export function FileUploadItem({
	status = "uploading",
	progress = 0,
	children,
	className,
	...props
}: ComponentProps<"li"> & { status?: FileItemContext["status"]; progress?: number }) {
	const context = useUpload();

	return (
		<ItemContext.Provider
			value={{
				status,
				progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
				disabled: context.disabled,
			}}
		>
			<li
				data-slot="file-upload-item"
				className={cn(
					"flex animate-in flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[10px] duration-240 ease-out-quint wrap-anywhere fade-in-0 slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none *:first:order-[-1] *:first:min-w-0 *:first:flex-auto",
					context.variant === "compact" ? "py-1.5 pr-1.5 pl-3" : "py-2 pr-2 pl-3",
					status === "error"
						? "bg-[color-mix(in_oklab,var(--destructive)_8%,var(--card))] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_28%,transparent)]"
						: "bg-card shadow-[inset_0_0_0_1px_var(--border)]",
					className,
				)}
				{...props}
				aria-busy={status === "uploading"}
				data-status={status}
			>
				{children}
				<span role="status" className={cn("order-[-1] text-[11.5px]/4", statusTextClass[status])}>
					{status === "uploading" ? "Uploading…" : status === "complete" ? "Upload complete" : "Upload failed"}
				</span>
			</li>
		</ItemContext.Provider>
	);
}

export function FileUploadProgress({ className, ...props }: Omit<ComponentProps<typeof Progress>, "value" | "max">) {
	const context = useItem();

	if (context.status !== "uploading") return null;

	return (
		<Progress
			aria-label="Upload progress"
			data-slot="file-upload-progress"
			className={cn(
				"order-10 block h-1 w-full basis-full overflow-hidden rounded-full border-0 bg-foreground/10 [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-indicator]]:bg-foreground [&_[data-slot=progress-indicator]]:[transition:transform_240ms_cubic-bezier(0.23,1,0.32,1)] motion-reduce:[&_[data-slot=progress-indicator]]:transition-none",
				className,
			)}
			{...props}
			max={100}
			value={context.progress}
			// The shadcn Progress keeps `value` for the indicator only, so expose it to assistive tech here.
			aria-valuenow={context.progress}
			aria-valuetext={`${Math.round(context.progress)}%`}
		/>
	);
}

export function FileUploadRetry({ children = "Retry upload", className, ...props }: ComponentProps<"button">) {
	const context = useItem();

	if (context.status !== "error") return null;

	return (
		<Button
			data-slot="file-upload-retry"
			variant="secondary"
			className={cn(buttonBase, raisedButton, actionClass, className)}
			{...props}
			type="button"
			disabled={context.disabled || props.disabled}
		>
			{children}
		</Button>
	);
}

export function FileUploadRemove({ children = "Remove file", className, ...props }: ComponentProps<"button">) {
	const context = useItem();

	return (
		<Button
			data-slot="file-upload-remove"
			variant="ghost"
			className={cn(
				buttonBase,
				"bg-transparent text-muted-foreground hover:bg-transparent hover:text-muted-foreground not-disabled:hover:bg-accent not-disabled:hover:text-foreground dark:hover:bg-transparent",
				actionClass,
				className,
			)}
			{...props}
			type="button"
			disabled={context.disabled || props.disabled}
		>
			{children}
		</Button>
	);
}
