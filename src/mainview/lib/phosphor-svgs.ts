/// <reference types="vite/client" />
// The regular weight of every Phosphor icon, for the icon picker's preview; a lazy chunk of icon-catalog.ts.
export const svgs = import.meta.glob<string>("../../../node_modules/@phosphor-icons/core/assets/regular/*.svg", {
	query: "?raw",
	import: "default",
	eager: true,
});
