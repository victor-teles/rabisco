import type { CanvasComment, CommentReply, Frame } from "./types";

type Point = { x: number; y: number };

/** Where a pin is stored: on a frame (frame-relative) or on the canvas. */
export type PinPlacement = { file?: string; x: number; y: number };

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function normalizeReply(raw: unknown): CommentReply | null {
	const reply = raw as Partial<CommentReply> | null;
	if (!reply || typeof reply.id !== "string" || typeof reply.text !== "string") return null;
	return { id: reply.id, text: reply.text, createdAt: typeof reply.createdAt === "string" ? reply.createdAt : "" };
}

/** Comments from a hand-edited or older `rabisco.json`: malformed entries are dropped, unknown fields too. */
export function normalizeComments(raw: unknown): CanvasComment[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const comments: CanvasComment[] = [];
	for (const entry of raw) {
		const c = entry as Partial<CanvasComment> | null;
		if (!c || typeof c.id !== "string" || seen.has(c.id) || !isFiniteNumber(c.x) || !isFiniteNumber(c.y)) continue;
		if (typeof c.text !== "string") continue;
		seen.add(c.id);
		const replies = Array.isArray(c.replies) ? c.replies.flatMap((r) => normalizeReply(r) ?? []) : [];
		comments.push({
			id: c.id,
			...(typeof c.file === "string" && c.file ? { file: c.file } : {}),
			x: c.x,
			y: c.y,
			text: c.text,
			createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
			...(c.resolved === true ? { resolved: true } : {}),
			...(replies.length ? { replies } : {}),
		});
	}
	return comments;
}

/** The topmost frame under a canvas point; later frames paint on top. */
export function frameAtPoint(frames: Frame[], point: Point): Frame | undefined {
	for (let i = frames.length - 1; i >= 0; i--) {
		const frame = frames[i]!;
		if (point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height) return frame;
	}
	return undefined;
}

/** How to store a pin dropped at a canvas point: on the topmost frame under it, else on the canvas. */
export function pinAt(point: Point, frames: Frame[]): PinPlacement {
	const frame = frameAtPoint(frames, point);
	if (!frame) return { x: Math.round(point.x), y: Math.round(point.y) };
	return { file: frame.file, x: Math.round(point.x - frame.x), y: Math.round(point.y - frame.y) };
}

/** A pin's canvas position, or `null` when its frame is not on the canvas. */
export function pinPosition(comment: PinPlacement, frames: Frame[]): Point | null {
	if (!comment.file) return { x: comment.x, y: comment.y };
	const frame = frames.find((f) => f.file === comment.file);
	return frame ? { x: frame.x + comment.x, y: frame.y + comment.y } : null;
}

/**
 * Keeps comments visible when their frame goes away (deleted, picked over, removed on disk):
 * a pin on a frame that was in `before` but is not in `after` becomes a canvas pin at the
 * spot where it was. The change and its undo are one step, so undo puts it back on the frame.
 * Pins on frames unknown to both stay as they are. Returns `comments` when nothing changed.
 */
export function detachComments(comments: CanvasComment[], before: Frame[], after: Frame[]): CanvasComment[] {
	if (before === after || !comments.length) return comments;
	const remaining = new Set(after.map((frame) => frame.file));
	let changed = false;
	const next = comments.map((comment) => {
		if (!comment.file || remaining.has(comment.file)) return comment;
		const frame = before.find((f) => f.file === comment.file);
		if (!frame) return comment;
		changed = true;
		const { file: _file, ...rest } = comment;
		return { ...rest, x: frame.x + comment.x, y: frame.y + comment.y };
	});
	return changed ? next : comments;
}
