import { Electroview } from "electrobun/view";
import * as esbuild from "esbuild-wasm";
import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";
import { transform as sucraseTransform } from "sucrase";
import initSwc, { transformSync as swcTransformSync } from "@swc/wasm-web";
import swcWasmUrl from "@swc/wasm-web/wasm_bg.wasm?url";
import tailwindBrowserRuntime from "../../../node_modules/@tailwindcss/browser/dist/index.global.js?raw";
import tailwindIndex from "../generated/tailwind-index";
import { FIXTURES } from "../shared/fixtures";
import type { BenchRPC } from "../shared/rpc";
import { extractCandidates, measure, once, summarize, type Stat } from "../shared/stats";
import { createTailwind } from "../shared/tailwind";

const rpc = Electroview.defineRPC<BenchRPC>({ maxRequestTime: 120_000, handlers: { requests: {}, messages: {} } });

new Electroview({ rpc });

const logEl = document.getElementById("log")!;

const log = (line: string) => {
	logEl.textContent += `\n${line}`;
};

const results: Stat[] = [];

const checks: Record<string, string> = {};

const push = (stat: Stat) => {
	results.push(stat);
	log(`${stat.name}: median ${stat.median.toFixed(3)} ms (p95 ${stat.p95.toFixed(3)}, n=${stat.n})`);
};

// ---------------------------------------------------------------- compilers

