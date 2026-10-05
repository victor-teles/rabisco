// Screens and components are copied verbatim, so the export looks like the canvas without conversion.

import { SCREEN_THEME_CSS } from "../../mainview/lib/render/theme";
import { parseDesignTokens, tokensToCss } from "../context/tokens";
import { isComponentFile, isScreenFile } from "../project";
import { isAlternate } from "../variations";
import type { ExportFile, Frame, ProjectFiles } from "../types";
import { importSpecifiers, localDependencies } from "./code";

export type ViteProjectInput = {
	name: string;
	/** The first screen opens first */
	frames: Frame[];
	files: ProjectFiles;
	/** By module name (`button` for `@/components/ui/button`) */
	uiSources: Record<string, string>;
	includeAlternates?: boolean;
};

export type ViteProject = {
	files: ExportFile[];
	/** Imports the export can't satisfy */
	warnings: string[];
};

/** Same as the canvas runtime, so the export renders the same way. */
const VERSIONS = new Map(
	Object.entries({
		react: "^19.3.0",
		"react-dom": "^19.3.0",
		"class-variance-authority": "^0.7.1",
		clsx: "^2.1.1",
		"lucide-react": "^1.52.0",
		"radix-ui": "^1.6.7",
		"tailwind-merge": "^3.7.0",
		"tw-animate-css": "^1.4.0",
	}),
);

const DEV_VERSIONS = {
	"@tailwindcss/vite": "^4.3.3",
	"@types/react": "^19.3.0",
	"@types/react-dom": "^19.3.0",
	"@vitejs/plugin-react": "^6.1.1",
	tailwindcss: "^4.3.3",
	typescript: "^5.9.3",
	vite: "^8.3.2",
};

const UI_PREFIX = "@/components/ui/";

const UTILS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
`;

/** `My App!` → `my-app` */
export function packageName(name: string) {
	const kebab = name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return kebab || "rabisco-design";
}

/** `@scope/pkg/x` → `@scope/pkg`; `null` for relative and `@/` imports */
function packageOf(specifier: string) {
	if (specifier.startsWith(".") || specifier.startsWith("@/")) return null;
	const parts = specifier.split("/");

	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** `welcome.alt-1` → `WelcomeAlt1Screen` */
function screenIdentifier(id: string) {
	const pascal = id
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((word) => word[0]!.toUpperCase() + word.slice(1))
		.join("");

	return `${/^[0-9]/.test(pascal) ? "_" : ""}${pascal}Screen`;
}

const screenId = (file: string) => file.replace(/^screens\//, "").replace(/\.tsx$/, "");

/** Canvas order first, then screens without a frame, sorted */
function exportedScreens(input: ViteProjectInput) {
	const keep = (file: string) =>
		isScreenFile(file) && Object.hasOwn(input.files, file) && (input.includeAlternates || !isAlternate(file));

	const onCanvas = input.frames.map((frame) => frame.file).filter(keep);

	const rest = Object.keys(input.files)
		.filter((file) => keep(file) && !onCanvas.includes(file))
		.sort();

	return [...new Set([...onCanvas, ...rest])];
}

/** Transitive; names the canvas doesn't provide go to `missing`. */
function uiModules(sources: string[], uiSources: Record<string, string>, missing: Set<string>) {
	const found = new Set<string>();

	const visit = (source: string) => {
		for (const specifier of importSpecifiers(source)) {
			if (!specifier.startsWith(UI_PREFIX)) continue;
			const name = specifier.slice(UI_PREFIX.length);

			if (found.has(name)) continue;

			if (uiSources[name] === undefined) {
				missing.add(specifier);
				continue;
			}

			found.add(name);
			visit(uiSources[name]!);
		}
	};

	sources.forEach(visit);

	return [...found].sort();
}

function packageJson(name: string, sources: string[], warnings: string[]) {
	const dependencies: Record<string, string> = {};

	const add = (pkg: string) => {
		const version = VERSIONS.get(pkg);

		if (version) dependencies[pkg] = version;
		else warnings.push(`"${pkg}" isn't a package the canvas provides, so it was left out of package.json`);
	};

	// main.tsx, lib/utils.ts and index.css always need these
	for (const pkg of ["react", "react-dom", "clsx", "tailwind-merge", "tw-animate-css"]) add(pkg);

	for (const source of sources) {
		for (const specifier of importSpecifiers(source)) {
			const pkg = packageOf(specifier);

			if (pkg && !dependencies[pkg]) add(pkg);
		}
	}

	const sorted = (record: Record<string, string>) =>
		Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

	const json = {
		name: packageName(name),
		private: true,
		version: "0.0.0",
		type: "module",
		scripts: { dev: "vite", build: "vite build", preview: "vite preview", typecheck: "tsc --noEmit" },
		dependencies: sorted(dependencies),
		devDependencies: DEV_VERSIONS,
	};

	return `${JSON.stringify(json, null, "\t")}\n`;
}

