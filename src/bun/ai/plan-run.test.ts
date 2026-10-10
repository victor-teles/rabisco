import { describe, expect, test } from "bun:test";
import { join } from "path";
import type { GenerationEvent, GenerationRequest, Provider } from "../../shared/ai/contract";
import { selectPlan } from "../../shared/ai/plan";
import type { GenerationEventMessage } from "../../shared/types";
import { createProjectFolder } from "../project-folder";
import { tempDir } from "../test-utils";
import { createMemorySecretStore } from "./keychain";
import { buildPlanRequest, scopedProvider } from "./plan-run";
import { createMockProvider } from "./providers/mock";
import { createAiService } from "./service";

/** The mock provider, recording every request it gets; `fail` makes the runs for those paths end in an error */
function setup(fail: string[] = []) {
	const root = tempDir();
	const sent: GenerationEventMessage[] = [];
	const requests: GenerationRequest[] = [];
	const mock = createMockProvider({ delayMs: 0 });

	const provider: Provider = {
		...mock,
		generate(request, signal) {
			requests.push(request);

			if (request.writes?.some((path) => fail.includes(path))) {
				return (async function* (): AsyncGenerator<GenerationEvent> {
					yield { type: "error", code: "rate_limited", message: "Slow down.", retryable: true };
				})();
			}

			return mock.generate(request, signal);
		},
	};

	const ai = createAiService({
		userDataDir: join(root, "userData"),
		secrets: createMemorySecretStore(),
		includeMock: true,
		send: (message) => sent.push(message),
		detect: async () => ({}),
		createProvider: () => provider,
	});

	const projectPath = createProjectFolder(root, "Demo", "mobile");

	return { ai, sent, requests, projectPath };
}

const params = (projectPath: string, generationId = "g1") => ({
	generationId,
	projectPath,
	prompt: "A habit tracker: welcome, today and a habit's details",
	device: "mobile" as const,
	model: "mock:mock",
});

async function planOf(ai: ReturnType<typeof setup>["ai"], projectPath: string) {
	const result = await ai.generate({ ...params(projectPath, "plan"), task: "plan" });

	if (!result.ok || !result.plan) throw new Error(result.ok ? "No plan" : result.error.message);

	return { result, plan: result.plan };
}

describe("plan task", () => {
	test("replies with a plan and writes nothing", async () => {
		const { ai, sent, requests, projectPath } = setup();
		const { result, plan } = await planOf(ai, projectPath);

		expect(result.changes).toEqual([]);
		expect(result.frames).toEqual([]);
		expect(plan.screens.map((s) => s.path)).toEqual(["screens/welcome.tsx", "screens/home.tsx", "screens/details.tsx"]);
		expect(plan.components.map((c) => c.path)).toEqual(["components/stat-card.tsx", "components/tab-bar.tsx"]);
		expect(plan.components[1]!.usedBy).toEqual(["screens/home.tsx"]);
		expect(plan.links).toHaveLength(2);
		expect(requests[0]!.task).toBe("plan");
		expect(requests[0]!.files).toEqual([]);
		// The JSON is for the card, not the chat
		expect(sent.some((m) => m.event.type === "message.delta")).toBe(false);
		expect(sent.at(-1)!.event.type).toBe("done");
	});

	test("the plan request has the screens' paths and the component catalog, no sources", () => {
		const request = buildPlanRequest({
			id: "p",
			model: "m",
			prompt: "More",
			device: "mobile",
			projectFiles: {
				"screens/home.tsx": "export default function Home() { return <p /> }",
				"screens/home.alt-1.tsx": "export default function Home() { return <p /> }",
				"components/row.tsx": "export function Row() { return <div /> }",
				"PRODUCT.md": "# Product\n\nHabits.\n",
			},
		});

		expect(request.projectScreens).toEqual(["screens/home.tsx"]);
		expect(request.components?.map((c) => c.path)).toEqual(["components/row.tsx"]);
		expect(request.files).toEqual([]);
		expect(request.context.product).toContain("Habits");
	});

	test("stopping during the plan resolves with aborted", async () => {
		const root = tempDir();
		const slow = createMockProvider({ delayMs: 200 });

		const ai = createAiService({
			userDataDir: join(root, "userData"),
			secrets: createMemorySecretStore(),
			includeMock: true,
			send: () => {},
			detect: async () => ({}),
			createProvider: () => slow,
		});

		const projectPath = createProjectFolder(root, "Demo", "mobile");
		const running = ai.generate({ ...params(projectPath, "p2"), task: "plan" });
		setTimeout(() => ai.stopGeneration("p2"), 20);
		const result = await running;

		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.error.code).toBe("aborted");
	});
});

