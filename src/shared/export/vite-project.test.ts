import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { SCREEN_THEME_CSS } from "../../mainview/lib/render/theme";
import type { Frame } from "../types";
import { packageName, viteProject, type ViteProjectInput } from "./vite-project";

const UI_DIR = join(import.meta.dir, "../../mainview/components/ui");
/** The shadcn sources the webview passes in (`UI_SOURCES`) */
const uiSources = Object.fromEntries(
	readdirSync(UI_DIR)
		.filter((file) => file.endsWith(".tsx"))
		.map((file) => [file.replace(/\.tsx$/, ""), readFileSync(join(UI_DIR, file), "utf8")]),
);

const frame = (file: string, x: number): Frame => ({ file, name: file, device: "mobile", x, y: 0, width: 390, height: 844 });

const files = {
	"screens/welcome.tsx": `import { Button } from "@/components/ui/button";

export default function Welcome() {
	return <Button data-link-to="screens/home.tsx">Start</Button>;
}
`,
	"screens/welcome.alt-1.tsx": `export default function Welcome() {\n\treturn <p>Alt</p>;\n}\n`,
	"screens/home.tsx": `import { Filters } from "../components/filters";
import { Search } from "lucide-react";

export default function Home() {
	return <Filters icon={Search} />;
}
`,
	"components/filters.tsx": `import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function Filters() {
	return <ToggleGroup type="single" className={cn("w-full")}><ToggleGroupItem value="a">A</ToggleGroupItem></ToggleGroup>;
}
`,
	"components/empty-state.tsx": `export function EmptyState() {\n\treturn null;\n}\n`,
	"DESIGN.md": "# Design\n\n## Tokens\n\n- primary: #2563eb\n- radius: 0.5rem\n",
	"PRODUCT.md": "# Product\n",
};

const input: ViteProjectInput = {
	name: "Coffee Club",
	// Home sits left of Welcome on the canvas, so it opens first
	frames: [frame("screens/home.tsx", 0), frame("screens/welcome.tsx", 500), frame("screens/welcome.alt-1.tsx", 1000)],
	files,
	uiSources,
};

const byPath = (project: ReturnType<typeof viteProject>) => Object.fromEntries(project.files.map((file) => [file.path, file.content]));

describe("vite project", () => {
	const project = viteProject(input);
	const out = byPath(project);

	test("has the files of a runnable project", () => {
		for (const path of ["package.json", "vite.config.ts", "tsconfig.json", "index.html", "README.md", ".gitignore", "src/main.tsx", "src/App.tsx", "src/index.css", "src/lib/utils.ts", "PRODUCT.md", "DESIGN.md"]) {
			expect(out[path]).toBeString();
		}
		expect(out["index.html"]).toContain("<title>Coffee Club</title>");
		expect(out["vite.config.ts"]).toContain('"@": fileURLToPath(new URL("./src", import.meta.url))');
		expect(project.warnings).toEqual([]);
	});

	test("copies screens and components verbatim, every component included, alternates left out", () => {
		expect(out["src/screens/welcome.tsx"]).toBe(files["screens/welcome.tsx"]);
		expect(out["src/screens/home.tsx"]).toBe(files["screens/home.tsx"]);
		expect(out["src/components/filters.tsx"]).toBe(files["components/filters.tsx"]);
		expect(out["src/components/empty-state.tsx"]).toBe(files["components/empty-state.tsx"]);
		expect(out["src/screens/welcome.alt-1.tsx"]).toBeUndefined();
		expect(out["src/App.tsx"]).not.toContain("alt-1");
	});

	test("alternates can be included", () => {
		const withAlternates = byPath(viteProject({ ...input, includeAlternates: true }));
		expect(withAlternates["src/screens/welcome.alt-1.tsx"]).toBe(files["screens/welcome.alt-1.tsx"]);
		expect(withAlternates["src/App.tsx"]).toContain('import WelcomeAlt1Screen from "./screens/welcome.alt-1";');
	});

	test("ships only the shadcn components used, with the ones they import", () => {
		const ui = Object.keys(out).filter((path) => path.startsWith("src/components/ui/")).sort();
		// toggle-group imports toggleVariants from toggle
		expect(ui).toEqual(["src/components/ui/button.tsx", "src/components/ui/toggle-group.tsx", "src/components/ui/toggle.tsx"]);
		expect(out["src/components/ui/button.tsx"]).toBe(uiSources.button!);
	});

	test("package.json lists the packages the files import", () => {
		const pkg = JSON.parse(out["package.json"]!);
		expect(pkg.name).toBe("coffee-club");
		expect(Object.keys(pkg.dependencies)).toEqual([
			"class-variance-authority",
			"clsx",
			"lucide-react",
			"radix-ui",
			"react",
			"react-dom",
			"tailwind-merge",
			"tw-animate-css",
		]);
		expect(Object.keys(pkg.devDependencies)).toContain("@tailwindcss/vite");
		expect(pkg.scripts.build).toBe("vite build");
	});

	test("the theme is the canvas theme, with DESIGN.md tokens after it", () => {
		const css = out["src/index.css"]!;
		expect(css.startsWith('@import "tailwindcss";\n@import "tw-animate-css";')).toBe(true);
		expect(css).toContain(SCREEN_THEME_CSS.trim());
		expect(css).toContain(":root:not(.dark) {\n\t--primary: #2563eb;");
		expect(css).toContain(":root {\n\t--radius: 0.5rem;");
		expect(css.indexOf("--primary: #2563eb")).toBeGreaterThan(css.indexOf(SCREEN_THEME_CSS.trim()));
	});

	test("the app lists screens in canvas order and follows links", () => {
		const app = out["src/App.tsx"]!;
		expect(app).toContain('import HomeScreen from "./screens/home";\nimport WelcomeScreen from "./screens/welcome";');
		expect(app.indexOf('id: "home"')).toBeLessThan(app.indexOf('id: "welcome"'));
		expect(app).toContain('closest("[data-link-to]")');
	});

	test("screens without a frame still export, after the canvas ones", () => {
		const app = byPath(viteProject({ ...input, frames: [frame("screens/welcome.tsx", 0)] }))["src/App.tsx"]!;
		expect(app.indexOf('id: "welcome"')).toBeLessThan(app.indexOf('id: "home"'));
	});

	test("unknown imports become warnings", () => {
		const odd = viteProject({
			...input,
			files: { ...files, "screens/odd.tsx": 'import { Calendar } from "@/components/ui/calendar";\nimport dayjs from "dayjs";\nexport default function Odd() {\n\treturn null;\n}\n' },
		});
		expect(odd.warnings).toHaveLength(2);
		expect(JSON.parse(byPath(odd)["package.json"]!).dependencies.dayjs).toBeUndefined();
	});

	test("needs a screen", () => {
		expect(() => viteProject({ ...input, frames: [], files: { "components/a.tsx": "" } })).toThrow();
	});

	test("package names", () => {
		expect(packageName("Café Délice!")).toBe("cafe-delice");
		expect(packageName("!!!")).toBe("rabisco-design");
	});
});
