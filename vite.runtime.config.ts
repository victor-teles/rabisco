// Builds the screen runtime (src/mainview/runtime) into src/mainview/public/runtime/, so the
// dev server serves it and the app build copies it into dist/runtime/.
// A classic IIFE script: frames have an opaque origin, where module scripts would need CORS.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

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

export default defineConfig({
	plugins: [
		react(),
		{
			name: "rabisco-frame-html",
			generateBundle() {
				this.emitFile({ type: "asset", fileName: "frame.html", source: FRAME_HTML });
			},
		},
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
