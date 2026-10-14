// A runnable project from the canvas. Screens and components are copied verbatim, so the export looks like the canvas
// without conversion; a framework adds the files that run them (Vite, Next.js, React Router).

import { SCREEN_THEME_CSS } from "../../mainview/lib/render/theme";
import { assetKey, PUBLIC_DIR, type ProjectAssets } from "../assets";
import { customTokenNames, tokenThemeCss, tokensToCss, type DesignTokens } from "../context/tokens";
import { isComponentFile, isScreenFile } from "../project";
import { isAlternate } from "../variations";
import type { ExportFile, Frame, ProjectFiles } from "../types";
import { importSpecifiers, localDependencies } from "./code";
import { handoffFiles } from "./handoff";
import { tokenFiles } from "./tokens";

export type AppProjectInput = {
	name: string;
	/** The first screen opens first */
	frames: Frame[];
	files: ProjectFiles;
	/** The tokens applied to the screens, which may lag behind DESIGN.md */
	theme: DesignTokens;
	/** By module name (`button` for `@/components/ui/button`, `uai/message` for `@/components/ui/uai/message`) */
	uiSources: Record<string, string>;
	includeAlternates?: boolean;
	/** The project's `public/` images; the app serves them at `/`, where screens point */
	assets?: ProjectAssets;
};

export type AppProject = {
	files: ExportFile[];
	/** Imports the export can't satisfy */
	warnings: string[];
};

/** A page the app routes to: `screens/welcome.alt-1.tsx` is `welcome.alt-1`, imported as `WelcomeAlt1Screen` from `screens/welcome.alt-1` */
export type ProjectScreen = { file: string; id: string; identifier: string; module: string };

/** `handoff` is the dev handoff page's route id, when the project has one */
export type FrameworkContext = { name: string; screens: ProjectScreen[]; handoff: string | null };

export type FrameworkReadme = {
	/** What the project is, after "Exported from Rabisco as a … project." */
	intro: string;
	/** The README line about the pages' folder */
	pages: string;
	/** Before the list of pages, e.g. `Screens` */
	list: string;
	/** How prototype links work, when the pages have them */
	links?: string;
};

