// Runs the fixed briefs through Rabisco's AI layer, writes each result as a project folder and scores it. See README.md.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import electrobunConfig from "../../electrobun.config";
import { createMemorySecretStore, createSecretStore } from "../../src/bun/ai/keychain";
import { PROMPT_VERSION } from "../../src/bun/ai/prompt";
import { addUsage } from "../../src/bun/ai/run";
import { createProvider, MOCK_CONFIG } from "../../src/bun/ai/providers";
import { createMockProvider } from "../../src/bun/ai/providers/mock";
import { createAiService } from "../../src/bun/ai/service";
import { SETTINGS_FILE } from "../../src/bun/ai/settings-store";
import { parseJson } from "../../src/bun/json";
import {
	appendChat,
	createProjectFolder,
	readCanvas,
	readProjectFiles,
	writeCanvas,
	writeProjectFiles,
} from "../../src/bun/project-folder";
import type { ElementFocus, GenerationPlan } from "../../src/shared/ai/contract";
import { elementFocus, focusNote } from "../../src/shared/ai/focus";
import { parseModelRef, toModelRef } from "../../src/shared/ai/settings";
import { newChatId } from "../../src/shared/chats";
import { isStyleId, styleDesign } from "../../src/shared/context/styles";
import { designSourceOf } from "../../src/shared/context/theme";
import { designTokensOf } from "../../src/shared/context/tokens";
import { FRAME_GAP } from "../../src/shared/project";
import type { ChatMessage, GenerateParams, GenerateResult } from "../../src/shared/types";
import { alternatesOf, placeNewFrames } from "../../src/shared/variations";
import { BRIEFS, DEVICE_SIZE, type Brief } from "./briefs";
import { deltasOf, METRICS, parseTotals, scoreGeneration, totalsOf, type BriefScore } from "./score";

const USAGE = `Usage: hutch run bench:gen -- --model <provider:model> [options]

  --model <ref>        Model to run, e.g. claude-code:opus (see --list)
  --mock               Run the mock provider instead: deterministic, no AI, no settings read
  --list               List the configured providers and their models, then exit
  --only <ids>         Comma-separated brief ids
  --style <id>         Start briefs without a DESIGN.md from this style (minimal, editorial, playful, dense, bold)
  --no-plan            Create briefs run in one go, as before plans (decision 0015)
  --user-data <dir>    Folder with providers.json (default: the app's)
  --out <dir>          Where to write projects and report.json (default: bench/gen/runs/<time>-<model>/)
  --baseline <file>    A previous report.json to compare totals with
  --parallel <n>       Briefs at a time (default 1; CLI providers may rate limit)
  --timeout <s>        Stop a brief after this many seconds (default 900)`;

// `hutch run bench:gen -- --list` passes the `--` on, and parseArgs would read every flag after it as a positional
const argv = Bun.argv.slice(2);

