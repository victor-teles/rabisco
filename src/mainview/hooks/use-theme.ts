import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Only an explicit pick is stored; without one the app follows the system. */
const STORAGE_KEY = "rabisco:theme-choice";

/** Older builds stored whatever the system was at first launch, which froze it: that value isn't a choice */
const LEGACY_KEY = "rabisco:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export const parseThemeChoice = (value: string | null): Theme | null =>
	value === "light" || value === "dark" ? value : null;

export const resolveTheme = (choice: Theme | null, systemDark: boolean): Theme =>
	choice ?? (systemDark ? "dark" : "light");

function storedChoice(): Theme | null {
	try {
		localStorage.removeItem(LEGACY_KEY);

		return parseThemeChoice(localStorage.getItem(STORAGE_KEY));
	} catch {
		return null;
	}
}

export function useTheme() {
	const [choice, setChoice] = useState<Theme | null>(storedChoice);
	const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
	const theme = resolveTheme(choice, systemDark);

	useEffect(() => {
		const media = window.matchMedia(DARK_QUERY);
		const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
		media.addEventListener("change", onChange);

		return () => media.removeEventListener("change", onChange);
	}, []);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
	}, [theme]);

	const toggleTheme = useCallback(() => {
		const next = theme === "dark" ? "light" : "dark";
		setChoice(next);

		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Private mode: the choice lasts for this session
		}
	}, [theme]);

	return { theme, toggleTheme };
}
