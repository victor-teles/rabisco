import { BrowserView, BrowserWindow, Utils } from "electrobun/main";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import tailwindIndex from "./generated/tailwind-index";
import { FIXTURES, LOCAL_COMPONENTS, SCREEN_WITH_LOCAL_COMPONENTS } from "./shared/fixtures";
import type { BenchRPC, CompileMode } from "./shared/rpc";
import { extractCandidates, measure, once, type Stat } from "./shared/stats";
import { createTailwind } from "./shared/tailwind";
import { transform as sucraseTransform } from "sucrase";

// ---------------------------------------------------------------- compilers

const transpiler = new Bun.Transpiler({ loader: "tsx", target: "browser" });

/**
 * transformSync always emits dev-mode JSX helpers with hashed names and no
 * import (it expects a bundler afterwards), so we import them ourselves.
 */
function transpile(source: string) {
	const code = transpiler.transformSync(source);
	const jsx = code.match(/\bjsxDEV_[a-z0-9]+\b/)?.[0];
	const fragment = code.match(/\bFragment_[a-z0-9]+\b/)?.[0];
	const names = [jsx && `jsxDEV as ${jsx}`, fragment && `Fragment as ${fragment}`].filter(Boolean);
	return names.length ? `import { ${names.join(", ")} } from "react/jsx-dev-runtime";\n${code}` : code;
}

const EXTERNAL = ["react", "react/*", "react-dom", "lucide-react", "@/*"];

async function build(files: Record<string, string> | undefined, entry: string) {
	const result = await Bun.build({
		entrypoints: [entry],
		...(files ? { files } : {}),
		external: EXTERNAL,
		format: "esm",
		target: "browser",
		jsx: { runtime: "automatic", importSource: "react", development: false },
	} as Parameters<typeof Bun.build>[0]);
	if (!result.success) throw new Error(result.logs.map((l) => l.message).join("\n"));
	return result.outputs[0]!.text();
}

const buildSingle = (source: string) => build({ "/project/screens/screen.tsx": source }, "/project/screens/screen.tsx");

const compileInMain = (source: string, mode: CompileMode) => (mode === "transpiler" ? transpile(source) : buildSingle(source));

// ---------------------------------------------------------------- benchmarks

async function runMainBenchmarks(): Promise<{ results: Stat[]; checks: Record<string, string> }> {
	const results: Stat[] = [];
	const checks: Record<string, string> = {};

	results.push(await once("main · Bun.Transpiler first call (small)", () => transpile(FIXTURES.small)));
	results.push(await once("main · Bun.build first call (small)", () => buildSingle(FIXTURES.small)));

	for (const [size, source] of Object.entries(FIXTURES)) {
		results.push(await measure(`main · Bun.Transpiler (${size})`, () => transpile(source), { warmup: 10, iterations: 50 }));
		results.push(await measure(`main · Bun.build (${size})`, () => buildSingle(source), { warmup: 5, iterations: 30 }));
	}

	// Same pure-JS compiler as the webview, to compare the two JavaScriptCore setups
	for (const size of ["medium", "large"] as const) {
		results.push(
			await measure(
				`main · sucrase (${size})`,
				() => sucraseTransform(FIXTURES[size], { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code,
				{ warmup: 10, iterations: 30 },
			),
		);
	}

	// Projects are folders, so bundling reads the screen and its components from disk
	const projectDir = join(Utils.paths.userData, "bench-project");
	const entry = join(projectDir, "screens/home.tsx");
	for (const [path, source] of Object.entries({ ...LOCAL_COMPONENTS, "/project/screens/home.tsx": SCREEN_WITH_LOCAL_COMPONENTS })) {
		const target = join(projectDir, path.replace("/project/", ""));
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, source);
	}
	const bundleFromDisk = () => build(undefined, entry);
	results.push(
		await measure("main · Bun.build screen + 3 local components (from disk)", bundleFromDisk, {
			note: "bundled into one module",
		}),
	);

	checks["main.transpiler.medium.head"] = transpile(FIXTURES.medium).slice(0, 200);
	checks["main.build.medium.head"] = (await buildSingle(FIXTURES.medium)).slice(0, 200);
	const bundled = await bundleFromDisk();
	checks["main.build.bundle.inlinesComponents"] = String(bundled.includes("function StatCard") && !bundled.includes("../components"));

	// Tailwind
	for (const [size, source] of Object.entries(FIXTURES)) {
		results.push(await measure(`main · extract candidates (${size})`, () => extractCandidates(source), { warmup: 10, iterations: 50 }));
	}
	results.push(await measure("main · tailwind compile() init", () => createTailwind(tailwindIndex), { warmup: 2, iterations: 10 }));
	for (const size of ["medium", "large"] as const) {
		const candidates = extractCandidates(FIXTURES[size]);
		const compilers = await Promise.all(Array.from({ length: 12 }, () => createTailwind(tailwindIndex)));
		let i = 0;
		results.push(
			await measure(`main · tailwind build cold (${size}, ${candidates.length} candidates)`, () => compilers[i++]!.build(candidates), {
				warmup: 2,
				iterations: 10,
			}),
		);
	}
	const warm = await createTailwind(tailwindIndex);
	const base = extractCandidates(FIXTURES.medium);
	warm.build(base);
	let n = 0;
	results.push(
		await measure("main · tailwind build incremental (+5 new classes)", () => {
			n++;
			return warm.build([...base, `mt-[${n}px]`, `mb-[${n}px]`, `w-[${n}px]`, `h-[${n}px]`, `gap-[${n}px]`]);
		}),
	);
	results.push(await measure("main · tailwind build no new classes", () => warm.build(base)));
	checks["main.tailwind.css.bytes"] = String(warm.build(base).length);

	return { results, checks };
}

// ---------------------------------------------------------------- app

const mainRun = await runMainBenchmarks();

const rpc = BrowserView.defineRPC<BenchRPC>({
	maxRequestTime: 120_000,
	handlers: {
		requests: {
			ping: ({ payload }) => ({ payload }),
			compileInMain: async ({ source, mode }) => ({ code: await compileInMain(source, mode) }),
			report: ({ env, results, checks }) => {
				const all = {
					date: new Date().toISOString(),
					env: { ...env, cottontail: Bun.version, platform: process.platform, arch: process.arch },
					results: [...mainRun.results, ...results],
					checks: { ...mainRun.checks, ...checks },
				};
				const path = join(Utils.paths.userData, "bench-results.json");
				writeFileSync(path, JSON.stringify(all, null, 2));
				console.log(`BENCH_RESULTS_PATH ${path}`);
				setTimeout(() => Utils.quit(), 200);
				return { ok: true };
			},
		},
		messages: {},
	},
});

new BrowserWindow({
	title: "Rabisco compile bench",
	url: "views://bench/index.html",
	frame: { width: 900, height: 700, x: 100, y: 100 },
	rpc,
});
