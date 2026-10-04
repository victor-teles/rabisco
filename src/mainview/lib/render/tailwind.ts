import { compile } from "tailwindcss";
import { SCREEN_THEME_CSS } from "./theme";

type Compiler = { build(candidates: string[]): string };

/** Stylesheets `@import`ed by the screen input, keyed by import id. */
export type StylesheetSources = Record<string, string>;

/** Input CSS shared by every screen: Tailwind, animations and the theme tokens. */
export function screenInput(stylesheets: StylesheetSources) {
	const imports = Object.keys(stylesheets).map((id) => `@import "${id}";`);
	return `${imports.join("\n")}\n${SCREEN_THEME_CSS}`;
}

/** Creates a Tailwind compiler that resolves `@import`s from in-memory stylesheets. */
export function createCompiler(stylesheets: StylesheetSources): Promise<Compiler> {
	return compile(screenInput(stylesheets), {
		base: "/",
		loadStylesheet: async (id, base) => {
			const content = stylesheets[id];
			if (content === undefined) throw new Error(`Unknown stylesheet ${id}`);
			return { path: id, base, content };
		},
	});
}

/**
 * Incremental Tailwind build shared by all frames. Keeps the union of class candidates and
 * builds only when that union gains a class. The candidate set only grows during a session.
 */
export class TailwindBuilder {
	#compiler: Compiler | null = null;
	#ready: Promise<void>;
	#known = new Set<string>();
	#listeners = new Set<(css: string) => void>();
	css = "";
	builds = 0;

	constructor(create: () => Promise<Compiler>, baseCandidates: Iterable<string> = []) {
		for (const candidate of baseCandidates) this.#known.add(candidate);
		this.#ready = create().then((compiler) => {
			this.#compiler = compiler;
			this.#build([...this.#known]);
		});
		this.#ready.catch((error) => console.error("[render] Tailwind failed to start", error));
	}

	get ready() {
		return this.#compiler !== null;
	}

	whenReady() {
		return this.#ready;
	}

	/** Adds candidates and rebuilds if any is new. Returns whether the CSS changed. */
	add(candidates: Iterable<string>): boolean {
		const fresh: string[] = [];
		for (const candidate of candidates) {
			if (!this.#known.has(candidate)) {
				this.#known.add(candidate);
				fresh.push(candidate);
			}
		}
		if (fresh.length === 0 || !this.#compiler) return false;
		return this.#build(fresh);
	}

	/** Called with the new stylesheet whenever it changes. */
	subscribe(listener: (css: string) => void) {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	#build(fresh: string[]) {
		this.builds++;
		const css = this.#compiler!.build(fresh);
		if (css === this.css) return false;
		this.css = css;
		for (const listener of this.#listeners) listener(css);
		return true;
	}
}
