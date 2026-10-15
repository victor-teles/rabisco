import { isString } from "./guards";
import { isJsonObject, type Json } from "./json";
import { sectionsAround, type Rect } from "./sections";
import type { CanvasSection, Frame, ModeChoices } from "./types";

export type ModeGroup = { name: string; options: readonly string[] };

export type ResolvedMode = Readonly<Record<string, string>>;

export const SCHEME = "scheme";

export const SCHEME_GROUP: ModeGroup = { name: SCHEME, options: ["light", "dark"] };

export const MODE_GROUPS: readonly ModeGroup[] = [SCHEME_GROUP];

const SLUG = /^[a-z0-9-]+$/;

export const isModeSlug = (value: string) => SLUG.test(value);

export function normalizeModes(raw: Json | undefined): ModeChoices | undefined {
	if (!isJsonObject(raw)) return undefined;
	const modes: ModeChoices = {};

	for (const [group, option] of Object.entries(raw)) {
		if (isString(option) && isModeSlug(group) && isModeSlug(option)) modes[group] = option;
	}

	return Object.keys(modes).length ? modes : undefined;
}

export const modeKey = (mode: ResolvedMode) =>
	Object.entries(mode)
		.map(([group, option]) => `${group}=${option}`)
		.join("&");

const interned = new Map<string, ResolvedMode>();

function intern(mode: ResolvedMode) {
	const key = modeKey(mode);
	const known = interned.get(key);

	if (known) return known;
	interned.set(key, mode);

	return mode;
}

export const inheritedModes = (section: CanvasSection, sections: readonly CanvasSection[]) =>
	resolveModes(
		{ x: section.x, y: section.y, width: section.width, height: section.height },
		sections.filter((other) => other.id !== section.id && other.width * other.height >= section.width * section.height),
	);

export function resolveModes(
	frame: Rect & { modes?: ModeChoices },
	sections: readonly CanvasSection[],
	groups: readonly ModeGroup[] = MODE_GROUPS,
): ResolvedMode {
	const choices = [frame.modes, ...sectionsAround(frame, sections).map((section) => section.modes)];
	const mode: Record<string, string> = {};

	for (const group of groups) {
		const chosen = choices.find((modes) => {
			const option = modes?.[group.name];

			return option !== undefined && group.options.includes(option);
		});

		mode[group.name] = chosen?.[group.name] ?? group.options[0] ?? "";
	}

	return intern(mode);
}

export const DEFAULT_MODE: ResolvedMode = intern(
	Object.fromEntries(MODE_GROUPS.map((group) => [group.name, group.options[0] ?? ""])),
);

export function targetModes(paths: readonly string[], frames: readonly Frame[], sections: readonly CanvasSection[]) {
	const modes: Record<string, ResolvedMode> = {};

	for (const path of paths) {
		const frame = frames.find((candidate) => candidate.file === path);

		if (frame) modes[path] = resolveModes(frame, sections);
	}

	return Object.keys(modes).length ? modes : undefined;
}

export function chooseMode(modes: ModeChoices | undefined, group: string, option: string | undefined) {
	const next: ModeChoices = { ...modes };

	if (option === undefined) delete next[group];
	else next[group] = option;

	return Object.keys(next).length ? next : undefined;
}

export const optionLabel = (option: string) => option.charAt(0).toUpperCase() + option.slice(1).replaceAll("-", " ");

export const modeLabel = (modes: ModeChoices) => Object.values(modes).map(optionLabel).join(", ");
