/// <reference types="vite/client" />
/** The Tailwind build shared by every frame in this webview (one per project, decision 0002). */
import tailwindIndex from "tailwindcss/index.css?raw";
import twAnimate from "../../../../node_modules/tw-animate-css/dist/tw-animate.css?raw";
import { extractCandidates } from "./candidates";
import { createCompiler, TailwindBuilder } from "./tailwind";

/** Sources of the shadcn components in the screen runtime, so their classes are always built. */
const runtimeSources = import.meta.glob<string>("../../components/ui/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
});

export const screenStyles = new TailwindBuilder(
	() => createCompiler({ tailwindcss: tailwindIndex, "tw-animate-css": twAnimate }),
	Object.values(runtimeSources).flatMap(extractCandidates),
);
