import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMockScreens } from "../../../shared/mock-generator";
import { extractCandidates, projectCandidates } from "./candidates";
import { createCompiler } from "./tailwind";

const root = join(import.meta.dir, "../../../..");

const stylesheets = {
	tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
	"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
};

/** The extraction before the filter, kept to prove the filter drops no class */
function unfiltered(source: string): string[] {
	const set = new Set<string>();

	const add = (token: string) => {
		if (token.length > 1 && token.length < 120 && /^[!-]?[a-z@[*]/.test(token)) set.add(token);
	};

	for (const token of source.split(/[\s"'`]+/)) {
		add(token);

		if (/[{}();,=<>]/.test(token)) for (const part of token.split(/[{}();,=<>]+/)) add(part);
	}

	return [...set];
}

const uiDir = join(root, "src/mainview/components/ui");

const sources = [
	...readdirSync(uiDir)
		.filter((name) => name.endsWith(".tsx"))
		.map((name) => readFileSync(join(uiDir, name), "utf8")),
	...(["mobile", "desktop"] as const).flatMap((device) =>
		generateMockScreens({ prompt: "A habit tracker with streaks", device }).changes.map((c) => c.content ?? ""),
	),
];

describe("candidates", () => {
	test("extracts classes from JSX and cn() calls", () => {
		const found = extractCandidates(`<div className={cn("p-4 w-[calc(100%-2rem)]", x && 'hover:bg-accent')} />`);
		expect(found).toEqual(expect.arrayContaining(["p-4", "w-[calc(100%-2rem)]", "hover:bg-accent"]));
	});

	test("keeps variants, modifiers, fractions and arbitrary values", () => {
		const classes = [
			"[&>svg]:size-3",
			"has-data-[slot=card-action]:grid-cols-[1fr_auto]",
			"[&_[cmdk-group-heading]]:px-2",
			"group-hover/item:bg-black/50",
			"bg-(--brand)",
			"-mt-0.5",
			"w-1/2",
			"from-10%",
			"p-4!",
			"!font-bold",
			"*:rounded-md",
			"@md:flex",
			"@container",
			"data-[state=open]:animate-in",
		];

		expect(extractCandidates(`"${classes.join(" ")}"`)).toEqual(expect.arrayContaining(classes));
	});

	test("drops tokens Tailwind never accepts", () => {
		const source = `import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "../components/stat-card";
import * as Lucide from "lucide-react/dist/esm/icons";

export default function Home({ title }: { title: string }) {
	const [count, setCount] = useState(42);
	const url = "https://example.com/a/b";
	return <a href={url} onClick={() => setCount(count + 1)} className="flex p-4">Welcome back, friend. Ready? {props.title}</a>;
}`;

		const found = extractCandidates(source);
		expect(found).toEqual(expect.arrayContaining(["flex", "p-4"]));

		for (const token of [
			"useState",
			"setCount",
			"onClick",
			"className",
			"@/components/ui/button",
			"../components/stat-card",
			"lucide-react/dist/esm/icons",
			"https://example.com/a/b",
			"props.title",
			"back,",
			"friend.",
			"Ready?",
			"42",
		])
			expect(found).not.toContain(token);
	});

	test("drops nothing Tailwind builds from real screens and runtime components", async () => {
		const compiler = await createCompiler(stylesheets);
		const before = [...new Set(sources.flatMap(unfiltered))];
		const after = [...new Set(sources.flatMap(extractCandidates))];
		expect(after.length).toBeLessThan(before.length);
		const css = compiler.build(after);
		expect((await createCompiler(stylesheets)).build(before)).toBe(css);
		expect(css).toContain(".rounded-md");
	});

	test("projectCandidates reads only scripts", () => {
		const found = projectCandidates({
			"screens/home.tsx": `<div className="grid gap-2" />`,
			"DESIGN.md": "rounded-full is our pill shape",
			"rabisco.json": `{"name": "x"}`,
		});

		expect(found).toEqual(expect.arrayContaining(["grid", "gap-2"]));
		expect(found).not.toContain("rounded-full");
	});
});
