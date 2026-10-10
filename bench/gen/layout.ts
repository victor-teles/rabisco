import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { AssetTracker } from "../../src/bun/assets";
import { readCanvas, readProjectFiles } from "../../src/bun/project-folder";
import { extractCandidates } from "../../src/mainview/lib/render/candidates";
import { CompileCache } from "../../src/mainview/lib/render/compile";
import { collectGraph } from "../../src/mainview/lib/render/graph";
import type { ModulePayload } from "../../src/mainview/lib/render/protocol";
import { createCompiler } from "../../src/mainview/lib/render/tailwind";
import { assetType } from "../../src/shared/assets";
import { isUiModule } from "../../src/shared/components/ui-modules";
import { customTokenNames, designTokensOf, tokensToCss } from "../../src/shared/context/tokens";
import { withLines } from "../../src/shared/design/locate";
import type { ProjectFiles } from "../../src/shared/types";
import { DEVICE_SIZE, type Brief } from "./briefs";
import type { LintReply, LintRequest } from "./layout-page";
import { layoutScoreOf, seedOf, withoutInherited, writtenScreens, type LayoutScore, type ScreenLayout } from "./score";

const root = join(import.meta.dir, "../..");

const LINT_TIMEOUT_MS = 60_000;

export type LayoutChecker = {
	browser: string;
	check: (dir: string, brief: Brief) => Promise<ScreenLayout[]>;
	close: () => Promise<void>;
};

async function buildRuntime(outDir: string) {
	const build = Bun.spawn(
		["bunx", "--bun", "vite", "build", "-c", "vite.runtime.config.ts", "--outDir", outDir, "--logLevel", "error"],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	);

	if ((await build.exited) !== 0)
		throw new Error(`The screen runtime didn't build: ${(await new Response(build.stderr).text()).trim()}`);
}

async function buildPage() {
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, "layout-page.ts")],
		target: "browser",
		format: "iife",
	});

	const output = built.outputs[0];

	if (!built.success || !output) throw new Error(`The layout page didn't build: ${built.logs.join("\n")}`);

	return output.text();
}

function uiCandidates() {
	const dir = join(root, "src/mainview/components/ui");

	return readdirSync(dir, { recursive: true, encoding: "utf8" }).flatMap((file) =>
		file.endsWith(".tsx") && isUiModule(file.slice(0, -".tsx".length))
			? extractCandidates(readFileSync(join(dir, file), "utf8"))
			: [],
	);
}

const stylesheets = {
	tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
	"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
};

const PAGE_HTML = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><script src="page.js"></script></body></html>`;

function serve(runtimeDir: string, pageJs: string) {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = decodeURIComponent(new URL(request.url).pathname);

			if (path === "/") return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });

			if (path === "/page.js") return new Response(pageJs, { headers: { "Content-Type": "text/javascript" } });
			const file = resolve(runtimeDir, `.${path.replace(/^\/runtime/, "")}`);

			if (!path.startsWith("/runtime/") || relative(runtimeDir, file).startsWith(".."))
				return new Response(null, { status: 404 });

			return new Response(Bun.file(file));
		},
	});
}

async function launch(): Promise<Browser> {
	try {
		return await chromium.launch({ channel: "chrome", headless: true });
	} catch (error) {
		const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);

		throw new Error(`Google Chrome didn't start (${reason}). Install Chrome, or pass --no-layout.`);
	}
}

function assetUrls(dir: string) {
	const urls: Record<string, string> = {};

	for (const [src, data] of Object.entries(new AssetTracker(dir).load())) {
		const type = assetType(src);

		if (type) urls[src] = `data:${type};base64,${data}`;
	}

	return urls;
}

function payloadOf(entry: string, files: ProjectFiles, cache: CompileCache) {
	const modules: Record<string, ModulePayload> = {};
	const candidates = new Set<string>();

	for (const [path, module] of collectGraph(entry, files, cache).modules) {
		for (const candidate of module.candidates) candidates.add(candidate);
		modules[path] =
			module.code === null
				? { source: module.source, error: module.error ?? { message: "Didn't compile", line: 1 } }
				: { source: module.source, code: module.code, icons: module.icons };
	}

	return { modules, candidates };
}

