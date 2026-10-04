"use client";

import { cva } from "class-variance-authority";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/uai-utils";

export const TOOL_CALL_VARIANTS = ["card", "inline", "compact"] as const;
export const TOOL_CALL_STATUSES = ["queued", "running", "success", "error"] as const;
export type ToolCallVariant = (typeof TOOL_CALL_VARIANTS)[number];
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];
export type ToolCallProps = ComponentProps<"div"> & {
  variant?: ToolCallVariant;
  status?: ToolCallStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ToolCallContextValue = {
  id: string;
  variant: ToolCallVariant;
  status: ToolCallStatus;
  open: boolean;
};

const ToolCallContext = createContext<ToolCallContextValue | null>(null);

function useToolCall(part: string) {
  const context = useContext(ToolCallContext);
  if (!context) throw new Error(`${part} must be used within ToolCall`);
  return context;
}

const dangerText = "text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]";
const statusDetails: Record<
  ToolCallStatus,
  { label: string; icon: LucideIcon; color: string; tint: string }
> = {
  queued: {
    label: "Queued",
    icon: CircleDashed,
    color: "text-subtle-foreground",
    tint: "bg-transparent shadow-[inset_0_0_0_1px_var(--border)]",
  },
  running: {
    label: "Running",
    icon: LoaderCircle,
    color: "text-foreground",
    tint: "bg-muted",
  },
  success: {
    label: "Succeeded",
    icon: Check,
    color: "text-success",
    tint: "bg-success/14",
  },
  error: {
    label: "Failed",
    icon: CircleAlert,
    color: dangerText,
    tint: "bg-destructive/14",
  },
};

const toolCallVariants = cva("min-w-0 overflow-hidden text-[13px]/[18px] text-foreground", {
  variants: {
    variant: {
      card: "rounded-[14px] border bg-card",
      inline: "rounded-[14px] border-0 bg-transparent",
      compact: "rounded-xl border bg-card",
    },
    error: { true: "", false: "" },
  },
  compoundVariants: [
    {
      variant: ["card", "compact"],
      error: true,
      className: "border-[color-mix(in_oklab,var(--destructive)_45%,var(--border))]",
    },
  ],
});

export function ToolCall({
  variant = "card",
  status = "queued",
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: ToolCallProps) {
  const id = useId();
  const [internal, setInternal] = useState(defaultOpen);
  const visible = open ?? internal;
  return (
    <ToolCallContext.Provider value={{ id, variant, status, open: visible }}>
      <Collapsible
        data-slot="tool-call"
        className={cn(toolCallVariants({ variant, error: status === "error" }), className)}
        {...props}
        open={visible}
        onOpenChange={(next) => {
          if (open === undefined) setInternal(next);
          onOpenChange?.(next);
        }}
        aria-busy={status === "running" || undefined}
        data-variant={variant}
        data-status={status}
      >
        {children}
      </Collapsible>
    </ToolCallContext.Provider>
  );
}

export function ToolCallHeader({ className, ...props }: ComponentProps<"div">) {
  const context = useToolCall("ToolCallHeader");
  return (
    <div
      data-slot="tool-call-header"
      className={cn(
        "flex min-w-0 items-center gap-2",
        context.variant === "inline" ? "pr-1" : context.variant === "compact" ? "pr-2" : "pr-3",
        className,
      )}
      {...props}
    />
  );
}

function StatusIcon({ status, size }: { status: ToolCallStatus; size: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (status !== "running") return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const animation = ref.current?.animate?.(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 900, iterations: Number.POSITIVE_INFINITY },
    );
    return () => animation?.cancel();
  }, [status]);
  const { icon: Icon, color } = statusDetails[status];
  return (
    <Icon
      ref={ref}
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      className={cn("flex-none", color)}
    />
  );
}

export function ToolCallTrigger({ children, className, ...props }: ComponentProps<"button">) {
  const context = useToolCall("ToolCallTrigger");
  const compact = context.variant === "compact";
  const inline = context.variant === "inline";
  return (
    <CollapsibleTrigger
      data-slot="tool-call-trigger"
      type="button"
      className={cn(
        "group/tool-call-trigger flex min-w-0 flex-auto cursor-pointer items-center gap-2 border-0 bg-transparent text-left font-[inherit] text-inherit outline-none transition-[background-color] duration-120 ease-out hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        compact ? "min-h-[34px]" : "min-h-11",
        inline ? "rounded-[10px] px-1.5" : compact ? "rounded-none px-2" : "rounded-none px-3",
        className,
      )}
      {...props}
      aria-controls={`${context.id}-content`}
    >
      <span
        className={cn(
          "grid flex-none place-items-center transition-[background-color] duration-200 ease-out",
          compact ? "size-5 rounded-[6px]" : "size-6 rounded-lg",
          statusDetails[context.status].tint,
        )}
      >
        <StatusIcon status={context.status} size={compact ? 12 : 13} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">{children}</span>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className={cn(
          "size-3.5",
          "flex-none text-subtle-foreground [transition:rotate_180ms_cubic-bezier(0.23,1,0.32,1),color_120ms_ease-out] group-hover/tool-call-trigger:text-foreground group-data-[state=open]/tool-call-trigger:rotate-180",
        )}
      />
    </CollapsibleTrigger>
  );
}

