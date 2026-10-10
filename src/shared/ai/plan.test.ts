import { describe, expect, test } from "bun:test";
import type { GenerationPlan } from "./contract";
import {
	fitPlan,
	parsePlanReply,
	pascalName,
	PLAN_LIMITS,
	planBlock,
	planJsonOf,
	planRevisionPrompt,
	plansFirst,
	renamePlanScreen,
	revisedPrompt,
	selectPlan,
} from "./plan";

const PLAN: GenerationPlan = {
	screens: [
		{ path: "screens/home.tsx", name: "Home", purpose: "Today at a glance.", content: "balance, recent activity" },
		{ path: "screens/send.tsx", name: "Send", purpose: "Pick someone and an amount.", content: "contacts, keypad" },
		{ path: "screens/done.tsx", name: "Done", purpose: "The transfer went through.", content: "check, summary" },
	],
	components: [
		{ path: "components/tab-bar.tsx", name: "TabBar", purpose: "Bottom tabs.", usedBy: ["screens/home.tsx"] },
		{
			path: "components/app-header.tsx",
			name: "AppHeader",
			purpose: "Title and back.",
			usedBy: ["screens/send.tsx", "screens/done.tsx"],
		},
	],
	links: [
		{ from: "screens/home.tsx", to: "screens/send.tsx", label: "Send" },
		{ from: "screens/send.tsx", to: "screens/done.tsx", label: "Confirm" },
	],
};

const ROW = `export function TabBar() { return <nav /> }\n`;

describe("planJsonOf", () => {
	test("reads a fenced block with text around it", () => {
		expect(planJsonOf('Here you go:\n```json\n{ "screens": [] }\n```\nThanks')).toEqual({ screens: [] });
	});

	test("falls back to the outermost braces", () => {
		expect(planJsonOf('Plan: { "screens": [{ "name": "A" }] } done')).toEqual({ screens: [{ name: "A" }] });
	});

	test("null for no JSON or broken JSON", () => {
		expect(planJsonOf("No plan here.")).toBeNull();
		expect(planJsonOf('```json\n{ "screens": [ \n```')).toBeNull();
		expect(planJsonOf("[1, 2]")).toBeNull();
	});
});

describe("parsePlanReply", () => {
	test("round-trips a good plan", () => {
		expect(parsePlanReply(planBlock(PLAN), {})).toEqual(PLAN);
	});

	test("null when the reply is malformed or has no screens", () => {
		expect(parsePlanReply("I think you need three screens.", {})).toBeNull();
		expect(parsePlanReply('```json\n{ "screens": "home" }\n```', {})).toBeNull();
		expect(parsePlanReply('```json\n{ "components": [{ "name": "TabBar" }] }\n```', {})).toBeNull();
	});

	test("skips fields of the wrong type and fills paths from names", () => {
		const reply = JSON.stringify({
			screens: [{ name: "Order history", purpose: 3 }, "home", { path: "screens/Bad Path.tsx" }],
			components: [{ name: "order row", usedBy: ["Order history", 4] }],
		});

		const plan = parsePlanReply(reply, {})!;
		expect(plan.screens.map((s) => [s.path, s.name, s.purpose])).toEqual([
			["screens/order-history.tsx", "Order history", ""],
			["screens/bad-path.tsx", "Bad Path", ""],
		]);
		expect(plan.components).toEqual([{ path: "components/order-row.tsx", name: "OrderRow", purpose: "", usedBy: [] }]);
	});
});

