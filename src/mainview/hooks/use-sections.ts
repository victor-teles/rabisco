import { useCallback, useState } from "react";
import type { ChangeOptions, ProjectState } from "@/hooks/use-project";
import type { Action } from "@/lib/actions";
import type { Snapshot } from "@/lib/history";
import { chooseMode } from "../../shared/modes";
import { moveSection, nextSectionName, sectionAround } from "../../shared/sections";
import type { CanvasSection, Frame, SectionColor } from "../../shared/types";

type Rect = { x: number; y: number; width: number; height: number };

type Options = {
	stateRef: React.RefObject<ProjectState | null>;
	sections?: CanvasSection[];
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	selected: Frame[];
	setSelection: (selection: string[]) => void;
};

const NO_SECTIONS: CanvasSection[] = [];

const patchSection = (snapshot: Snapshot, id: string, patch: Partial<Omit<CanvasSection, "id">>): Snapshot => ({
	...snapshot,
	sections: (snapshot.sections ?? NO_SECTIONS).map((section) =>
		section.id === id ? { ...section, ...patch } : section,
	),
});

export function useSections({ stateRef, sections = NO_SECTIONS, change, selected, setSelection }: Options) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [drawing, setDrawing] = useState(false);
	const current = selectedId ? sections.find((section) => section.id === selectedId) : undefined;

	if (selectedId && !current) setSelectedId(null);

	const screensSelected = selected.length > 0;
	const [hadScreens, setHadScreens] = useState(screensSelected);

	if (hadScreens !== screensSelected) {
		setHadScreens(screensSelected);

		if (screensSelected) setSelectedId(null);
	}

	const select = useCallback(
		(id: string | null) => {
			setSelectedId(id);
			setDrawing(false);

			if (id) setSelection([]);
		},
		[setSelection],
	);

	const add = useCallback(
		(section: CanvasSection) => {
			change((snapshot) => ({ ...snapshot, sections: [...(snapshot.sections ?? NO_SECTIONS), section] }), {
				select: [],
			});
			setSelectedId(section.id);
			setRenaming(section.id);
			setDrawing(false);
		},
		[change],
	);

	const draw = useCallback(
		(rect: Rect) => add({ id: crypto.randomUUID(), name: nextSectionName(sections), color: "gray", ...rect }),
		[add, sections],
	);

	const create = () => {
		const around = sectionAround(selected, crypto.randomUUID(), nextSectionName(sections));

		if (around) add(around);
		else setDrawing(true);
	};

	const rename = useCallback(
		(id: string, name: string | null) => {
			setRenaming(null);
			const next = name?.trim();
			const section = stateRef.current?.canvas.sections?.find((s) => s.id === id);

			if (next && section && next !== section.name) change((snapshot) => patchSection(snapshot, id, { name: next }));
		},
		[change, stateRef],
	);

	const recolor = useCallback(
		(id: string, color: SectionColor) => change((snapshot) => patchSection(snapshot, id, { color })),
		[change],
	);

	const setTheme = useCallback(
		(id: string, group: string, option: string | undefined) =>
			change((snapshot) => ({
				...snapshot,
				sections: (snapshot.sections ?? NO_SECTIONS).map((section) =>
					section.id === id ? { ...section, modes: chooseMode(section.modes, group, option) } : section,
				),
			})),
		[change],
	);

	const remove = useCallback(
		(id: string) =>
			change((snapshot) => ({
				...snapshot,
				sections: (snapshot.sections ?? NO_SECTIONS).filter((section) => section.id !== id),
			})),
		[change],
	);

	const resize = useCallback(
		(id: string, rect: Rect) => change((snapshot) => patchSection(snapshot, id, rect)),
		[change],
	);

	const move = useCallback(
		(id: string, dx: number, dy: number, dragId: string) =>
			change(
				(snapshot) => ({ ...snapshot, ...moveSection(snapshot.sections ?? NO_SECTIONS, snapshot.frames, id, dx, dy) }),
				{
					coalesce: `section:${dragId}`,
				},
			),
		[change],
	);

	const actions: Action[] = [
		{
			id: "add-section",
			label: screensSelected ? "Add section around selection" : "Add section",
			group: "Arrange",
			chords: [{ code: "KeyS", shift: true }],
			enabled: true,
			run: create,
		},
		{
			id: "rename-section",
			label: "Rename section",
			group: "Arrange",
			chords: [{ code: "KeyR", mod: true }],
			enabled: current !== undefined && !screensSelected,
			run: () => current && setRenaming(current.id),
		},
		{
			id: "delete-section",
			label: "Delete section",
			group: "Arrange",
			chords: [{ key: "Backspace" }, { key: "Delete" }],
			enabled: current !== undefined,
			destructive: true,
			run: () => current && remove(current.id),
		},
		{
			id: "clear-section",
			label: "Clear section selection",
			group: "Edit",
			chords: [{ key: "Escape" }],
			enabled: current !== undefined || drawing,
			hidden: true,
			run: () => select(null),
		},
	];

	return {
		sections,
		selectedId: current ? current.id : null,
		renaming,
		drawing,
		actions,
		select,
		draw,
		startRename: setRenaming,
		rename,
		recolor,
		setTheme,
		remove,
		move,
		resize,
		create,
		cancelDrawing: () => setDrawing(false),
	};
}
