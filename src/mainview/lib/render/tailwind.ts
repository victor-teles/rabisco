import { compile } from "tailwindcss";
import { SCREEN_THEME_CSS } from "./theme";

type Compiler = { build(candidates: string[]): string };

export type StylesheetSources = Record<string, string>;

export function screenInput(stylesheets: StylesheetSources) {
	const imports = Object.keys(stylesheets).map((id) => `@import "${id}";`);

	return `${imports.join("\n")}\n${SCREEN_THEME_CSS}`;
}

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
 * Rebuilds only when the candidate union gains a class; `reset()` drops it back to the base set.
 * `add()` only queues: the batch builds once when `css` is read or at the end of the task, and
 * listeners hear about the result once per batch.
 */
export class TailwindBuilder {
	#create: () => Promise<Compiler>;
	#base: string[];
	#compiler: Compiler | null = null;
	#ready!: Promise<void>;
	#generation = 0;
	#known = new Set<string>();
	#pending: string[] = [];
	#scheduled = false;
	#css = "";
	#announced = "";
	#listeners = new Set<(css: string) => void>();
	builds = 0;
	/** How many times listeners were told about new CSS. */
	broadcasts = 0;

	constructor(create: () => Promise<Compiler>, baseCandidates: Iterable<string> = []) {
		this.#create = create;
		this.#base = [...baseCandidates];
		this.#start([]);
	}

	get ready() {
		return this.#compiler !== null;
	}

	/** Builds what `add()` queued first, so callers always read CSS for every class they added. */
	get css() {
		this.flush();

		return this.#css;
	}

	whenReady() {
		return this.#ready;
	}

	/** Tailwind's compiler keeps every candidate it has built, so a reset needs a fresh one. `extra` joins the first build. */
	reset(extra: Iterable<string> = []) {
		this.#compiler = null;
		this.#start(extra);
	}

	#start(extra: Iterable<string>) {
		const generation = ++this.#generation;
		this.#known = new Set(this.#base);
		this.#pending = [];

		for (const candidate of extra) this.#known.add(candidate);
		this.#ready = this.#create().then((compiler) => {
			if (generation !== this.#generation) return this.#ready;
			this.#compiler = compiler;
			this.#build([...this.#known]);
			this.#announce();
		});
		this.#ready.catch((error) => console.error("[render] Tailwind failed to start", error));
	}

	/** Returns whether any candidate was new. Before the compiler is ready they join its first build. */
	add(candidates: Iterable<string>): boolean {
		let fresh = false;

		for (const candidate of candidates) {
			if (this.#known.has(candidate)) continue;
			this.#known.add(candidate);
			fresh = true;

			if (this.#compiler) this.#pending.push(candidate);
		}

		if (fresh && this.#compiler && !this.#scheduled) {
			this.#scheduled = true;
			queueMicrotask(() => {
				this.#scheduled = false;
				this.flush();
				this.#announce();
			});
		}

		return fresh;
	}

	/** Builds the queued candidates now. Returns whether the CSS changed. */
	flush(): boolean {
		if (this.#pending.length === 0 || !this.#compiler) return false;
		const fresh = this.#pending;
		this.#pending = [];

		return this.#build(fresh);
	}

	subscribe(listener: (css: string) => void) {
		this.#listeners.add(listener);

		return () => void this.#listeners.delete(listener);
	}

	#build(fresh: string[]) {
		this.builds++;
		const css = this.#compiler!.build(fresh);

		if (css === this.#css) return false;
		this.#css = css;

		return true;
	}

	#announce() {
		if (this.#css === this.#announced) return;
		this.#announced = this.#css;
		this.broadcasts++;

		for (const listener of this.#listeners) listener(this.#css);
	}
}
