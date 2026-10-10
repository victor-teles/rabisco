import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Rabisco Bench",
		identifier: "app.rabisco.bench",
		version: "0.0.1",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "main.ts",
			// Bun.build is reached through a typed global, so include it explicitly
			capabilities: ["build"],
		},
		copy: {
			"dist/index.html": "views/bench/index.html",
			"dist/assets": "views/bench/assets",
		},
		mac: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
