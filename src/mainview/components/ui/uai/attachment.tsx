"use client";

import { cva } from "class-variance-authority";
import {
	CircleAlert,
	File,
	FileArchive,
	FileAudio,
	FileCode,
	FileSpreadsheet,
	FileText,
	FileVideo,
	ImageIcon,
	type LucideIcon,
	RotateCw,
	X,
} from "lucide-react";
import { type ComponentProps, createContext, createElement, useContext, useId } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/uai-utils";

export const ATTACHMENT_VARIANTS = ["row", "card", "chip"] as const;

export type AttachmentVariant = (typeof ATTACHMENT_VARIANTS)[number];

export type AttachmentStatus = "uploading" | "ready" | "error";

export type AttachmentProps = ComponentProps<"div"> & {
	variant?: AttachmentVariant;
	status?: AttachmentStatus;
	/** Upload progress from 0 to 100. Omit for indeterminate progress. */
	progress?: number;
	/** MIME type, used to choose the default file icon. */
	mimeType?: string;
};

type AttachmentContextValue = {
	id: string;
	variant: AttachmentVariant;
	status: AttachmentStatus;
	progress?: number;
	mimeType: string;
};

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

function useAttachment(part: string) {
	const context = useContext(AttachmentContext);

	if (!context) throw new Error(`${part} must be used within Attachment`);

	return context;
}

function iconFor(mimeType: string): LucideIcon {
	if (mimeType.startsWith("image/")) return ImageIcon;

	if (mimeType.startsWith("video/")) return FileVideo;

	if (mimeType.startsWith("audio/")) return FileAudio;

	if (/zip|tar|gzip|compressed/.test(mimeType)) return FileArchive;

	if (/csv|spreadsheet|excel/.test(mimeType)) return FileSpreadsheet;

	if (/json|javascript|typescript|xml|html|x-/.test(mimeType)) return FileCode;

	if (mimeType.startsWith("text/") || /pdf|document|word/.test(mimeType)) return FileText;

	return File;
}

const dangerText = "text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]";

const attachmentVariants = cva(
	"relative min-w-0 border bg-card text-[13px]/[18px] text-card-foreground animate-in fade-in-0 zoom-in-98 duration-200 ease-out-quint [transition:border-color_120ms_ease-out,background-color_120ms_ease-out] data-[status=ready]:hover:border-border-strong motion-reduce:animate-none motion-reduce:transition-none",
	{
		variants: {
			variant: {
				row: "flex items-center gap-2.5 rounded-xl p-2",
				card: "grid w-44 grid-rows-[auto_auto] gap-2 rounded-[14px] p-1",
				chip: "inline-flex min-h-[30px] max-w-[260px] items-center gap-1.5 rounded-full py-0.75 pr-0.75 pl-1",
			},
		},
	},
);

export function Attachment({
	variant = "row",
	status = "ready",
	progress,
	mimeType = "",
	children,
	className,
	...props
}: AttachmentProps) {
	const id = useId();
	const clamped = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));

	return (
		<AttachmentContext.Provider value={{ id, variant, status, progress: clamped, mimeType }}>
			{/* biome-ignore lint/a11y/useSemanticElements: an attachment groups its name, status, and actions; fieldset is for form controls. */}
			<div
				role="group"
				aria-labelledby={`${id}-name`}
				data-slot="attachment"
				className={cn(
					attachmentVariants({ variant }),
					status === "error" && "border-[color-mix(in_oklab,var(--destructive)_45%,var(--border))]",
					className,
				)}
				{...props}
				aria-busy={status === "uploading" || undefined}
				data-variant={variant}
				data-status={status}
			>
				{children}
			</div>
		</AttachmentContext.Provider>
	);
}

export type AttachmentThumbnailProps = Omit<ComponentProps<"span">, "children"> & {
	/** Image thumbnail URL. Without it, a file-type icon is shown. */
	src?: string;
	alt?: string;
};

export function AttachmentThumbnail({ src, alt = "", className, ...props }: AttachmentThumbnailProps) {
	const context = useAttachment("AttachmentThumbnail");
	const icon = context.status === "error" ? CircleAlert : iconFor(context.mimeType);
	const chip = context.variant === "chip";
	const card = context.variant === "card";

	return (
		<span
			data-slot="attachment-thumbnail"
			className={cn(
				"relative grid flex-none place-items-center overflow-hidden",
				card && "h-24 w-full rounded-[10px]",
				chip && "size-5.5 rounded-full shadow-[0_0_0_1px_oklch(1_0_0/0.08)]",
				context.variant === "row" && "size-9 rounded-lg",
				context.status === "error" ? cn("bg-destructive/14", dangerText) : "bg-muted text-muted-foreground",
				className,
			)}
			{...props}
		>
			{src && context.status !== "error" ? (
				// biome-ignore lint/performance/noImgElement: registry components stay framework-neutral.
				<img
					src={src}
					alt={alt}
					className={cn(
						"size-full object-cover transition-opacity duration-200 ease-[ease-out] motion-reduce:transition-none",
						context.status === "uploading" ? "opacity-60" : "opacity-100",
					)}
				/>
			) : (
				createElement(icon, { size: card ? 20 : chip ? 12 : 16, strokeWidth: 1.75, "aria-hidden": "true" })
			)}
		</span>
	);
}

