import type { ElectrobunConfig } from "electrobun";

// The Agent SDK spawns this native binary; a packaged app has no node_modules to find it in
const claudeBinary = `claude${process.platform === "win32" ? ".exe" : ""}`;

const claudeSdkBinary = `node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${claudeBinary}`;

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
			[claudeSdkBinary]: `bin/${claudeBinary}`,
		},
		// Vite output is rebuilt by `hutch run ui:build` / HMR, not the watcher
		watchIgnore: ["dist/**", "src/mainview/public/runtime/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
