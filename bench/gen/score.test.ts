import { describe, expect, test } from "bun:test";
import { elementFocus } from "../../src/shared/ai/focus";
import { designTokensOf } from "../../src/shared/context/tokens";
import type { DesignFinding } from "../../src/shared/design/findings";
import type { GenerateResult } from "../../src/shared/types";
import {
	layoutCell,
	layoutScoreOf,
	layoutTotalsOf,
	ruleCell,
	seedOf,
	withoutInherited,
	writtenScreens,
	newFindings,
	componentImports,
	deltasOf,
	focusOutside,
	parseTotals,
	scoreGeneration,
	tokenClassUses,
	totalsOf,
	uiModulesOf,
	type ScoreInput,
} from "./score";

const DESIGN = `# Design

## Tokens

- primary: #1f6f4a
- color-brand: #1f6f4a
- radius-card: 1.25rem
- text-amount: 2.5rem/1.1
`;

const tokens = designTokensOf(DESIGN);

const card = `import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/uai/metric-card";
import { AppTabBar } from "../components/app-tab-bar";
import { Row } from "./row";

export default function Home() {
	return (
		<div className="bg-gray-100 rounded-card">
			<p className="text-amount hover:text-brand/80 bg-primary">R$ 10</p>
			<Button className="bg-brand">Send</Button>
			<MetricCard />
			<AppTabBar />
		</div>
	);
}
`;

const ok = (changes: { path: string; content: string | null }[]): GenerateResult => ({
	ok: true,
	changes,
	frames: [],
	reply: "",
	problems: [],
	context: [],
	usage: { inputTokens: 1200, outputTokens: 800, costUsd: 0.02 },
});

const input = (overrides: Partial<ScoreInput>): ScoreInput => ({
	id: "brief",
	task: "create",
	device: "mobile",
	themed: true,
	before: { "components/app-tab-bar.tsx": "export function AppTabBar() {}", "components/row.tsx": "" },
	result: ok([]),
	ms: 1234.4,
	attempts: 1,
	tokens,
	...overrides,
});

describe("uiModulesOf", () => {
	test("splits shadcn primitives from uai blocks", () => {
		expect(uiModulesOf([card])).toEqual({ ui: ["button"], uai: ["metric-card"] });
	});
});

describe("componentImports", () => {
	test("resolves project components from a screen", () => {
		expect(componentImports("screens/home.tsx", card)).toEqual(["components/app-tab-bar.tsx"]);
	});

	test("resolves both forms from a component", () => {
		expect(componentImports("components/list.tsx", card)).toEqual(["components/app-tab-bar.tsx", "components/row.tsx"]);
	});
});

describe("tokenClassUses", () => {
	test("counts custom token classes with variants and opacity, not built-in ones", () => {
		const uses = tokenClassUses([card], tokens);

		expect(Object.fromEntries(uses)).toEqual({ "color-brand": 2, "radius-card": 1, "text-amount": 1 });
	});

	test("finds nothing without custom tokens", () => {
		expect(tokenClassUses([card], { light: {}, dark: {} }).size).toBe(0);
	});
});