export function AttachmentDetails({ className, ...props }: ComponentProps<"div">) {
	const context = useAttachment("AttachmentDetails");

	return (
		<div
			data-slot="attachment-details"
			className={cn(
				"grid min-w-0 flex-auto",
				context.variant === "chip" ? "gap-0 px-0.5" : "gap-px",
				context.variant === "card" && "px-1.5 pb-1.5",
				className,
			)}
			{...props}
		/>
	);
}

export function AttachmentName({ className, ...props }: ComponentProps<"span">) {
	const context = useAttachment("AttachmentName");

	return (
		<span
			data-slot="attachment-name"
			className={cn(
				"truncate font-medium",
				context.variant === "chip" ? "text-[12.5px]/[18px]" : "text-[13px]/[18px]",
				className,
			)}
			{...props}
			id={`${context.id}-name`}
		/>
	);
}

export function AttachmentMeta({ className, ...props }: ComponentProps<"span">) {
	const context = useAttachment("AttachmentMeta");

	if (context.status === "error") return null;

	return (
		<span
			data-slot="attachment-meta"
			className={cn(
				"truncate text-subtle-foreground tabular-nums",
				context.variant === "chip" ? "text-[11px]/4" : "text-[11.5px]/4",
				context.status === "uploading" && "shimmer-text motion-reduce:text-subtle-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function AttachmentProgress({ className, ...props }: ComponentProps<"div">) {
	const context = useAttachment("AttachmentProgress");

	if (context.status !== "uploading") return null;
	const value = context.progress;

	return (
		<Progress
			aria-labelledby={`${context.id}-name`}
			aria-valuenow={value}
			aria-valuetext={value === undefined ? "Uploading" : `${Math.round(value)}% uploaded`}
			data-slot="attachment-progress"
			data-indeterminate={value === undefined || undefined}
			value={value ?? null}
			className={cn(
				"mt-1.25 h-0.75 bg-muted",
				"*:data-[slot=progress-indicator]:rounded-full *:data-[slot=progress-indicator]:bg-foreground *:data-[slot=progress-indicator]:transition-transform *:data-[slot=progress-indicator]:duration-240 *:data-[slot=progress-indicator]:ease-out-quint motion-reduce:*:data-[slot=progress-indicator]:transition-none",
				"data-indeterminate:*:data-[slot=progress-indicator]:w-[35%] data-indeterminate:*:data-[slot=progress-indicator]:animate-[indeterminate_1.2s_cubic-bezier(0.65,0,0.35,1)_infinite] data-indeterminate:*:data-[slot=progress-indicator]:opacity-60",
				"motion-reduce:data-indeterminate:*:data-[slot=progress-indicator]:animate-none motion-reduce:data-indeterminate:*:data-[slot=progress-indicator]:transform-none!",
				className,
			)}
			{...props}
		/>
	);
}

export function AttachmentError({ className, children, ...props }: ComponentProps<"span">) {
	const context = useAttachment("AttachmentError");

	if (context.status !== "error") return null;

	return (
		<span
			role="alert"
			data-slot="attachment-error"
			className={cn(
				"truncate",
				dangerText,
				context.variant === "chip" ? "text-[11px]/4" : "text-[11.5px]/4",
				className,
			)}
			{...props}
		>
			{children ?? "Upload failed"}
		</span>
	);
}

function controlClass(variant: AttachmentVariant, right: string) {
	return cn(
		"flex-none cursor-pointer p-0 text-subtle-foreground [transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_cubic-bezier(0.23,1,0.32,1)] hover:bg-accent hover:text-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-accent",
		variant === "chip"
			? "size-5.5 rounded-full [&_svg:not([class*='size-'])]:size-3"
			: "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
		variant === "card" &&
			cn(
				"absolute top-2.5 size-6 rounded-full bg-card/82 text-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)] backdrop-blur-[8px]",
				right,
			),
	);
}

export function AttachmentRetry({ children, className, ...props }: ComponentProps<"button">) {
	const context = useAttachment("AttachmentRetry");

	if (context.status !== "error") return null;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label="Retry upload"
			title="Retry upload"
			aria-describedby={`${context.id}-name`}
			data-slot="attachment-retry"
			className={cn(controlClass(context.variant, "right-[38px]"), className)}
			{...props}
		>
			{children ?? <RotateCw size={context.variant === "chip" ? 12 : 14} aria-hidden="true" />}
		</Button>
	);
}

export function AttachmentRemove({ children, className, ...props }: ComponentProps<"button">) {
	const context = useAttachment("AttachmentRemove");
	const label = context.status === "uploading" ? "Cancel upload" : "Remove attachment";

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			aria-describedby={`${context.id}-name`}
			data-slot="attachment-remove"
			className={cn(controlClass(context.variant, "right-2.5"), className)}
			{...props}
		>
			{children ?? <X size={context.variant === "chip" ? 12 : 14} aria-hidden="true" />}
		</Button>
	);
}
