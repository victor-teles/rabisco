// Decision 0038: a viewer on the local network sends a plain-text comment with a screen and a pin position.
import { isFiniteNumber, isString } from "../guards";
import { isJsonObject, type Json } from "../json";
import type { CanvasComment } from "../types";

export const COMMENT_MAX_LENGTH = 2000;

/** Larger than any comment the viewer sends; the server reads no more */
export const COMMENT_BODY_LIMIT = 16 * 1024;

const COORDINATE_LIMIT = 100_000;

/** `x`/`y` are screen-relative, like a pinned canvas comment */
export type ViewerComment = { screen: string; x: number; y: number; text: string };

const isCoordinate = (value: Json | undefined): value is number =>
	isFiniteNumber(value) && value >= 0 && value <= COORDINATE_LIMIT;

const isControl = (code: number) => (code < 32 && code !== 9 && code !== 10) || code === 127;

/** Control characters other than tabs and line breaks are dropped */
export function cleanCommentText(text: string): string {
	let clean = "";

	for (const char of text.replace(/\r\n?/g, "\n")) if (!isControl(char.charCodeAt(0))) clean += char;

	return clean.trim();
}

/** `null` for anything but a comment on one of `screens` */
export function parseViewerComment(value: Json, screens: readonly string[]): ViewerComment | null {
	if (!isJsonObject(value)) return null;
	const { screen, x, y, text } = value;

	if (!isString(screen) || !screens.includes(screen) || !isCoordinate(x) || !isCoordinate(y) || !isString(text))
		return null;
	const clean = cleanCommentText(text);

	if (!clean || clean.length > COMMENT_MAX_LENGTH) return null;

	return { screen, x: Math.round(x), y: Math.round(y), text: clean };
}

/** A new thread pinned to the screen, inside its frame */
export function viewerThread(
	comment: ViewerComment,
	frame: { width: number; height: number } | undefined,
	id: string,
	createdAt: string,
): CanvasComment {
	const x = frame ? Math.min(comment.x, frame.width) : comment.x;

	return { id, file: comment.screen, x, y: comment.y, text: comment.text, createdAt };
}