describe("scoreGeneration", () => {
	test("records a failure with its code and the repairs it took", () => {
		const score = scoreGeneration(
			input({
				result: { ok: false, error: { code: "rate_limited", message: "Slow down", retryable: true } },
				attempts: 3,
			}),
		);

		expect(score).toMatchObject({ ok: false, error: { code: "rate_limited", message: "Slow down" }, repairs: 2 });
		expect(score.screens).toBe(0);
	});

	test("scores written files", () => {
		const score = scoreGeneration(
			input({
				result: ok([
					{ path: "screens/home.tsx", content: card },
					{ path: "components/stat.tsx", content: 'export function Stat() { return <p className="text-sm" />; }' },
					{ path: "screens/old.tsx", content: null },
				]),
			}),
		);

		expect(score).toMatchObject({
			ok: true,
			repairs: 0,
			screens: 1,
			components: 1,
			ms: 1234,
			inputTokens: 1200,
			outputTokens: 800,
			costUsd: 0.02,
			componentsAvailable: 2,
			componentsReused: 1,
			uiModules: ["button"],
			uaiModules: ["metric-card"],
			tokensDefined: 3,
			tokensUsed: 3,
			tokenClassUses: 4,
		});
		expect(score.rawColors).toBeGreaterThan(0);
		expect(score.focusOutside).toBeUndefined();
	});

	test("counts reuse only in new screens", () => {
		const score = scoreGeneration(
			input({
				task: "edit",
				before: { "components/app-tab-bar.tsx": "", "screens/home.tsx": "" },
				result: ok([{ path: "screens/home.tsx", content: card }]),
			}),
		);

		expect(score.componentsReused).toBe(0);
	});
});

const pricing = `export default function Pricing() {
	return (
		<div>
			<h1>Plans</h1>
			<section id="pro">
				<h2>Pro</h2>
			</section>
		</div>
	);
}
`;

describe("newFindings", () => {
	const seed = `export default function Today() {\n\treturn <div className="bg-white text-gray-900">Today</div>;\n}\n`;
	const edited = `export default function Today() {\n\treturn <div className="bg-white text-gray-900"><p className="text-zinc-500">Mon</p></div>;\n}\n`;
	const tokens = designTokensOf(undefined);

	test("leaves out the colors the seed already had", () => {
		const found = newFindings("screens/today.tsx", edited, { "screens/today.tsx": seed }, tokens);

		expect(found.map((finding) => finding.message.split(" ")[0])).toEqual(["text-zinc-500"]);
	});

	test("compares a variation with the screen it varies", () => {
		const found = newFindings("screens/today.alt-1.tsx", seed, { "screens/today.tsx": seed }, tokens);

		expect(found).toEqual([]);
	});

	test("counts everything in a new file", () => {
		expect(newFindings("screens/new.tsx", edited, {}, tokens).length).toBe(3);
	});
});

describe("focusOutside", () => {
	const at = pricing.indexOf('<section id="pro">');
	const focus = elementFocus(pricing, "screens/pricing.tsx", at)!;
	const before = { "screens/pricing.tsx": pricing };

	test("an edit inside the element changes nothing outside", () => {
		const after = pricing.replace("<h2>Pro</h2>", '<h2 className="font-bold">Pro</h2>\n\t\t\t\t<p>Most popular</p>');

		expect(focusOutside(focus, before, [{ path: focus.file, content: after }])).toBe(0);
	});

	test("counts lines changed outside the element", () => {
		const after = pricing.replace("<h1>Plans</h1>", "<h1>Pricing</h1>");

		expect(focusOutside(focus, before, [{ path: focus.file, content: after }])).toBe(1);
	});

	test("a deleted file counts all of its lines", () => {
		expect(focusOutside(focus, before, [{ path: focus.file, content: null }])).toBe(pricing.split("\n").length);
	});

	test("is scored for focus briefs", () => {
		const after = pricing.replace("<h1>Plans</h1>", "<h1>Pricing</h1>");

		const score = scoreGeneration(
			input({ task: "focus", before, focus, result: ok([{ path: focus.file, content: after }]) }),
		);

		expect(score.focusOutside).toBe(1);
	});
});

describe("totalsOf", () => {
	test("sums briefs and rates reuse and token use", () => {
		const scores = [
			scoreGeneration(input({ result: ok([{ path: "screens/home.tsx", content: card }]) })),
			scoreGeneration(input({ themed: false, tokens: { light: {}, dark: {} }, result: ok([]) })),
			scoreGeneration(
				input({ result: { ok: false, error: { code: "network", message: "Offline", retryable: true } } }),
			),
		];

		expect(totalsOf(scores)).toMatchObject({
			ok: 2,
			errors: 1,
			screens: 1,
			inputTokens: 2400,
			reuse: 25,
			tokenUse: 100,
			tokenClassUses: 4,
			seconds: 3.7,
		});
	});
});

