"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  FileText,
  LoaderCircle,
  type LucideIcon,
  Search,
  Wrench,
} from "lucide-react";
import {
  Children,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/uai-utils";

export const THINKING_STATUSES = ["thinking", "complete", "error"] as const;

export type ThinkingStatus = (typeof THINKING_STATUSES)[number];

export type ThinkingProps = ComponentProps<"section"> & {
  status?: ThinkingStatus;
  defaultOpen?: boolean;
};

const statusDetails: Record<
  ThinkingStatus,
  { title: string; summary: string; label: string; icon: LucideIcon }
> = {
  thinking: {
    title: "Thinking",
    summary: "Working through the request.",
    label: "Working",
    icon: LoaderCircle,
  },
  complete: {
    title: "Work complete",
    summary: "The response is ready.",
    label: "Complete",
    icon: Check,
  },
  error: {
    title: "Work stopped",
    summary: "Something interrupted this run.",
    label: "Error",
    icon: AlertTriangle,
  },
};

type ThinkingContextValue = {
  status: ThinkingStatus;
  open: boolean;
};

const ThinkingContext = createContext<ThinkingContextValue | null>(null);

function useThinking(name: string) {
  const context = useContext(ThinkingContext);
  if (!context) throw new Error(`${name} must be used within Thinking`);
  return context;
}

export function Thinking({
  status = "thinking",
  defaultOpen = true,
  className,
  children,
  ...props
}: ThinkingProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <ThinkingContext.Provider value={{ status, open }}>
      <Collapsible asChild open={open} onOpenChange={setOpen}>
        <section
          data-slot="thinking"
          className={cn(
            "overflow-hidden rounded-[14px] border bg-card text-card-foreground transition-colors duration-150 motion-reduce:transition-none",
            status === "error" &&
              "border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))]",
            className,
          )}
          {...props}
          data-status={status}
          aria-busy={status === "thinking"}
        >
          {children}
        </section>
      </Collapsible>
    </ThinkingContext.Provider>
  );
}

export type ThinkingTriggerProps = Omit<ComponentProps<"button">, "title"> & {
  title?: ReactNode;
  summary?: ReactNode;
  duration?: ReactNode;
};

export function ThinkingTrigger({
  title,
  summary,
  duration,
  className,
  ...props
}: ThinkingTriggerProps) {
  const context = useThinking("ThinkingTrigger");
  const copy = statusDetails[context.status];
  const StatusIcon = copy.icon;

  return (
    <CollapsibleTrigger
      type="button"
      data-slot="thinking-trigger"
      className={cn(
        "group/trigger flex w-full items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors duration-120 ease-out hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg bg-muted",
          context.status === "complete" && "bg-success/14",
          context.status === "error" && "bg-destructive/14",
        )}
      >
        <StatusIcon
          strokeWidth={2}
          className={cn(
            "size-3.5",
            context.status === "thinking" &&
              "text-muted-foreground motion-safe:animate-spin motion-reduce:animate-none",
            context.status === "complete" && "text-success",
            context.status === "error" && "text-destructive",
          )}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px]/[18px] font-medium",
              context.status === "thinking" && "shimmer-text",
            )}
          >
            {title ?? copy.title}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-px text-[11.5px]/4 font-medium",
              context.status === "thinking" && "bg-muted text-muted-foreground",
              context.status === "complete" && "bg-success/14 text-success",
              context.status === "error" && "bg-destructive/14 text-destructive",
            )}
          >
            {copy.label}
          </span>
        </span>
        <span
          className="mt-0.5 block truncate text-[12.5px]/[18px] text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {summary ?? copy.summary}
        </span>
      </span>
      {duration ? (
        <span className="shrink-0 font-mono text-[11.5px]/4 tabular-nums text-subtle-foreground">
          {duration}
        </span>
      ) : null}
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-subtle-foreground transition-[transform,color] duration-180 ease-out-quint group-hover/trigger:text-muted-foreground motion-reduce:transition-none",
          context.open && "rotate-180",
        )}
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  );
}

function getEmptyLabel(status: ThinkingStatus) {
  if (status === "thinking") return "Waiting for the first activity…";
  if (status === "error") return "No activity details are available.";
  return "No activity was recorded.";
}

export type ThinkingContentProps = ComponentProps<"div"> & {
  emptyLabel?: ReactNode;
};

export function ThinkingContent({
  emptyLabel,
  children,
  className,
  ...props
}: ThinkingContentProps) {
  const context = useThinking("ThinkingContent");
  const hasActivity = Children.count(children) > 0;

  return (
    <CollapsibleContent
      data-slot="thinking-content"
      className={cn(
        "border-t px-3.5 pt-1 pb-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-240 ease-out-quint motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      {hasActivity ? (
        <div role="log" aria-live="polite" aria-relevant="additions text">
          <ol>{children}</ol>
        </div>
      ) : (
        <p className="py-3 text-[13px]/[18px] text-subtle-foreground">
          {emptyLabel ?? getEmptyLabel(context.status)}
        </p>
      )}
    </CollapsibleContent>
  );
}

type ThinkingActivityBaseProps = Omit<ComponentProps<"li">, "children"> & {
  children: ReactNode;
  elapsed?: ReactNode;
};

export type ThinkingActivityProps = ThinkingActivityBaseProps &
  (
    | { type: "progress"; tool?: never; path?: never; query?: never }
    | { type: "tool"; tool: ReactNode; path?: never; query?: never }
    | { type: "file"; path: ReactNode; tool?: never; query?: never }
    | { type: "search"; query: ReactNode; tool?: never; path?: never }
  );

const activityDetails: Record<ThinkingActivityProps["type"], { label: string; icon: LucideIcon }> =
  {
    progress: { label: "Update", icon: Circle },
    tool: { label: "Tool", icon: Wrench },
    file: { label: "File", icon: FileText },
    search: { label: "Search", icon: Search },
  };

export function ThinkingActivity(props: ThinkingActivityProps) {
  const { type, children, elapsed, className, ...itemProps } = props;
  const details = activityDetails[type];
  const ActivityIcon = details.icon;
  const evidence =
    type === "tool"
      ? props.tool
      : type === "file"
        ? props.path
        : type === "search"
          ? props.query
          : null;
  const { tool: _tool, path: _path, query: _query, ...domProps } = itemProps;

  return (
    <li
      data-slot="thinking-activity"
      className={cn(
        "group grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] gap-x-2.5 py-2.5",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-240 ease-out-quint fill-mode-backwards motion-reduce:animate-none",
        "nth-2:[animation-delay:40ms] nth-3:[animation-delay:80ms] nth-4:[animation-delay:120ms] nth-5:[animation-delay:160ms] nth-6:[animation-delay:200ms]",
        className,
      )}
      {...domProps}
    >
      <span className="relative grid size-6 place-items-center text-subtle-foreground after:absolute after:top-6 after:bottom-[-10px] after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border group-last:after:hidden">
        <ActivityIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2 pt-[3px]">
          <span className="min-w-0 text-[13px]/[18px] font-medium text-card-foreground">
            {children}
          </span>
          <span className="shrink-0 text-[11.5px]/4 text-subtle-foreground">{details.label}</span>
        </span>
        {evidence ? (
          <span className="mt-1.5 inline-block max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px]/4 break-all text-muted-foreground">
            {evidence}
          </span>
        ) : null}
      </span>
      {elapsed ? (
        <span className="pt-1 pl-2 font-mono text-[11.5px]/4 tabular-nums text-subtle-foreground">
          {elapsed}
        </span>
      ) : null}
    </li>
  );
}