const { values: args } = parseArgs({
	args: argv[0] === "--" ? argv.slice(1) : argv,
	options: {
		model: { type: "string" },
		mock: { type: "boolean", default: false },
		list: { type: "boolean", default: false },
		only: { type: "string" },
		style: { type: "string" },
		"no-plan": { type: "boolean", default: false },
		"user-data": { type: "string" },
		out: { type: "string" },
		baseline: { type: "string" },
		parallel: { type: "string", default: "1" },
		timeout: { type: "string", default: "900" },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (args.help) {
	console.log(USAGE);
	process.exit(0);
}

function fail(message: string): never {
	console.error(`${message}\n\n${USAGE}`);
	process.exit(2);
}

/** Where Electrobun keeps the app's data: `<app data>/<identifier>/<channel>`, the installed app before a dev build */
function appUserData() {
	const home = homedir();

	const root =
		process.platform === "darwin"
			? join(home, "Library", "Application Support")
			: process.platform === "win32"
				? (process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"))
				: (process.env.XDG_DATA_HOME ?? join(home, ".local", "share"));

	const base = join(root, electrobunConfig.app.identifier);
	const name = electrobunConfig.app.name;
	const channels = ["stable", name, "canary", `${name}-canary`, "dev"];

	return join(base, channels.find((channel) => existsSync(join(base, channel, SETTINGS_FILE))) ?? "dev");
}

const userDataDir = args.mock ? mkdtempSync(join(tmpdir(), "rabisco-gen-")) : (args["user-data"] ?? appUserData());

const attempts = new Map<string, number>();

const ai = createAiService({
	userDataDir,
	// The mock needs no keys, and a run without AI shouldn't ask for the keychain
	secrets: args.mock ? createMemorySecretStore() : createSecretStore(),
	includeMock: args.mock,
	// The mock run reads no settings, so it doesn't add the CLIs it finds
	detect: args.mock ? async () => ({}) : undefined,
	createProvider: args.mock
		? (config, deps) =>
				config.type === "mock"
					? { ...createMockProvider({ delayMs: 0 }), id: config.id, label: config.label }
					: createProvider(config, deps)
		: undefined,
	send: ({ generationId, attempt }) => attempts.set(generationId, Math.max(attempts.get(generationId) ?? 0, attempt)),
});

process.on("SIGINT", () => {
	ai.stopAll();
	process.exit(130);
});

if (args.list) {
	console.log(`Providers in ${userDataDir}:\n`);
	const { statuses } = await ai.listProviders(true);

	for (const status of statuses) {
		const health = !status.enabled
			? "disabled"
			: status.health?.ok
				? "ok"
				: `${status.health?.code ?? "unknown"}: ${status.health?.message ?? ""}`;

		console.log(`${status.label} (${status.id}): ${health}`);

		for (const model of status.models) console.log(`  ${toModelRef(status.id, model.id)}  ${model.label}`);
	}

	process.exit(0);
}

const model = args.mock
	? toModelRef(MOCK_CONFIG.id, "mock")
	: (args.model ?? fail("Pass --model <provider:model>, or --mock."));

{
	const { statuses } = await ai.listProviders();
	const providerId = parseModelRef(model)?.providerId ?? model;
	const status = statuses.find((s) => s.id === providerId);

	if (!status?.enabled) fail(`No enabled provider "${providerId}" in ${userDataDir}. Run with --list to see them.`);
}

const parallel = Math.max(1, Number.parseInt(args.parallel, 10) || 1);

const timeoutMs = Math.max(1, Number(args.timeout) || 900) * 1000;

const only = args.only?.split(",").map((id) => id.trim());

const style =
	args.style === undefined ? null : isStyleId(args.style) ? args.style : fail(`Unknown style "${args.style}".`);

const unknown = only?.filter((id) => !BRIEFS.some((brief) => brief.id === id)) ?? [];

if (unknown.length) fail(`Unknown brief id: ${unknown.join(", ")}. Briefs: ${BRIEFS.map((b) => b.id).join(", ")}`);

const briefs = only ? BRIEFS.filter((brief) => only.includes(brief.id)) : BRIEFS;

const date = new Date();

const stamp = date.toISOString().slice(0, 19).replace(/:/g, "-");

const slug = `${model}${style ? `-${style}` : ""}`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();

const outDir = args.out ?? join(import.meta.dir, "runs", `${stamp}-${slug}`);

mkdirSync(outDir, { recursive: true });

/** An app-shaped project: context templates or the theme, the seed screens on the canvas */
function createProject(brief: Brief) {
	const dir = createProjectFolder(outDir, brief.id, brief.device, brief.theme ? null : style);
	const canvas = readCanvas(dir);

	if (!canvas) throw new Error(`No rabisco.json in ${dir}`);

	if (style && !brief.theme) {
		const design = styleDesign(style);
		canvas.theme = { ...designTokensOf(design), source: designSourceOf(design) };
	}

	if (brief.theme) {
		const { product, design, components } = brief.theme;
		writeProjectFiles(dir, [
			{ path: "PRODUCT.md", content: product },
			{ path: "DESIGN.md", content: design },
			...Object.entries(components).map(([path, content]) => ({ path, content })),
		]);
		// The app applies DESIGN.md's tokens on request; a themed project here starts with them applied
		canvas.theme = { ...designTokensOf(design), source: designSourceOf(design) };
	}

	const size = DEVICE_SIZE[brief.device];
	let x = 0;

	for (const seed of brief.seeds ?? []) {
		canvas.frames.push({ file: seed.path, name: seed.name, device: brief.device, x, y: 0, ...size });
		x += size.width + FRAME_GAP;
	}

	writeProjectFiles(
		dir,
		(brief.seeds ?? []).map((seed) => ({ path: seed.path, content: seed.source })),
	);
	canvas.name = brief.id;
	writeCanvas(dir, canvas);

	return dir;
}

function focusOf(brief: Brief, dir: string): ElementFocus | undefined {
	if (!brief.focus || !brief.target) return undefined;
	const source = readProjectFiles(dir)[brief.target] ?? "";
	const focus = elementFocus(source, brief.target, source.indexOf(brief.focus));

	if (!focus) throw new Error(`Brief ${brief.id}: no element at "${brief.focus}" in ${brief.target}`);

	return focus;
}

/** What the editor does with a result: write the files, place new frames, keep the chat */
function applyResult(dir: string, result: GenerateResult, prompt: string) {
	const chatId = newChatId();
	const now = new Date().toISOString();
	const messages: ChatMessage[] = [{ id: crypto.randomUUID(), role: "user", content: prompt, createdAt: now }];

	if (!result.ok) {
		appendChat(dir, chatId, [
			...messages,
			{
				id: crypto.randomUUID(),
				role: "assistant",
				content: `Error (${result.error.code}): ${result.error.message}`,
				createdAt: now,
			},
		]);

		return;
	}

	writeProjectFiles(dir, result.changes);
	const canvas = readCanvas(dir);

	if (!canvas) throw new Error(`No rabisco.json in ${dir}`);
	const placedFiles = new Set(canvas.frames.map((frame) => frame.file));
	const created = result.frames.filter((frame) => !placedFiles.has(frame.file));

	const files = readProjectFiles(dir);
	canvas.frames = [...canvas.frames, ...placeNewFrames(canvas.frames, created)].filter((frame) => frame.file in files);
	canvas.alternates = alternatesOf(Object.keys(files));
	canvas.updatedAt = now;
	writeCanvas(dir, canvas);

	const problems = result.problems.map((p) => `\n• ${p.path}${p.line ? `:${p.line}` : ""}: ${p.message}`).join("");
	const reply = result.reply.trim() || "Done.";

	appendChat(dir, chatId, [
		...messages,
		{ id: crypto.randomUUID(), role: "assistant", content: reply + problems, createdAt: now, context: result.context },
	]);
}

const failure = (message: string): GenerateResult => ({
	ok: false,
	error: { code: "unknown", message, retryable: false },
});

/** The app's plan step, with the plan accepted as it is; `undefined` when it fails, so the brief runs in one go */
async function planFor(params: GenerateParams) {
	const result = await ai.generate({ ...params, generationId: `${params.generationId}-plan`, task: "plan" });

	return result.ok && result.plan ? { plan: result.plan, usage: result.usage } : undefined;
}

const planning = !args["no-plan"];

async function runBrief(brief: Brief): Promise<BriefScore> {
	const dir = createProject(brief);
	const before = readProjectFiles(dir);
	const focus = focusOf(brief, dir);
	const generationId = `${brief.id}-${crypto.randomUUID().slice(0, 8)}`;

	const params: GenerateParams = {
		generationId,
		projectPath: dir,
		prompt: brief.prompt,
		device: brief.device,
		model,
		task: brief.task === "create" ? "create" : brief.task === "vary" ? "vary" : "edit",
	};

	if (brief.target) params.targets = [brief.target];

	if (focus) params.focus = focus;

	if (brief.variations) params.variations = brief.variations;

	const timer = setTimeout(() => {
		ai.stopGeneration(`${generationId}-plan`);
		ai.stopGeneration(generationId);
	}, timeoutMs);

	const start = performance.now();
	let result: GenerateResult;
	let plan: GenerationPlan | undefined;

	try {
		// Like the editor: a create of one variation is planned first
		const planned = planning && params.task === "create" && !brief.variations ? await planFor(params) : undefined;

		if (planned) {
			plan = planned.plan;
			params.plan = plan;
		}

		result = await ai.generate(params);

		if (planned && result.ok) result.usage = addUsage(planned.usage, result.usage);
	} catch (error) {
		result = failure(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
	}

	const ms = performance.now() - start;

	if (!result.ok && result.error.code === "aborted") result.error.message = `Stopped after ${Math.round(ms / 1000)} s.`;
	applyResult(dir, result, focus ? focusNote(focus.label, brief.target ?? "", brief.prompt) : brief.prompt);

	return scoreGeneration({
		id: brief.id,
		task: brief.task,
		device: brief.device,
		themed: !!brief.theme || style !== null,
		before,
		result,
		ms,
		attempts: attempts.get(generationId) ?? 0,
		tokens: designTokensOf(before["DESIGN.md"]),
		focus,
		plan,
	});
}

/** A brief that throws (a broken fixture, a full disk) is recorded, not fatal */
async function safeRun(brief: Brief): Promise<BriefScore> {
	try {
		return await runBrief(brief);
	} catch (error) {
		return scoreGeneration({
			id: brief.id,
			task: brief.task,
			device: brief.device,
			themed: !!brief.theme || style !== null,
			before: {},
			result: failure(error instanceof Error ? error.message : String(error)),
			ms: 0,
			attempts: 0,
			tokens: { light: {}, dark: {} },
		});
	}
}

console.log(
	`Prompt v${PROMPT_VERSION} · ${model} · ${briefs.length} briefs · ${parallel} at a time${planning ? "" : " · no plan"}\n`,
);

const scores: BriefScore[] = Array.from({ length: briefs.length });

let next = 0;

async function worker() {
	while (next < briefs.length) {
		const index = next++;
		const brief = briefs[index]!;
		const score = await safeRun(brief);
		scores[index] = score;
		const outcome = score.ok ? "ok" : `${score.error?.code}: ${score.error?.message}`;
		console.log(`${brief.id}: ${outcome} (${(score.ms / 1000).toFixed(1)} s)`);
	}
}

await Promise.all(Array.from({ length: Math.min(parallel, briefs.length) }, worker));

const totals = totalsOf(scores);

const report = {
	promptVersion: PROMPT_VERSION,
	style,
	plan: planning,
	model,
	date: date.toISOString(),
	briefs: scores,
	totals,
};

writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, "\t")}\n`);

const optional = (value: number | undefined) => (value === undefined ? "" : String(value));

console.log("");

console.table(
	scores.map((score) => ({
		brief: score.id,
		task: score.task,
		device: score.device,
		ok: score.ok ? "ok" : (score.error?.code ?? "error"),
		repairs: score.repairs,
		problems: score.problemsLeft,
		files: `${score.screens}s ${score.components}c`,
		plan: score.planned ? `${score.sharedComponents ?? 0} shared` : "",
		"time s": Math.round(score.ms / 100) / 10,
		"tokens in/out": score.inputTokens === undefined ? "" : `${score.inputTokens}/${optional(score.outputTokens)}`,
		cost: optional(score.costUsd),
		"raw colors": score.rawColors,
		reuse: score.componentsAvailable ? `${score.componentsReused}/${score.componentsAvailable}` : "",
		"ui/uai": `${score.uiModules.length}/${score.uaiModules.length}`,
		tokens: score.tokensDefined ? `${score.tokensUsed}/${score.tokensDefined}` : "",
		"focus out": score.focusOutside === undefined ? "" : (score.focusOutside ?? "too large"),
	})),
);

if (args.baseline) {
	const base = parseTotals(parseJson(readFileSync(args.baseline, "utf8")));
	console.log(`\nAgainst ${args.baseline}:`);
	console.table(
		deltasOf(base, totals).map((d) => ({
			metric: d.label,
			baseline: d.base ?? "",
			now: d.now,
			delta: d.delta === null ? "" : d.delta > 0 ? `+${d.delta}` : String(d.delta),
			"": d.verdict,
		})),
	);
} else {
	console.table(METRICS.map(({ key, label }) => ({ metric: label, total: totals[key] })));
}

console.log(`\nProjects and report.json in ${relative(process.cwd(), outDir) || "."}`);

if (totals.errors) process.exit(1);
