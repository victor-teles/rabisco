/// <reference types="vite/client" />

const raw = import.meta.glob<string>("../components/ui/*.tsx", { query: "?raw", import: "default", eager: true });

export const UI_SOURCES: Record<string, string> = Object.fromEntries(
	Object.entries(raw).map(([path, source]) => [path.replace(/^.*\/([^/]+)\.tsx$/, "$1"), source]),
);