const VITE_CONFIG = `import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
});
`;

const TSCONFIG = `${JSON.stringify(
	{
		compilerOptions: {
			target: "ES2022",
			lib: ["ES2022", "DOM", "DOM.Iterable"],
			module: "ESNext",
			moduleResolution: "bundler",
			jsx: "react-jsx",
			strict: true,
			skipLibCheck: true,
			isolatedModules: true,
			noEmit: true,
			paths: { "@/*": ["./src/*"] },
		},
		include: ["src"],
	},
	null,
	"\t",
)}\n`;

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const indexHtml = (name: string) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${escapeHtml(name)}</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="/src/main.tsx"></script>
	</body>
</html>
`;

const MAIN = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
`;

function appTsx(screens: string[]) {
	const entries = screens.map((file) => ({
		id: screenId(file),
		name: screenIdentifier(screenId(file)),
		from: `./${file.replace(/\.tsx$/, "")}`,
	}));

	return `import { useEffect, useState } from "react";
${entries.map((e) => `import ${e.name} from "${e.from}";`).join("\n")}

/** The screens, in canvas order. The first one opens first. */
const screens = [
${entries.map((e) => `\t{ id: ${JSON.stringify(e.id)}, Screen: ${e.name} },`).join("\n")}
];

/** The screen in the URL hash (\`#/settings\`), or the first screen. */
function currentScreen() {
	const id = decodeURIComponent(window.location.hash.replace(/^#\\/?/, ""));
	return screens.find((screen) => screen.id === id) ?? screens[0];
}

/** The screen a link names: \`screens/settings.tsx\`, \`./settings.tsx\` and \`settings\` all mean \`settings\`. */
function linkTarget(to: string) {
	return to
		.trim()
		.replace(/^(\\.\\/|\\/)+/, "")
		.replace(/^screens\\//, "")
		.replace(/\\.tsx$/, "");
}

/**
 * Shows one screen at a time. A click on an element with \`data-link-to\`
 * (a prototype link drawn in Rabisco) opens that screen, and \`back\` goes back.
 */
export default function App() {
	const [screen, setScreen] = useState(currentScreen);

	useEffect(() => {
		const onHashChange = () => {
			setScreen(currentScreen());
			window.scrollTo(0, 0);
		};
		// Capture phase: the link wins over the screen's own click handlers
		const onClick = (event: MouseEvent) => {
			if (event.button !== 0 || !(event.target instanceof Element)) return;
			const to = event.target.closest("[data-link-to]")?.getAttribute("data-link-to")?.trim();
			if (!to) return;
			event.preventDefault();
			event.stopPropagation();
			if (to.toLowerCase() === "back") window.history.back();
			else if (screens.some((s) => s.id === linkTarget(to))) window.location.hash = \`/\${linkTarget(to)}\`;
			else console.warn(\`No screen for data-link-to="\${to}"\`);
		};
		window.addEventListener("hashchange", onHashChange);
		window.addEventListener("click", onClick, true);
		return () => {
			window.removeEventListener("hashchange", onHashChange);
			window.removeEventListener("click", onClick, true);
		};
	}, []);

	const { id, Screen } = screen;
	return <Screen key={id} />;
}
`;
}

