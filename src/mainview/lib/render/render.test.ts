import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModuleRegistry, RenderError } from "../../runtime/registry";
import { excerptOf, locationFromStack } from "../../runtime/errors";
import { extractCandidates } from "./candidates";
import { CompileCache, compileSource } from "./compile";
import { collectGraph, withDependents } from "./graph";
import type { ModulePayload } from "./protocol";
import { extractRequires, joinPath, resolveRelative } from "./resolve";
import { createCompiler, TailwindBuilder } from "./tailwind";
import { designThemeCss } from "./theme";

const SCREEN = `import { Button } from "@/components/ui/button";
import { Card } from "../components/stat-card";
import { Home } from "lucide-react";

export default function HomeScreen() {
	return <div className="flex p-4"><Card /><Button><Home /></Button></div>;
}
`;

const CARD = `import { Pill } from "./pill";
export function Card({ label = "x" }: { label?: string }) {
	return <div className="rounded-xl bg-card"><Pill />{label}</div>;
}
`;

const PILL = `export function Pill() { return <span className="rounded-full px-2" />; }\n`;

const FILES = {
	"screens/home.tsx": SCREEN,
	"components/stat-card.tsx": CARD,
	"components/pill.tsx": PILL,
	"screens/other.tsx": `export default function Other() { return null; }\n`,
};

describe("resolve", () => {
	test("joins relative specifiers", () => {
		expect(joinPath("screens/home.tsx", "../components/x")).toBe("components/x");
		expect(joinPath("components/a.tsx", "./b")).toBe("components/b");
	});
	test("resolves with or without an extension", () => {
		const exists = (path: string) => path === "components/x.tsx";
		expect(resolveRelative("screens/a.tsx", "../components/x", exists)).toBe("components/x.tsx");
		expect(resolveRelative("screens/a.tsx", "../components/x.tsx", exists)).toBe("components/x.tsx");
		expect(resolveRelative("screens/a.tsx", "../components/y", exists)).toBeNull();
	});
	test("extracts requires from compiled code", () => {
		const { code } = compileSource("screens/home.tsx", SCREEN);
		expect(extractRequires(code!)).toEqual(
			expect.arrayContaining([
				"react/jsx-runtime",
				"@/components/ui/button",
				"../components/stat-card",
				"lucide-react",
			]),
		);
	});
});

describe("compile", () => {
	test("emits CommonJS with a sourceURL and keeps line numbers", () => {
		const compiled = compileSource("screens/home.tsx", SCREEN);
		expect(compiled.error).toBeNull();
		expect(compiled.code).toContain('require("react/jsx-runtime")');
		expect(compiled.code!.endsWith("//# sourceURL=rabisco://project/screens/home.tsx")).toBe(true);
		const lines = compiled.code!.split("\n");
		expect(lines[4]).toContain("function HomeScreen");
	});
	test("captures syntax errors with a line instead of throwing", () => {
		const compiled = compileSource("screens/bad.tsx", "export default function A() {\n\treturn <div>;\n}\n");
		expect(compiled.code).toBeNull();
		expect(compiled.error!.line).toBe(2);
		expect(compiled.error!.message).not.toContain("Error transforming");
		expect(compiled.error!.message.length).toBeGreaterThan(0);
	});
	test("tags DOM elements with their file and original offset", () => {
		const compiled = compileSource("screens/home.tsx", SCREEN);
		expect(compiled.source).toBe(SCREEN);
		const div = SCREEN.indexOf("<div");
		expect(compiled.code).toContain(`'data-rabisco-loc': "screens/home.tsx:${div}"`);
		// Component usages carry one too, as a prop the runtime reads from React's tree
		expect(compiled.code).toContain(`'data-rabisco-loc': "screens/home.tsx:${SCREEN.indexOf("<Card")}"`);
		expect(compiled.code!.match(/data-rabisco-loc/g)!.length).toBe(4);
		expect(compileSource("components/pill.tsx", PILL).code).toContain(
			`'data-rabisco-loc': "components/pill.tsx:${PILL.indexOf("<span")}"`,
		);
	});
	test("error lines still point at the original source", () => {
		const source = `export default function A() {\n\tconst x = null as any;\n\treturn <div className="p-4">{x.boom}</div>;\n}\n`;
		const compiled = compileSource("screens/a.tsx", source);
		expect(compiled.code!.split("\n")[2]).toContain("x.boom");

		const bad = compileSource(
			"screens/bad.tsx",
			'export default function A() {\n\treturn <div className="a">\n\t\t<span>;\n}\n',
		);

		expect(bad.error!.line).toBeGreaterThanOrEqual(3);
		expect(bad.source).not.toContain("data-rabisco-loc");
	});
	test("caches by content", () => {
		const cache = new CompileCache();
		const a = cache.get("screens/home.tsx", SCREEN);
		expect(cache.get("screens/home.tsx", SCREEN)).toBe(a);
		expect(cache.get("screens/home.tsx", `${SCREEN}\n`)).not.toBe(a);
		// Back to the original content: hit by hash
		expect(cache.get("screens/home.tsx", SCREEN)).toBe(a);
		expect(cache.misses).toBe(2);
		expect(cache.hits).toBe(2);
	});
});

