import {
	customTokenNames,
	orderedTokenNames,
	tokenKind,
	tokenUtility,
	type DesignTokens,
	type TokenKind,
} from "../../shared/context/tokens";

const SEMANTIC = `- Built in: bg-, text- and border- with background, foreground, card, popover, primary, secondary, muted, accent (each with a -foreground pair), destructive, success, warning, border, input, ring, chart-1 to chart-5; rounded-sm to rounded-xl (they follow radius); font-sans, font-serif, font-mono.`;

const CLASSES: Record<TokenKind, (utility: string) => string[]> = {
	color: (utility) => [`bg-${utility}`, `text-${utility}`, `border-${utility}`],
	radius: (utility) => [`rounded-${utility}`],
	font: (utility) => [`font-${utility}`],
	text: (utility) => [`text-${utility}`],
	spacing: (utility) => [`p-${utility}`, `gap-${utility}`],
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

	return lines.join("\n");
}
