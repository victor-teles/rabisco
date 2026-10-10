import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { SCREEN_THEME_CSS } from "../../mainview/lib/render/theme";
import type { Frame } from "../types";
import { packageName, viteProject, type ViteProjectInput } from "./vite-project";

const UI_DIR = join(import.meta.dir, "../../mainview/components/ui");

// Keyed like `UI_SOURCES`: `button`, `uai/search-field`
const uiSources = Object.fromEntries(
	readdirSync(UI_DIR, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".tsx"))
		.map((file) => [file.replace(/\.tsx$/, ""), readFileSync(join(UI_DIR, file), "utf8")]),
);

const frame = (file: string, x: number): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
});

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
	// Applied before DESIGN.md's radius changed, so the export keeps what the canvas shows
	theme: { light: { primary: "#2563eb", radius: "0.75rem" }, dark: {} },
	uiSources,
};

const byPath = (project: ReturnType<typeof viteProject>) =>
	Object.fromEntries(project.files.map((file) => [file.path, file.content]));

describe("vite project", () => {
	const project = viteProject(input);
	const out = byPath(project);

	test("has the files of a runnable project", () => {
		for (const path of [
			"package.json",
			"vite.config.ts",
			"tsconfig.json",
			"index.html",
			"README.md",
			".gitignore",
			"src/main.tsx",
			"src/App.tsx",
			"src/index.css",
			"src/lib/utils.ts",
			"PRODUCT.md",
			"DESIGN.md",
		]) {
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
		const ui = Object.keys(out)
			.filter((path) => path.startsWith("src/components/ui/"))
			.sort();

		// toggle-group imports toggleVariants from toggle
		expect(ui).toEqual([
			"src/components/ui/button.tsx",
			"src/components/ui/toggle-group.tsx",
			"src/components/ui/toggle.tsx",
		]);
		expect(out["src/components/ui/button.tsx"]).toBe(uiSources.button!);
		expect(out["src/lib/uai-utils.ts"]).toBeUndefined();
	});

	test("ships the uai blocks used, with the primitives they import and their `cn`", () => {
		const search = `import { SearchField, SearchFieldControl, SearchFieldInput } from "@/components/ui/uai/search-field";

export default function Search() {
	return <SearchField><SearchFieldControl><SearchFieldInput /></SearchFieldControl></SearchField>;
}
`;

		const project = viteProject({ ...input, files: { "screens/search.tsx": search }, frames: [] });
		const blockOut = byPath(project);

		const ui = Object.keys(blockOut)
			.filter((path) => path.startsWith("src/components/ui/"))
			.sort();

		expect(ui).toEqual([
			"src/components/ui/button.tsx",
			"src/components/ui/input.tsx",
			"src/components/ui/label.tsx",
			"src/components/ui/uai/search-field.tsx",
		]);
		expect(blockOut["src/components/ui/uai/search-field.tsx"]).toBe(uiSources["uai/search-field"]!);
		expect(blockOut["src/lib/uai-utils.ts"]).toContain("export function cn(");
		expect(blockOut["README.md"]).toContain("`uai/search-field`");
		expect(project.warnings).toEqual([]);
	});

	test("ships the placeholder module when a screen draws one, with no extra packages", () => {
		const gallery = `import { Placeholder } from "@/components/ui/placeholder";

export default function Gallery() {
	return <Placeholder kind="photo" subject="food" seed="brunch" className="aspect-[4/3] w-full rounded-lg" />;
}
`;

		const project = viteProject({ ...input, files: { "screens/gallery.tsx": gallery }, frames: [] });
		const placeholderOut = byPath(project);

		expect(placeholderOut["src/components/ui/placeholder.tsx"]).toBe(uiSources.placeholder!);
		expect(Object.keys(JSON.parse(placeholderOut["package.json"]!).dependencies)).not.toContain("radix-ui");
		expect(project.warnings).toEqual([]);
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

	test("the theme is the canvas theme, with the applied tokens after it", () => {
		const css = out["src/index.css"]!;
		expect(css.startsWith('@import "tailwindcss";\n@import "tw-animate-css";')).toBe(true);
		expect(css).toContain(SCREEN_THEME_CSS.trim());
		expect(css).toContain(":root:not(.dark) {\n\t--primary: #2563eb;");
		expect(css).toContain(":root {\n\t--radius: 0.75rem;");
		expect(css.indexOf("--primary: #2563eb")).toBeGreaterThan(css.indexOf(SCREEN_THEME_CSS.trim()));
		expect(css).not.toContain("@theme reference");
	});

	test("custom tokens get their names in the theme and their values after it", () => {
		const theme = { light: { "color-brand": "#e11d48" }, dark: { "color-brand": "#fb7185" } };
		const css = byPath(viteProject({ ...input, theme }))["src/index.css"]!;
		expect(css).toContain("@theme reference {\n\t--color-brand: currentcolor;\n}");
		expect(css).toContain(":root {\n\t--color-brand: #e11d48;");
		expect(css).toContain(".dark {\n\t--color-brand: #fb7185;");
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
			files: {
				...files,
				"screens/odd.tsx":
					'import { Calendar } from "@/components/ui/calendar";\nimport dayjs from "dayjs";\nexport default function Odd() {\n\treturn null;\n}\n',
			},
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

test("copies the project's images into public/, where Vite serves them at /", () => {
	const project = viteProject({ ...input, assets: { "/images/logo.png": "bG9nbw==", "../escape.png": "eA==" } });
	const image = project.files.find((file) => file.path === "public/images/logo.png");
	expect(image).toEqual({ path: "public/images/logo.png", content: "bG9nbw==", encoding: "base64" });
	expect(project.files.some((file) => file.path.includes("escape"))).toBe(false);
	expect(byPath(project)["README.md"]).toContain("`public/`: the images the screens show");
	expect(byPath(viteProject(input))["README.md"]).not.toContain("`public/`");
});