describe("graph", () => {
	test("collects reachable project modules", () => {
		const graph = collectGraph("screens/home.tsx", FILES, new CompileCache());
		expect([...graph.modules.keys()]).toEqual(["screens/home.tsx", "components/stat-card.tsx", "components/pill.tsx"]);
		expect(graph.missing).toEqual([]);
	});
	test("reports missing imports", () => {
		const graph = collectGraph(
			"screens/a.tsx",
			{ "screens/a.tsx": `import { X } from "../components/nope";\nexport default X;\n` },
			new CompileCache(),
		);

		expect(graph.missing).toEqual([{ from: "screens/a.tsx", specifier: "../components/nope" }]);
	});
	test("still follows imports of files that do not compile", () => {
		const graph = collectGraph(
			"screens/a.tsx",
			{
				"screens/a.tsx": `import { Pill } from "../components/pill";\nexport default () => <div>;\n`,
				"components/pill.tsx": PILL,
			},
			new CompileCache(),
		);

		expect(graph.modules.has("components/pill.tsx")).toBe(true);
	});
	test("invalidates dependents transitively", () => {
		const edges = new Map([
			["screens/home.tsx", ["components/stat-card.tsx"]],
			["components/stat-card.tsx", ["components/pill.tsx"]],
			["screens/other.tsx", []],
		]);

		expect(withDependents(["components/pill.tsx"], edges)).toEqual(
			new Set(["components/pill.tsx", "components/stat-card.tsx", "screens/home.tsx"]),
		);
		expect(withDependents(["screens/other.tsx"], edges)).toEqual(new Set(["screens/other.tsx"]));
	});
});

describe("candidates", () => {
	test("extracts classes from JSX and cn() calls", () => {
		const found = extractCandidates(`<div className={cn("p-4 w-[calc(100%-2rem)]", x && 'hover:bg-accent')} />`);
		expect(found).toEqual(expect.arrayContaining(["p-4", "w-[calc(100%-2rem)]", "hover:bg-accent"]));
	});
	test("keeps arbitrary variants intact", () => {
		expect(extractCandidates(`"[&>svg]:size-3 has-data-[slot=card-action]:grid-cols-[1fr_auto]"`)).toEqual(
			expect.arrayContaining(["[&>svg]:size-3", "has-data-[slot=card-action]:grid-cols-[1fr_auto]"]),
		);
	});
});

