import {
	appProject,
	escapeHtml,
	LINK_CLICK,
	LINK_TARGET,
	TYPESCRIPT_VERSIONS,
	type AppProjectInput,
	type Framework,
	type ProjectScreen,
} from "./app-project";

export type ViteProjectInput = AppProjectInput;

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

function appTsx(screens: ProjectScreen[], handoff: string | null) {
	const handoffImport = handoff ? `import { Handoff } from "./handoff/handoff";\n` : "";

	return `import { useEffect, useState } from "react";
${handoffImport}${screens.map((s) => `import ${s.identifier} from "./${s.module}";`).join("\n")}

/** The screens, in canvas order. The first one opens first. */
const screens = [
${screens.map((s) => `\t{ id: ${JSON.stringify(s.id)}, Screen: ${s.identifier} },`).join("\n")}
];

/** The screen in the URL hash (\`#/settings\`), or the first screen${handoff ? `; \`null\` for the handoff page (\`#/${handoff}\`)` : ""}. */
function currentScreen() {
	const id = decodeURIComponent(window.location.hash.replace(/^#\\/?/, ""));
${handoff ? `\tif (id === ${JSON.stringify(handoff)}) return null;\n` : ""}	return screens.find((screen) => screen.id === id) ?? screens[0];
}

${LINK_TARGET}

${LINK_CLICK}

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
			const to = clickedLink(event);
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

${handoff ? "\tif (!screen) return <Handoff />;\n" : ""}	const { id, Screen } = screen;
	return <Screen key={id} />;
}
`;
}

export const VITE: Framework = {
	name: "Vite + React",
	dependencies: {},
	devDependencies: {
		...TYPESCRIPT_VERSIONS,
		"@tailwindcss/vite": "^4.3.3",
		"@vitejs/plugin-react": "^6.1.1",
		tailwindcss: "^4.3.3",
		vite: "^8.3.2",
	},
	scripts: { dev: "vite", build: "vite build", preview: "vite preview", typecheck: "tsc --noEmit" },
	stylesheet: "src/index.css",
	gitignore: "node_modules\ndist\n*.local\n",
	screenUrl: (id) => `/#/${id}`,
	files: ({ name, screens, handoff }) => [
		{ path: "vite.config.ts", content: VITE_CONFIG },
		{ path: "tsconfig.json", content: TSCONFIG },
		{ path: "index.html", content: indexHtml(name) },
		{ path: "src/main.tsx", content: MAIN },
		{ path: "src/App.tsx", content: appTsx(screens, handoff) },
		{ path: "src/vite-env.d.ts", content: '/// <reference types="vite/client" />\n' },
	],
	readme: {
		intro: "The screens and components are the same code the canvas renders.",
		pages: "`src/screens/`: one file per screen. `src/App.tsx` shows them in canvas order, starting with the first.",
		list: "Screens",
		links:
			"`src/App.tsx` handles them with a small hash router (`#/settings`). Replace it with your app's router when you wire the screens to real data.",
	},
};

export const viteProject = (input: ViteProjectInput) => appProject(input, VITE);
