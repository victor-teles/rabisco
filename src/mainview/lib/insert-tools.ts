import type { Rect } from "./align";
import { dropTarget, insertDrop } from "./component-drop";
import { MAX_FRAME_SIZE, MIN_FRAME_SIZE, type Size } from "./device-presets";
import { sourceVersion } from "./render/protocol";
import { attrValue } from "../../shared/jsx/text";
import { FRAME_SIZE } from "../../shared/project";
import type { Device } from "../../shared/types";

export type InsertTool = "frame" | "rectangle" | "ellipse" | "text";

export const INSERT_TOOLS: readonly InsertTool[] = ["frame", "rectangle", "ellipse", "text"];

export const isInsertTool = (tool: string): tool is InsertTool => INSERT_TOOLS.some((insert) => insert === tool);

export type InsertTarget = { parent: number; index: number; version: string };

export type CanvasInsert = {
	tool: InsertTool;
	file: string | null;
	rect: Rect;
	dragged: boolean;
	target: InsertTarget | null;
	available: Size | null;
};

export const BOX_SIZE = 96;

export const TEXT_PLACEHOLDER = "Text";

const SPACING = 4;

export function sizeClass(axis: "w" | "h", size: number, available: number | null = null): string {
	if (available !== null && size >= available) return `${axis}-full`;

	return `${axis}-${Math.max(1, Math.round(size / SPACING))}`;
}

export function boxSize(insert: Pick<CanvasInsert, "rect" | "dragged">): Size {
	if (!insert.dragged) return { width: BOX_SIZE, height: BOX_SIZE };

	return { width: insert.rect.width, height: insert.rect.height };
}

function sizeClasses(size: Size, available: Size | null) {
	return `${sizeClass("h", size.height, available?.height)} ${sizeClass("w", size.width, available?.width)}`;
}

export function insertSnippet(insert: Pick<CanvasInsert, "tool" | "rect" | "dragged" | "available">): string {
	const { tool, available } = insert;

	if (tool === "text") {
		if (!insert.dragged) return `<p>${TEXT_PLACEHOLDER}</p>`;

		return `<p className="${sizeClass("w", insert.rect.width, available?.width)}">${TEXT_PLACEHOLDER}</p>`;
	}

	const size = sizeClasses(boxSize(insert), available);

	if (tool === "rectangle") return `<div className="${size} rounded-lg bg-muted" />`;

	if (tool === "ellipse") return `<div className="${size} rounded-full bg-muted" />`;

	return `<div className="${size}" />`;
}

export function imageAlt(src: string): string {
	const file = src.split("/").at(-1) ?? "";

	const words = file
		.replace(/\.[^.]*$/, "")
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.toLowerCase();

	return words ? words[0]!.toUpperCase() + words.slice(1) : "Image";
}

export const imageSnippet = (src: string) =>
	`<img src=${attrValue(src)} alt=${attrValue(imageAlt(src))} className="h-auto max-w-full" />`;

export function insertIntoScreen(
	source: string,
	target: InsertTarget | null,
	snippet: string,
): { source: string; start: number } | null {
	const placed = target?.version === sourceVersion(source) ? target : null;
	const fallback = placed ? null : dropTarget(source, null);
	const at = placed ?? (fallback && { parent: fallback.parent, index: fallback.slots.length });

	return at && insertDrop(source, at.parent, at.index, { snippet, imports: [] });
}

const clampFrame = (value: number) => Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, Math.round(value)));

export function newFrameRect(insert: Pick<CanvasInsert, "rect" | "dragged">, device: Device): Rect {
	const { rect } = insert;
	const size = insert.dragged ? { width: clampFrame(rect.width), height: clampFrame(rect.height) } : FRAME_SIZE[device];

	return { x: Math.round(rect.x), y: Math.round(rect.y), width: size.width, height: size.height };
}
