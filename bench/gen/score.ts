// Scores one generation from its files alone, with no AI and no rendering. See README.md for what each score means.
import type { ElementFocus, GenerationPlan, ProviderErrorCode } from "../../src/shared/ai/contract";
import {
	customTokenNames,
	tokenKind,
	tokenUtility,
	type DesignTokens,
	type TokenKind,
} from "../../src/shared/context/tokens";
import type { DesignFinding, DesignRule } from "../../src/shared/design/findings";
import { sourceFindings } from "../../src/shared/design/source-checks";
import { readImports } from "../../src/shared/jsx/imports";
import { resolveModule } from "../../src/shared/jsx/modules";
import type { Json } from "../../src/shared/json";
import { isComponentFile, isScreenFile } from "../../src/shared/project";
import { parseClass, splitModifier } from "../../src/shared/tailwind/classes";
import type { FileChange, GenerateResult, ProjectFiles } from "../../src/shared/types";
import { baseOf } from "../../src/shared/variations";
import { changesOutside } from "../../src/bun/ai/focus-guard";
import { objectOr, optionalNumber } from "../../src/bun/json";
import type { BriefDevice, BriefTask, SeedScreen } from "./briefs";

export type BriefScore = {
	id: string;
	task: BriefTask;
	device: BriefDevice;
	themed: boolean;
	ok: boolean;
	error?: { code: ProviderErrorCode; message: string };
	/** Repair attempts after the first try */
	repairs: number;
	/** Problems left after the repairs; those files were not written */
	problemsLeft: number;
	screens: number;
	components: number;
	ms: number;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	/** `raw-color` findings of `sourceFindings` in the written files, minus those their seed already had */
	rawColors: number;
	/** Every source finding in the written files */
	designFindings: number;
	/** Project components before the generation */
	componentsAvailable: number;
	/** Of those, how many new screens import */
	componentsReused: number;
	/** `@/components/ui/<name>` modules imported by the written files */
	uiModules: string[];
	/** `@/components/ui/uai/<name>` modules imported by the written files */
	uaiModules: string[];
	/** Custom tokens in DESIGN.md */
	tokensDefined: number;
	/** Of those, how many the written files use through their classes */
	tokensUsed: number;
	tokenClassUses: number;
	/** Focus briefs: changed lines outside the element; `null` when the file was too large to compare */
	focusOutside?: number | null;
	/** Create briefs: a plan ran first (decision 0015). Missing in reports from before plans */
	planned?: boolean;
	/** Of the plan's shared components, how many were written */
	sharedComponents?: number;
	layout?: LayoutScore;
};

export const LAYOUT_RULES = [
	"frame-overflow",
	"text-clipped",
	"overlap",
	"contrast",
	"empty-container",
	"font-sizes",
] as const satisfies readonly DesignRule[];

export type LayoutRule = (typeof LAYOUT_RULES)[number];

export type ScreenLayout = { path: string; findings: DesignFinding[] } | { path: string; error: string };

export type LayoutScore = {
	screens: number;
	failed: { path: string; error: string }[];
	errors: number;
	warnings: number;
	byRule: Partial<Record<DesignRule, number>>;
	findings: DesignFinding[];
};

export type ScoreInput = {
	id: string;
	task: BriefTask;
	device: BriefDevice;
	themed: boolean;
	before: ProjectFiles;
	result: GenerateResult;
	ms: number;
	/** Highest 1-based attempt seen in the generation events; 0 when none came */
	attempts: number;
	tokens: DesignTokens;
	focus?: ElementFocus;
	/** The plan the generation followed, if one ran */
	plan?: GenerationPlan;
};

const UI_PREFIX = "@/components/ui/";

const UAI_PREFIX = "@/components/ui/uai/";

/** `@/components/ui/*` and `@/components/ui/uai/*` modules imported by the files, by name */
export function uiModulesOf(sources: string[]) {
	const ui = new Set<string>();
	const uai = new Set<string>();

	for (const source of sources) {
		for (const { module } of readImports(source)) {
			if (module.startsWith(UAI_PREFIX)) uai.add(module.slice(UAI_PREFIX.length));
			else if (module.startsWith(UI_PREFIX)) ui.add(module.slice(UI_PREFIX.length));
		}
	}

	return { ui: [...ui].sort(), uai: [...uai].sort() };
}

/** Project component paths a file imports, e.g. `components/stat-card.tsx` */
export function componentImports(path: string, source: string): string[] {
	const found = new Set<string>();

	for (const { module } of readImports(source)) {
		const resolved = `${resolveModule(path, module)}.tsx`;

		if (isComponentFile(resolved)) found.add(resolved);
	}

	return [...found];
}

