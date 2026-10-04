import { defineConfig } from "vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

export default defineConfig({
	resolve: { alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")) },
	root: "view",
	base: "./",
	build: { outDir: "../dist", emptyOutDir: true, target: "es2022", assetsInlineLimit: 0 },
});
