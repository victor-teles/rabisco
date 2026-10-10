/// <reference types="vite/client" />

const raw = import.meta.glob<string>("../components/ui/**/*.tsx", { query: "?raw", import: "default", eager: true });

/** By module name: `button` for `@/components/ui/button`, `uai/message` for `@/components/ui/uai/message` */
export const UI_SOURCES: Record<string, string> = Object.fromEntries(
	Object.entries(raw).map(([path, source]) => [path.replace(/^.*\/components\/ui\/(.+)\.tsx$/, "$1"), source]),
);