const COLOR_PREFIX =
	/^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|from|via|to|fill|stroke|divide|outline|shadow|decoration|accent|caret)-(.+)$/;

const UTILITY_OF: Record<TokenKind, RegExp> = {
	color: COLOR_PREFIX,
	radius: /^rounded(?:-[trblse]{1,2})?-(.+)$/,
	font: /^font-(.+)$/,
	text: /^text-(.+)$/,
	spacing:
		/^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|size|w|h|min-[wh]|max-[wh]|inset(?:-[xy])?|top|right|bottom|left)-(.+)$/,
};

/** Uses of each custom token's classes (`bg-brand`, `hover:text-brand/80`, `rounded-card`); a rough split on quotes and spaces */
export function tokenClassUses(sources: string[], tokens: DesignTokens): Map<string, number> {
	const uses = new Map<string, number>();
	const custom = customTokenNames(tokens);

	for (const source of sources) {
		for (const word of source.split(/[\s"'`{}(),;]+/)) {
			if (!word.includes("-")) continue;
			const { utility } = parseClass(word);

			for (const name of custom) {
				const kind = tokenKind(name);
				const match = kind && UTILITY_OF[kind].exec(utility);

				if (match && splitModifier(match[1]!)[0] === tokenUtility(name)) uses.set(name, (uses.get(name) ?? 0) + 1);
			}
		}
	}

	return uses;
}

const written = (changes: FileChange[]) =>
	changes.flatMap(({ path, content }) => (content !== null && path.endsWith(".tsx") ? [{ path, content }] : []));

function usageOf(result: GenerateResult) {
	if (!result.ok || !result.usage) return {};
	const { inputTokens, outputTokens, costUsd } = result.usage;

	return { inputTokens, outputTokens, costUsd };
}

/**
 * The class a raw-color finding is about (its message starts with it), or "families" for the
 * one-per-file palette finding. Seed and output findings match on it, wherever the class moved
 */
const findingKey = (finding: DesignFinding) =>
	`${finding.rule}:${finding.message.startsWith("Uses ") ? "families" : (finding.message.split(" ")[0] ?? "")}`;

/** An edit keeps the seed's look and a variation starts from it, so only what the model added counts */
export function newFindings(path: string, content: string, before: ProjectFiles, tokens: DesignTokens) {
	const seed = before[path] ?? before[baseOf(path)];
	const found = sourceFindings(path, content, tokens);

	if (seed === undefined) return found;
	const inherited = new Set(sourceFindings(path, seed, tokens).map(findingKey));

	return found.filter((finding) => !inherited.has(findingKey(finding)));
}

export function scoreGeneration(input: ScoreInput): BriefScore {
	const { result, before, tokens } = input;
	const available = Object.keys(before).filter(isComponentFile);

	const score: BriefScore = {
		id: input.id,
		task: input.task,
		device: input.device,
		themed: input.themed,
		ok: result.ok,
		repairs: Math.max(0, input.attempts - 1),
		problemsLeft: 0,
		screens: 0,
		components: 0,
		ms: Math.round(input.ms),
		...usageOf(result),
		rawColors: 0,
		designFindings: 0,
		componentsAvailable: available.length,
		componentsReused: 0,
		uiModules: [],
		uaiModules: [],
		tokensDefined: customTokenNames(tokens).length,
		tokensUsed: 0,
		tokenClassUses: 0,
	};

	if (input.task === "focus") score.focusOutside = null;

	if (input.task === "create") {
		score.planned = input.plan !== undefined;
		score.sharedComponents = 0;
	}

	if (!result.ok) {
		score.error = { code: result.error.code, message: result.error.message };

		return score;
	}

	const files = written(result.changes);
	const sources = files.map((file) => file.content);
	const findings = files.flatMap(({ path, content }) => newFindings(path, content, before, tokens));
	const reused = new Set<string>();

	for (const { path, content } of files) {
		if (!isScreenFile(path) || path in before) continue;

		for (const component of componentImports(path, content)) if (available.includes(component)) reused.add(component);
	}

	const modules = uiModulesOf(sources);
	const uses = tokenClassUses(sources, tokens);

	score.problemsLeft = result.problems.length;
	score.screens = files.filter((file) => isScreenFile(file.path)).length;
	score.components = files.filter((file) => isComponentFile(file.path)).length;
	score.rawColors = findings.filter((finding) => finding.rule === "raw-color").length;
	score.designFindings = findings.length;
	score.componentsReused = reused.size;
	score.uiModules = modules.ui;
	score.uaiModules = modules.uai;
	score.tokensUsed = uses.size;
	score.tokenClassUses = [...uses.values()].reduce((sum, count) => sum + count, 0);

	if (input.focus) score.focusOutside = focusOutside(input.focus, before, result.changes);

	if (input.plan) {
		const paths = new Set(files.map((file) => file.path));
		score.sharedComponents = input.plan.components.filter((component) => paths.has(component.path)).length;
	}

	return score;
}

/** Changed lines outside the focused element; a deleted file counts as all of its lines */
export function focusOutside(focus: ElementFocus, before: ProjectFiles, changes: FileChange[]): number | null {
	const source = before[focus.file];
	const change = changes.find((c) => c.path === focus.file);

	if (source === undefined || !change) return 0;

	if (change.content === null) return source.split("\n").length;

	return changesOutside(source, change.content, focus)?.length ?? null;
}

export function writtenScreens(files: ProjectFiles, seeds: SeedScreen[]): string[] {
	const seeded = new Map(seeds.map((seed) => [seed.path, seed.source]));

	return Object.keys(files)
		.filter((path) => isScreenFile(path) && files[path] !== seeded.get(path))
		.sort();
}

export function seedOf(path: string, seeds: SeedScreen[]) {
	return seeds.find((seed) => seed.path === path || seed.path === baseOf(path));
}

const layoutKey = (finding: DesignFinding) => `${finding.rule}:${finding.message}`;

export function withoutInherited(findings: DesignFinding[], inherited: DesignFinding[]) {
	const seen = new Set(inherited.map(layoutKey));

	return findings.filter((finding) => !seen.has(layoutKey(finding)));
}

export function layoutScoreOf(screens: ScreenLayout[]): LayoutScore {
	const score: LayoutScore = { screens: screens.length, failed: [], errors: 0, warnings: 0, byRule: {}, findings: [] };

	for (const screen of screens) {
		if ("error" in screen) {
			score.failed.push({ path: screen.path, error: screen.error });
			continue;
		}

		for (const finding of screen.findings) {
			score.findings.push(finding);
			score.byRule[finding.rule] = (score.byRule[finding.rule] ?? 0) + 1;

			if (finding.severity === "error") score.errors++;
			else score.warnings++;
		}
	}

	return score;
}

export function layoutCell(layout: LayoutScore | undefined) {
	if (!layout) return "";
	const failed = layout.failed.length ? ` ${layout.failed.length} failed` : "";

	return `${layout.errors}e ${layout.warnings}w${failed}`;
}

export function ruleCell(layout: LayoutScore | undefined) {
	return LAYOUT_RULES.flatMap((rule) => (layout?.byRule[rule] ? [`${rule} ${layout.byRule[rule]}`] : [])).join(", ");
}

export const METRICS = [
	{ key: "ok", label: "ok", better: "higher" },
	{ key: "errors", label: "errors", better: "lower" },
	{ key: "repairs", label: "repair attempts", better: "lower" },
	{ key: "problemsLeft", label: "problems left", better: "lower" },
	{ key: "screens", label: "screens written", better: "none" },
	{ key: "components", label: "components written", better: "none" },
	{ key: "seconds", label: "wall time (s)", better: "lower" },
	{ key: "inputTokens", label: "input tokens", better: "lower" },
	{ key: "outputTokens", label: "output tokens", better: "lower" },
	{ key: "costUsd", label: "cost (USD)", better: "lower" },
	{ key: "rawColors", label: "raw colors", better: "lower" },
	{ key: "designFindings", label: "source findings", better: "lower" },
	{ key: "reuse", label: "component reuse (%)", better: "higher" },
	{ key: "uiModules", label: "ui modules used", better: "higher" },
	{ key: "uaiModules", label: "uai blocks used", better: "higher" },
	{ key: "tokenUse", label: "custom tokens used (%)", better: "higher" },
	{ key: "tokenClassUses", label: "custom token classes", better: "higher" },
	{ key: "focusOutside", label: "lines changed outside focus", better: "lower" },
	{ key: "planned", label: "briefs planned first", better: "none" },
	{ key: "sharedComponents", label: "shared components from plans", better: "none" },
	{ key: "layoutScreens", label: "screens checked for layout", better: "none" },
	{ key: "layoutFailed", label: "screens that didn't render", better: "lower" },
	{ key: "layoutErrors", label: "layout errors", better: "lower" },
	{ key: "layoutWarnings", label: "layout warnings", better: "lower" },
	{ key: "frame-overflow", label: "layout: wider than the screen", better: "lower" },
	{ key: "text-clipped", label: "layout: clipped text", better: "lower" },
	{ key: "overlap", label: "layout: overlap", better: "lower" },
	{ key: "contrast", label: "layout: low contrast", better: "lower" },
	{ key: "empty-container", label: "layout: empty container", better: "lower" },
	{ key: "font-sizes", label: "layout: too many font sizes", better: "lower" },
] as const;

export type Metric = (typeof METRICS)[number]["key"];

export type LayoutMetric = "layoutScreens" | "layoutFailed" | "layoutErrors" | "layoutWarnings" | LayoutRule;

export type Totals = Record<Exclude<Metric, LayoutMetric>, number> & Partial<Record<LayoutMetric, number>>;

const sum = (scores: BriefScore[], pick: (score: BriefScore) => number | null | undefined) =>
	scores.reduce((total, score) => total + (pick(score) ?? 0), 0);

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Reuse counts briefs that create screens in a project with components; token use counts themed briefs */
export function totalsOf(scores: BriefScore[]): Totals {
	const ok = scores.filter((score) => score.ok);

	const creating = ok.filter(
		(score) => score.componentsAvailable > 0 && (score.task === "create" || score.task === "vary"),
	);

	const themed = ok.filter((score) => score.themed);

	return {
		ok: ok.length,
		errors: scores.length - ok.length,
		repairs: sum(scores, (score) => score.repairs),
		problemsLeft: sum(scores, (score) => score.problemsLeft),
		screens: sum(scores, (score) => score.screens),
		components: sum(scores, (score) => score.components),
		seconds: Math.round(sum(scores, (score) => score.ms) / 100) / 10,
		inputTokens: sum(scores, (score) => score.inputTokens),
		outputTokens: sum(scores, (score) => score.outputTokens),
		costUsd: Math.round(sum(scores, (score) => score.costUsd) * 10_000) / 10_000,
		rawColors: sum(scores, (score) => score.rawColors),
		designFindings: sum(scores, (score) => score.designFindings),
		reuse: percent(
			sum(creating, (score) => score.componentsReused),
			sum(creating, (score) => score.componentsAvailable),
		),
		uiModules: sum(scores, (score) => score.uiModules.length),
		uaiModules: sum(scores, (score) => score.uaiModules.length),
		tokenUse: percent(
			sum(themed, (score) => score.tokensUsed),
			sum(themed, (score) => score.tokensDefined),
		),
		tokenClassUses: sum(scores, (score) => score.tokenClassUses),
		focusOutside: sum(scores, (score) => score.focusOutside),
		planned: scores.filter((score) => score.planned).length,
		sharedComponents: sum(scores, (score) => score.sharedComponents),
		...layoutTotalsOf(scores.map((score) => score.layout)),
	};
}

export function layoutTotalsOf(layouts: (LayoutScore | undefined)[]): Partial<Record<LayoutMetric, number>> {
	const checked = layouts.flatMap((layout) => (layout ? [layout] : []));

	if (!checked.length) return {};

	const totals: Partial<Record<LayoutMetric, number>> = {
		layoutScreens: checked.reduce((total, layout) => total + layout.screens, 0),
		layoutFailed: checked.reduce((total, layout) => total + layout.failed.length, 0),
		layoutErrors: checked.reduce((total, layout) => total + layout.errors, 0),
		layoutWarnings: checked.reduce((total, layout) => total + layout.warnings, 0),
	};

	for (const rule of LAYOUT_RULES)
		totals[rule] = checked.reduce((total, layout) => total + (layout.byRule[rule] ?? 0), 0);

	return totals;
}

/** Totals of a saved report; metrics it doesn't have are missing */
export function parseTotals(report: Json): Partial<Totals> {
	const totals = objectOr(objectOr(report).totals);
	const parsed: Partial<Totals> = {};

	for (const { key } of METRICS) {
		const value = optionalNumber(totals[key]);

		if (value !== undefined) parsed[key] = value;
	}

	return parsed;
}

export type Delta = {
	metric: Metric;
	label: string;
	base: number | null;
	now: number | null;
	delta: number | null;
	verdict: string;
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function deltasOf(base: Partial<Totals>, now: Totals): Delta[] {
	return METRICS.map(({ key, label, better }) => {
		const before = base[key];
		const after = now[key];

		if (before === undefined || after === undefined)
			return { metric: key, label, base: before ?? null, now: after ?? null, delta: null, verdict: "" };
		const delta = round(after - before);
		const improved = better === "higher" ? delta > 0 : delta < 0;
		const verdict = !delta || better === "none" ? "" : improved ? "better" : "worse";

		return { metric: key, label, base: before, now: after, delta, verdict };
	});
}