export function ToolCallName({ className, ...props }: ComponentProps<"span">) {
  useToolCall("ToolCallName");
  return (
    <span
      data-slot="tool-call-name"
      className={cn("flex-none font-mono text-[12px] font-medium tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function ToolCallSummary({ className, ...props }: ComponentProps<"span">) {
  useToolCall("ToolCallSummary");
  return (
    <span
      data-slot="tool-call-summary"
      className={cn("min-w-0 truncate text-[12.5px] text-muted-foreground", className)}
      {...props}
    />
  );
}

export function ToolCallStatus({ children, className, ...props }: ComponentProps<"span">) {
  const context = useToolCall("ToolCallStatus");
  const details = statusDetails[context.status];
  const settled = context.status === "success" || context.status === "error";
  return (
    <span
      data-slot="tool-call-status"
      role="status"
      className={cn(
        "flex-none rounded-full py-0.5 text-[11.5px]/4 font-medium whitespace-nowrap tabular-nums",
        settled ? cn("px-2", details.tint, details.color) : "px-0",
        context.status === "queued" && "text-subtle-foreground",
        context.status === "running" && "shimmer-text",
        className,
      )}
      {...props}
    >
      {children ?? details.label}
    </span>
  );
}

export function ToolCallContent({ className, ...props }: ComponentProps<"div">) {
  const context = useToolCall("ToolCallContent");
  const inline = context.variant === "inline";
  return (
    <CollapsibleContent
      data-slot="tool-call-content"
      className={cn(
        "animate-in gap-2.5 fade-in-0 slide-in-from-top-1 duration-240 ease-out-quint motion-reduce:animate-none",
        context.open ? "grid" : "hidden",
        inline
          ? "border-t-0 pt-1.5 pr-0 pb-1 pl-[38px]"
          : cn("border-t", context.variant === "compact" ? "p-2" : "p-3"),
        className,
      )}
      {...props}
      id={`${context.id}-content`}
      forceMount
      hidden={!context.open}
    />
  );
}

export type ToolCallPayloadProps = ComponentProps<"div"> & {
  /** Heading shown above the payload. */
  label?: ReactNode;
};

function Payload({
  part,
  slot,
  defaultLabel,
  label,
  className,
  children,
  ...props
}: ToolCallPayloadProps & { part: string; slot: string; defaultLabel: string }) {
  const context = useToolCall(part);
  const labelId = `${context.id}-${defaultLabel.toLowerCase()}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group keeps the payload heading lightweight inside chat logs.
    <div
      data-slot={slot}
      role="group"
      aria-labelledby={labelId}
      className={cn("grid gap-1", className)}
      {...props}
    >
      <span id={labelId} className="text-[11.5px]/4 text-subtle-foreground">
        {label ?? defaultLabel}
      </span>
      <pre
        className={cn(
          "m-0 max-h-[220px] overflow-auto px-2.5 py-2 font-mono text-[11.5px]/[18px] whitespace-pre-wrap text-[color-mix(in_oklab,var(--foreground)_88%,var(--muted-foreground))] wrap-anywhere",
          context.variant === "compact" ? "rounded-lg" : "rounded-[10px]",
          context.variant === "inline" ? "bg-muted" : "bg-background",
        )}
      >
        {children}
      </pre>
    </div>
  );
}

export function ToolCallInput(props: ToolCallPayloadProps) {
  return <Payload {...props} part="ToolCallInput" slot="tool-call-input" defaultLabel="Input" />;
}

export function ToolCallOutput(props: ToolCallPayloadProps) {
  const context = useToolCall("ToolCallOutput");
  if (context.status === "queued" || context.status === "error") return null;
  return <Payload {...props} part="ToolCallOutput" slot="tool-call-output" defaultLabel="Output" />;
}

export function ToolCallError({ children, className, ...props }: ComponentProps<"p">) {
  const context = useToolCall("ToolCallError");
  if (context.status !== "error") return null;
  return (
    <p
      data-slot="tool-call-error"
      className={cn(
        "m-0 flex items-start gap-2 rounded-[10px] bg-destructive/10 px-2.5 py-2 text-[12.5px]",
        dangerText,
        className,
      )}
      {...props}
    >
      <CircleAlert size={14} aria-hidden="true" className="mt-0.5 flex-none size-3.5" />
      <span>{children ?? "The tool returned an error."}</span>
    </p>
  );
}
