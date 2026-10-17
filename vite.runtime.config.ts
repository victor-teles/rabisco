// A classic IIFE script: frames have an opaque origin, where module scripts would need CORS.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const TABLER = resolve(import.meta.dirname, "node_modules/@tabler/icons");

const PHOSPHOR = resolve(import.meta.dirname, "node_modules/@phosphor-icons/core");

const PHOSPHOR_WEIGHTS = ["regular", "thin", "light", "bold", "fill", "duotone"] as const;

type IconNode = [string, Record<string, string>][];

/** Mirrors `iconFileName` in `src/shared/icons.ts` */
const iconFileName = (base: string) => base.replace(/(?<=.)([A-Z])/g, "-$1").toLowerCase();

/** How @tabler/icons-react names its exports: `a-b-2` → `AB2` */
const tablerPascal = (name: string) => name.replace(/(^\w|-\w)/g, (part) => part.replace("-", "").toUpperCase());

/** Phosphor's SVGs hold only `<path>`s */
function svgNodes(svg: string): IconNode {
	return [...svg.matchAll(/<(path)\s([^>]*?)\/>/g)].map(([, tag, attributes]) => [
		tag!,
		Object.fromEntries([...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name!, value!])),
	]);
}

function writeIconScripts(dir: string, scripts: Map<string, string>) {
	for (const [name, script] of scripts) {
		const path = join(dir, `${name}.js`);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, script);
	}
}

/** `icons/tabler/<file>.js`: the outline and filled styles of one icon (decision 0050) */
function tablerIcons(): Plugin {
	return {
		name: "rabisco-tabler-icons",
		apply: "build",
		writeBundle(options) {
			const read = (style: string): Record<string, IconNode> =>
				JSON.parse(readFileSync(join(TABLER, `tabler-nodes-${style}.json`), "utf-8"));

			const outline = read("outline");
			const filled = read("filled");
			const scripts = new Map<string, string>();

			for (const name of new Set([...Object.keys(outline), ...Object.keys(filled)])) {
				const file = `tabler/${iconFileName(tablerPascal(name))}`;
				const data = JSON.stringify({ name, outline: outline[name], filled: filled[name] });

				if (scripts.has(file)) this.warn(`Two Tabler icons write ${file}`);
				scripts.set(file, `self.__rabiscoIcon&&__rabiscoIcon(${JSON.stringify(file)},${data});`);
			}

			writeIconScripts(join(options.dir!, "icons"), scripts);
			this.info(`${scripts.size} Tabler icon scripts`);
		},
	};
}

/** `icons/phosphor/<file>.js`: the six weights of one icon, under its name and its old alias (decision 0050) */
function phosphorIcons(): Plugin {
	return {
		name: "rabisco-phosphor-icons",
		apply: "build",
		async writeBundle(options) {
			const { icons } = await import(pathToFileURL(join(PHOSPHOR, "dist/index.mjs")).href);
			const scripts = new Map<string, string>();

			for (const icon of icons) {
				const weights = Object.fromEntries(
					PHOSPHOR_WEIGHTS.map((weight) => {
						const file = weight === "regular" ? icon.name : `${icon.name}-${weight}`;

						return [weight, svgNodes(readFileSync(join(PHOSPHOR, "assets", weight, `${file}.svg`), "utf-8"))];
					}),
				);

				const data = JSON.stringify(weights);

				for (const pascal of [icon.pascal_name, icon.alias?.pascal_name]) {
					if (!pascal) continue;
					const file = `phosphor/${iconFileName(pascal)}`;

					if (!scripts.has(file))
						scripts.set(file, `self.__rabiscoIcon&&__rabiscoIcon(${JSON.stringify(file)},${data});`);
				}
			}

			writeIconScripts(join(options.dir!, "icons"), scripts);
			this.info(`${scripts.size} Phosphor icon scripts`);
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
		tablerIcons(),
		phosphorIcons(),
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
