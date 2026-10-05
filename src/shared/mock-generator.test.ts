import { describe, expect, test } from "bun:test";
import * as Lucide from "lucide-react";
import React, { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "sucrase";
import { generateMockScreens } from "./mock-generator";
import { FRAME_GAP, FRAME_SIZE, isComponentFile, isScreenFile } from "./project";
import type { ProjectFiles } from "./types";
import { compileTsx } from "../bun/test-utils";

const ALLOWED = new Set([
	"react",
	"lucide-react",
	"@/lib/utils",
	"@/components/ui/button",
	"@/components/ui/card",
	"@/components/ui/badge",
	"@/components/ui/avatar",
	"@/components/ui/input",
	"@/components/ui/separator",
	"@/components/ui/tabs",
	"@/components/ui/progress",
]);

const importsOf = (source: string) => [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!);

/** Stand-ins for the shadcn modules: every named export renders its children. */
const ui = new Proxy(
	{},
	{
		get: (_, name) =>
			name === "__esModule"
				? true
				: ({ children }: { children?: ReactNode }) => createElement("div", { "data-ui": String(name) }, children),
	},
);

/** What a compiled screen or component module exports, as far as the test reads it. */
type ModuleExports = { default?: FunctionComponent };

type CommonJsModule = { exports: ModuleExports };

/** Renders a screen with a tiny module registry, the way a frame will. */
function render(entry: string, files: ProjectFiles) {
	const cache = new Map<string, ModuleExports>();

	const load = (path: string): ModuleExports => {
		const cached = cache.get(path);

		if (cached) return cached;
		const { code } = transform(files[path]!, { transforms: ["typescript", "jsx", "imports"], production: true });
		const module: CommonJsModule = { exports: {} };
		cache.set(path, module.exports);

		const require = (spec: string) => {
			if (spec === "react") return React;

			if (spec === "lucide-react") return Lucide;

			if (spec === "@/lib/utils") return { cn: (...c: unknown[]) => c.filter(Boolean).join(" ") };

			if (spec.startsWith("@/components/ui/")) return ui;

			if (spec.startsWith("../components/")) return load(`${spec.slice(3)}.tsx`);
			throw new Error(`Unexpected import ${spec}`);
		};

		new Function("module", "exports", "require", "React", code)(module, module.exports, require, React);

		return module.exports;
	};

	const screen = load(entry).default;

	if (!screen) throw new Error(`${entry} has no default export`);

	return renderToStaticMarkup(createElement(screen));
}

describe("mock generator", () => {
	for (const device of ["mobile", "desktop"] as const) {
		test(`${device} screens are valid TSX with allowed imports`, () => {
			const prompt = 'A habit tracker for "busy" <parents> & {kids}';
			const result = generateMockScreens({ prompt, device });
			const files = Object.fromEntries(result.changes.map((c) => [c.path, c.content!]));
			const screens = result.changes.filter((c) => isScreenFile(c.path));
			const components = result.changes.filter((c) => isComponentFile(c.path));

			expect(screens.map((c) => c.path)).toEqual(
				device === "mobile"
					? ["screens/welcome.tsx", "screens/home.tsx", "screens/details.tsx"]
					: ["screens/landing.tsx", "screens/dashboard.tsx"],
			);
			expect(components.length).toBeGreaterThan(0);
			expect(result.frames.map((f) => f.x)).toEqual(screens.map((_, i) => i * (FRAME_SIZE[device].width + FRAME_GAP)));
			expect(result.frames.every((f) => f.height === FRAME_SIZE[device].height && f.device === device)).toBe(true);

			for (const { path, content } of result.changes) {
				expect(() => compileTsx(content!)).not.toThrow();

				for (const spec of importsOf(content!)) {
					if (spec.startsWith("../components/")) expect(files[`${spec.slice(3)}.tsx`]).toBeString();
					else expect(ALLOWED.has(spec)).toBe(true);
				}

				if (isScreenFile(path)) {
					expect(content).toMatch(/export default function [A-Z]\w*\(\)/);
					expect(content).toMatch(/className="[^"]*\b(min-)?h-full\b/);
					expect(render(path, files)).toContain("<");
				} else {
					expect(content).toMatch(/export function [A-Z]\w*\(/);
				}
			}

			expect(render(screens[0]!.path, files)).toContain("&lt;parents&gt;");
		});
	}

	test("avoids existing screens and reuses existing components", () => {
		const result = generateMockScreens({
			prompt: "Fitness",
			device: "mobile",
			existingFiles: ["screens/welcome.tsx", "components/stat-card.tsx"],
		});

		const paths = result.changes.map((c) => c.path);
		expect(paths).toContain("screens/welcome-2.tsx");
		expect(paths).not.toContain("screens/welcome.tsx");
		expect(paths).not.toContain("components/stat-card.tsx");
		expect(paths).toContain("components/tab-bar.tsx");
		expect(result.frames[0]!.file).toBe("screens/welcome-2.tsx");
	});

	test("accent comes from the prompt", () => {
		const accentOf = (prompt: string) =>
			generateMockScreens({ prompt, device: "mobile" }).changes[0]!.content!.match(/bg-(\w+)-600/)![1];

		expect(accentOf("same prompt")).toBe(accentOf("same prompt"));
		const accents = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(accentOf));
		expect(accents.size).toBeGreaterThan(1);
	});
});
