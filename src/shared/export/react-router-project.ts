import {
	appProject,
	LINK_CLICK,
	LINK_TARGET,
	TYPESCRIPT_VERSIONS,
	type AppProjectInput,
	type Framework,
	type ProjectScreen,
} from "./app-project";

const VERSION = "^8.4.0";

const CONFIG = `import type { Config } from "@react-router/dev/config";

export default {
	appDirectory: "src/app",
	ssr: true,
} satisfies Config;
`;

const VITE_CONFIG = `import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), reactRouter()],
	resolve: {
		tsconfigPaths: true,
	},
});
`;

const TSCONFIG = `${JSON.stringify(
	{
		include: ["**/*", "**/.server/**/*", "**/.client/**/*", ".react-router/types/**/*"],
		compilerOptions: {
			lib: ["DOM", "DOM.Iterable", "ES2022"],
			types: ["vite/client"],
			target: "ES2022",
			module: "ES2022",
			moduleResolution: "bundler",
			jsx: "react-jsx",
			rootDirs: [".", "./.react-router/types"],
			paths: { "@/*": ["./src/*"] },
			esModuleInterop: true,
			noEmit: true,
			resolveJsonModule: true,
			skipLibCheck: true,
			strict: true,
		},
	},
	null,
	"\t",
)}\n`;

const root = (name: string) => `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { ScreenLinks } from "./screen-links";
import "./app.css";

export function meta() {
	return [{ title: ${JSON.stringify(name)} }];
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return (
		<>
			<Outlet />
			<ScreenLinks />
		</>
	);
}
`;

const routeFile = (screen: ProjectScreen) => `src/app/routes/${screen.id}.tsx`;

const routes = (screens: ProjectScreen[]) => `import { index, route, type RouteConfig } from "@react-router/dev/routes";

/** The screens, in canvas order. \`/\` opens the first one. */
export default [
	index("routes/_index.tsx"),
${screens.map((s) => `\troute(${JSON.stringify(s.id)}, ${JSON.stringify(routeFile(s).replace("src/app/", ""))}),`).join("\n")}
] satisfies RouteConfig;
`;

const route = (screen: ProjectScreen) => `import ${screen.identifier} from "@/${screen.module}";

export default function Route() {
	return <${screen.identifier} />;
}
`;

const screenLinks = (screens: ProjectScreen[]) => `import { useEffect } from "react";
import { useNavigate } from "react-router";

const screens = ${JSON.stringify(screens.map((screen) => screen.id))};

${LINK_TARGET}

${LINK_CLICK}

/**
 * A click on an element with \`data-link-to\` (a prototype link drawn in Rabisco)
 * opens that screen's route, and \`back\` goes back.
 */
export function ScreenLinks() {
	const navigate = useNavigate();

	useEffect(() => {
		// Capture phase: the link wins over the screen's own click handlers
		const onClick = (event: MouseEvent) => {
			const to = clickedLink(event);
			if (!to) return;
			event.preventDefault();
			event.stopPropagation();
			if (to.toLowerCase() === "back") void navigate(-1);
			else if (screens.includes(linkTarget(to))) void navigate(\`/\${linkTarget(to)}\`);
			else console.warn(\`No screen for data-link-to="\${to}"\`);
		};
		window.addEventListener("click", onClick, true);
		return () => window.removeEventListener("click", onClick, true);
	}, [navigate]);

	return null;
}
`;

export const REACT_ROUTER: Framework = {
	name: "React Router",
	dependencies: {
		"@react-router/node": VERSION,
		"@react-router/serve": VERSION,
		isbot: "^5.1.36",
		"react-router": VERSION,
	},
	devDependencies: {
		...TYPESCRIPT_VERSIONS,
		"@react-router/dev": VERSION,
		"@tailwindcss/vite": "^4.3.3",
		tailwindcss: "^4.3.3",
		vite: "^8.3.2",
	},
	scripts: {
		dev: "react-router dev",
		build: "react-router build",
		start: "react-router-serve ./build/server/index.js",
		typecheck: "react-router typegen && tsc",
	},
	stylesheet: "src/app/app.css",
	gitignore: "node_modules\n/build\n/.react-router\n.env*\n",
	files: ({ name, screens }) => [
		{ path: "react-router.config.ts", content: CONFIG },
		{ path: "vite.config.ts", content: VITE_CONFIG },
		{ path: "tsconfig.json", content: TSCONFIG },
		{ path: "src/app/root.tsx", content: root(name) },
		{ path: "src/app/routes.ts", content: routes(screens) },
		{ path: "src/app/screen-links.tsx", content: screenLinks(screens) },
		{ path: "src/app/routes/_index.tsx", content: route(screens[0]!) },
		...screens.map((screen) => ({ path: routeFile(screen), content: route(screen) })),
	],
	readme: {
		intro: "The screens and components are the same code the canvas renders.",
		pages:
			"`src/screens/`: one file per screen. Each one is a route in `src/app/routes.ts` (`/settings`), and `/` opens the first.",
		list: "Screens",
		links: "`src/app/screen-links.tsx` handles them with the React Router `navigate`.",
	},
};

export const reactRouterProject = (input: AppProjectInput) => appProject(input, REACT_ROUTER);
