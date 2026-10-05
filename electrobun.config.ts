import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Rabisco",
		identifier: "app.rabisco.desktop",
		version: "0.0.1",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"dist/runtime": "views/mainview/runtime",
		},
		// Vite output is rebuilt by `hutch run ui:build` / HMR, not the watcher
		watchIgnore: ["dist/**", "src/mainview/public/runtime/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
