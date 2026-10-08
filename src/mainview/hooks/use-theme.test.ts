import { expect, test } from "bun:test";
import { parseThemeChoice, resolveTheme } from "./use-theme";

test("follows the system until there is a choice", () => {
	expect(resolveTheme(null, true)).toBe("dark");
	expect(resolveTheme(null, false)).toBe("light");
	expect(resolveTheme("light", true)).toBe("light");
	expect(resolveTheme("dark", false)).toBe("dark");
});

test("only light and dark are choices", () => {
	expect(parseThemeChoice("dark")).toBe("dark");
	expect(parseThemeChoice("light")).toBe("light");
	expect(parseThemeChoice("system")).toBeNull();
	expect(parseThemeChoice(null)).toBeNull();
});
