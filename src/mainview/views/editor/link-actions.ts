import type { Action } from "@/lib/actions";
import { findElement, parseJsx } from "../../../shared/jsx";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import { BACK, hasExpressionLink, linkOfElement, resolveLink, type LinkEdit } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { type MenuEntry, SEPARATOR } from "./action-menu";
import type { ElementRef } from "./canvas";

const LINK_TO_PREFIX = "link-to:";

const LINK_BACK = "link-back";

const REMOVE_LINK = "remove-link";

export const LINK_MENU: MenuEntry = {
	label: "Link to",
	items: [`${LINK_TO_PREFIX}*`, SEPARATOR, LINK_BACK, SEPARATOR, REMOVE_LINK],
};

type LinkState = { editable: boolean; written: string | null; current: string | null };

export function linkState(files: ProjectFiles, element: ElementRef | null): LinkState {
	const source = element ? files[element.file] : undefined;
	const node = element && source !== undefined ? findElement(parseJsx(source), element.start) : null;

	if (!node || node.name === null || hasExpressionLink(node)) return { editable: false, written: null, current: null };
	const written = linkOfElement(node);
	const target = written === null ? null : resolveLink(written, files);
	const current = target?.kind === "screen" ? target.file : target?.kind === "back" ? BACK : null;

	return { editable: true, written, current };
}

type Options = {
	element: ElementRef | null;
	files: ProjectFiles;
	frames: Frame[];
	changeLink: (element: ElementRef, edit: LinkEdit) => void;
};

export function linkActions({ element, files, frames, changeLink }: Options): Action[] {
	const { editable, written, current } = linkState(files, element);
	const link = (to: string | null) => element && changeLink(element, { to });

	const targets = frames.filter(
		(frame) => isScreenFile(frame.file) && files[frame.file] !== undefined && frame.file !== element?.file,
	);

	return [
		...targets.map((frame): Action => ({
			id: `${LINK_TO_PREFIX}${frame.file}`,
			label: frame.name || screenNameFromPath(frame.file),
			group: "Prototype",
			enabled: editable,
			checked: current === frame.file,
			hidden: true,
			run: () => link(frame.file),
		})),
		{
			id: LINK_BACK,
			label: "Back",
			group: "Prototype",
			enabled: editable,
			checked: current === BACK,
			hidden: true,
			run: () => link(BACK),
		},
		{
			id: REMOVE_LINK,
			label: "Remove link",
			group: "Prototype",
			enabled: editable && written !== null,
			run: () => link(null),
		},
	];
}
