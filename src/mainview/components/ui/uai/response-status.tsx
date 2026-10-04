"use client";

import { cva } from "class-variance-authority";
import { Check, CircleAlert, CircleDashed, RotateCw, Square } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/uai-utils";

export const RESPONSE_STATUS_VARIANTS = ["inline", "pill", "bar"] as const;
export const RESPONSE_STATUSES = ["queued", "streaming", "stopped", "complete", "failed"] as const;
export type ResponseStatusVariant = (typeof RESPONSE_STATUS_VARIANTS)[number];
export type ResponseStatusValue = (typeof RESPONSE_STATUSES)[number];
export type ResponseStatusProps = ComponentProps<"div"> & {
  variant?: ResponseStatusVariant;
  status?: ResponseStatusValue;
};

type ActionKind = "stop" | "retry";
type ResponseStatusContextValue = {
  id: string;
  variant: ResponseStatusVariant;
  status: ResponseStatusValue;
  active: boolean;
  register: (kind: ActionKind, node: HTMLButtonElement | null) => void;
  setFocused: (kind: ActionKind | null) => void;
};

const ResponseStatusContext = createContext<ResponseStatusContextValue | null>(null);

function useResponseStatus(part: string) {
  const context = useContext(ResponseStatusContext);
  if (!context) throw new Error(`${part} must be used within ResponseStatus`);
  return context;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const dangerText = "text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]";
const defaultLabels: Record<ResponseStatusValue, string> = {
  queued: "Waiting to start…",
  streaming: "Generating response…",
  stopped: "Response stopped",
  complete: "Response complete",
  failed: "Response failed",
};

const responseStatusVariants = cva(
  "max-w-full min-w-0 flex-wrap items-center text-[13px]/[18px] text-foreground outline-none",
  {
    variants: {
      variant: {
        inline: "inline-flex min-h-7 gap-2",
        pill: "inline-flex min-h-8 gap-2 rounded-full bg-muted py-0.5 pr-0.5 pl-2.5 inset-ring-1 inset-ring-foreground/5",
        bar: "flex min-h-11 gap-2.5 rounded-[14px] border bg-card py-1.5 pr-1.5 pl-3.5",
      },
      failed: { true: "", false: "" },
    },
    compoundVariants: [
      {
        variant: "bar",
        failed: true,
        className: "border-[color-mix(in_oklab,var(--destructive)_45%,var(--border))]",
      },
    ],
  },
);

const responseStatusActionVariants = cva(
  "h-7 cursor-pointer gap-1.5 rounded-full px-3 text-[12.5px] text-foreground has-[>svg]:px-3 [transition:background-color_120ms_ease-out,transform_140ms_cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        inline:
          "bg-secondary hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]",
        pill: "bg-card hover:bg-accent",
        bar: "bg-secondary hover:bg-[color-mix(in_oklab,var(--secondary)_85%,var(--foreground))]",
      },
    },
  },
);

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ResponseStatus({
  variant = "inline",
  status = "queued",
  children,
  className,
  ...props
}: ResponseStatusProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const actions = useRef<Partial<Record<ActionKind, HTMLButtonElement>>>({});
  const focused = useRef<ActionKind | null>(null);
  const active = status === "queued" || status === "streaming";
  // When the focused Stop or Retry action unmounts after a status change, keep focus nearby.
  useIsomorphicLayoutEffect(() => {
    const kind = focused.current;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!kind || actions.current[kind]?.isConnected || !lost) return;
    focused.current = null;
    const next = actions.current[kind === "stop" ? "retry" : "stop"];
    if (next?.isConnected) {
      focused.current = kind === "stop" ? "retry" : "stop";
      next.focus();
    } else rootRef.current?.focus();
  }, [status]);
  return (
    <ResponseStatusContext.Provider
      value={{
        id,
        variant,
        status,
        active,
        register: (kind, node) => {
          if (node) actions.current[kind] = node;
          else delete actions.current[kind];
        },
        setFocused: (kind) => {
          focused.current = kind;
        },
      }}
    >
      <div
        tabIndex={-1}
        data-slot="response-status"
        {...props}
        ref={rootRef}
        aria-busy={active || undefined}
        data-variant={variant}
        data-status={status}
        className={cn(responseStatusVariants({ variant, failed: status === "failed" }), className)}
      >
        {children}
      </div>
    </ResponseStatusContext.Provider>
  );
}

