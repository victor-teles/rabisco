import {
	customTokenNames,
	orderedTokenNames,
	tokenKind,
	tokenUtility,
	type DesignTokens,
	type TokenKind,
} from "../../shared/context/tokens";
import { modeAttributes } from "../../shared/export/html";
import { SCHEME, type ResolvedMode } from "../../shared/modes";

const SEMANTIC = `- Built in: bg-, text- and border- with background, foreground, card, popover, primary, secondary, muted, accent (each with a -foreground pair), destructive, success, warning, border, input, ring, chart-1 to chart-5; rounded-sm to rounded-xl (they follow radius); font-sans, font-serif, font-mono.`;

const CLASSES: Record<TokenKind, (utility: string) => string[]> = {
	color: (utility) => [`bg-${utility}`, `text-${utility}`, `border-${utility}`],
	radius: (utility) => [`rounded-${utility}`],
	font: (utility) => [`font-${utility}`],
	"font-weight": (utility) => [`font-${utility}`],
	text: (utility) => [`text-${utility}`],
	spacing: (utility) => [`p-${utility}`, `gap-${utility}`],
	shadow: (utility) => [`shadow-${utility}`],
	duration: (utility) => [`duration-${utility}`],
	ease: (utility) => [`ease-${utility}`],
};

/** `#e11d48, dark #fb7185`; a token set in one mode only shows that mode */
function valuesOf(tokens: DesignTokens, name: string) {
	const light = tokens.light[name];
	const dark = tokens.dark[name];

	if (light === undefined) return `dark ${dark}`;

	return dark === undefined || dark === light ? light : `${light}, dark ${dark}`;
}

/** The token classes screens can use, for screen prompts; `null` when the theme sets nothing */
export function themeTokensText(tokens: DesignTokens): string | null {
	const custom = new Set(customTokenNames(tokens));
	const builtIn = orderedTokenNames(tokens.light, tokens.dark).filter((name) => !custom.has(name) && tokenKind(name));

	if (!custom.size && !builtIn.length) return null;

	const lines = [
		"# Theme tokens",
		"Screens render with the project's theme. Use these classes rather than raw values (hex or rgb colors, Tailwind palette colors, arbitrary [...] values), so a token change re-themes every screen.",
		SEMANTIC,
	];

	if (builtIn.length)
		lines.push(`- Set by this project: ${builtIn.map((name) => `${name}: ${valuesOf(tokens, name)}`).join("; ")}`);

	for (const name of custom) {
		const kind = tokenKind(name);

		if (kind) lines.push(`- ${CLASSES[kind](tokenUtility(name)).join(" / ")} (${name}: ${valuesOf(tokens, name)})`);
	}

	if ([...custom].some((name) => tokenKind(name) === "text")) {
		lines.push(
			"- A text-* token is a text style: its one class sets the size and any line height, weight and tracking it lists. Don't add font-*, leading-* or tracking-* classes next to it unless the design needs a change.",
		);
	}

	return lines.join("\n");
}

/** The targets that render in a mode other than the default, and the token values that apply there */
export function modesText(modes: Record<string, ResolvedMode>, tokens: DesignTokens | undefined): string | null {
	const screens = Object.entries(modes);

	if (!screens.length) return null;

	const lines = [
		"# Modes",
		"These screens render in a mode on the canvas. Rabisco sets it on <html>, so don't set it in the screen:",
		...screens.map(
			([path, mode]) => `- ${path}: ${Object.values(mode).join(", ")} (${modeAttributes(mode).trim() || "no class"})`,
		),
		"Use the token classes, not raw colors: they take the mode's values, so the screen follows its mode.",
	];

	const dark = Object.entries(tokens?.dark ?? {});

	if (screens.some(([, mode]) => mode[SCHEME] === "dark") && dark.length)
		lines.push(`- Dark values: ${dark.map(([name, value]) => `${name}: ${value}`).join("; ")}`);

	for (const group of tokens?.modes ?? []) {
		for (const option of group.options) {
			const values = [
				...Object.entries(option.light).map(([name, value]) => `${name}: ${value}`),
				...Object.entries(option.dark).map(([name, value]) => `${name} (dark): ${value}`),
			];

			if (values.length && screens.some(([, mode]) => mode[group.name] === option.name))
				lines.push(`- ${group.name} ${option.name} values, over the project's: ${values.join("; ")}`);
		}
	}

	return lines.join("\n");
}
