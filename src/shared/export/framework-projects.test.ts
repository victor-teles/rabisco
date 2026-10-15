import { describe, expect, test } from "bun:test";
import { designTokensOf } from "../context/tokens";
import { exportFixture } from "./export-fixture";
import { nextProject } from "./next-project";
import { reactRouterProject } from "./react-router-project";
import { viteProject } from "./vite-project";

const byPath = (project: ReturnType<typeof nextProject>) =>
	Object.fromEntries(project.files.map((file) => [file.path, file.content]));

const input = exportFixture();

/** In frame order, so Welcome opens first */
const screenIds = ["welcome", "home", "details", "landing", "dashboard", "settings"];

describe("every framework", () => {
	for (const [name, project] of [
		["vite", viteProject(input)],
		["next", nextProject(input)],
		["react-router", reactRouterProject(input)],
	] as const) {
		test(`${name}: the same screens, components, UI kit, tokens and images, with no warnings`, () => {
			const out = byPath(project);

			expect(project.warnings).toEqual([]);
			expect(out["src/screens/settings.tsx"]).toBe(input.files["screens/settings.tsx"]!);
			expect(out["src/components/profile-row.tsx"]).toBe(input.files["components/profile-row.tsx"]!);
			expect(out["src/components/ui/uai/metric-card.tsx"]).toBe(input.uiSources["uai/metric-card"]!);
			expect(out["src/lib/uai-utils.ts"]).toContain("export function cn(");
			expect(out["tokens/tokens.css"]).toContain("--color-brand: #e11d48;");
			expect(out["public/images/logo.png"]).toBeString();
			expect(out["DESIGN.md"]).toBeString();
		});
	}
});

describe("next project", () => {
	const out = byPath(nextProject(input));

	test("each screen is a client route, and / opens the first", () => {
		for (const id of screenIds) expect(out[`src/app/${id}/page.tsx`]).toStartWith('"use client";');

		expect(out["src/app/settings/page.tsx"]).toContain('import SettingsScreen from "@/screens/settings";');
		expect(out["src/app/page.tsx"]).toBe(out["src/app/welcome/page.tsx"]!);
	});

	test("the layout loads the stylesheet and follows prototype links with the router", () => {
		expect(out["src/app/layout.tsx"]).toContain('import "./globals.css";');
		expect(out["src/app/layout.tsx"]).toContain('title: "Coffee Club"');
		expect(out["src/app/screen-links.tsx"]).toContain(`const screens = ${JSON.stringify(screenIds)};`);
		expect(out["src/app/screen-links.tsx"]).toContain("router.push(`/${linkTarget(to)}`)");
		expect(out["src/app/globals.css"]).toStartWith('@import "tailwindcss";');
		expect(out["postcss.config.mjs"]).toContain('"@tailwindcss/postcss": {}');
	});

	test("package.json runs Next.js with Tailwind through PostCSS", () => {
		const pkg = JSON.parse(out["package.json"]!);

		expect(pkg.scripts.build).toBe("next build");
		expect(pkg.dependencies.next).toBeString();
		expect(pkg.dependencies["radix-ui"]).toBeString();
		expect(Object.keys(pkg.devDependencies)).toEqual([
			"@tailwindcss/postcss",
			"@types/node",
			"@types/react",
			"@types/react-dom",
			"tailwindcss",
			"typescript",
		]);
		expect(out["README.md"]).toContain("Exported from Rabisco as a Next.js project.");
		expect(out[".gitignore"]).toContain(".next");
	});
});

describe("react router project", () => {
	const out = byPath(reactRouterProject(input));

	test("each screen is a route in routes.ts, and / opens the first", () => {
		const routes = out["src/app/routes.ts"]!;

		expect(routes).toContain('index("routes/_index.tsx"),');
		expect(routes).toContain('route("settings", "routes/settings.tsx"),');
		expect(routes.indexOf('"welcome"')).toBeLessThan(routes.indexOf('"settings"'));

		for (const id of screenIds) expect(out[`src/app/routes/${id}.tsx`]).toBeString();

		expect(out["src/app/routes/_index.tsx"]).toBe(out["src/app/routes/welcome.tsx"]!);
	});

	test("the root loads the stylesheet and follows prototype links with navigate", () => {
		expect(out["src/app/root.tsx"]).toContain('import "./app.css";');
		expect(out["src/app/root.tsx"]).toContain("<ScreenLinks />");
		expect(out["src/app/screen-links.tsx"]).toContain("void navigate(-1)");
		expect(out["react-router.config.ts"]).toContain('appDirectory: "src/app"');
		expect(out["src/app/app.css"]).toStartWith('@import "tailwindcss";');
	});

	test("package.json runs React Router", () => {
		const pkg = JSON.parse(out["package.json"]!);

		expect(pkg.scripts).toMatchObject({ build: "react-router build", typecheck: "react-router typegen && tsc" });
		expect(pkg.dependencies["react-router"]).toBe(pkg.devDependencies["@react-router/dev"]);
		expect(pkg.dependencies["@react-router/serve"]).toBeString();
	});
});

describe("screen modes", () => {
	const dark = {
		id: "dark",
		name: "Dark",
		color: "gray" as const,
		x: -600,
		y: -100,
		width: 600,
		height: 1100,
		modes: { scheme: "dark" },
	};

	const withSection = { ...input, sections: [dark] };
	const settingsMode = 'const mode = {"scheme":"dark"};';

	test("vite: each screen opens in the mode its section gives it", () => {
		const out = byPath(viteProject(withSection));
		const app = out["src/App.tsx"]!;

		expect(out["src/lib/screen-mode.tsx"]).toContain('root.classList.toggle("dark", mode.scheme === "dark");');
		expect(app).toContain('import { ScreenMode } from "@/lib/screen-mode";');
		expect(app).toContain('{ id: "settings", Screen: SettingsScreen, mode: {"scheme":"dark"} }');
		expect(app).toContain('{ id: "welcome", Screen: WelcomeScreen, mode: {"scheme":"light"} }');
		expect(app).toContain("<ScreenMode key={id} mode={mode}>");
	});

	test("next and react router: each route wraps its screen in ScreenMode", () => {
		const next = byPath(nextProject(withSection));
		const router = byPath(reactRouterProject(withSection));

		expect(next["src/app/settings/page.tsx"]).toContain(settingsMode);
		expect(next["src/app/settings/page.tsx"]).toContain("<ScreenMode mode={mode}>");
		expect(next["src/app/welcome/page.tsx"]).toContain('const mode = {"scheme":"light"};');
		expect(router["src/app/routes/settings.tsx"]).toContain(settingsMode);
		expect(router["src/lib/screen-mode.tsx"]).toBeString();
	});

	test("a section's DESIGN.md mode option reaches its screens and the stylesheet", () => {
		const theme = designTokensOf(
			"## Tokens\n\n### Brand mode: Default\n\n### Brand mode: Acme\n\n- primary: #e11d48\n",
		);

		const acme = { ...dark, modes: { brand: "acme" } };
		const out = byPath(viteProject({ ...input, theme, sections: [acme] }));
		const app = out["src/App.tsx"]!;

		expect(app).toContain('{ id: "settings", Screen: SettingsScreen, mode: {"scheme":"light","brand":"acme"} }');
		expect(app).toContain('{ id: "welcome", Screen: WelcomeScreen, mode: {"scheme":"light","brand":"default"} }');
		expect(out["src/index.css"]).toContain(':root:not(.dark)[data-mode-brand="acme"] {\n\t--primary: #e11d48;\n}');
	});
});
