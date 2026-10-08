// A classic IIFE script: frames have an opaque origin, where module scripts would need CORS.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FRAME_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<style>html,body,#root{height:100%;margin:0}</style>
		<style id="rabisco-css"></style>
	</head>
	<body>
		<div id="root"></div>
		<script src="./frame.js"></script>
	</body>
</html>
`;

const LUCIDE = resolve(import.meta.dirname, "node_modules/lucide-react/dist/esm");

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * One classic script per icon (`icons/<kebab name>.js`), loaded on demand by `runtime/icons.ts`.
 * Aliases whose kebab name isn't the icon's file (`Home` → `house`) get a copy under their own name.
 */
function lucideIcons(): Plugin {
	return {
		name: "rabisco-lucide-icons",
		apply: "build",
		async writeBundle(options) {
			const index = readFileSync(join(LUCIDE, "lucide-react.mjs"), "utf-8");
			const scripts = new Map<string, string>();

			for (const match of index.matchAll(/export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g)) {
				const file = match[2]!;
				const names = match[1]!.split(",").map((part) => part.trim().replace(/^default as /, ""));
				const bases = new Set(names.map((name) => name.replace(/^Lucide(?=[A-Z0-9])/, "").replace(/(?<=.)Icon$/, "")));
				const { __iconData } = await import(pathToFileURL(join(LUCIDE, "icons", `${file}.mjs`)).href);
				const data = JSON.stringify(__iconData);

				for (const name of [file, ...[...bases].map(kebab)]) {
					// The icon's own file wins over another icon's alias
					if (name !== file && (scripts.has(name) || index.includes(`/icons/${name}.mjs'`))) continue;
					scripts.set(name, `self.__rabiscoIcon&&__rabiscoIcon(${JSON.stringify(name)},${data});`);
				}
			}

			const dir = join(options.dir!, "icons");
			mkdirSync(dir, { recursive: true });

			for (const [name, script] of scripts) writeFileSync(join(dir, `${name}.js`), script);
			this.info(`${scripts.size} icon scripts`);
		},
	};
}

export default defineConfig({
	plugins: [
		react(),
		{
			name: "rabisco-frame-html",
			generateBundle() {
				this.emitFile({ type: "asset", fileName: "frame.html", source: FRAME_HTML });
			},
		},
		lucideIcons(),
	],
	resolve: {
		alias: [{ find: /^@\//, replacement: `${resolve(import.meta.dirname, "src/mainview")}/` }],
	},
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	publicDir: false,
	build: {
		outDir: resolve(import.meta.dirname, "src/mainview/public/runtime"),
		emptyOutDir: true,
		target: "es2022",
		minify: true,
		lib: {
			entry: resolve(import.meta.dirname, "src/mainview/runtime/main.tsx"),
			formats: ["iife"],
			name: "RabiscoRuntime",
			fileName: () => "frame.js",
		},
	},
});