const compilers = {
	"esbuild-wasm": async (source) =>
		(await esbuild.transform(source, { loader: "tsx", jsx: "automatic", format: "esm", target: "es2022" })).code,
	sucrase: (source) =>
		sucraseTransform(source, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code,
	"swc-wasm": (source) =>
		swcTransformSync(source, {
			jsc: {
				parser: { syntax: "typescript", tsx: true },
				transform: { react: { runtime: "automatic" } },
				target: "es2022",
			},
			module: { type: "es6" },
		}).code,
} satisfies Record<string, (source: string) => string | Promise<string>>;

/** Correctness gate: the output must parse as an ES module (imports stripped, nothing is called). */
async function parsesAsModule(code: string) {
	// Sucrase keeps imports on the same line as code to preserve line numbers
	const stripped = code.replace(/\bimport\s[^;'"]*?from\s*["'][^"']+["'];?/g, "");
	const url = URL.createObjectURL(new Blob([stripped], { type: "text/javascript" }));

	try {
		await import(/* @vite-ignore */ url);

		return "ok";
	} catch (error) {
		return `FAIL ${String(error)}`;
	} finally {
		URL.revokeObjectURL(url);
	}
}

// ---------------------------------------------------------------- tailwind per frame

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

function frameMarkup(candidates: string[]) {
	const elements = candidates.map((c) => `<div class="${c.replace(/"/g, "")}"></div>`).join("");

	return `<div id="probe" class="p-4"></div><div hidden>${elements}</div>`;
}

/** Time from inserting an iframe until `#probe` has Tailwind's p-4 applied. */
async function timeToStyled(srcdoc: string) {
	const iframe = document.createElement("iframe");
	iframe.style.cssText = "position:absolute;left:-9999px;width:390px;height:844px";
	const start = performance.now();
	iframe.srcdoc = srcdoc;
	document.body.appendChild(iframe);

	for (;;) {
		const probe = iframe.contentDocument?.getElementById("probe");

		if (probe && iframe.contentWindow!.getComputedStyle(probe).paddingTop === "16px") break;

		if (performance.now() - start > 10_000) throw new Error("timed out waiting for styles");
		await nextFrame();
	}

	const elapsed = performance.now() - start;
	iframe.remove();

	return elapsed;
}

async function sampleFrames(name: string, srcdoc: () => string, iterations = 15) {
	await timeToStyled(srcdoc()); // warm the cache
	const samples: number[] = [];

	for (let i = 0; i < iterations; i++) samples.push(await timeToStyled(srcdoc()));

	return summarize(name, samples);
}

// ---------------------------------------------------------------- run

async function run() {
	push(await once("webview · esbuild-wasm initialize", () => esbuild.initialize({ wasmURL: esbuildWasmUrl })));
	push(await once("webview · swc-wasm initialize", () => initSwc({ module_or_path: swcWasmUrl })));

	for (const [name, compile] of Object.entries(compilers)) {
		push(await once(`webview · ${name} first call (small)`, () => compile(FIXTURES.small)));

		for (const [size, source] of Object.entries(FIXTURES)) {
			push(
				await measure(`webview · ${name} (${size})`, () => compile(source), { warmup: 5, iterations: 20, batch: 20 }),
			);
		}

		checks[`webview.${name}.medium.parses`] = await parsesAsModule(await compile(FIXTURES.medium));
		checks[`webview.${name}.large.parses`] = await parsesAsModule(await compile(FIXTURES.large));
	}

	// RPC overhead on its own, by payload size
	for (const kb of [0, 8, 40]) {
		const payload = "x".repeat(kb * 1024);
		push(
			await measure(
				`webview → main RPC · ping (${kb} KB)`,
				() => rpc.request.ping({ payload }).then((r) => r.payload),
				{ warmup: 5, iterations: 10, batch: 5 },
			),
		);
	}

	// End to end through RPC: what the webview actually waits for when the main process compiles
	for (const mode of ["transpiler", "build"] as const) {
		for (const size of ["medium", "large"] as const) {
			push(
				await measure(
					`webview → main RPC · ${mode} (${size})`,
					() => rpc.request.compileInMain({ source: FIXTURES[size], mode }).then((r) => r.code),
					{
						warmup: 5,
						iterations: 10,
						batch: 5,
					},
				),
			);
		}

		const { code } = await rpc.request.compileInMain({ source: FIXTURES.medium, mode });
		checks[`main.${mode}.medium.parses`] = await parsesAsModule(code);
		const large = await rpc.request.compileInMain({ source: FIXTURES.large, mode });
		checks[`main.${mode}.large.parses`] = await parsesAsModule(large.code);
	}

	// Tailwind compile() in the webview
	for (const [size, source] of Object.entries(FIXTURES)) {
		push(
			await measure(`webview · extract candidates (${size})`, () => extractCandidates(source), {
				warmup: 10,
				iterations: 20,
				batch: 50,
			}),
		);
	}

	push(
		await measure("webview · tailwind compile() init", () => createTailwind(tailwindIndex), {
			warmup: 2,
			iterations: 10,
			batch: 10,
		}),
	);

	for (const size of ["medium", "large"] as const) {
		const candidates = extractCandidates(FIXTURES[size]);
		const fresh = await Promise.all(Array.from({ length: 2 + 10 * 10 }, () => createTailwind(tailwindIndex)));
		let i = 0;
		push(
			await measure(
				`webview · tailwind build cold (${size}, ${candidates.length} candidates)`,
				() => fresh[i++]!.build(candidates),
				{
					warmup: 2,
					iterations: 10,
					batch: 10,
				},
			),
		);
	}

	const warm = await createTailwind(tailwindIndex);
	const base = extractCandidates(FIXTURES.medium);
	const css = warm.build(base);
	let n = 0;
	push(
		await measure(
			"webview · tailwind build incremental (+5 new classes)",
			() => {
				n++;

				return warm.build([...base, `mt-[${n}px]`, `mb-[${n}px]`, `w-[${n}px]`, `h-[${n}px]`, `gap-[${n}px]`]);
			},
			{ iterations: 20, batch: 20 },
		),
	);
	push(await measure("webview · tailwind build no new classes", () => warm.build(base), { iterations: 20, batch: 50 }));

	// Per frame: shared precompiled CSS vs the Tailwind browser runtime inside every iframe
	const markup = frameMarkup(base);
	push(await sampleFrames("frame · precompiled CSS injected → styled", () => `<style>${css}</style>${markup}`));
	push(
		await sampleFrames(
			"frame · @tailwindcss/browser runtime → styled",
			() => `<script>${tailwindBrowserRuntime}</script>${markup}`,
		),
	);

	log("\nReporting…");
	await rpc.request.report({
		env: { userAgent: navigator.userAgent, hardwareConcurrency: String(navigator.hardwareConcurrency) },
		results,
		checks,
	});
	log("Done.");
}

run().catch((error) => {
	log(`ERROR ${error?.stack ?? error}`);
	rpc.request.report({
		env: { error: String(error) },
		results,
		checks: { ...checks, error: String(error?.stack ?? error) },
	});
});
