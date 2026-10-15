import { describe, expect, test } from "bun:test";
import * as Cva from "class-variance-authority";
import * as Lucide from "lucide-react";
import React, { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "sucrase";
import * as Utils from "@/lib/utils";
import { isComponentFile } from "../project";
import { DEFAULT_KIT, isKitId, KIT_IDS, kitById, kitFiles, STARTER_KITS } from "./starter-kits";
import { isUiModule, UI_MODULES } from "./ui-modules";

type Import = { from: string; names: string[] };

function importsOf(source: string): Import[] {
	const imports: Import[] = [];

	for (const match of source.matchAll(/^import (type )?(?:\{([^}]*)\}|(\w+)) from "([^"]+)";$/gm)) {
		if (match[1]) continue;

		const names = (match[2] ?? "")
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name && !name.startsWith("type "));

		imports.push({ from: match[4]!, names });
	}

	return imports;
}

const LUCIDE_EXPORTS = new Set(Object.keys(Lucide));

type Exports = Record<string, ComponentType>;

type KitModule = { exports: Exports };

type Namespace = typeof React | typeof Lucide | typeof Cva | typeof Utils | Exports;

async function loadExternal(from: string): Promise<Namespace> {
	if (from === "react") return React;

	if (from === "lucide-react") return Lucide;

	if (from === "class-variance-authority") return Cva;

	if (from === "@/lib/utils") return Utils;

	return import(from.replace("@/", "../../mainview/"));
}

async function evaluate(files: Record<string, string>, path: string, done = new Map<string, Exports>()) {
	const cached = done.get(path);

	if (cached) return cached;

	const source = files[path]!;
	const externals = new Map<string, Namespace>();

	for (const { from } of importsOf(source)) {
		externals.set(
			from,
			from.startsWith("../components/")
				? await evaluate(files, `${from.slice(3)}.tsx`, done)
				: await loadExternal(from),
		);
	}

	const { code } = transform(source, { transforms: ["typescript", "jsx", "imports"], production: true });
	const module: KitModule = { exports: {} };
	const require = (from: string) => externals.get(from) ?? React;
	new Function("module", "exports", "require", "React", code)(module, module.exports, require, React);
	done.set(path, module.exports);

	return module.exports;
}

describe("STARTER_KITS", () => {
	test("has one kit per id, shadcn first and empty", () => {
		expect(STARTER_KITS.map((kit) => kit.id)).toEqual([...KIT_IDS]);
		expect(DEFAULT_KIT).toBe("shadcn");
		expect(Object.keys(kitById("shadcn").files)).toEqual([]);
	});

	test("every kit besides shadcn writes component files only", () => {
		for (const kit of STARTER_KITS) {
			if (kit.id === "shadcn") continue;

			expect(Object.keys(kit.files).length).toBeGreaterThanOrEqual(4);

			for (const path of Object.keys(kit.files)) expect(isComponentFile(path)).toBe(true);
		}
	});

	test("kit files import only what screens can, with names that exist", () => {
		for (const kit of STARTER_KITS) {
			for (const [path, source] of Object.entries(kit.files)) {
				for (const { from, names } of importsOf(source)) {
					if (from.startsWith("@/components/ui/")) {
						const module = from.slice("@/components/ui/".length);
						expect(isUiModule(module)).toBe(true);

						if (isUiModule(module)) for (const name of names) expect(UI_MODULES[module]).toContain(name);
					} else if (from === "lucide-react") {
						for (const name of names) expect(LUCIDE_EXPORTS.has(name)).toBe(true);
					} else if (from.startsWith("../components/")) {
						expect(kit.files[`${from.slice(3)}.tsx`]).toBeDefined();
					} else {
						expect(["react", "@/lib/utils", "class-variance-authority"]).toContain(from);
					}
				}

				expect(source, path).not.toContain('from "cn"');
			}
		}
	});

	test("every component renders with no props", async () => {
		for (const kit of STARTER_KITS) {
			for (const path of Object.keys(kit.files)) {
				const exports = await evaluate(kit.files, path);
				const components = Object.entries(exports).filter(([name]) => /^[A-Z]/.test(name));

				expect(components.length, path).toBeGreaterThan(0);

				for (const [, Component] of components) {
					expect(renderToStaticMarkup(createElement(Component)).length).toBeGreaterThan(0);
				}
			}
		}
	});
});

describe("kitFiles", () => {
	test("is empty without a kit and a copy with one", () => {
		expect(kitFiles(null)).toEqual({});
		expect(kitFiles("shadcn")).toEqual({});

		const files = kitFiles("dashboard");
		expect(files).toEqual(kitById("dashboard").files);
		expect(files).not.toBe(kitById("dashboard").files);
	});

	test("isKitId", () => {
		expect(isKitId("ios")).toBe(true);
		expect(isKitId("bootstrap")).toBe(false);
		expect(isKitId(null)).toBe(false);
	});
});
