import { useCallback, useMemo, useState } from "react";
import type { Snapshot } from "@/lib/history";
import { pinAt, type PinPlacement } from "../../shared/comments";
import type { CanvasComment, Frame } from "../../shared/types";
import type { ChangeOptions } from "./use-project";

type Point = { x: number; y: number };

/** A pin placed but not posted yet. It lives here, not in the history, until it has text. */
export type CommentDraft = PinPlacement & { id: string };

type Options = {
	/** `canvas.comments`, which mirrors the history's present */
	comments: CanvasComment[] | undefined;
	frames: Frame[];
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	/** Ends a coalescing run (a typing burst, a pin drag) */
	endStep: () => void;
};

const NO_COMMENTS: CanvasComment[] = [];

const commentsOf = (snapshot: Snapshot) => snapshot.comments ?? NO_COMMENTS;

/**
 * Comment pins on the canvas. Every edit of a posted comment is an undo step
 * (typing and drags coalesce); the draft pin, the open thread and "show
 * resolved" are view state.
 */
export function useComments({ comments = NO_COMMENTS, frames, change, endStep }: Options) {
	const [draft, setDraft] = useState<CommentDraft | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [showResolved, setShowResolved] = useState(false);

	/** Applies `update` to one comment; a no-op when it is gone (undone meanwhile). */
	const patch = useCallback(
		(id: string, update: (comment: CanvasComment) => CanvasComment, options?: ChangeOptions) =>
			change((snapshot) => {
				if (!commentsOf(snapshot).some((c) => c.id === id)) return snapshot;

				return { ...snapshot, comments: commentsOf(snapshot).map((c) => (c.id === id ? update(c) : c)) };
			}, options),
		[change],
	);

	/** Places a draft pin at a canvas point, on the topmost frame under it if any. Replaces an earlier draft. */
	const startDraft = useCallback(
		(point: Point) => {
			setOpenId(null);
			setDraft({ id: crypto.randomUUID(), ...pinAt(point, frames) });
		},
		[frames],
	);

	/** Drops the draft. With an `id`, only if it is still that draft (a stale dismiss can't remove a newer one). */
	const cancelDraft = useCallback((id?: string) => {
		setDraft((current) => (current && (id === undefined || current.id === id) ? null : current));
	}, []);

	/** Adds a comment as one undo step and returns its id. */
	const add = useCallback(
		(placement: PinPlacement, text: string, id: string = crypto.randomUUID()) => {
			const comment: CanvasComment = { id, ...placement, text: text.trim(), createdAt: new Date().toISOString() };
			change((snapshot) => ({ ...snapshot, comments: [...commentsOf(snapshot), comment] }));

			return id;
		},
		[change],
	);

	/** Posts the draft; blank text just removes it. */
	const postDraft = useCallback(
		(text: string) => {
			if (draft && text.trim()) {
				const { id, ...placement } = draft;
				add(placement, text, id);
			}

			setDraft(null);
		},
		[draft, add],
	);

	/** Edits a comment's text; a typing burst is one step until `endStep`. */
	const update = useCallback(
		(id: string, text: string) => patch(id, (c) => ({ ...c, text }), { coalesce: `comment-text:${id}` }),
		[patch],
	);

	/** Moves a pin to a canvas point, re-attaching it to the frame under it. One drag (`dragId`) is one step. */
	const move = useCallback(
		(id: string, point: Point, dragId: string) =>
			change(
				(snapshot) => {
					const target = commentsOf(snapshot).find((c) => c.id === id);

					if (!target) return snapshot;
					const { file: _file, ...rest } = target;
					const moved = { ...rest, ...pinAt(point, snapshot.frames) };

					if (moved.file === target.file && moved.x === target.x && moved.y === target.y) return snapshot;

					return { ...snapshot, comments: commentsOf(snapshot).map((c) => (c.id === id ? moved : c)) };
				},
				{ coalesce: `comment-move:${dragId}` },
			),
		[change],
	);

	const resolve = useCallback(
		(id: string) => {
			patch(id, (c) => ({ ...c, resolved: true }));

			if (!showResolved) setOpenId((current) => (current === id ? null : current));
		},
		[patch, showResolved],
	);

	const reopen = useCallback(
		(id: string) =>
			patch(id, (c) => {
				const { resolved: _resolved, ...rest } = c;

				return rest;
			}),
		[patch],
	);

	const reply = useCallback(
		(id: string, text: string) => {
			if (!text.trim()) return;
			const entry = { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString() };
			patch(id, (c) => ({ ...c, replies: [...(c.replies ?? []), entry] }));
		},
		[patch],
	);

	const removeReply = useCallback(
		(id: string, replyId: string) =>
			patch(id, (c) => {
				const replies = (c.replies ?? []).filter((r) => r.id !== replyId);
				const { replies: _replies, ...rest } = c;

				return replies.length ? { ...rest, replies } : rest;
			}),
		[patch],
	);

	const remove = useCallback(
		(id: string) => {
			change((snapshot) =>
				commentsOf(snapshot).some((c) => c.id === id)
					? { ...snapshot, comments: commentsOf(snapshot).filter((c) => c.id !== id) }
					: snapshot,
			);
			setOpenId((current) => (current === id ? null : current));
		},
		[change],
	);

	const open = useCallback((id: string) => {
		setDraft(null);
		setOpenId(id);
	}, []);

	/** Closes the thread. With an `id`, only if that thread is the open one. */
	const close = useCallback((id?: string) => {
		setOpenId((current) => (id === undefined || current === id ? null : current));
	}, []);

	return useMemo(
		() => ({
			comments,
			draft,
			openId,
			showResolved,
			setShowResolved,
			startDraft,
			cancelDraft,
			postDraft,
			add,
			update,
			move,
			resolve,
			reopen,
			reply,
			removeReply,
			remove,
			open,
			close,
			endStep,
		}),
		[
			comments,
			draft,
			openId,
			showResolved,
			startDraft,
			cancelDraft,
			postDraft,
			add,
			update,
			move,
			resolve,
			reopen,
			reply,
			removeReply,
			remove,
			open,
			close,
			endStep,
		],
	);
}

export type CommentsController = ReturnType<typeof useComments>;