describe("deltasOf", () => {
	test("marks each metric better or worse by its direction", () => {
		const now = totalsOf([scoreGeneration(input({ result: ok([{ path: "screens/home.tsx", content: card }]) }))]);
		const base = parseTotals({ totals: { ...now, rawColors: now.rawColors + 2, reuse: 80, ok: "junk" } });
		const deltas = new Map(deltasOf(base, now).map((d) => [d.metric, d]));

		expect(deltas.get("rawColors")).toMatchObject({ delta: -2, verdict: "better" });
		expect(deltas.get("reuse")).toMatchObject({ delta: 50 - 80, verdict: "worse" });
		expect(deltas.get("screens")).toMatchObject({ delta: 0, verdict: "" });
		expect(deltas.get("ok")).toMatchObject({ base: null, delta: null });
	});
});

describe("plans", () => {
	const plan = {
		screens: [{ path: "screens/home.tsx", name: "Home", purpose: "", content: "" }],
		components: [
			{ path: "components/tab-bar.tsx", name: "TabBar", purpose: "", usedBy: ["screens/home.tsx"] },
			{ path: "components/header.tsx", name: "Header", purpose: "", usedBy: ["screens/home.tsx"] },
		],
		links: [],
	};

	test("a planned create records the plan and the shared components it wrote", () => {
		const score = scoreGeneration(
			input({
				plan,
				result: ok([
					{ path: "components/tab-bar.tsx", content: "export function TabBar() { return null }" },
					{ path: "screens/home.tsx", content: card },
				]),
			}),
		);

		expect(score).toMatchObject({ planned: true, sharedComponents: 1 });
	});

	test("an unplanned create says so; other tasks leave it out", () => {
		expect(scoreGeneration(input({}))).toMatchObject({ planned: false, sharedComponents: 0 });
		expect(scoreGeneration(input({ task: "edit" })).planned).toBeUndefined();
	});

	test("totals count planned briefs and their shared components", () => {
		const scores = [
			scoreGeneration(input({ plan, result: ok([{ path: "components/header.tsx", content: "" }]) })),
			scoreGeneration(input({})),
		];

		expect(totalsOf(scores)).toMatchObject({ planned: 1, sharedComponents: 1 });
	});

	test("a report from before plans has no plan totals, and compares without them", () => {
		const old = parseTotals({ totals: { ok: 3, errors: 0 } });
		expect(old.planned).toBeUndefined();
		const deltas = new Map(deltasOf(old, totalsOf([scoreGeneration(input({ plan }))])).map((d) => [d.metric, d]));
		expect(deltas.get("planned")).toMatchObject({ base: null, now: 1, delta: null });
	});
});

