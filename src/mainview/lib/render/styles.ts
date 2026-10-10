/// <reference types="vite/client" />
// One Tailwind build shared by every frame in the webview (decision 0002).
import tailwindIndex from "tailwindcss/index.css?raw";
import twAnimate from "../../../../node_modules/tw-animate-css/dist/tw-animate.css?raw";
import { isUiModule } from "../../../shared/components/ui-modules";
import { customTokenNames, tokensToCss, type DesignTokens } from "../../../shared/context/tokens";
import { UI_SOURCES } from "../ui-sources";
import { extractCandidates } from "./candidates";
import { createCompiler, TailwindBuilder } from "./tailwind";

/** Scanned so the classes inside the modules screens can import (shadcn and uai) are always built. */
const runtimeSources = Object.entries(UI_SOURCES).flatMap(([name, source]) => (isUiModule(name) ? [source] : []));

/** Only grows during a session, like the candidates: a name no open project uses builds nothing (decision 0013) */
const tokenNames = new Set<string>();

export const screenStyles = new TailwindBuilder(
	() => createCompiler({ tailwindcss: tailwindIndex, "tw-animate-css": twAnimate }, tokenNames),
	runtimeSources.flatMap(extractCandidates),
);

const themeCache = new WeakMap<DesignTokens, string>();

/**
 * Loaded after the shared Tailwind stylesheet so the applied tokens re-theme screens without a rebuild. A custom
 * token name the compiler hasn't seen restarts it once, so `bg-brand` gets built.
 */
export function themeCss(tokens: DesignTokens): string {
	let css = themeCache.get(tokens);

	if (css !== undefined) return css;

	const size = tokenNames.size;

	for (const name of customTokenNames(tokens)) tokenNames.add(name);

	if (tokenNames.size !== size) screenStyles.restart();
	themeCache.set(tokens, (css = tokensToCss(tokens)));

	return css;
}
