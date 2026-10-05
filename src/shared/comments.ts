import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { CanvasComment, CommentReply, Frame } from "./types";

type Point = { x: number; y: number };

/** `x`/`y` are frame-relative when `file` is set. */
export type PinPlacement = { file?: string; x: number; y: number };

function normalizeReply(raw: Json): CommentReply | null {
	if (!isJsonObject(raw) || !isString(raw.id) || !isString(raw.text)) return null;

	return { id: raw.id, text: raw.text, createdAt: isString(raw.createdAt) ? raw.createdAt : "" };
}

/** Drops malformed entries and unknown fields (hand-edited or older `rabisco.json`). */
export function normalizeComments(raw: Json | undefined): CanvasComment[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const comments: CanvasComment[] = [];

	for (const c of raw) {
		if (!isJsonObject(c) || !isString(c.id) || seen.has(c.id) || !isFiniteNumber(c.x) || !isFiniteNumber(c.y)) continue;

		if (!isString(c.text)) continue;
		seen.add(c.id);
		const replies = isJsonArray(c.replies) ? c.replies.flatMap((r) => normalizeReply(r) ?? []) : [];

		const comment: CanvasComment = {
			id: c.id,
			x: c.x,
			y: c.y,
			text: c.text,
			createdAt: isString(c.createdAt) ? c.createdAt : "",
		};

		if (isString(c.file) && c.file) comment.file = c.file;

		if (c.resolved === true) comment.resolved = true;

		if (replies.length) comment.replies = replies;
		comments.push(comment);
	}

	return comments;
}

/** Later frames paint on top. */
export function frameAtPoint(frames: Frame[], point: Point): Frame | undefined {
	for (let i = frames.length - 1; i >= 0; i--) {
		const frame = frames[i]!;

		if (
			point.x >= frame.x &&
			point.x <= frame.x + frame.width &&
			point.y >= frame.y &&
			point.y <= frame.y + frame.height
		)
			return frame;
	}

	return undefined;
}

export function pinAt(point: Point, frames: Frame[]): PinPlacement {
	const frame = frameAtPoint(frames, point);

	if (!frame) return { x: Math.round(point.x), y: Math.round(point.y) };

	return { file: frame.file, x: Math.round(point.x - frame.x), y: Math.round(point.y - frame.y) };
}

export function pinPosition(comment: PinPlacement, frames: Frame[]): Point | null {
	if (!comment.file) return { x: comment.x, y: comment.y };
	const frame = frames.find((f) => f.file === comment.file);

	return frame ? { x: frame.x + comment.x, y: frame.y + comment.y } : null;
}

/** Pins on frames that went away become canvas pins in place. Returns `comments` when nothing changed. */
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
