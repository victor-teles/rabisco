import type { Action } from "@/lib/actions";
import type { DesignTokens } from "../../../shared/context/tokens";
import { groupLabel, modeGroups, optionLabel, resolveModes, SCHEME } from "../../../shared/modes";
import type { CanvasSection, Frame } from "../../../shared/types";
import { SEPARATOR, type MenuEntry } from "./action-menu";

const PREFIX = "screen-theme:";

const MODE_PREFIX = "screen-mode:";

export const THEME_MENU: MenuEntry = { label: "Theme", items: [`${PREFIX}*`, SEPARATOR, `${MODE_PREFIX}*`] };

type Options = {
	selected: Frame[];
	sections: CanvasSection[];
	theme: DesignTokens;
	setTheme: (files: string[], group: string, option: string | undefined) => void;
};

export function screenThemeActions({ selected, sections, theme, setTheme }: Options): Action[] {
	const files = selected.map((frame) => frame.file);

	return modeGroups(theme).flatMap((group) => {
		const scheme = group.name === SCHEME;
		const own = new Set(selected.map((frame) => frame.modes?.[group.name]));

		const inherited = new Set(
			selected.map((frame) => resolveModes({ ...frame, modes: undefined }, sections, theme)[group.name]),
		);

		const auto = inherited.size === 1 ? `Auto (${optionLabel([...inherited][0]!)})` : "Auto";
		const prefix = scheme ? PREFIX : `${MODE_PREFIX}${group.name}:`;
		const label = (text: string) => (scheme ? text : `${groupLabel(group.name)}: ${text}`);

		return [undefined, ...group.options].map((option) => ({
			id: `${prefix}${option ?? "auto"}`,
			label: label(option ? optionLabel(option) : auto),
			group: "Screen",
			enabled: files.length > 0,
			checked: own.size === 1 && own.has(option),
			hidden: true,
			run: () => setTheme(files, group.name, option),
		}));
	});
}