function StreamingDots() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const dots = Array.from(ref.current?.children ?? []);
    const animations = dots.map((dot, index) =>
      dot.animate?.([{ opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }], {
        duration: 1100,
        delay: index * 160,
        iterations: Number.POSITIVE_INFINITY,
        easing: "ease-in-out",
      }),
    );
    return () => {
      for (const animation of animations) animation?.cancel();
    };
  }, []);
  return (
    <span ref={ref} className="inline-flex gap-0.75">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="size-1 rounded-full bg-current opacity-60" />
      ))}
    </span>
  );
}

export function ResponseStatusIndicator({ children, className, ...props }: ComponentProps<"span">) {
  const context = useResponseStatus("ResponseStatusIndicator");
  const icon = {
    queued: <CircleDashed size={14} className="size-3.5" />,
    streaming: <StreamingDots />,
    stopped: <Square size={11} className="size-[11px]" fill="currentColor" strokeWidth={0} />,
    complete: <Check size={14} className="size-3.5" />,
    failed: <CircleAlert size={14} className="size-3.5" />,
  }[context.status];
  const color = {
    queued: "text-subtle-foreground",
    streaming: "text-foreground",
    stopped: "text-subtle-foreground",
    complete: "text-success",
    failed: dangerText,
  }[context.status];
  return (
    <span
      aria-hidden="true"
      data-slot="response-status-indicator"
      className={cn(
        "grid size-[18px] flex-none place-items-center transition-[color] duration-200 ease-out",
        color,
        className,
      )}
      {...props}
    >
      {children ?? icon}
    </span>
  );
}

export function ResponseStatusLabel({ children, className, ...props }: ComponentProps<"span">) {
  const context = useResponseStatus("ResponseStatusLabel");
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-slot="response-status-label"
      className={cn(
        "min-w-0 font-medium transition-[color] duration-200 ease-out",
        context.active
          ? "shimmer-text"
          : context.status === "failed"
            ? dangerText
            : "text-foreground",
        className,
      )}
      {...props}
      id={`${context.id}-label`}
    >
      {children ?? defaultLabels[context.status]}
    </span>
  );
}

export function ResponseStatusDetail({ className, ...props }: ComponentProps<"span">) {
  useResponseStatus("ResponseStatusDetail");
  return (
    <span
      data-slot="response-status-detail"
      className={cn("min-w-0 text-[12px] text-subtle-foreground tabular-nums", className)}
      {...props}
    />
  );
}

export function ResponseStatusActions({ className, ...props }: ComponentProps<"div">) {
  useResponseStatus("ResponseStatusActions");
  return (
    <div
      data-slot="response-status-actions"
      className={cn("ml-auto flex items-center gap-1", className)}
      {...props}
    />
  );
}

function useAction(kind: ActionKind, part: string) {
  const context = useResponseStatus(part);
  return {
    context,
    ref: (node: HTMLButtonElement | null) => context.register(kind, node),
    onFocus: () => context.setFocused(kind),
    // A blur caused by unmounting keeps the record so the root can restore focus.
    onBlur: (node: HTMLButtonElement) =>
      queueMicrotask(() => {
        if (node.isConnected) context.setFocused(null);
      }),
  };
}

export function ResponseStatusStop({
  children,
  onFocus,
  onBlur,
  className,
  ...props
}: ComponentProps<"button">) {
  const { context, ref, onFocus: track, onBlur: untrack } = useAction("stop", "ResponseStatusStop");
  if (!context.active) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-describedby={`${context.id}-label`}
      data-slot="response-status-stop"
      className={cn(responseStatusActionVariants({ variant: context.variant }), className)}
      {...props}
      ref={ref}
      onFocus={(event) => {
        onFocus?.(event);
        track();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        untrack(event.currentTarget);
      }}
    >
      {children ?? (
        <>
          <Square className="size-2.25" fill="currentColor" strokeWidth={0} aria-hidden="true" />
          Stop
        </>
      )}
    </Button>
  );
}

export function ResponseStatusRetry({
  children,
  onFocus,
  onBlur,
  className,
  ...props
}: ComponentProps<"button">) {
  const {
    context,
    ref,
    onFocus: track,
    onBlur: untrack,
  } = useAction("retry", "ResponseStatusRetry");
  if (context.status !== "failed" && context.status !== "stopped") return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-describedby={`${context.id}-label`}
      data-slot="response-status-retry"
      className={cn(responseStatusActionVariants({ variant: context.variant }), className)}
      {...props}
      ref={ref}
      onFocus={(event) => {
        onFocus?.(event);
        track();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        untrack(event.currentTarget);
      }}
    >
      {children ?? (
        <>
          <RotateCw className="size-3" aria-hidden="true" />
          {context.status === "failed" ? "Retry" : "Regenerate"}
        </>
      )}
    </Button>
  );
}
