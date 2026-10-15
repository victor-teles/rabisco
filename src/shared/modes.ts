import {
	validateToken,
	type DesignTokens,
	type TokenModeOption,
	type TokenModeGroup,
	type TokenSet,
} from "./context/tokens";
import { isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import { sectionsAround, type Rect } from "./sections";
import type { CanvasSection, Frame, ModeChoices } from "./types";

export type ModeGroup = { name: string; options: readonly string[] };

export type ResolvedMode = Readonly<Record<string, string>>;

export const SCHEME = "scheme";

export const SCHEME_GROUP: ModeGroup = { name: SCHEME, options: ["light", "dark"] };

const SCHEME_ONLY: readonly ModeGroup[] = [SCHEME_GROUP];

const groupsCache = new WeakMap<DesignTokens, readonly ModeGroup[]>();

/** The scheme group, then the applied theme's groups in DESIGN.md order */
export function modeGroups(theme: DesignTokens): readonly ModeGroup[] {
	if (!theme.modes?.length) return SCHEME_ONLY;
	const known = groupsCache.get(theme);

	if (known) return known;

	const groups = [
		SCHEME_GROUP,
		...theme.modes.map((group) => ({ name: group.name, options: group.options.map((option) => option.name) })),
	];

	groupsCache.set(theme, groups);

	return groups;
}

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

function tokenValues(raw: Json | undefined): TokenSet {
	const values: TokenSet = {};

	if (!isJsonObject(raw)) return values;

	for (const [name, value] of Object.entries(raw)) {
		if (isString(value) && validateToken(name, value) === null) values[name] = value;
	}

	return values;
}

/** An applied theme's groups from `rabisco.json`; names that aren't slugs, and repeated ones, are dropped */
export function normalizeTokenModes(raw: Json | undefined): TokenModeGroup[] | undefined {
	if (!isJsonArray(raw)) return undefined;
	const groups: TokenModeGroup[] = [];

	for (const group of raw) {
		if (!isJsonObject(group) || !isString(group.name) || !isModeSlug(group.name) || group.name === SCHEME) continue;

		if (groups.some((known) => known.name === group.name) || !isJsonArray(group.options)) continue;
		const options: TokenModeOption[] = [];

		for (const option of group.options) {
			if (!isJsonObject(option) || !isString(option.name) || !isModeSlug(option.name)) continue;

			if (!options.some((known) => known.name === option.name))
				options.push({ name: option.name, light: tokenValues(option.light), dark: tokenValues(option.dark) });
		}

		if (options.length) groups.push({ name: group.name, options });
	}

	return groups.length ? groups : undefined;
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

export const inheritedModes = (section: CanvasSection, sections: readonly CanvasSection[], theme: DesignTokens) =>
	resolveModes(
		{ x: section.x, y: section.y, width: section.width, height: section.height },
		sections.filter((other) => other.id !== section.id && other.width * other.height >= section.width * section.height),
		theme,
	);

export function resolveModes(
	frame: Rect & { modes?: ModeChoices },
	sections: readonly CanvasSection[],
	theme: DesignTokens,
): ResolvedMode {
	const groups = modeGroups(theme);
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

export const defaultMode = (theme: DesignTokens) => resolveModes({ x: 0, y: 0, width: 0, height: 0 }, [], theme);

/** Without a theme: only the scheme group */
export const DEFAULT_MODE: ResolvedMode = defaultMode({ light: {}, dark: {} });

export function targetModes(
	paths: readonly string[],
	frames: readonly Frame[],
	sections: readonly CanvasSection[],
	theme: DesignTokens,
) {
	const modes: Record<string, ResolvedMode> = {};

	for (const path of paths) {
		const frame = frames.find((candidate) => candidate.file === path);

		if (frame) modes[path] = resolveModes(frame, sections, theme);
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

export const groupLabel = (group: string) => (group === SCHEME ? "Theme" : optionLabel(group));

export const modeLabel = (modes: ModeChoices) => Object.values(modes).map(optionLabel).join(", ");
