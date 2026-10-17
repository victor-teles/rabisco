import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ChangeOptions, ProjectState } from "@/hooks/use-project";
import type { Action } from "@/lib/actions";
import type { Snapshot } from "@/lib/history";
import { addPage, deletePage, moveToPage, renamePage } from "@/lib/pages";
import { nextPageName } from "../../shared/pages";
import type { CanvasPage, Frame } from "../../shared/types";

type Options = {
	stateRef: React.RefObject<ProjectState | null>;
	pages: CanvasPage[];
	page: string | undefined;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	setPage: (page: string) => void;
	undo: () => void;
	selected: Frame[];
};

const ONE_PAGE: CanvasPage[] = [{ id: "", name: "Page 1" }];

export const movePageActionId = (id: string) => `move-to-page:${id}`;

export function usePages({ stateRef, pages, page, change, setPage, undo, selected }: Options) {
	const [renaming, setRenaming] = useState<string | null>(null);
	const shown = pages.length ? pages : ONE_PAGE;
	const found = shown.findIndex((each) => each.id === page);
	const index = Math.max(0, found);
	const current = shown[index]!;

	const add = useCallback(
		(name?: string) => {
			const id = crypto.randomUUID();

			change((snapshot) =>
				addPage(snapshot, { id, name: name ?? nextPageName(snapshot.pages ?? ONE_PAGE) }, crypto.randomUUID()),
			);
			setPage(id);

			return id;
		},
		[change, setPage],
	);

	const rename = useCallback(
		(id: string, name: string | null) => {
			setRenaming(null);

			if (name === null) return;

			if (id) change((snapshot) => renamePage(snapshot, id, name));
			else if (name.trim() && name.trim() !== ONE_PAGE[0]!.name)
				change((snapshot) => {
					const added = addPage(snapshot, { id: crypto.randomUUID(), name: "" }, crypto.randomUUID());
					const first = added.pages![0]!;

					return renamePage({ ...added, pages: [first] }, first.id, name);
				});
		},
		[change],
	);

	const remove = useCallback(
		(id: string) => {
			const doomed = shown.find((each) => each.id === id);

			if (!doomed || shown.length < 2) return;
			change((snapshot) => deletePage(snapshot, id), { select: [] });
			const step = stateRef.current?.history.present;

			toast(`Deleted ${doomed.name}`, {
				id: "delete-page",
				description: "Its screens, sections, images and notes went with it.",
				action: {
					label: "Undo",
					onClick: () => {
						if (stateRef.current?.history.present !== step)
							return void toast("Other edits came after the delete", { description: "Press ⌘Z to step back to it." });
						undo();
						setPage(id);
					},
				},
			});
		},
		[shown, change, stateRef, undo, setPage],
	);

	const go = useCallback((id: string) => id && setPage(id), [setPage]);

	const step = (by: number) => {
		const next = shown[(index + by + shown.length) % shown.length];

		if (next && next !== current) go(next.id);
	};

	const moveSelection = (target: string) => {
		const files = selected.map((frame) => frame.file);
		const name = shown.find((each) => each.id === target)?.name;

		if (!files.length || !name) return;
		change((snapshot) => moveToPage(snapshot, files, target), { select: [] });

		toast(files.length === 1 ? `Moved 1 screen to ${name}` : `Moved ${files.length} screens to ${name}`, {
			id: "move-to-page",
			action: { label: "Go to page", onClick: () => go(target) },
		});
	};

	const moveToNewPage = () => {
		const files = selected.map((frame) => frame.file);

		if (!files.length) return;
		const id = crypto.randomUUID();

		change((snapshot) => {
			const added = addPage(snapshot, { id, name: nextPageName(snapshot.pages ?? ONE_PAGE) }, crypto.randomUUID());

			return moveToPage(added, files, id);
		});
		setPage(id);
	};

	const actions: Action[] = [
		{
			id: "add-page",
			label: "Add page",
			group: "Pages",
			enabled: true,
			run: () => add(),
		},
		{
			id: "next-page",
			label: "Next page",
			group: "Pages",
			chords: [{ key: "PageDown" }],
			enabled: shown.length > 1,
			run: () => step(1),
		},
		{
			id: "previous-page",
			label: "Previous page",
			group: "Pages",
			chords: [{ key: "PageUp" }],
			enabled: shown.length > 1,
			run: () => step(-1),
		},
		{
			id: "rename-page",
			label: "Rename page",
			group: "Pages",
			enabled: true,
			run: () => setRenaming(current.id),
		},
		{
			id: "delete-page",
			label: "Delete page",
			group: "Pages",
			enabled: shown.length > 1,
			destructive: true,
			run: () => remove(current.id),
		},
		...shown.map((each): Action => ({
			id: movePageActionId(each.id),
			label: each.name,
			group: "Move to page",
			enabled: each.id !== current.id && selected.length > 0,
			hidden: true,
			run: () => moveSelection(each.id),
		})),
		{
			id: "move-to-new-page",
			label: "Move to new page",
			group: "Pages",
			enabled: selected.length > 0,
			run: moveToNewPage,
		},
	];

	return { pages: shown, current, renaming, actions, add, rename, remove, go, startRename: setRenaming };
}
