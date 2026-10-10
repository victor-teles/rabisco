import { memo, useMemo } from "react";
import { CheckCheck, ChevronRight, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateMedia,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import type { CommentsController } from "@/hooks/use-comments";
import type { Rect } from "@/lib/align";
import { commentThreads, threadView, type CommentThread } from "@/lib/comment-threads";
import { formatWhen } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Frame } from "../../../shared/types";

type CommentsListProps = {
	controller: CommentsController;
	frames: Frame[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Brings the thread's screen, or the area around its pin, into view */
	onReveal: (rects: Rect[]) => void;
};

/** Every thread in one place, open ones first; a click jumps to the pin and opens its thread */
export const CommentsList = memo(function CommentsList({
	controller,
	frames,
	open,
	onOpenChange,
	onReveal,
}: CommentsListProps) {
	const { comments, showResolved, setShowResolved } = controller;
	const threads = useMemo(() => commentThreads(comments, frames), [comments, frames]);

	const jump = (thread: CommentThread) => {
		const view = threadView(thread.comment, frames);

		if (!view.length) return;
		onOpenChange(false);
		onReveal(view);
		// After the list closes, so its focus handling can't dismiss the thread
		requestAnimationFrame(() => controller.open(thread.comment.id));
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Comments"
							className={cn("relative", open && "bg-accent")}
						>
							<MessagesSquare />
							{threads.open.length ? (
								<span className="absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground tabular-nums">
									{threads.open.length}
								</span>
							) : null}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">
					Comments <Kbd>⌥C</Kbd>
				</TooltipContent>
			</Tooltip>
			<PopoverContent
				side="top"
				sideOffset={10}
				className="flex w-80 flex-col gap-0 p-0 text-[13px]"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<div className="flex h-10 items-center gap-2 border-b px-3">
					<span className="font-medium">Comments</span>
					<span className="text-xs text-subtle-foreground tabular-nums">{threads.open.length} open</span>
					<Button
						variant="ghost"
						size="xs"
						className={cn("ml-auto", showResolved ? "bg-accent" : "text-muted-foreground")}
						aria-pressed={showResolved}
						disabled={!threads.resolved.length && !showResolved}
						onClick={() => setShowResolved(!showResolved)}
					>
						<CheckCheck />
						{showResolved ? "Hide resolved pins" : "Show resolved pins"}
					</Button>
				</div>
				<ScrollArea className="max-h-[min(60vh,28rem)]">
					{comments.length === 0 ? (
						<EmptyState variant="plain">
							<EmptyStateMedia>
								<MessagesSquare />
							</EmptyStateMedia>
							<EmptyStateContent>
								<EmptyStateHeader>
									<EmptyStateTitle>No comments yet</EmptyStateTitle>
									<EmptyStateDescription>
										Press <Kbd>C</Kbd> and click a screen to add one.
									</EmptyStateDescription>
								</EmptyStateHeader>
							</EmptyStateContent>
						</EmptyState>
					) : (
						<div className="flex flex-col p-1">
							{threads.open.length ? (
								threads.open.map((thread) => <ThreadRow key={thread.comment.id} thread={thread} onJump={jump} />)
							) : (
								<EmptyState variant="compact">
									<EmptyStateContent>
										<EmptyStateHeader>
											<EmptyStateTitle>Every thread is resolved.</EmptyStateTitle>
										</EmptyStateHeader>
									</EmptyStateContent>
								</EmptyState>
							)}
							{threads.resolved.length ? (
								<Collapsible className="mt-1 border-t pt-1">
									<CollapsibleTrigger className="group flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground">
										<ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
										Resolved
										<span className="tabular-nums">({threads.resolved.length})</span>
									</CollapsibleTrigger>
									<CollapsibleContent>
										{threads.resolved.map((thread) => (
											<ThreadRow key={thread.comment.id} thread={thread} onJump={jump} />
										))}
									</CollapsibleContent>
								</Collapsible>
							) : null}
						</div>
					)}
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
});

function ThreadRow({ thread, onJump }: { thread: CommentThread; onJump: (thread: CommentThread) => void }) {
	const { comment, number, screen } = thread;
	const replies = comment.replies?.length ?? 0;

	const meta = [
		screen ?? "Canvas",
		formatWhen(comment.createdAt),
		replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "",
	];

	return (
		<button
			type="button"
			onClick={() => onJump(thread)}
			className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
		>
			<span
				className={cn(
					"grid size-5 shrink-0 place-items-center rounded-full rounded-bl-none text-[10px] font-semibold tabular-nums",
					comment.resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
				)}
			>
				{number}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className={cn("line-clamp-2 break-words", comment.resolved && "text-muted-foreground")}>
					{comment.text}
				</span>
				<span className="truncate text-xs text-subtle-foreground">{meta.filter(Boolean).join(" · ")}</span>
			</span>
		</button>
	);
}
