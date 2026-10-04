import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			...electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
			{ find: /^@\//, replacement: `${resolve(import.meta.dirname, "src/mainview")}/` },
		],
	},
	root: "src/mainview",
	// Relative asset URLs so the bundle resolves under views://mainview/
	base: "./",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
