import {
	appProject,
	LINK_CLICK,
	LINK_TARGET,
	TYPESCRIPT_VERSIONS,
	type AppProjectInput,
	type Framework,
	type ProjectScreen,
} from "./app-project";

const NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`;

const POSTCSS_CONFIG = `const config = {
	plugins: {
		"@tailwindcss/postcss": {},
	},
};

export default config;
`;

const TSCONFIG = `${JSON.stringify(
	{
		compilerOptions: {
			target: "ES2022",
			lib: ["dom", "dom.iterable", "esnext"],
			allowJs: true,
			skipLibCheck: true,
			strict: true,
			noEmit: true,
			esModuleInterop: true,
			module: "esnext",
			moduleResolution: "bundler",
			resolveJsonModule: true,
			isolatedModules: true,
			jsx: "react-jsx",
			incremental: true,
			plugins: [{ name: "next" }],
			paths: { "@/*": ["./src/*"] },
		},
		include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
		exclude: ["node_modules"],
	},
	null,
	"\t",
)}\n`;

const layout = (name: string) => `import type { Metadata } from "next";
import { ScreenLinks } from "./screen-links";
import "./globals.css";

export const metadata: Metadata = {
	title: ${JSON.stringify(name)},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				{children}
				<ScreenLinks />
			</body>
		</html>
	);
}
`;

/** Client pages, since screens use state and effects and don't say \`"use client"\` themselves */
const page = (screen: ProjectScreen) => `"use client";

import ${screen.identifier} from "@/${screen.module}";

export default function Page() {
	return <${screen.identifier} />;
}
`;

const handoffPage = (name: string) => `import type { Metadata } from "next";
import { Handoff } from "@/handoff/handoff";

export const metadata: Metadata = {
	title: ${JSON.stringify(`Dev handoff · ${name}`)},
};

export default function Page() {
	return <Handoff />;
}
`;

const screenLinks = (screens: ProjectScreen[]) => `"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The screens, in canvas order. \`/\` opens the first one. */
const screens = ${JSON.stringify(screens.map((screen) => screen.id))};

${LINK_TARGET}

${LINK_CLICK}

/**
 * A click on an element with \`data-link-to\` (a prototype link drawn in Rabisco)
 * opens that screen's route, and \`back\` goes back.
 */
export function ScreenLinks() {
	const router = useRouter();

	useEffect(() => {
		// Capture phase: the link wins over the screen's own click handlers
		const onClick = (event: MouseEvent) => {
			const to = clickedLink(event);
			if (!to) return;
			event.preventDefault();
			event.stopPropagation();
			if (to.toLowerCase() === "back") router.back();
			else if (screens.includes(linkTarget(to))) router.push(\`/\${linkTarget(to)}\`);
			else console.warn(\`No screen for data-link-to="\${to}"\`);
		};
		window.addEventListener("click", onClick, true);
		return () => window.removeEventListener("click", onClick, true);
	}, [router]);

	return null;
}
`;

const GITIGNORE = "node_modules\n.next\nout\nnext-env.d.ts\n*.tsbuildinfo\n.env*\n";

export const NEXT: Framework = {
	name: "Next.js",
	dependencies: { next: "^16.4.0" },
	devDependencies: {
		...TYPESCRIPT_VERSIONS,
		"@tailwindcss/postcss": "^4.3.3",
		"@types/node": "^22",
		tailwindcss: "^4.3.3",
	},
	scripts: { dev: "next dev", build: "next build", start: "next start", typecheck: "next typegen && tsc --noEmit" },
	stylesheet: "src/app/globals.css",
	gitignore: GITIGNORE,
	screenUrl: (id) => `/${id}`,
	files: ({ name, screens, handoff }) => [
		{ path: "next.config.ts", content: NEXT_CONFIG },
		{ path: "postcss.config.mjs", content: POSTCSS_CONFIG },
		{ path: "tsconfig.json", content: TSCONFIG },
		{ path: "src/app/layout.tsx", content: layout(name) },
		{ path: "src/app/screen-links.tsx", content: screenLinks(screens) },
		{ path: "src/app/page.tsx", content: page(screens[0]!) },
		...screens.map((screen) => ({ path: `src/app/${screen.id}/page.tsx`, content: page(screen) })),
		...(handoff ? [{ path: `src/app/${handoff}/page.tsx`, content: handoffPage(name) }] : []),
	],
	readme: {
		intro: "The screens and components are the same code the canvas renders.",
		pages:
			"`src/screens/`: one file per screen. Each one is a route in `src/app/` (`/settings`), and `/` opens the first.",
		list: "Screens",
		links: "`src/app/screen-links.tsx` handles them with the Next.js router.",
	},
};

export const nextProject = (input: AppProjectInput) => appProject(input, NEXT);
