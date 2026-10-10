import { memo, useRef, useState } from "react";
import { CircleCheck, Pencil, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { CommentsController } from "@/hooks/use-comments";
import type { ChatComment } from "@/lib/comment-threads";
import { formatWhen } from "@/lib/time";
import { cn } from "@/lib/utils";
import { pinPosition } from "../../../shared/comments";
import type { CanvasComment, Frame } from "../../../shared/types";

export { frameAtPoint, pinAt, pinPosition, type PinPlacement } from "../../../shared/comments";

/** Screen pixels the pointer travels before a press on a pin becomes a drag */
const DRAG_THRESHOLD = 3;

type Point = { x: number; y: number };

type CommentsLayerProps = {
	controller: CommentsController;
	frames: Frame[];
	/** Read when a drag moves, so zooming doesn't re-render the pins */
	getZoom: () => number;
	/** Puts the thread in the chat composer, to send from there */
	onSendToChat?: (thread: ChatComment) => void;
	/** Why "Send to chat" is off right now */
	sendBlocked?: string;
};

// Threads render in a portal, but React still bubbles their events through the canvas: stop them reaching it
const stop = (event: React.PointerEvent) => event.stopPropagation();

/** Pins counter-scale so they keep their screen size; a click opens the thread, a drag moves the pin */
export const CommentsLayer = memo(function CommentsLayer({
	controller,
	frames,
	getZoom,
	onSendToChat,
	sendBlocked,
}: CommentsLayerProps) {
	const { comments, draft, openId, showResolved } = controller;
	const draftAt = draft ? pinPosition(draft, frames) : null;

	return (
		<>
			{comments.map((comment, index) => {
				const at = pinPosition(comment, frames);

				if (!at) return null;

				return (
					<CommentPin
						key={comment.id}
						comment={comment}
						number={index + 1}
						at={at}
						// Hidden, not removed: the thread animates closed against its pin, and the pin fades out
						hidden={comment.resolved === true && !showResolved && comment.id !== openId}
						getZoom={getZoom}
						open={comment.id === openId}
						controller={controller}
						onSendToChat={onSendToChat}
						sendBlocked={sendBlocked}
					/>
				);
			})}
			{draft && draftAt ? (
				<PinAnchor key={draft.id} at={draftAt}>
					<Popover open onOpenChange={(open) => !open && controller.cancelDraft(draft.id)}>
						<PopoverAnchor asChild>
							<PinMarker active label="New comment" pinId={draft.id} />
						</PopoverAnchor>
						<ThreadContent pinId={draft.id}>
							<Composer
								placeholder="Add a comment"
								submitLabel="Post"
								onSubmit={controller.postDraft}
								onCancel={() => controller.cancelDraft(draft.id)}
							/>
						</ThreadContent>
					</Popover>
				</PinAnchor>
			) : null}
		</>
	);
});

/** Its child is counter-scaled from the bottom-left, where the pin's tip is */
function PinAnchor({ at, hidden = false, children }: { at: Point; hidden?: boolean; children: React.ReactNode }) {
	return (
		<div className={cn("absolute", hidden && "pointer-events-none")} style={{ left: at.x, top: at.y }} inert={hidden}>
			<div className="absolute bottom-0 left-0 origin-bottom-left" style={{ transform: "scale(var(--unzoom))" }}>
				{children}
			</div>
		</div>
	);
}

function PinMarker({
	label,
	pinId,
	number,
	active = false,
	resolved = false,
	dragging = false,
	hidden = false,
	...props
}: React.ComponentProps<"button"> & {
	label: string;
	pinId: string;
	number?: number;
	active?: boolean;
	resolved?: boolean;
	dragging?: boolean;
	hidden?: boolean;
}) {
	return (
		<button
			type="button"
			data-comment-pin={pinId}
			aria-label={label}
			title={label}
			className={cn(
				"grid size-7 origin-bottom-left place-items-center rounded-full rounded-bl-none border-2 border-background text-xs font-semibold tabular-nums shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-[scale,opacity,background-color,color] motion-safe:duration-150 motion-safe:ease-out",
				resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
				active && "scale-110",
				hidden && "scale-50 opacity-0",
				dragging ? "cursor-grabbing" : "cursor-pointer",
			)}
			onPointerDown={stop}
			{...props}
		>
			{number ?? null}
		</button>
	);
}

/** Pressing its own pin is not an outside click: the pin toggles or drags it */
function ThreadContent({
	pinId,
	children,
	onEscapeKeyDown,
}: {
	pinId: string;
	children: React.ReactNode;
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
	return (
		<PopoverContent
			side="right"
			align="start"
			sideOffset={8}
			className="flex w-72 flex-col gap-2.5 p-3 text-[13px]"
			onPointerDown={stop}
			onOpenAutoFocus={(event) => event.preventDefault()}
			onEscapeKeyDown={onEscapeKeyDown}
			onInteractOutside={(event) => {
				const target = event.target instanceof Element ? event.target : null;

				if (target?.closest(`[data-comment-pin="${CSS.escape(pinId)}"]`)) event.preventDefault();
			}}
		>
			{children}
		</PopoverContent>
	);
}

type PinDrag = { id: string; startX: number; startY: number; origin: Point; at: Point; moved: boolean };

function CommentPin({
	comment,
	number,
	at,
	getZoom,
	open,
	controller,
	onSendToChat,
	sendBlocked,
	hidden,
}: {
	comment: CanvasComment;
	number: number;
	at: Point;
	hidden: boolean;
	getZoom: () => number;
	open: boolean;
	controller: CommentsController;
	onSendToChat?: (thread: ChatComment) => void;
	sendBlocked?: string;
}) {
	const drag = useRef<PinDrag | null>(null);
	/** Where the pin is while it drags; the comment moves once, on release */
	const [dragAt, setDragAt] = useState<Point | null>(null);
	const dragging = dragAt !== null;
	const [editing, setEditing] = useState(false);
	// The click that ends a drag must not toggle the thread
	const justDragged = useRef(false);

	const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.stopPropagation();

		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			id: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			origin: at,
			at,
			moved: false,
		};
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const current = drag.current;

		if (!current) return;
		const dx = event.clientX - current.startX;
		const dy = event.clientY - current.startY;

		if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		current.moved = true;
		const zoom = getZoom();
		current.at = { x: current.origin.x + dx / zoom, y: current.origin.y + dy / zoom };
		setDragAt(current.at);
	};

	const endDrag = () => {
		const current = drag.current;

		if (current?.moved) {
			justDragged.current = true;
			controller.move(comment.id, current.at, current.id);
			controller.endStep();
		}

		drag.current = null;
		setDragAt(null);
	};

	const onClick = () => {
		if (justDragged.current) {
			justDragged.current = false;

			return;
		}

		if (open) controller.close(comment.id);
		else controller.open(comment.id);
	};

	const onOpenChange = (next: boolean) => {
		if (next) return;
		setEditing(false);
		controller.close(comment.id);
	};

	const replies = comment.replies ?? [];

	return (
		<PinAnchor at={dragAt ?? at} hidden={hidden}>
			<Popover open={open && !dragging} onOpenChange={onOpenChange}>
				<PopoverAnchor asChild>
					<PinMarker
						label={`Comment ${number}`}
						pinId={comment.id}
						number={number}
						active={open}
						resolved={comment.resolved}
						dragging={dragging}
						hidden={hidden}
						aria-expanded={open}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={endDrag}
						onPointerCancel={endDrag}
						onClick={onClick}
					/>
				</PopoverAnchor>
				<ThreadContent
					pinId={comment.id}
					onEscapeKeyDown={(event) => {
						// Esc while editing leaves the editor (its blur finishes the edit), not the thread
						if (!editing) return;
						event.preventDefault();

						if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
					}}
				>
					<div className="flex items-center gap-1">
						<span className="text-xs text-subtle-foreground">
							<span className="font-medium text-muted-foreground tabular-nums">#{number}</span>
							{` · ${formatWhen(comment.createdAt)}`}
							{comment.resolved ? " · Resolved" : null}
						</span>
						<div className="ml-auto flex items-center">
							{onSendToChat && !comment.resolved ? (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Send to chat"
									title={sendBlocked ?? "Send to chat"}
									// Not `disabled`, so the reason still shows on hover and on click
									aria-disabled={sendBlocked ? true : undefined}
									className={cn(sendBlocked && "opacity-50")}
									onClick={() => (sendBlocked ? toast(sendBlocked) : onSendToChat({ comment, number }))}
								>
									<Sparkles />
								</Button>
							) : null}
							{!editing ? (
								<Button variant="ghost" size="icon-xs" aria-label="Edit" title="Edit" onClick={() => setEditing(true)}>
									<Pencil />
								</Button>
							) : null}
							{comment.resolved ? (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Reopen"
									title="Reopen"
									onClick={() => controller.reopen(comment.id)}
								>
									<RotateCcw />
								</Button>
							) : (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Resolve"
									title="Resolve"
									onClick={() => controller.resolve(comment.id)}
								>
									<CircleCheck />
								</Button>
							)}
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Delete"
								title="Delete"
								onClick={() => controller.remove(comment.id)}
							>
								<Trash2 />
							</Button>
						</div>
					</div>
					{editing ? (
						<EditText comment={comment} controller={controller} onDone={() => setEditing(false)} />
					) : (
						<p className="break-words whitespace-pre-wrap">{comment.text}</p>
					)}
					{replies.length ? (
						<ul className="flex flex-col gap-2 border-t pt-2.5">
							{replies.map((reply) => (
								<li key={reply.id} className="group/reply flex flex-col gap-0.5">
									<div className="flex items-center text-xs text-subtle-foreground">
										{formatWhen(reply.createdAt)}
										<Button
											variant="ghost"
											size="icon-xs"
											className="-my-1 ml-auto size-5 opacity-0 group-hover/reply:opacity-100 focus-visible:opacity-100"
											aria-label="Delete reply"
											title="Delete reply"
											onClick={() => controller.removeReply(comment.id, reply.id)}
										>
											<X />
										</Button>
									</div>
									<p className="break-words whitespace-pre-wrap">{reply.text}</p>
								</li>
							))}
						</ul>
					) : null}
					{editing ? null : (
						<Composer
							key={comment.id}
							placeholder="Reply"
							submitLabel="Reply"
							onSubmit={(text) => controller.reply(comment.id, text)}
							onCancel={() => controller.close(comment.id)}
							keepAfterSubmit
						/>
					)}
				</ThreadContent>
			</Popover>
		</PinAnchor>
	);
}

