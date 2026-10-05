import { useRef, useState } from "react";
import { CircleCheck, Pencil, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { CommentsController } from "@/hooks/use-comments";
import { cn } from "@/lib/utils";
import { pinPosition } from "../../../shared/comments";
import type { CanvasComment, Frame } from "../../../shared/types";

export { frameAtPoint, pinAt, pinPosition, type PinPlacement } from "../../../shared/comments";

/** Screen pixels the pointer travels before a press on a pin becomes a drag */
const DRAG_THRESHOLD = 3;

type Point = { x: number; y: number };

type CommentsLayerProps = {
	controller: CommentsController;
	/** The canvas frames, to place pins that sit on a frame */
	frames: Frame[];
	zoom: number;
	/** Shows "Ask AI" on threads: a targeted generation from the comment */
	onAskAI?: (comment: CanvasComment) => void;
};

// Pointer input on pins and threads must never reach the canvas (select, marquee, pan).
// Threads render in a portal, but React still bubbles their events through the canvas.
const stop = (event: React.PointerEvent) => event.stopPropagation();

/**
 * Comment pins, rendered inside the canvas's transformed layer (canvas
 * coordinates). Pins counter-scale so they keep their screen size; a click
 * opens the thread, a drag moves the pin. Resolved pins are hidden unless
 * "show resolved" is on.
 */
export function CommentsLayer({ controller, frames, zoom, onAskAI }: CommentsLayerProps) {
	const { comments, draft, openId, showResolved } = controller;
	const draftAt = draft ? pinPosition(draft, frames) : null;
	return (
		<>
			{comments.map((comment, index) => {
				if (comment.resolved && !showResolved && comment.id !== openId) return null;
				const at = pinPosition(comment, frames);
				if (!at) return null;
				return (
					<CommentPin
						key={comment.id}
						comment={comment}
						number={index + 1}
						at={at}
						zoom={zoom}
						open={comment.id === openId}
						controller={controller}
						onAskAI={onAskAI}
					/>
				);
			})}
			{draft && draftAt ? (
				<PinAnchor key={draft.id} at={draftAt} zoom={zoom}>
					<Popover open onOpenChange={(open) => !open && controller.cancelDraft(draft.id)}>
						<PopoverAnchor asChild>
							<PinShape active label="New comment" pinId={draft.id} />
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
}

/** A 0×0 box at the pin's canvas point; its child is counter-scaled from the bottom-left, where the pin's tip is. */
function PinAnchor({ at, zoom, children }: { at: Point; zoom: number; children: React.ReactNode }) {
	return (
		<div className="absolute" style={{ left: at.x, top: at.y }}>
			<div className="absolute bottom-0 left-0 origin-bottom-left" style={{ transform: `scale(${1 / zoom})` }}>
				{children}
			</div>
		</div>
	);
}

/** Figma's pin: a round badge with a square bottom-left corner pointing at the spot. */
function PinShape({
	label,
	pinId,
	number,
	active = false,
	resolved = false,
	dragging = false,
	...props
}: React.ComponentProps<"button"> & {
	label: string;
	pinId: string;
	number?: number;
	active?: boolean;
	resolved?: boolean;
	dragging?: boolean;
}) {
	return (
		<button
			type="button"
			data-comment-pin={pinId}
			aria-label={label}
			title={label}
			className={cn(
				"grid size-7 place-items-center rounded-full rounded-bl-none border-2 border-background text-xs font-semibold tabular-nums shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-transform",
				resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
				active && "scale-110",
				dragging ? "cursor-grabbing" : "cursor-pointer",
			)}
			onPointerDown={stop}
			{...props}
		>
			{number ?? null}
		</button>
	);
}

/**
 * The thread popover. Pointer input stays out of the canvas; the composer takes focus itself.
 * Pressing its own pin is not an outside click: the pin toggles or drags it.
 */
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

type PinDrag = { id: string; startX: number; startY: number; origin: Point; moved: boolean };

function CommentPin({
	comment,
	number,
	at,
	zoom,
	open,
	controller,
	onAskAI,
}: {
	comment: CanvasComment;
	number: number;
	at: Point;
	zoom: number;
	open: boolean;
	controller: CommentsController;
	onAskAI?: (comment: CanvasComment) => void;
}) {
	const drag = useRef<PinDrag | null>(null);
	const [dragging, setDragging] = useState(false);
	const [editing, setEditing] = useState(false);
	// The click that ends a drag must not toggle the thread
	const justDragged = useRef(false);

	const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { id: crypto.randomUUID(), startX: event.clientX, startY: event.clientY, origin: at, moved: false };
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const current = drag.current;
		if (!current) return;
		const dx = event.clientX - current.startX;
		const dy = event.clientY - current.startY;
		if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		if (!current.moved) {
			current.moved = true;
			setDragging(true);
		}
		controller.move(comment.id, { x: current.origin.x + dx / zoom, y: current.origin.y + dy / zoom }, current.id);
	};

	const endDrag = () => {
		if (drag.current?.moved) {
			justDragged.current = true;
			controller.endStep();
		}
		drag.current = null;
		setDragging(false);
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
		<PinAnchor at={at} zoom={zoom}>
			<Popover open={open && !dragging} onOpenChange={onOpenChange}>
				<PopoverAnchor asChild>
					<PinShape
						label={`Comment ${number}`}
						pinId={comment.id}
						number={number}
						active={open}
						resolved={comment.resolved}
						dragging={dragging}
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
							{[timeAgo(comment.createdAt), comment.resolved ? "Resolved" : ""].filter(Boolean).map((part) => ` · ${part}`)}
						</span>
						<div className="ml-auto flex items-center">
							{onAskAI && !comment.resolved ? (
								<Button variant="ghost" size="icon-xs" aria-label="Ask AI" title="Ask AI" onClick={() => onAskAI(comment)}>
									<Sparkles />
								</Button>
							) : null}
							{!editing ? (
								<Button variant="ghost" size="icon-xs" aria-label="Edit" title="Edit" onClick={() => setEditing(true)}>
									<Pencil />
								</Button>
							) : null}
							{comment.resolved ? (
								<Button variant="ghost" size="icon-xs" aria-label="Reopen" title="Reopen" onClick={() => controller.reopen(comment.id)}>
									<RotateCcw />
								</Button>
							) : (
								<Button variant="ghost" size="icon-xs" aria-label="Resolve" title="Resolve" onClick={() => controller.resolve(comment.id)}>
									<CircleCheck />
								</Button>
							)}
							<Button variant="ghost" size="icon-xs" aria-label="Delete" title="Delete" onClick={() => controller.remove(comment.id)}>
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
										{timeAgo(reply.createdAt)}
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

/** Edits the comment in place: every keystroke is part of one undo step, Enter or blur finishes. */
function EditText({ comment, controller, onDone }: { comment: CanvasComment; controller: CommentsController; onDone: () => void }) {
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

/** Enter posts, ⇧Enter adds a line, Esc cancels. */
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
	/** Clears the field after posting instead of leaving it to the parent to unmount */
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

function timeAgo(iso: string) {
	const time = new Date(iso).getTime();
	if (!Number.isFinite(time)) return "";
	const seconds = Math.round((Date.now() - time) / 1000);
	const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	if (seconds < 60) return "just now";
	if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
	if (seconds < 86400) return format.format(-Math.round(seconds / 3600), "hour");
	return format.format(-Math.round(seconds / 86400), "day");
}
