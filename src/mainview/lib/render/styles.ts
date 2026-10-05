/// <reference types="vite/client" />
// One Tailwind build shared by every frame in the webview (decision 0002).
import tailwindIndex from "tailwindcss/index.css?raw";
import twAnimate from "../../../../node_modules/tw-animate-css/dist/tw-animate.css?raw";
import { extractCandidates } from "./candidates";
import { createCompiler, TailwindBuilder } from "./tailwind";

/** Scanned so the runtime shadcn components' classes are always built. */
const runtimeSources = import.meta.glob<string>("../../components/ui/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
});

export const screenStyles = new TailwindBuilder(
	() => createCompiler({ tailwindcss: tailwindIndex, "tw-animate-css": twAnimate }),
	Object.values(runtimeSources).flatMap(extractCandidates),
);