/** Every keystroke is part of one undo step; Enter or blur finishes */
function EditText({
	comment,
	controller,
	onDone,
}: {
	comment: CanvasComment;
	controller: CommentsController;
	onDone: () => void;
}) {
	const original = useRef(comment.text);

	const finish = () => {
		// A comment can't be blank: put the text back rather than delete it
		if (!comment.text.trim()) controller.update(comment.id, original.current);
		controller.endStep();
		onDone();
	};

	return (
		<Textarea
			autoFocus
			value={comment.text}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => controller.update(comment.id, event.target.value)}
			onBlur={finish}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
					event.preventDefault();
					finish();
				}
			}}
			className="max-h-48 min-h-9 resize-none px-2 py-1.5 text-[13px] md:text-[13px]"
		/>
	);
}

function Composer({
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
	keepAfterSubmit = false,
}: {
	placeholder: string;
	submitLabel: string;
	onSubmit: (text: string) => void;
	onCancel: () => void;
	keepAfterSubmit?: boolean;
}) {
	const [text, setText] = useState("");

	const submit = () => {
		if (!text.trim()) return;
		onSubmit(text);

		if (keepAfterSubmit) setText("");
	};

	return (
		<div className="flex flex-col gap-1.5">
			<Textarea
				autoFocus
				value={text}
				placeholder={placeholder}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						submit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
				className="max-h-48 min-h-9 resize-none px-2 py-1.5 text-[13px] md:text-[13px]"
			/>
			<div className="flex items-center gap-2">
				<span className="text-xs text-subtle-foreground">⏎ to {submitLabel.toLowerCase()} · ⇧⏎ new line</span>
				<Button size="xs" className="ml-auto" disabled={!text.trim()} onClick={submit}>
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}
