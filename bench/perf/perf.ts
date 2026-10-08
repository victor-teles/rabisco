// Guards the Phase 9 targets that can be measured outside the packaged app. See README.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commit, createHistory, nextSnapshot, seal, type History } from "../../src/mainview/lib/history";
import { extractCandidates, projectCandidates } from "../../src/mainview/lib/render/candidates";
import { CompileCache, compileSource } from "../../src/mainview/lib/render/compile";
import { collectGraph } from "../../src/mainview/lib/render/graph";
import { createCompiler, TailwindBuilder } from "../../src/mainview/lib/render/tailwind";
import { syntheticProject } from "./fixtures";

const root = join(import.meta.dir, "../..");

const SCREENS = 30;

type Check = { name: string; value: number; unit: string; limit: number; note?: string };

const checks: Check[] = [];

const check = (name: string, value: number, unit: string, limit: number, note?: string) =>
	checks.push({ name, value: Math.round(value * 1000) / 1000, unit, limit, note });

function stats(samples: number[]) {
	const sorted = [...samples].sort((a, b) => a - b);
	const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

	return { median: pick(0.5), p95: pick(0.95) };
}

function time(fn: () => void) {
	const start = performance.now();
	fn();

	return performance.now() - start;
}

const stylesheets = {
	tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
	"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
};

// Same base set as src/mainview/lib/render/styles.ts
const uiDir = join(root, "src/mainview/components/ui");

const runtimeCandidates = readdirSync(uiDir)
	.filter((name) => name.endsWith(".tsx"))
	.flatMap((name) => extractCandidates(readFileSync(join(uiDir, name), "utf8")));

const { files, frames } = syntheticProject(SCREENS);

const screens = frames.map((frame) => frame.file);

type FrameModel = { sent: string; synced: boolean };

/** What every FrameHost does on its first sync: compile the graph, add its candidates, read the CSS. */
function sync(builder: TailwindBuilder, cache: CompileCache, screen: string, frame?: FrameModel) {
	for (const module of collectGraph(screen, files, cache).modules.values()) builder.add(module.candidates);
	const css = builder.css;

	if (!frame) return 0;
	frame.synced = true;

	if (css === frame.sent) return 0;
	frame.sent = css;

	return 1;
}

/** Frames become ready one by one, each in its own task, and get pushed CSS after their first sync. */
async function openProject(prime: boolean) {
	const builder = new TailwindBuilder(() => createCompiler(stylesheets), runtimeCandidates);
	await builder.whenReady();
	const builds = builder.builds;
	const start = performance.now();
	builder.reset(prime ? projectCandidates(files) : []);
	await builder.whenReady();
	const cache = new CompileCache();
	let posted = 0;
	let busy = performance.now() - start;

	for (const screen of screens) {
		const frame: FrameModel = { sent: "", synced: false };
		builder.subscribe((css) => {
			if (!frame.synced || css === frame.sent) return;
			frame.sent = css;
			posted++;
		});
		const synced = performance.now();
		posted += sync(builder, cache, screen, frame);
		busy += performance.now() - synced;
		await new Promise((resolve) => setTimeout(resolve));
	}

	return { builds: builder.builds - builds, posted, ms: busy };
}

// Warm the JIT once, then measure
await openProject(true);

const opened = await openProject(true);

const unprimed = await openProject(false);

check("open: Tailwind builds after the first sync", opened.builds, "builds", 1, `${unprimed.builds} without priming`);

check(
	"open: full-CSS payloads posted to frames",
	opened.posted,
	"posts",
	screens.length,
	`${unprimed.posted} without priming`,
);

check(
	"open: compile + CSS for every frame (host side)",
	opened.ms,
	"ms",
	150,
	`${screens.length} screens, without waits`,
);

const sources = Object.entries(files);

const extract: number[] = [];

for (let i = 0; i < 20; i++) for (const [, source] of sources) extract.push(time(() => extractCandidates(source)));

check("candidates: extract one file (p95)", stats(extract).p95, "ms", 0.5, `${sources.length} files`);

const compiles: number[] = [];

for (let i = 0; i < 10; i++) {
	for (const screen of screens) compiles.push(time(() => compileSource(screen, `${files[screen]}\n// ${i}`)));
}

const compiled = stats(compiles);

check("compile: one screen, cold (median)", compiled.median, "ms", 5);

check("compile: one screen, cold (p95)", compiled.p95, "ms", 15);

// Typing a new class into one screen: compile, candidates, incremental Tailwind build
{
	const builder = new TailwindBuilder(() => createCompiler(stylesheets), runtimeCandidates);
	builder.reset(projectCandidates(files));
	await builder.whenReady();
	const cache = new CompileCache();

	for (const screen of screens) sync(builder, cache, screen);
	const screen = screens[0]!;
	const typed = " bg-rose-500/40 hover:translate-y-0.5 ring-offset-4";
	const keystrokes: number[] = [];
	const source = files[screen]!;
	const at = source.indexOf('className="') + 'className="'.length;

	for (let i = 1; i <= typed.length; i++) {
		const next = source.slice(0, at) + typed.slice(0, i) + source.slice(at);
		const edited = { ...files, [screen]: next };
		keystrokes.push(
			time(() => {
				for (const module of collectGraph(screen, edited, cache).modules.values()) builder.add(module.candidates);
				void builder.css;
			}),
		);
	}

	check(
		"keystroke: compile + Tailwind for the edited screen (p95)",
		stats(keystrokes).p95,
		"ms",
		20,
		`${typed.length} keys`,
	);
}

// A frame drag on a 30-screen canvas
{
	const present = { frames, files, comments: [] };
	let history: History = createHistory(present);

	const move = (dx: number) =>
		nextSnapshot(history.present, {
			...history.present,
			frames: history.present.frames.map((frame, i) => (i === 3 ? { ...frame, x: frame.x + dx } : frame)),
		});

	const moves: number[] = [];

	for (let i = 1; i <= 120; i++) moves.push(time(() => (history = commit(history, move(1), { coalesce: "drag" }))));
	history = seal(history);
	check("drag: undo steps after 120 coalesced pointermoves", history.past.length, "steps", 1);
	check("drag: one commit (p95 of 120)", stats(moves).p95, "ms", 0.5);
}

const failed = checks.filter((c) => c.value > c.limit);

console.table(
	checks.map((c) => ({
		check: c.name,
		value: `${c.value} ${c.unit}`,
		limit: `<= ${c.limit}`,
		ok: c.value > c.limit ? "FAIL" : "ok",
		note: c.note ?? "",
	})),
);

if (failed.length) {
	console.error(`${failed.length} perf check(s) failed`);
	process.exit(1);
}
