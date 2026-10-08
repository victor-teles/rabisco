import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMockScreens } from "../../../shared/mock-generator";
import type { ProjectFiles } from "../../../shared/types";
import { projectCandidates } from "./candidates";
import { CompileCache } from "./compile";
import { collectGraph } from "./graph";
import { createCompiler, TailwindBuilder } from "./tailwind";

const root = join(import.meta.dir, "../../../..");

const stylesheets = {
	tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
	"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
};

const create = () => createCompiler(stylesheets);

function project(screens: number): ProjectFiles {
	const files: ProjectFiles = {};

	for (let round = 0; Object.keys(files).filter((p) => p.startsWith("screens/")).length < screens; round++) {
		const device = round % 2 ? "desktop" : "mobile";
		const result = generateMockScreens({ prompt: `Idea ${round}`, device, existingFiles: Object.keys(files) });

		for (const change of result.changes) if (change.content !== null) files[change.path] = change.content;
	}

	return files;
}

describe("tailwind batching", () => {
	test("adds in one task build once, and listeners hear once", async () => {
		const builder = new TailwindBuilder(create, ["p-4"]);
		await builder.whenReady();
		const heard: string[] = [];
		builder.subscribe((css) => heard.push(css));
		const builds = builder.builds;

		expect(builder.add(["bg-primary"])).toBe(true);
		expect(builder.add(["m-2", "p-4"])).toBe(true);
		expect(builder.add(["p-4"])).toBe(false);
		expect(builder.builds).toBe(builds);

		await Promise.resolve();
		expect(builder.builds).toBe(builds + 1);
		expect(heard).toHaveLength(1);
		expect(heard[0]).toContain(".bg-primary");
		expect(heard[0]).toContain(".m-2");
	});

	test("reading css builds the queue right away, so a frame never gets CSS without its classes", async () => {
		const builder = new TailwindBuilder(create);
		await builder.whenReady();
		const heard: string[] = [];
		builder.subscribe((css) => heard.push(css));
		builder.add(["grid-cols-3"]);
		expect(builder.css).toContain(".grid-cols-3");
		expect(heard).toHaveLength(0);

		await Promise.resolve();
		expect(heard).toEqual([builder.css]);
		expect(builder.flush()).toBe(false);
	});

	test("candidates added before the compiler is ready join its first build", async () => {
		const builder = new TailwindBuilder(create, ["p-4"]);
		builder.add(["m-2"]);
		await builder.whenReady();
		expect(builder.builds).toBe(1);
		expect(builder.css).toContain(".m-2");
	});

	test("opening a 30-screen project builds once", async () => {
		const files = project(30);
		const screens = Object.keys(files).filter((p) => p.startsWith("screens/"));
		expect(screens.length).toBeGreaterThanOrEqual(30);

		const builder = new TailwindBuilder(create, ["p-4"]);
		await builder.whenReady();
		const before = builder.builds;
		builder.reset(projectCandidates(files));
		await builder.whenReady();
		const builds = builder.builds;
		expect(builds - before).toBe(1);
		const cache = new CompileCache();
		let broadcasts = 0;
		builder.subscribe(() => broadcasts++);

		// What each frame host does on its first sync
		for (const screen of screens) {
			for (const module of collectGraph(screen, files, cache).modules.values()) builder.add(module.candidates);
			expect(builder.css).toContain(".flex");
		}

		await Promise.resolve();
		expect(builder.builds - builds).toBe(0);
		expect(broadcasts).toBe(0);
	});
});
