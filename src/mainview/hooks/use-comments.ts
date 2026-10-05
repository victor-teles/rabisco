import { useCallback, useMemo, useState } from "react";
import type { Snapshot } from "@/lib/history";
import { pinAt, type PinPlacement } from "../../shared/comments";
import type { CanvasComment, Frame } from "../../shared/types";
import type { ChangeOptions } from "./use-project";

type Point = { x: number; y: number };

/** Lives outside the history until it has text. */
export type CommentDraft = PinPlacement & { id: string };

type Options = {
	comments: CanvasComment[] | undefined;
	frames: Frame[];
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	endStep: () => void;
};

const NO_COMMENTS: CanvasComment[] = [];

const commentsOf = (snapshot: Snapshot) => snapshot.comments ?? NO_COMMENTS;

export function useComments({ comments = NO_COMMENTS, frames, change, endStep }: Options) {
	const [draft, setDraft] = useState<CommentDraft | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [showResolved, setShowResolved] = useState(false);

	const patch = useCallback(
		(id: string, update: (comment: CanvasComment) => CanvasComment, options?: ChangeOptions) =>
			change((snapshot) => {
				if (!commentsOf(snapshot).some((c) => c.id === id)) return snapshot;

				return { ...snapshot, comments: commentsOf(snapshot).map((c) => (c.id === id ? update(c) : c)) };
			}, options),
		[change],
	);

	const startDraft = useCallback(
		(point: Point) => {
			setOpenId(null);
			setDraft({ id: crypto.randomUUID(), ...pinAt(point, frames) });
		},
		[frames],
	);

	/** With an `id`, only if it is still that draft, so a stale dismiss can't remove a newer one. */
	const cancelDraft = useCallback((id?: string) => {
		setDraft((current) => (current && (id === undefined || current.id === id) ? null : current));
	}, []);

	const add = useCallback(
		(placement: PinPlacement, text: string, id: string = crypto.randomUUID()) => {
			const comment: CanvasComment = { id, ...placement, text: text.trim(), createdAt: new Date().toISOString() };
			change((snapshot) => ({ ...snapshot, comments: [...commentsOf(snapshot), comment] }));

			return id;
		},
		[change],
	);

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

	const update = useCallback(
		(id: string, text: string) => patch(id, (c) => ({ ...c, text }), { coalesce: `comment-text:${id}` }),
		[patch],
	);

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