async function lintOn(page: Page, request: LintRequest): Promise<LintReply> {
	let timer: Timer | undefined;

	const timeout = new Promise<LintReply>((done) => {
		timer = setTimeout(() => done({ ok: false, error: "The checks didn't finish in time" }), LINT_TIMEOUT_MS);
	});

	const linted = page.evaluate(
		(sent): LintReply | Promise<LintReply> =>
			window.__rabiscoLint?.(sent) ?? { ok: false, error: "The layout page didn't load" },
		request,
	);

	try {
		return await Promise.race([linted, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

async function checkProject(page: Page, base: string[], dir: string, brief: Brief): Promise<ScreenLayout[]> {
	const files = readProjectFiles(dir);
	const canvas = readCanvas(dir);
	const theme = canvas?.theme ?? designTokensOf(files["DESIGN.md"]);
	const seeds = brief.seeds ?? [];
	const before: ProjectFiles = { ...files, ...Object.fromEntries(seeds.map((seed) => [seed.path, seed.source])) };
	const screens = writtenScreens(files, seeds);
	const seeded = seeds.filter((seed) => screens.some((path) => seedOf(path, seeds) === seed));
	const cache = new CompileCache();

	const renders = [
		...screens.map((entry) => ({ key: entry, entry, files, ...payloadOf(entry, files, cache) })),
		...seeded.map((seed) => ({
			key: `seed:${seed.path}`,
			entry: seed.path,
			files: before,
			...payloadOf(seed.path, before, cache),
		})),
	];

	const candidates = new Set(base);

	for (const render of renders) for (const candidate of render.candidates) candidates.add(candidate);
	const compiler = await createCompiler(stylesheets, customTokenNames(theme));
	const css = compiler.build([...candidates]);
	const themeCss = tokensToCss(theme);
	const assets = assetUrls(dir);
	const linted = new Map<string, LintReply>();

	for (const { key, entry, files: sources, modules } of renders) {
		const size = canvas?.frames.find((frame) => frame.file === entry) ?? DEVICE_SIZE[brief.device];
		const request = { entry, width: size.width, height: size.height, modules, css, theme: themeCss, assets };
		const reply = await lintOn(page, request);

		linted.set(
			key,
			reply.ok
				? {
						ok: true,
						findings: withLines(
							reply.findings.map((finding) => ({ path: entry, ...finding })),
							sources,
						),
					}
				: reply,
		);
	}

	return screens.map((path) => {
		const reply = linted.get(path);
		const seed = seedOf(path, seeds);
		const inherited = seed ? linted.get(`seed:${seed.path}`) : undefined;

		if (!reply?.ok) return { path, error: reply?.error ?? "Not checked" };

		return { path, findings: withoutInherited(reply.findings, inherited?.ok ? inherited.findings : []) };
	});
}

export async function startLayoutChecker(): Promise<LayoutChecker> {
	const runtimeDir = mkdtempSync(join(tmpdir(), "rabisco-runtime-"));

	try {
		await buildRuntime(runtimeDir);
		const server = serve(runtimeDir, await buildPage());

		const browser = await launch().catch((error) => {
			void server.stop(true);
			throw error;
		});

		const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
		await page.goto(server.url.href);
		const base = uiCandidates();

		return {
			browser: `Chrome ${browser.version()}`,
			check: (dir, brief) => checkProject(page, base, dir, brief),
			close: async () => {
				await browser.close();
				await server.stop(true);
				rmSync(runtimeDir, { recursive: true, force: true });
			},
		};
	} catch (error) {
		rmSync(runtimeDir, { recursive: true, force: true });
		throw error;
	}
}

export type LayoutRun = { browser: string } | { skipped: string };

export type LayoutProject = { dir: string; brief: Brief };

export async function checkLayouts(
	projects: LayoutProject[],
): Promise<{ run: LayoutRun; scores: Map<string, LayoutScore> }> {
	const scores = new Map<string, LayoutScore>();
	let checker: LayoutChecker;

	try {
		checker = await startLayoutChecker();
	} catch (error) {
		const skipped = error instanceof Error ? error.message : String(error);
		console.warn(`Layout checks skipped: ${skipped}`);

		return { run: { skipped }, scores };
	}

	console.log(`\nLayout checks in ${checker.browser}`);

	try {
		for (const { dir, brief } of projects) {
			const score = layoutScoreOf(await checker.check(dir, brief));
			scores.set(brief.id, score);
			const failed = score.failed.length ? `, ${score.failed.length} didn't render` : "";
			console.log(`${brief.id}: ${score.screens} screens, ${score.errors} errors, ${score.warnings} warnings${failed}`);
		}
	} finally {
		await checker.close();
	}

	return { run: { browser: checker.browser }, scores };
}