describe("create from a plan", () => {
	test("components first, then one run per screen; one combined result", async () => {
		const { ai, requests, projectPath } = setup();
		const { plan } = await planOf(ai, projectPath);

		const accepted = selectPlan(plan, {
			screens: ["screens/home.tsx", "screens/details.tsx"],
			components: ["components/tab-bar.tsx", "components/stat-card.tsx"],
		});

		requests.length = 0;
		const result = await ai.generate({ ...params(projectPath), plan: accepted });

		if (!result.ok) throw new Error(result.error.message);

		expect(requests[0]!.writes).toEqual(["components/stat-card.tsx", "components/tab-bar.tsx"]);
		expect(requests.slice(1).map((r) => r.writes)).toEqual([["screens/home.tsx"], ["screens/details.tsx"]]);

		// Each screen run sees the components just written, as read-only references
		for (const request of requests.slice(1)) {
			expect(request.references).toEqual(["components/stat-card.tsx", "components/tab-bar.tsx"]);
			expect(request.files.map((f) => f.path)).toContain("components/tab-bar.tsx");
			expect(request.plan?.screens.map((s) => s.name)).toEqual(["Home", "Details"]);
		}

		expect(result.changes.map((c) => c.path)).toEqual([
			"components/stat-card.tsx",
			"components/tab-bar.tsx",
			"screens/home.tsx",
			"screens/details.tsx",
		]);
		expect(result.problems).toEqual([]);
		expect(result.frames.map((f) => [f.file, f.name])).toEqual([
			["screens/home.tsx", "Home"],
			["screens/details.tsx", "Details"],
		]);
		expect(result.frames[1]!.x).toBeGreaterThan(result.frames[0]!.x);

		const home = result.changes.find((c) => c.path === "screens/home.tsx")!.content!;
		expect(home).toContain('from "../components/tab-bar"');
		expect(home).toContain('data-link-to="screens/details.tsx"');
		expect(result.reply).toContain("2 screens from the plan: Home and Details");
		expect(result.reply).toContain("StatCard and TabBar");
	});

	test("unticked components aren't written, and screens don't import them", async () => {
		const { ai, requests, projectPath } = setup();
		const { plan } = await planOf(ai, projectPath);
		const accepted = selectPlan(plan, { screens: ["screens/home.tsx"], components: ["components/stat-card.tsx"] });

		requests.length = 0;
		const result = await ai.generate({ ...params(projectPath), plan: accepted });

		if (!result.ok) throw new Error(result.error.message);
		expect(result.changes.map((c) => c.path)).toEqual(["components/stat-card.tsx", "screens/home.tsx"]);
		expect(result.changes[1]!.content).not.toContain("tab-bar");
	});

	test("a failed screen run leaves the others, with a note", async () => {
		const { ai, projectPath } = setup(["screens/details.tsx"]);
		const { plan } = await planOf(ai, projectPath);
		const result = await ai.generate({ ...params(projectPath), plan });

		if (!result.ok) throw new Error(result.error.message);
		expect(result.frames.map((f) => f.name)).toEqual(["Welcome", "Home"]);
		expect(result.reply).toContain("Details failed");
	});

	test("a failed shell fails the whole run, writing nothing", async () => {
		const { ai, projectPath } = setup(["components/tab-bar.tsx"]);
		const { plan } = await planOf(ai, projectPath);
		const result = await ai.generate({ ...params(projectPath), plan });

		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.error.code).toBe("rate_limited");
	});

	test("a plan with variations runs as a plain create", async () => {
		const { ai, requests, projectPath } = setup();
		const { plan } = await planOf(ai, projectPath);

		requests.length = 0;
		await ai.generate({ ...params(projectPath), plan, variations: 2 });
		expect(requests.every((r) => r.writes === undefined)).toBe(true);
	});
});

describe("scopedProvider", () => {
	const fake = (events: GenerationEvent[]): Provider => ({
		...createMockProvider(),
		async *generate() {
			yield* events;
		},
	});

	async function run(provider: Provider) {
		const out: GenerationEvent[] = [];

		for await (const event of provider.generate(
			{ id: "r", task: "create", model: "m", prompt: "", device: "mobile", context: {}, files: [] },
			new AbortController().signal,
		))
			out.push(event);

		return out;
	}

	test("drops writes outside the allowed paths", async () => {
		const out = await run(
			scopedProvider(
				fake([
					{ type: "file.end", path: "components/a.tsx", content: "a" },
					{ type: "file.end", path: "components/b.tsx", content: "b" },
					{ type: "done" },
				]),
				new Set(["components/a.tsx"]),
			),
		);

		expect(out.map((e) => ("path" in e ? e.path : e.type))).toEqual(["components/a.tsx", "done"]);
	});

	test("moves a screen written under another name to the planned path", async () => {
		const out = await run(
			scopedProvider(
				fake([
					{ type: "file.start", path: "screens/main.tsx", kind: "screen" },
					{ type: "file.end", path: "screens/main.tsx", content: "x" },
					{ type: "file.end", path: "components/extra.tsx", content: "y" },
					{ type: "done" },
				]),
				new Set(["screens/home.tsx"]),
			),
		);

		expect(out.map((e) => ("path" in e ? e.path : e.type))).toEqual(["screens/home.tsx", "screens/home.tsx", "done"]);
	});
});
