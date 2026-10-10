import {
	designTokensOf,
	orderedTokenNames,
	setDesignToken,
	validateToken,
	validateTokenName,
	type DesignTokens,
} from "./tokens";

export type TokenMode = "light" | "dark";

/** One edit from the token editor; each becomes one undo step */
export type TokenEdit =
	/** `null` removes the value in that mode */
	| { kind: "set"; name: string; mode: TokenMode; value: string | null }
	| { kind: "add"; name: string; light: string; dark?: string }
	| { kind: "rename"; from: string; to: string }
	| { kind: "remove"; name: string };

export type TokenForm = { name: string; light: string; dark: string };

export type TokenFormErrors = Partial<Record<keyof TokenForm, string>>;

const MODES: TokenMode[] = ["light", "dark"];

/** DESIGN.md writes names lowercase and without `--` */
export const normalizeTokenName = (raw: string) => raw.trim().toLowerCase().replace(/^--/, "");

const hasToken = (tokens: DesignTokens, name: string) => name in tokens.light || name in tokens.dark;

/** `null` when `from` can become `to` with the values it has */
export function renameError(tokens: DesignTokens, from: string, to: string): string | null {
	if (to === from) return null;

	if (hasToken(tokens, to)) return `${to} is already a token`;

	const nameError = validateTokenName(to);

	if (nameError) return nameError;

	for (const mode of MODES) {
		const value = tokens[mode][from];
		const reason = value === undefined ? null : validateToken(to, value);

		if (reason) return `${mode === "dark" ? "Dark" : "Light"} value ${value}: ${reason}`;
	}

	return null;
}

/** The add form as an edit, or why it can't be one. The dark value is optional. */
export function parseTokenForm(
	form: TokenForm,
	tokens: DesignTokens,
): { edit: TokenEdit; errors?: undefined } | { edit?: undefined; errors: TokenFormErrors } {
	const name = normalizeTokenName(form.name);
	const light = form.light.trim();
	const dark = form.dark.trim();
	const errors: TokenFormErrors = {};

	if (!name) errors.name = "Name the token";
	else if (hasToken(tokens, name)) errors.name = `${name} is already a token`;
	else {
		const nameError = validateTokenName(name);

		if (nameError) errors.name = nameError;
	}

	if (!errors.name) {
		const lightError = light ? validateToken(name, light) : "Give it a light value";
		const darkError = dark ? validateToken(name, dark) : null;

		if (lightError) errors.light = lightError;

		if (darkError) errors.dark = darkError;
	}

	if (errors.name || errors.light || errors.dark) return { errors };

	return { edit: dark ? { kind: "add", name, light, dark } : { kind: "add", name, light } };
}

/** DESIGN.md after the edit. Callers validate first; a rename keeps the valid values only. */
/**
 * A theme read with AI (decision 0009) isn't in DESIGN.md. Before the first edit in the token editor, its tokens are
 * written there, so the edit adds to the theme the screens show instead of replacing it.
 */
export function seedDesignTokens(markdown: string, applied: DesignTokens | undefined): string {
	if (!applied || hasAnyToken(designTokensOf(markdown))) return markdown;

	let text = markdown;

	for (const mode of MODES) {
		for (const name of orderedTokenNames(applied[mode])) text = setDesignToken(text, name, mode, applied[mode][name]!);
	}

	return text;
}

const hasAnyToken = (tokens: DesignTokens) =>
	Object.keys(tokens.light).length > 0 || Object.keys(tokens.dark).length > 0;

export function applyTokenEdit(markdown: string, edit: TokenEdit): string {
	switch (edit.kind) {
		case "set":
			return setDesignToken(markdown, edit.name, edit.mode, edit.value);
		case "add": {
			const light = setDesignToken(markdown, edit.name, "light", edit.light);

			return edit.dark === undefined ? light : setDesignToken(light, edit.name, "dark", edit.dark);
		}

		case "remove":
			return MODES.reduce((text, mode) => setDesignToken(text, edit.name, mode, null), markdown);
		case "rename": {
			if (edit.to === edit.from) return markdown;

			const tokens = designTokensOf(markdown);

			return MODES.reduce((text, mode) => {
				const value = tokens[mode][edit.from];
				const removed = setDesignToken(text, edit.from, mode, null);

				return value === undefined ? removed : setDesignToken(removed, edit.to, mode, value);
			}, markdown);
		}
	}
}
