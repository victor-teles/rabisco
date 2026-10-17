import type { Action } from "@/lib/actions";
import { MOTION_KIND_LABELS, MOTION_KINDS, MOTION_PRESETS, presetsIn } from "../../../shared/motion/presets";
import { readClassName } from "../../../shared/tailwind/classes";
import type { ProjectFiles } from "../../../shared/types";
import type { MenuEntry } from "./action-menu";
import type { ElementRef } from "./canvas";

const MOTION_PREFIX = "motion:";

/** One submenu per kind; a checked preset is on the element, and picking it again removes it */
export const MOTION_MENU: MenuEntry = {
	label: "Motion",
	items: MOTION_KINDS.map((kind) => ({ label: MOTION_KIND_LABELS[kind], items: [`${MOTION_PREFIX}${kind}-*`] })),
};

type Options = {
	element: ElementRef | null;
	extras: ElementRef[];
	files: ProjectFiles;
	/** Toggles the preset on the selection, as one undo step */
	toggle: (preset: string, on: boolean) => void;
};

export function motionActions({ element, extras, files, toggle }: Options): Action[] {
	const source = element ? files[element.file] : undefined;
	const info = element && source !== undefined ? readClassName(source, element.start) : null;
	const own = info?.editable && !extras.length ? presetsIn(info.classes) : [];

	return MOTION_PRESETS.map((preset): Action => {
		const checked = own.some((applied) => applied.id === preset.id);

		return {
			id: `${MOTION_PREFIX}${preset.id}`,
			label: preset.name,
			group: "Motion",
			enabled: !!info?.editable,
			checked,
			hidden: true,
			run: () => toggle(preset.id, !checked),
		};
	});
}
