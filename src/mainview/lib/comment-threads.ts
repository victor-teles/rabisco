import type { Rect } from "@/lib/align";
import { pinPosition } from "../../shared/comments";
import type { CanvasComment, Frame } from "../../shared/types";

export type CommentThread = {
	comment: CanvasComment;
	/** The number on its pin */
	number: number;
	/** The screen it is pinned to, or `null` on the canvas */
	screen: string | null;
};

/** Newest first, open before resolved. Numbers follow the pins, which count in creation order. */
export function commentThreads(comments: CanvasComment[], frames: Frame[]) {
	const open: CommentThread[] = [];
	const resolved: CommentThread[] = [];

	for (let index = comments.length - 1; index >= 0; index--) {
		const comment = comments[index]!;
		const frame = comment.file ? frames.find((f) => f.file === comment.file) : undefined;
		const thread = { comment, number: index + 1, screen: frame?.name ?? null };

		if (comment.resolved) resolved.push(thread);
		else open.push(thread);
	}

	return { open, resolved };
}

/** Half the size of the area shown around a canvas pin */
const PIN_VIEW = 240;

/** What to bring into view for a thread: its screen, or the area around a canvas pin */
export function threadView(comment: CanvasComment, frames: Frame[]): Rect[] {
	const frame = comment.file ? frames.find((f) => f.file === comment.file) : undefined;

	if (frame) return [frame];
	const at = pinPosition(comment, frames);

	return at ? [{ x: at.x - PIN_VIEW, y: at.y - PIN_VIEW, width: PIN_VIEW * 2, height: PIN_VIEW * 2 }] : [];
}

/** A thread as the chat reads it; `element` names what its pin points at */
export type ChatComment = { comment: CanvasComment; number: number; element?: string };

/** The open threads pinned to a screen, in pin order */
export function openOnScreen(comments: CanvasComment[], file: string): ChatComment[] {
	return comments.flatMap((comment, index) =>
		comment.file === file && !comment.resolved ? [{ comment, number: index + 1 }] : [],
	);
}

const indent = (text: string, by: string) => text.trim().replaceAll("\n", `\n${by}`);

const replyLines = (comment: CanvasComment, by: string) =>
	(comment.replies ?? []).map((reply) => `${by}Reply: ${indent(reply.text, `${by}  `)}`);

/** A prompt to review in the composer. One thread reads as itself; several become a list named by their pins */
export function commentsPrompt(threads: ChatComment[], screen?: string): string {
	if (threads.length === 1) {
		const { comment } = threads[0]!;

		return [comment.text.trim(), ...replyLines(comment, "")].join("\n");
	}

	const items = threads.map(({ comment, number, element }) => {
		const where = element ? `#${number}, on ${element}` : `#${number}`;

		return [`- ${where}: ${indent(comment.text, "  ")}`, ...replyLines(comment, "  ")].join("\n");
	});

	return [`Address these comments${screen ? ` on ${screen}` : ""}:`, ...items].join("\n");
}
