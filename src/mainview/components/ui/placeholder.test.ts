import { describe, expect, test } from "bun:test";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileSource } from "../../lib/render/compile";
import { externals } from "../../runtime/externals";
import { ModuleRegistry } from "../../runtime/registry";
import { Placeholder } from "./placeholder";

type Props = Parameters<typeof Placeholder>[0];

const render = (props: Props) => renderToStaticMarkup(createElement(Placeholder, props));

const KINDS: Props[] = [
	{ kind: "photo", subject: "landscape" },
	{ kind: "photo", subject: "food" },
	{ kind: "photo", subject: "interior" },
	{ kind: "photo", subject: "product" },
	{ kind: "photo", subject: "people" },
	{ kind: "photo" },
	{ kind: "avatar" },
	{ kind: "illustration", subject: "tiles" },
	{ kind: "illustration", subject: "empty" },
	{ kind: "illustration", subject: "success" },
	{ kind: "illustration", subject: "error" },
	{ kind: "map", pin: true },
	{ kind: "chart", subject: "area" },
	{ kind: "chart", subject: "line" },
	{ kind: "chart", subject: "bar" },
];

describe("Placeholder", () => {
	test("the same props draw the same image", () => {
		for (const props of KINDS) expect(render({ ...props, seed: "brunch" })).toBe(render({ ...props, seed: "brunch" }));
	});

	test("another seed draws another image", () => {
		for (const props of KINDS) expect(render({ ...props, seed: "a" })).not.toBe(render({ ...props, seed: "b" }));
	});

	test("every kind draws an image with a name for screen readers", () => {
		for (const props of KINDS) {
			const html = render(props);
			expect(html).toContain('role="img"');
			expect(html).toMatch(/aria-label="[A-Z][a-z]+/);
			expect(html).toMatch(/<(path|rect|circle)/);
		}

		expect(render({ kind: "photo", subject: "food" })).toContain('aria-label="Food photo"');
		expect(render({ kind: "map", label: "Pickup at 5th Ave" })).toContain('aria-label="Pickup at 5th Ave"');
	});

	test("draws with the theme, except photos, which keep their own colors", () => {
		expect(render({ kind: "chart" })).toContain("var(--chart-1)");
		expect(render({ kind: "map" })).toContain("var(--muted)");
		expect(render({ kind: "avatar" })).toMatch(/var\(--chart-\d\)/);
		expect(render({ kind: "illustration", subject: "success" })).toContain("var(--success)");
	});

	test("an unknown subject falls back instead of breaking the screen", () => {
		expect(render({ kind: "photo", subject: "spaceship" })).toContain("<svg");
		expect(render({ kind: "chart", subject: "pie" })).toContain("<svg");
	});

	test("the className sizes it, over the defaults", () => {
		const html = render({ kind: "photo", className: "aspect-square h-40 rounded-xl" });
		expect(html).toContain("aspect-square");
		expect(html).not.toContain("aspect-[4/3]");
		expect(render({ kind: "map", pin: true })).toContain("fill-primary");
	});

	test("a screen imports it through the frame runtime", () => {
		const source = `import { Placeholder } from "@/components/ui/placeholder";

export default function Menu() {
	return <Placeholder kind="photo" subject="food" seed="ramen" className="aspect-[4/3] w-full rounded-lg" />;
}
`;

		const compiled = compileSource("screens/menu.tsx", source);
		expect(compiled.error).toBeNull();

		const registry = new ModuleRegistry(externals);
		registry.apply({ "screens/menu.tsx": { source, code: compiled.code! } }, true);
		const Screen = registry.load("screens/menu.tsx").default;

		if (!(Screen instanceof Function)) throw new Error("No default export");
		// SAFETY: a screen default-exports a function component, and the check above made sure it is a function
		const html = renderToStaticMarkup(createElement(Screen as FunctionComponent));

		expect(html).toContain('data-slot="placeholder"');
		expect(html).toContain('aria-label="Food photo"');
	});
});