describe("layout", () => {
	const seed = { path: "screens/home.tsx", name: "Home", source: "seed" };

	const contrast: DesignFinding = {
		rule: "contrast",
		severity: "error",
		message: '<p> "Morning" has a contrast of 2.47:1, under 3:1',
		path: "screens/home.tsx",
		start: 120,
		line: 9,
	};

	const fontSizes: DesignFinding = { rule: "font-sizes", severity: "warning", message: "The screen uses 7 font sizes" };
	const overlap: DesignFinding = { rule: "overlap", severity: "warning", message: "<div> overlaps <p>" };

	test("checks the screens the generation wrote: new ones, alternates and changed seeds", () => {
		const files = {
			"screens/home.tsx": "seed",
			"screens/home.alt-1.tsx": "alt",
			"screens/new.tsx": "new",
			"components/row.tsx": "row",
			"DESIGN.md": "",
		};

		expect(writtenScreens(files, [seed])).toEqual(["screens/home.alt-1.tsx", "screens/new.tsx"]);
		expect(writtenScreens({ ...files, "screens/home.tsx": "edited" }, [seed])).toContain("screens/home.tsx");
	});

	test("an alternate compares with the seed it varies", () => {
		expect(seedOf("screens/home.alt-2.tsx", [seed])).toBe(seed);
		expect(seedOf("screens/new.tsx", [seed])).toBeUndefined();
	});

	test("drops what the seed already had, wherever it moved", () => {
		const moved = { ...contrast, start: 300, line: 20 };

		expect(withoutInherited([moved, overlap], [contrast])).toEqual([overlap]);
	});

	test("counts findings by severity and rule, and keeps screens that failed", () => {
		const score = layoutScoreOf([
			{ path: "screens/home.tsx", findings: [contrast, fontSizes, overlap] },
			{ path: "screens/new.tsx", error: "screens/new.tsx:3: Unexpected token" },
		]);

		expect(score).toMatchObject({
			screens: 2,
			errors: 1,
			warnings: 2,
			byRule: { contrast: 1, "font-sizes": 1, overlap: 1 },
			failed: [{ path: "screens/new.tsx", error: "screens/new.tsx:3: Unexpected token" }],
		});
		expect(score.findings[0]).toMatchObject({ path: "screens/home.tsx", line: 9 });
		expect(layoutCell(score)).toBe("1e 2w 1 failed");
		expect(ruleCell(score)).toBe("overlap 1, contrast 1, font-sizes 1");
	});

	test("totals add up the briefs that were checked and leave layout out when none were", () => {
		const home = layoutScoreOf([{ path: "screens/home.tsx", findings: [contrast, overlap] }]);
		const totals = layoutTotalsOf([home, undefined, home]);

		expect(totals).toMatchObject({
			layoutScreens: 2,
			layoutFailed: 0,
			layoutErrors: 2,
			layoutWarnings: 2,
			contrast: 2,
			overlap: 2,
			"text-clipped": 0,
		});
		expect(layoutTotalsOf([undefined])).toEqual({});
		expect(totalsOf([scoreGeneration(input({}))]).layoutErrors).toBeUndefined();
	});

	test("a brief's layout reaches the totals", () => {
		const score = scoreGeneration(input({}));
		score.layout = layoutScoreOf([{ path: "screens/home.tsx", findings: [contrast] }]);

		expect(totalsOf([score])).toMatchObject({ layoutErrors: 1, contrast: 1 });
	});

	test("an old report compares without layout, and a run without layout compares with a new report", () => {
		const scored = scoreGeneration(input({}));
		scored.layout = layoutScoreOf([{ path: "screens/home.tsx", findings: [contrast] }]);
		const withLayout = totalsOf([scored]);
		const old = parseTotals({ totals: { ok: 1, errors: 0 } });
		const fromOld = new Map(deltasOf(old, withLayout).map((d) => [d.metric, d]));

		expect(old.layoutErrors).toBeUndefined();
		expect(fromOld.get("layoutErrors")).toMatchObject({ base: null, now: 1, delta: null, verdict: "" });

		const skipped = new Map(
			deltasOf(parseTotals({ totals: withLayout }), totalsOf([scoreGeneration(input({}))])).map((d) => [d.metric, d]),
		);

		expect(skipped.get("contrast")).toMatchObject({ base: 1, now: null, delta: null, verdict: "" });
	});

	test("fewer layout findings is better", () => {
		const scored = scoreGeneration(input({}));
		scored.layout = layoutScoreOf([{ path: "screens/home.tsx", findings: [] }]);
		const deltas = new Map(deltasOf({ layoutWarnings: 3, overlap: 2 }, totalsOf([scored])).map((d) => [d.metric, d]));

		expect(deltas.get("layoutWarnings")).toMatchObject({ delta: -3, verdict: "better" });
		expect(deltas.get("overlap")).toMatchObject({ delta: -2, verdict: "better" });
	});
});