export type Framework = {
	name: string;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	scripts: Record<string, string>;
	/** Where Tailwind, the theme and the tokens go */
	stylesheet: string;
	files: (context: FrameworkContext) => ExportFile[];
	/** Where the app shows a screen, for the handoff page */
	screenUrl: (id: string) => string;
	gitignore: string;
	readme: FrameworkReadme;
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

export const TYPESCRIPT_VERSIONS = {
	"@types/react": "^19.3.0",
	"@types/react-dom": "^19.3.0",
	typescript: "^5.9.3",
};

const UI_PREFIX = "@/components/ui/";

/** The uai blocks import their own copy of `cn` */
const UAI_UTILS = "@/lib/uai-utils";

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

const pageId = (file: string) => file.replace(/^[^/]+\//, "").replace(/\.tsx$/, "");

/** Canvas order first, then screens without a frame, sorted */
function exportedScreens(input: AppProjectInput) {
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

const sorted = (record: Record<string, string>) =>
	Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

function packageJson(name: string, framework: Framework, sources: string[], warnings: string[]) {
	const dependencies = new Map(Object.entries(framework.dependencies));

	const add = (pkg: string) => {
		const version = VERSIONS.get(pkg);

		if (version) dependencies.set(pkg, version);
		else warnings.push(`"${pkg}" isn't a package the canvas provides, so it was left out of package.json`);
	};

	// The app, lib/utils.ts and the stylesheet always need these
	for (const pkg of ["react", "react-dom", "clsx", "tailwind-merge", "tw-animate-css"]) add(pkg);

	for (const source of sources) {
		for (const specifier of importSpecifiers(source)) {
			const pkg = packageOf(specifier);

			if (pkg && !dependencies.has(pkg)) add(pkg);
		}
	}

	const json = {
		name: packageName(name),
		private: true,
		version: "0.0.0",
		type: "module",
		scripts: framework.scripts,
		dependencies: sorted(Object.fromEntries(dependencies)),
		devDependencies: sorted(framework.devDependencies),
	};

	return `${JSON.stringify(json, null, "\t")}\n`;
}

export const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The function that turns a `data-link-to` value into a screen id, as source for the app */
export const LINK_TARGET = `/** The screen a link names: \`screens/settings.tsx\`, \`./settings.tsx\` and \`settings\` all mean \`settings\`. */
function linkTarget(to: string) {
	return to
		.trim()
		.replace(/^(\\.\\/|\\/)+/, "")
		.replace(/^screens\\//, "")
		.replace(/\\.tsx$/, "");
}`;

/** The `data-link-to` value of the clicked element, or `null` when the click isn't a link */
export const LINK_CLICK = `/** The \`data-link-to\` of a plain left click on a prototype link, or \`null\` */
function clickedLink(event: MouseEvent) {
	if (event.button !== 0 || !(event.target instanceof Element)) return null;
	return event.target.closest("[data-link-to]")?.getAttribute("data-link-to")?.trim() || null;
}`;

function stylesheet(theme: DesignTokens) {
	const tokens = tokensToCss(theme);
	const custom = tokenThemeCss(customTokenNames(theme));

	return [
		`@import "tailwindcss";\n@import "tw-animate-css";\n`,
		`/* The screen theme: shadcn tokens with neutral colors */\n${SCREEN_THEME_CSS.trim()}\n`,
		custom && `/* The custom DESIGN.md tokens, so bg-brand and rounded-card exist; values are set below */\n${custom}`,
		`/* Screens fill the window, like a frame on the canvas */\nhtml,\nbody,\n#root {\n\theight: 100%;\n}\n`,
		tokens && `/* The DESIGN.md tokens applied to the screens: they override the theme above */\n${tokens}`,
	]
		.filter(Boolean)
		.join("\n");
}

function readme(
	name: string,
	framework: Framework,
	pages: string[],
	components: string[],
	ui: string[],
	images: number,
	handoffUrl: string | null,
) {
	const list = (items: string[]) => items.map((item) => `- \`${item}\``).join("\n");
	const { readme } = framework;

	return `# ${name}

Exported from Rabisco as a ${framework.name} project. ${readme.intro}

## Run it

\`\`\`sh
npm install
npm run dev
\`\`\`

\`npm run build\` builds the app, and \`npm run typecheck\` checks the types.
${handoffUrl ? `\nThe dev handoff page at \`${handoffUrl}\` shows every screen with the components, UI kit modules and tokens it uses, and every token with its light and dark value.\n` : ""}
## What's inside

- ${readme.pages}
- \`src/components/\`: the project's components${components.length ? "" : " (none yet)"}.
- \`src/components/ui/\`: the [shadcn/ui](https://ui.shadcn.com) components the screens use, and the [uai](https://uaiblocks.vercel.app) blocks in \`uai/\`.
- \`${framework.stylesheet}\`: Tailwind, the theme tokens and the \`DESIGN.md\` tokens applied on the canvas.
- \`tokens/\`: the same tokens for your own app, as \`tokens.css\`, a Tailwind theme and DTCG \`tokens.json\`.
${images ? `- \`public/\`: the images the screens show. The app serves them at \`/\`, so \`/images/logo.png\` is \`public/images/logo.png\`.\n` : ""}- \`PRODUCT.md\` and \`DESIGN.md\`: the product and design context, when the project has them.

${readme.list}: ${pages.length ? `\n\n${list(pages.map((file) => `src/${file}`))}` : "none"}
${ui.length ? `\nUI components: ${ui.map((module) => `\`${module}\``).join(", ")}\n` : ""}${
		readme.links
			? `
## Prototype links

Elements with \`data-link-to="screens/settings.tsx"\` open that screen when clicked, and \`data-link-to="back"\` goes back. ${readme.links}

\`data-link-transition\` (\`dissolve\`, \`slide\`, \`push\`) and \`data-link-mode\` (\`overlay\`, \`sheet\`) say how Rabisco plays a link: with an animation, or as a modal or sheet over the current screen. The app here ignores them and opens the screen; keep them as notes for your own transitions and dialogs, or remove them.
`
			: ""
	}`;
}

export function appProject(input: AppProjectInput, framework: Framework): AppProject {
	const screens = exportedScreens(input);

	if (!screens.length) throw new Error("There are no screens to export");

	return buildProject(input, framework, screens, true);
}

/** `pages` are files in `input.files` the framework routes to; every component comes too */
export function buildProject(
	input: AppProjectInput,
	framework: Framework,
	pages: string[],
	handoff = false,
): AppProject {
	const { files, name } = input;
	const warnings: string[] = [];
	const roots = [...pages, ...Object.keys(files).filter(isComponentFile).sort()];
	const included = new Set(roots);

	for (const file of roots) for (const dep of localDependencies(files, file)) included.add(dep);
	const projectFiles = [...included];
	const projectSources = projectFiles.map((file) => files[file]!);

	const missingUi = new Set<string>();
	const ui = uiModules(projectSources, input.uiSources, missingUi);

	for (const specifier of missingUi)
		warnings.push(`"${specifier}" isn't a component the canvas provides, so it was left out`);
	const uiSources = ui.map((module) => input.uiSources[module]!);
	const assets: [string, string][] = [];

	for (const [src, content] of Object.entries(input.assets ?? {})) {
		const key = assetKey(src);

		if (key) assets.push([key, content]);
	}

	assets.sort(([a], [b]) => a.localeCompare(b));

	const screens = pages.map((file) => ({
		file,
		id: pageId(file),
		identifier: screenIdentifier(pageId(file)),
		module: file.replace(/\.tsx$/, ""),
	}));

	const handoffId = screens.some((screen) => screen.id === "handoff") ? "dev-handoff" : "handoff";
	const context: FrameworkContext = { name, screens, handoff: handoff ? handoffId : null };

	const components = projectFiles.filter(isComponentFile);

	const out: ExportFile[] = [
		{ path: "package.json", content: packageJson(name, framework, [...projectSources, ...uiSources], warnings) },
		{ path: ".gitignore", content: framework.gitignore },
		{
			path: "README.md",
			content: readme(
				name,
				framework,
				pages,
				components,
				ui,
				assets.length,
				context.handoff && framework.screenUrl(context.handoff),
			),
		},
		...framework.files(context),
		{ path: framework.stylesheet, content: stylesheet(input.theme) },
		{ path: "src/lib/utils.ts", content: UTILS },
		...ui.map((module) => ({ path: `src/components/ui/${module}.tsx`, content: input.uiSources[module]! })),
		...projectFiles.map((file) => ({ path: `src/${file}`, content: files[file]! })),
	];

	if (uiSources.some((source) => importSpecifiers(source).includes(UAI_UTILS)))
		out.push({ path: "src/lib/uai-utils.ts", content: UTILS });

	out.push(...tokenFiles(input.theme));

	if (handoff) {
		const handoffScreens = screens.map((screen) => {
			const dependencies = localDependencies(files, screen.file);
			const sources = [screen.file, ...dependencies].map((file) => files[file]!);

			return {
				file: screen.file,
				id: screen.id,
				url: framework.screenUrl(screen.id),
				dependencies,
				ui: uiModules(sources, input.uiSources, new Set()),
			};
		});

		out.push(...handoffFiles({ name, frames: input.frames, files, theme: input.theme, screens: handoffScreens }));
	}

	for (const context of ["PRODUCT.md", "DESIGN.md"])
		if (files[context]?.trim()) out.push({ path: context, content: files[context]! });

	for (const [src, content] of assets) out.push({ path: `${PUBLIC_DIR}${src}`, content, encoding: "base64" });

	return { files: out, warnings };
}
