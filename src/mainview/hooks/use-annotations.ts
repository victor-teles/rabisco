import { useCallback, useState } from "react";
import type { ChangeOptions } from "@/hooks/use-project";
import type { Action } from "@/lib/actions";
import type { Snapshot } from "@/lib/history";
import { MAX_NOTE_TEXT, moveAnnotation } from "../../shared/annotations";
import type { Annotation, CanvasArrow, CanvasNote, SectionColor } from "../../shared/types";

type Rect = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };

export type AnnotationKind = Annotation["kind"];

type Options = {
	annotations: Annotation[];
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	screensSelected: boolean;
	othersSelected: boolean;
	setSelection: (selection: string[]) => void;
	/** Before a drawing tool turns on */
	onDraw?: () => void;
};

const NO_ANNOTATIONS: Annotation[] = [];

const DUPLICATE_OFFSET = 24;

const annotationsOf = (snapshot: Snapshot) => snapshot.annotations ?? NO_ANNOTATIONS;

const patch = (snapshot: Snapshot, id: string, update: (annotation: Annotation) => Annotation): Snapshot => ({
	...snapshot,
	annotations: annotationsOf(snapshot).map((annotation) => (annotation.id === id ? update(annotation) : annotation)),
});

export function useAnnotations({
	annotations,
	change,
	screensSelected,
	othersSelected,
	setSelection,
	onDraw,
}: Options) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [drawing, setDrawing] = useState<AnnotationKind | null>(null);
	const [color, setColor] = useState<SectionColor>("yellow");
	const current = selectedId ? annotations.find((annotation) => annotation.id === selectedId) : undefined;

	if (selectedId && !current) {
		setSelectedId(null);
		setEditing(null);
	}

	const anyOther = screensSelected || othersSelected;
	const [hadOthers, setHadOthers] = useState(anyOther);

	if (hadOthers !== anyOther) {
		setHadOthers(anyOther);

		if (anyOther) {
			setSelectedId(null);
			setEditing(null);
		}
	}

	const select = useCallback(
		(id: string | null) => {
			setSelectedId(id);
			setEditing((was) => (was === id ? was : null));

			if (id) setSelection([]);
		},
		[setSelection],
	);

	const add = useCallback(
		(annotation: Annotation) => {
			change((snapshot) => ({ ...snapshot, annotations: [...annotationsOf(snapshot), annotation] }), { select: [] });
			setSelectedId(annotation.id);
			setEditing(annotation.kind === "note" ? annotation.id : null);
			setDrawing(null);
		},
		[change],
	);

	const drawNote = useCallback(
		(rect: Rect) => add({ kind: "note", id: crypto.randomUUID(), text: "", color, ...rect } satisfies CanvasNote),
		[add, color],
	);

	const drawArrow = useCallback(
		(from: Point, to: Point) =>
			add({ kind: "arrow", id: crypto.randomUUID(), x1: from.x, y1: from.y, x2: to.x, y2: to.y } satisfies CanvasArrow),
		[add],
	);

	const move = useCallback(
		(id: string, dx: number, dy: number, dragId: string) =>
			change((snapshot) => patch(snapshot, id, (annotation) => moveAnnotation(annotation, dx, dy)), {
				coalesce: `annotation:${dragId}`,
			}),
		[change],
	);

	const resize = useCallback(
		(id: string, rect: Rect) =>
			change((snapshot) =>
				patch(snapshot, id, (annotation) => (annotation.kind === "note" ? { ...annotation, ...rect } : annotation)),
			),
		[change],
	);

	const moveEnds = useCallback(
		(id: string, ends: { x1: number; y1: number; x2: number; y2: number }) =>
			change((snapshot) =>
				patch(snapshot, id, (annotation) => (annotation.kind === "arrow" ? { ...annotation, ...ends } : annotation)),
			),
		[change],
	);

	const setText = useCallback(
		(id: string, text: string) => {
			setEditing(null);
			const next = text.slice(0, MAX_NOTE_TEXT);

			change((snapshot) => {
				const note = annotationsOf(snapshot).find((annotation) => annotation.id === id);

				return note?.kind === "note" && note.text !== next
					? patch(snapshot, id, (annotation) => ({ ...annotation, text: next }))
					: snapshot;
			});
		},
		[change],
	);

	const recolor = useCallback(
		(id: string, next: SectionColor) => {
			setColor(next);
			change((snapshot) =>
				patch(snapshot, id, (annotation) => (annotation.kind === "note" ? { ...annotation, color: next } : annotation)),
			);
		},
		[change],
	);

	const remove = useCallback(
		(id: string) =>
			change((snapshot) => ({
				...snapshot,
				annotations: annotationsOf(snapshot).filter((annotation) => annotation.id !== id),
			})),
		[change],
	);

	const duplicate = useCallback(
		(id: string) => {
			const source = annotations.find((annotation) => annotation.id === id);

			if (!source) return;
			const copy = { ...moveAnnotation(source, DUPLICATE_OFFSET, DUPLICATE_OFFSET), id: crypto.randomUUID() };

			change((snapshot) => ({ ...snapshot, annotations: [...annotationsOf(snapshot), copy] }), { select: [] });
			setSelectedId(copy.id);
			setEditing(null);
		},
		[annotations, change],
	);

	const startDrawing = useCallback(
		(kind: AnnotationKind) => {
			if (drawing !== kind) onDraw?.();
			setDrawing(drawing === kind ? null : kind);
			setSelectedId(null);
			setEditing(null);
		},
		[drawing, onDraw],
	);

	const cancelDrawing = useCallback(() => setDrawing(null), []);

	const idle = current !== undefined && editing === null;

	const actions: Action[] = [
		{
			id: "sticky-note",
			label: "Sticky note",
			group: "Insert",
			chords: [{ code: "KeyS" }],
			enabled: true,
			checked: drawing === "note",
			run: () => startDrawing("note"),
		},
		{
			id: "arrow",
			label: "Arrow",
			group: "Insert",
			chords: [{ code: "KeyL", shift: true }],
			enabled: true,
			checked: drawing === "arrow",
			run: () => startDrawing("arrow"),
		},
		{
			id: "edit-note",
			label: "Edit note",
			group: "Edit",
			chords: [{ key: "Enter" }],
			enabled: editing === null && current?.kind === "note",
			hidden: true,
			run: () => current && setEditing(current.id),
		},
		{
			id: "duplicate-annotation",
			label: current?.kind === "arrow" ? "Duplicate arrow" : "Duplicate note",
			group: "Edit",
			chords: [{ code: "KeyD", mod: true }],
			enabled: idle,
			run: () => current && duplicate(current.id),
		},
		{
			id: "delete-annotation",
			label: current?.kind === "arrow" ? "Delete arrow" : "Delete note",
			group: "Arrange",
			chords: [{ key: "Backspace" }, { key: "Delete" }],
			enabled: idle,
			destructive: true,
			run: () => current && remove(current.id),
		},
		{
			id: "clear-annotation",
			label: "Clear note selection",
			group: "Edit",
			chords: [{ key: "Escape" }],
			enabled: idle || drawing !== null,
			hidden: true,
			run: () => {
				setDrawing(null);
				select(null);
			},
		},
	];

	return {
		annotations,
		selectedId: current ? current.id : null,
		editing,
		drawing,
		actions,
		select,
		startEditing: setEditing,
		startDrawing,
		cancelDrawing,
		drawNote,
		drawArrow,
		move,
		resize,
		moveEnds,
		setText,
		recolor,
		remove,
		duplicate,
	};
}