describe("registry", () => {
	// No test renders: modules only need the runtime's exports to exist
	const jsx = { jsx: () => null, jsxs: () => null, Fragment: "f" };

	const externals = {
		react: {},
		"react/jsx-runtime": jsx,
		"lucide-react": { Home: "Home" },
		"@/components/ui/button": { Button: "Button" },
	};

	const payloads = () => {
		const cache = new CompileCache();
		const out: Record<string, ModulePayload> = {};

		for (const [path, source] of Object.entries(FILES)) {
			const m = cache.get(path, source);
			out[path] = m.error ? { source, error: m.error } : { source, code: m.code! };
		}

		return out;
	};

	test("resolves externals and project modules", () => {
		const registry = new ModuleRegistry(externals);
		registry.apply(payloads(), true);
		const screen = registry.load("screens/home.tsx");
		expect(screen.default).toBeInstanceOf(Function);
		expect(registry.isLoaded("components/pill.tsx")).toBe(true);
	});
	test("invalidates a changed module and its dependents only", () => {
		const registry = new ModuleRegistry(externals);
		registry.apply(payloads(), true);
		registry.load("screens/home.tsx");
		registry.load("screens/other.tsx");
		const pill = compileSource("components/pill.tsx", PILL.replace("px-2", "px-3"));
		const invalid = registry.apply({ "components/pill.tsx": { source: pill.source, code: pill.code! } });
		expect(invalid).toEqual(new Set(["components/pill.tsx", "components/stat-card.tsx", "screens/home.tsx"]));
		expect(registry.isLoaded("screens/other.tsx")).toBe(true);
		expect(registry.isLoaded("screens/home.tsx")).toBe(false);
	});
	test("names the missing import", () => {
		const registry = new ModuleRegistry(externals);
		const bad = compileSource("screens/a.tsx", `import x from "left-pad";\nexport default () => x;\n`);
		registry.apply({ "screens/a.tsx": { source: bad.source, code: bad.code! } }, true);
		let error: RenderError | undefined;

		try {
			registry.load("screens/a.tsx");
		} catch (e) {
			if (e instanceof RenderError) error = e;
		}

		expect(error).toBeInstanceOf(RenderError);
		expect(error!.kind).toBe("missing-module");
		expect(error!.message).toContain('"left-pad"');
		expect(error!.line).toBe(1);
	});
	test("throws compile errors with their location", () => {
		const registry = new ModuleRegistry(externals);
		registry.apply(
			{ "screens/a.tsx": { source: "x", error: { message: "Unexpected token", line: 3, column: 2 } } },
			true,
		);
		expect(() => registry.load("screens/a.tsx")).toThrow("Unexpected token");
	});
	test("stack traces carry the project file and line", () => {
		const registry = new ModuleRegistry(externals);
		const source = `export default function A() {\n\tconst x = null as any;\n\treturn x.boom;\n}\n`;
		const compiled = compileSource("screens/a.tsx", source);
		registry.apply({ "screens/a.tsx": { source, code: compiled.code! } }, true);
		const A = registry.load("screens/a.tsx").default;
		expect(A).toBeInstanceOf(Function);
		let stack = "";

		try {
			if (A instanceof Function) A();
		} catch (e) {
			if (e instanceof Error) stack = e.stack ?? "";
		}

		const location = locationFromStack(stack);
		expect(location?.file).toBe("screens/a.tsx");
		expect(location?.line).toBe(3);
		expect(excerptOf(source, 3)?.find((l) => l.line === 3)?.text).toContain("x.boom");
	});
});

describe("tailwind", () => {
	const root = join(import.meta.dir, "../../../..");

	const stylesheets = {
		tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
		"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
	};

	test("builds only when the candidate union grows", async () => {
		const builder = new TailwindBuilder(() => createCompiler(stylesheets), ["p-4"]);
		await builder.whenReady();
		expect(builder.css).toContain(".p-4");
		expect(builder.css).toContain("--primary:");
		const builds = builder.builds;
		expect(builder.add(["p-4"])).toBe(false);
		expect(builder.builds).toBe(builds);
		expect(builder.add(["bg-primary", "animate-in"])).toBe(true);
		expect(builder.css).toContain(".bg-primary");
	});

	test("DESIGN.md tokens override the theme variables the build uses", async () => {
		const builder = new TailwindBuilder(() => createCompiler(stylesheets), ["bg-primary", "rounded-lg", "font-mono"]);
		await builder.whenReady();
		// Preflight reads the body font through --default-font-family, which points at --font-sans
		expect(builder.css).toMatch(/--default-font-family: var\(--font-sans\)/);
		expect(builder.css).toMatch(/font-family: var\(--default-font-family/);
		expect(builder.css).toContain("background-color: var(--primary)");
		expect(builder.css).toContain("border-radius: var(--radius)");
		expect(builder.css).toContain("font-family: var(--font-mono)");

		const design = "# Design\n\n## Tokens\n\n- primary: #2563eb\n- font-sans: Inter, sans-serif\n";
		const theme = designThemeCss({ "DESIGN.md": design });
		expect(theme).toContain("--primary: #2563eb;");
		expect(theme).toContain("--font-sans: Inter, sans-serif;");
		// Unlayered, so it beats the theme layer; cached by content
		expect(theme).not.toContain("@layer");
		expect(designThemeCss({ "DESIGN.md": design, "screens/a.tsx": "" })).toBe(theme);
		expect(designThemeCss({})).toBe("");
	});
});
