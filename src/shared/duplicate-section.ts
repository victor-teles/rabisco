import { chooseMode, optionLabel } from "./modes";
import { FRAME_GAP, uniqueScreenPath } from "./project";
import { retargetLinks } from "./prototype/links";
import { membersOf } from "./sections";
import type { CanvasSection, Frame, ProjectFiles } from "./types";

export type SectionCanvas = { sections: CanvasSection[]; frames: Frame[]; files: ProjectFiles };

export type ModePick = { group: string; option: string };

export function duplicateWithMode(
	canvas: SectionCanvas,
	id: string,
	pick: ModePick,
	copyId: string,
): SectionCanvas | null {
	const source = canvas.sections.find((section) => section.id === id);

	if (!source) return null;
	const members = membersOf(source, canvas.sections, canvas.frames);
	const dx = source.width + FRAME_GAP;
	const taken = new Set(Object.keys(canvas.files));
	const paths = new Map<string, string>();

	for (const file of members.frames) {
		const path = uniqueScreenPath(file.replace(/^screens\//, "").replace(/\.tsx$/, ""), taken);

		taken.add(path);
		paths.set(file, path);
	}

	const frames = canvas.frames.flatMap((frame) => {
		const file = paths.get(frame.file);

		if (!file) return [];
		const copy: Frame = { ...frame, file, name: `${frame.name} copy`, x: frame.x + dx };
		const modes = chooseMode(frame.modes, pick.group, undefined);

		if (modes) copy.modes = modes;
		else delete copy.modes;

		return [copy];
	});

	const nested = canvas.sections.flatMap((section) => {
		if (!members.sections.includes(section.id)) return [];
		const copy: CanvasSection = { ...section, id: crypto.randomUUID(), x: section.x + dx };
		const modes = chooseMode(section.modes, pick.group, undefined);

		if (modes) copy.modes = modes;
		else delete copy.modes;

		return [copy];
	});

	const label = optionLabel(pick.option);
	const named = source.modes?.[pick.group] && optionLabel(source.modes[pick.group]) === source.name;

	const section: CanvasSection = {
		...source,
		id: copyId,
		name: named ? label : `${source.name} ${label}`,
		x: source.x + dx,
		modes: chooseMode(source.modes, pick.group, pick.option),
	};

	const copies: ProjectFiles = {};

	for (const [from, to] of paths) copies[to] = canvas.files[from] ?? "";

	for (const [from, to] of paths) {
		for (const change of retargetLinks(copies, from, to))
			if (change.content !== null) copies[change.path] = change.content;
	}

	return {
		sections: [...canvas.sections, section, ...nested],
		frames: [...canvas.frames, ...frames],
		files: { ...canvas.files, ...copies },
	};
}