describe("fitPlan", () => {
	test("drops a repeated screen path, and moves links to the kept one", () => {
		const plan = fitPlan({ ...PLAN, screens: [...PLAN.screens, { ...PLAN.screens[0]!, name: "Home again" }] }, {});

		expect(plan.screens.map((s) => s.path)).toEqual(["screens/home.tsx", "screens/send.tsx", "screens/done.tsx"]);
	});

	test("a screen that exists gets a new path; links and users follow it", () => {
		const plan = fitPlan(PLAN, { "screens/home.tsx": "export default function Home() {}" });
		expect(plan.screens[0]!.path).toBe("screens/home-2.tsx");
		expect(plan.links[0]).toEqual({ from: "screens/home-2.tsx", to: "screens/send.tsx", label: "Send" });
		expect(plan.components[0]!.usedBy).toEqual(["screens/home-2.tsx"]);
	});

	test("drops components the project has, by path or by export name", () => {
		expect(fitPlan(PLAN, { "components/tab-bar.tsx": ROW }).components.map((c) => c.name)).toEqual(["AppHeader"]);
		expect(fitPlan(PLAN, { "components/bottom-nav.tsx": ROW }).components.map((c) => c.name)).toEqual(["AppHeader"]);
	});

	test("keeps links between planned screens or to existing ones", () => {
		const plan = fitPlan(
			{
				...PLAN,
				links: [
					{ from: "screens/home.tsx", to: "screens/settings.tsx", label: "Settings" },
					{ from: "screens/home.tsx", to: "screens/nowhere.tsx", label: "" },
					{ from: "screens/settings.tsx", to: "screens/home.tsx", label: "" },
					{ from: "screens/home.tsx", to: "screens/home.tsx", label: "" },
				],
			},
			{ "screens/settings.tsx": "export default function Settings() {}" },
		);

		expect(plan.links).toEqual([{ from: "screens/home.tsx", to: "screens/settings.tsx", label: "Settings" }]);
	});

	test("caps the counts", () => {
		const many = Array.from({ length: 10 }, (_, i) => ({
			path: `screens/s${i}.tsx`,
			name: `S${i}`,
			purpose: "",
			content: "",
		}));

		const parts = Array.from({ length: 10 }, (_, i) => ({
			path: `components/p${i}.tsx`,
			name: `P${i}`,
			purpose: "",
			usedBy: [],
		}));

		const plan = fitPlan({ screens: many, components: parts, links: [] }, {});
		expect(plan.screens).toHaveLength(PLAN_LIMITS.screens);
		expect(plan.components).toHaveLength(PLAN_LIMITS.components);
	});
});

describe("editing a plan", () => {
	test("unticking a screen drops its links and users", () => {
		const plan = selectPlan(PLAN, {
			screens: ["screens/home.tsx", "screens/send.tsx"],
			components: ["components/app-header.tsx"],
		});

		expect(plan.screens.map((s) => s.name)).toEqual(["Home", "Send"]);
		expect(plan.components).toEqual([{ ...PLAN.components[1]!, usedBy: ["screens/send.tsx"] }]);
		expect(plan.links).toEqual([PLAN.links[0]!]);
	});

	test("renaming a screen moves its path, links and users", () => {
		const plan = renamePlanScreen(PLAN, "screens/send.tsx", "Send money", {});
		expect(plan.screens[1]).toMatchObject({ path: "screens/send-money.tsx", name: "Send money" });
		expect(plan.links.map((l) => [l.from, l.to])).toEqual([
			["screens/home.tsx", "screens/send-money.tsx"],
			["screens/send-money.tsx", "screens/done.tsx"],
		]);
		expect(plan.components[1]!.usedBy).toEqual(["screens/send-money.tsx", "screens/done.tsx"]);
	});

	test("an empty or taken name", () => {
		expect(renamePlanScreen(PLAN, "screens/send.tsx", "  ", {})).toBe(PLAN);
		expect(renamePlanScreen(PLAN, "screens/send.tsx", "Home", {}).screens[1]!.path).toBe("screens/home-2.tsx");
	});

	test("plans first only in plan mode, for a create of one version", () => {
		const create = { planMode: true, task: "create", variations: 1 };

		expect(plansFirst(create)).toBe(true);
		expect(plansFirst({ ...create, planMode: false })).toBe(false);
		expect(plansFirst({ ...create, task: "edit" })).toBe(false);
		expect(plansFirst({ ...create, variations: 3 })).toBe(false);
		expect(plansFirst({ ...create, plan: PLAN })).toBe(false);
	});

	test("a revision carries the prompt, the plan and the feedback", () => {
		const prompt = planRevisionPrompt("A banking app", PLAN, "Add a settings screen");

		expect(prompt.startsWith("A banking app\n\n")).toBe(true);
		expect(prompt).toContain(planBlock(PLAN));
		expect(prompt.endsWith("Add a settings screen")).toBe(true);
		expect(revisedPrompt(" A banking app ", "Add a settings screen ")).toBe("A banking app\n\nAdd a settings screen");
	});

	test("pascal names", () => {
		expect(pascalName("tab bar")).toBe("TabBar");
		expect(pascalName("components/app-header.tsx")).toBe("AppHeader");
		expect(pascalName("StatCard")).toBe("StatCard");
		expect(pascalName("3d view")).toBe("");
	});
});