function indexCss(files: ProjectFiles) {
	const tokens = files["DESIGN.md"] ? tokensToCss(parseDesignTokens(files["DESIGN.md"])) : "";

	return [
		`@import "tailwindcss";\n@import "tw-animate-css";\n`,
		`/* The screen theme: shadcn tokens with neutral colors */\n${SCREEN_THEME_CSS.trim()}\n`,
		`/* Screens fill the window, like a frame on the canvas */\nhtml,\nbody,\n#root {\n\theight: 100%;\n}\n`,
		tokens && `/* Tokens from DESIGN.md: they override the theme above */\n${tokens}`,
	]
		.filter(Boolean)
		.join("\n");
}

function readme(name: string, screens: string[], components: string[], ui: string[]) {
	const list = (items: string[]) => items.map((item) => `- \`${item}\``).join("\n");

	return `# ${name}

Exported from Rabisco. The screens and components are the same code the canvas renders.

## Run it

\`\`\`sh
npm install
npm run dev
\`\`\`

\`npm run build\` builds a static site into \`dist/\`, and \`npm run typecheck\` checks the types.

## What's inside

- \`src/screens/\`: one file per screen. \`src/App.tsx\` shows them in canvas order, starting with the first.
- \`src/components/\`: the project's components${components.length ? "" : " (none yet)"}.
- \`src/components/ui/\`: the [shadcn/ui](https://ui.shadcn.com) components the screens use.
- \`src/index.css\`: Tailwind, the theme tokens and the overrides from \`DESIGN.md\`.
- \`PRODUCT.md\` and \`DESIGN.md\`: the product and design context, when the project has them.

Screens: ${screens.length ? `\n\n${list(screens.map((file) => `src/${file}`))}` : "none"}
${ui.length ? `\nshadcn/ui components: ${ui.map((name) => `\`${name}\``).join(", ")}\n` : ""}
## Prototype links

Elements with \`data-link-to="screens/settings.tsx"\` open that screen when clicked, and \`data-link-to="back"\` goes back. \`src/App.tsx\` handles them with a small hash router (\`#/settings\`). Replace it with your app's router when you wire the screens to real data.
`;
}

const GITIGNORE = "node_modules\ndist\n*.local\n";

export function viteProject(input: ViteProjectInput): ViteProject {
	const { files, name } = input;
	const screens = exportedScreens(input);

	if (!screens.length) throw new Error("There are no screens to export");
	const warnings: string[] = [];

	const roots = [...screens, ...Object.keys(files).filter(isComponentFile).sort()];
	const included = new Set(roots);

	for (const file of roots) for (const dep of localDependencies(files, file)) included.add(dep);
	const projectFiles = [...included];
	const projectSources = projectFiles.map((file) => files[file]!);

	const missingUi = new Set<string>();
	const ui = uiModules(projectSources, input.uiSources, missingUi);

	for (const specifier of missingUi)
		warnings.push(`"${specifier}" isn't a component the canvas provides, so it was left out`);
	const uiSources = ui.map((module) => input.uiSources[module]!);

	const out: ExportFile[] = [
		{ path: "package.json", content: packageJson(name, [...projectSources, ...uiSources], warnings) },
		{ path: "vite.config.ts", content: VITE_CONFIG },
		{ path: "tsconfig.json", content: TSCONFIG },
		{ path: "index.html", content: indexHtml(name) },
		{ path: ".gitignore", content: GITIGNORE },
		{ path: "README.md", content: readme(name, screens, projectFiles.filter(isComponentFile), ui) },
		{ path: "src/main.tsx", content: MAIN },
		{ path: "src/App.tsx", content: appTsx(screens) },
		{ path: "src/index.css", content: indexCss(files) },
		{ path: "src/vite-env.d.ts", content: '/// <reference types="vite/client" />\n' },
		{ path: "src/lib/utils.ts", content: UTILS },
		...ui.map((module) => ({ path: `src/components/ui/${module}.tsx`, content: input.uiSources[module]! })),
		...projectFiles.map((file) => ({ path: `src/${file}`, content: files[file]! })),
	];

	for (const context of ["PRODUCT.md", "DESIGN.md"])
		if (files[context]?.trim()) out.push({ path: context, content: files[context]! });

	return { files: out, warnings };
}
