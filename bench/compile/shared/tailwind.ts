import { compile } from "tailwindcss";

/** The input every screen shares; DESIGN.md tokens would be appended here. */
export const TAILWIND_INPUT = `@import "tailwindcss";`;

export function createTailwind(indexCss: string) {
	return compile(TAILWIND_INPUT, {
		base: "/",
		loadStylesheet: async (id, base) => {
			if (id !== "tailwindcss") throw new Error(`Unknown stylesheet ${id}`);

			return { path: "tailwindcss/index.css", base, content: indexCss };
		},
	});
}
