import type { Action } from "@/lib/actions";
import { optionLabel, resolveModes, SCHEME, SCHEME_GROUP } from "../../../shared/modes";
import type { CanvasSection, Frame } from "../../../shared/types";
import type { MenuEntry } from "./action-menu";

const PREFIX = "screen-theme:";

export const THEME_MENU: MenuEntry = { label: "Theme", items: [`${PREFIX}*`] };

type Options = {
	selected: Frame[];
	sections: CanvasSection[];
	setTheme: (files: string[], option: string | undefined) => void;
};

export function screenThemeActions({ selected, sections, setTheme }: Options): Action[] {
	const own = new Set(selected.map((frame) => frame.modes?.[SCHEME]));
	const inherited = new Set(selected.map((frame) => resolveModes({ ...frame, modes: undefined }, sections)[SCHEME]));
	const files = selected.map((frame) => frame.file);
	const auto = inherited.size === 1 ? `Auto (${optionLabel([...inherited][0]!)})` : "Auto";

	return [undefined, ...SCHEME_GROUP.options].map((option) => ({
		id: `${PREFIX}${option ?? "auto"}`,
		label: option ? optionLabel(option) : auto,
		group: "Screen",
		enabled: files.length > 0,
		checked: own.size === 1 && own.has(option),
		hidden: true,
		run: () => setTheme(files, option),
	}));
}
