// @hutch cli=0.27.1 cottontail=0.7.1
export default {
	packageManager: "bun",
	scripts: {
		install: ["hutch", "install"],
		start: "hutch electrobun prepare && hutch run ui:build && hutch electrobun dev",
		dev: "hutch electrobun prepare && hutch run ui:build && hutch electrobun dev --watch",
		"dev:hmr": "bunx concurrently -k -n ui,app 'hutch run hmr' 'hutch run start'",
		hmr: "hutch electrobun prepare && hutch run runtime:build && bunx --bun vite --port 5173",
		"runtime:build": "bunx --bun vite build -c vite.runtime.config.ts",
		"ui:build": "hutch run runtime:build && bunx --bun vite build",
		typecheck: "bunx tsc --noEmit",
		lint: "bunx oxlint",
		"lint:fix": "bunx oxlint --fix",
		fmt: "bunx oxfmt",
		"fmt:check": "bunx oxfmt --check",
		// See bench/compile/README.md
		"bench:compile":
			"cd bench/compile && bun prepare.ts && bunx --bun vite build && hutch electrobun prepare && hutch electrobun dev",
		build: "hutch electrobun prepare && hutch run ui:build && hutch electrobun build --env=stable",
		"build:canary": "hutch electrobun prepare && hutch run ui:build && hutch electrobun build --env=canary",
	},
	electrobun: {
		version: "2.0.2",
	},
};
