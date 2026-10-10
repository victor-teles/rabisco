import { describe, expect, test } from "bun:test";
import type { AttachCallbacks } from "./generation-session";
import { createProjectSessions, type Landed, type SessionsApi } from "./project-sessions";
import type { GenerationPlan } from "../../shared/ai/contract";
import type { PolishMode } from "../../shared/design/polish";
import { emptyCanvas } from "../../shared/project";
import type {
	CanvasDoc,
	ChatMessage,
	GenerateParams,
	GenerateResult,
	GenerationEventMessage,
	ProjectFiles,
} from "../../shared/types";
import type { ScreenCheck } from "@/views/editor/design-check";

const MODEL = "mock:mock";

const SCREEN = "export default function Home() {\n\treturn <main>Home</main>;\n}\n";

const POLISHED = "export default function Home() {\n\treturn <main className='text-foreground'>Home</main>;\n}\n";

const ok = { ok: true } as const;

type Stored = { canvas: CanvasDoc; files: ProjectFiles; chats: Map<string, ChatMessage[]> };

type Gate = { params: GenerateParams; resolve: (result: GenerateResult) => void };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(condition: () => boolean) {
	for (let i = 0; i < 200 && !condition(); i++) await tick();

	if (!condition()) throw new Error("Timed out waiting");
}

function memoryApi() {
	const log: string[] = [];
	const stored = new Map<string, Stored>();
	const calls: GenerateParams[] = [];
	const gates = new Map<string, Gate>();

	const project = (path: string) => {
		let found = stored.get(path);

		if (!found) {
			found = { canvas: emptyCanvas(path, "mobile"), files: { "DESIGN.md": "# Design\n" }, chats: new Map() };
			stored.set(path, found);
		}

		return found;
	};

	const aborted: GenerateResult = { ok: false, error: { code: "aborted", message: "Stopped.", retryable: true } };

	const api: SessionsApi = {
		async openProject({ path }) {
			log.push(`open ${path}`);
			const { canvas, files } = project(path);

			return { path, canvas, files, chatId: "chat-1", messages: [], chats: [] };
		},
		async closeProject({ path }) {
			log.push(`close ${path}`);

			return ok;
		},
		async writeFiles({ path, changes }) {
			log.push(`write ${path}`);
			const found = project(path);
			const files = { ...found.files };

			for (const change of changes) {
				if (change.content === null) delete files[change.path];
				else files[change.path] = change.content;
			}

			found.files = files;

			return ok;
		},
		async saveCanvas({ path, canvas }) {
			log.push(`save ${path}`);
			project(path).canvas = canvas;

			return ok;
		},
		async appendMessages({ path, chatId, messages }) {
			log.push(`append ${path}`);
			const { chats } = project(path);
			chats.set(chatId, [...(chats.get(chatId) ?? []), ...messages]);

			return ok;
		},
		async openChat({ path, chatId }) {
			return project(path).chats.get(chatId) ?? [];
		},
		async deleteChat() {
			return ok;
		},
		generate(params) {
			calls.push(params);

			return new Promise((resolve) => gates.set(params.generationId, { params, resolve }));
		},
		async stopGeneration({ generationId }) {
			log.push("stop");
			gates.get(generationId)?.resolve(aborted);

			return ok;
		},
	};

	const finish = (params: GenerateParams, result: GenerateResult) => gates.get(params.generationId)?.resolve(result);

	return { api, log, calls, stored: project, finish };
}

function created(path = "screens/home.tsx", content = SCREEN): GenerateResult {
	return {
		ok: true,
		changes: [{ path, content }],
		frames: [{ file: path, name: "Home", device: "mobile", x: 0, y: 0, width: 390, height: 844 }],
		reply: "Made the home screen.",
		problems: [],
		context: [],
	};
}

const PLAN: GenerationPlan = {
	screens: [{ path: "screens/home.tsx", name: "Home", purpose: "Start", content: "Habits" }],
	components: [],
	links: [],
};

function setup({ polish = "off", plan = false }: { polish?: PolishMode; plan?: boolean } = {}) {
	const memory = memoryApi();
	const events = new Set<(message: GenerationEventMessage) => void>();
	const landed: Landed[] = [];
	const checks: string[][] = [];

	const sessions = createProjectSessions({
		api: memory.api,
		onFilesChanged: () => () => {},
		onAssetsChanged: () => () => {},
		onGenerationEvent: (listener) => {
			events.add(listener);

			return () => void events.delete(listener);
		},
		onSaveError: () => {},
		generation: {
			schedule: (callback) => {
				let pending = true;

				queueMicrotask(() => pending && callback());

				return () => void (pending = false);
			},
			check: async ({ selected }): Promise<ScreenCheck[]> => {
				checks.push(selected.map((frame) => frame.file));

				return selected.map((frame) => ({
					frame,
					findings: [{ rule: "contrast", severity: "error", message: "Text is hard to read", path: frame.file }],
				}));
			},
			watchRenderErrors: async () => [],
			polishMode: () => polish,
			planMode: () => plan,
		},
		writeDelay: 5,
		saveDelay: 5,
	});

	sessions.onLanded((value) => landed.push(value));

	const emit = (message: GenerationEventMessage) => {
		for (const listener of events) listener(message);
	};

	const placed: string[][] = [];

	const callbacks: AttachCallbacks = {
		onPlaced: (frames) => placed.push(frames.map((frame) => frame.file)),
		onResolved: () => {},
	};

	async function open(path: string) {
		const detachProject = sessions.attach(path);
		const entry = sessions.get(path)!;
		const detachController = entry.controller.attach(callbacks);

		await waitFor(() => entry.session.state() !== null);

		const close = () => {
			detachController();
			detachProject();
		};

		return { ...entry, close };
	}

	const nextCall = async (count: number) => {
		await waitFor(() => memory.calls.length >= count);

		return memory.calls[count - 1]!;
	};

	return { ...memory, sessions, landed, emit, open, nextCall, placed, checks };
}

describe("project sessions", () => {
	test("a run keeps going after the editor detaches and lands as one undo step", async () => {
		const { sessions, open, nextCall, finish, log, landed, stored } = setup();
		const { session, controller, close } = await open("/p/a");
		const steps = session.state()!.history.past.length;

		const running = controller.run("A habit tracker", {}, MODEL);
		const params = await nextCall(1);
		close();

		expect(sessions.activity("/p/a")).toBe("generating");
		finish(params, created());
		await running;

		expect(log).not.toContain("stop");
		expect(session.state()!.history.past.length).toBe(steps + 1);
		expect(session.state()!.files["screens/home.tsx"]).toBe(SCREEN);
		expect(session.state()!.messages.map((m) => m.content)).toEqual(["Made the home screen."]);
		expect(sessions.activity("/p/a")).toBe("ready");
		expect(landed).toEqual([{ path: "/p/a", name: "/p/a", outcome: "ready" }]);
		expect(stored("/p/a").files["screens/home.tsx"]).toBe(SCREEN);
		expect(stored("/p/a").canvas.frames.map((frame) => frame.file)).toEqual(["screens/home.tsx"]);
		expect(log).not.toContain("close /p/a");
	});

	test("reattaching mid-run shows what was written so far, and later events apply", async () => {
		const { sessions, open, nextCall, finish, emit } = setup();
		const first = await open("/p/a");
		const running = first.controller.run("A habit tracker", {}, MODEL);
		const params = await nextCall(1);
		const generationId = params.generationId;

		emit({ generationId, attempt: 1, event: { type: "file.start", path: "screens/home.tsx", kind: "screen" } });
		emit({ generationId, attempt: 1, event: { type: "file.delta", path: "screens/home.tsx", text: "export " } });
		first.close();
		emit({ generationId, attempt: 1, event: { type: "file.delta", path: "screens/home.tsx", text: "default" } });

		const again = await open("/p/a");
		await tick();

		expect(again.controller).toBe(first.controller);
		expect(again.controller.get().generation?.writing["screens/home.tsx"]?.text).toBe("export default");

		emit({ generationId, attempt: 1, event: { type: "file.end", path: "screens/home.tsx", content: SCREEN } });
		await tick();
		expect(again.controller.get().generation?.writing["screens/home.tsx"]?.done).toBe(true);

		finish(params, created());
		await running;
		expect(sessions.activity("/p/a")).toBe(null);
	});

	test("Stop after reattaching stops the run once", async () => {
		const { open, nextCall, log } = setup();
		const first = await open("/p/a");
		const running = first.controller.run("A habit tracker", {}, MODEL);
		await nextCall(1);
		first.close();

		const again = await open("/p/a");
		again.controller.stop();
		await running;

		expect(log.filter((entry) => entry === "stop")).toHaveLength(1);
		expect(again.session.state()!.messages.map((m) => m.content)).toEqual(["Stopped. Nothing was changed."]);
		expect(again.controller.get().generation).toBe(null);
	});

	test("a plan that arrives while detached waits for approval", async () => {
		const { sessions, open, nextCall, finish, calls, landed } = setup({ plan: true });
		const first = await open("/p/a");
		const running = first.controller.run("A habit tracker", {}, MODEL);
		const params = await nextCall(1);
		first.close();

		finish(params, { ok: true, changes: [], frames: [], reply: "", problems: [], context: [], plan: PLAN });
		await running;

		expect(params.task).toBe("plan");
		expect(calls).toHaveLength(1);
		expect(sessions.activity("/p/a")).toBe("plan");
		expect(landed.map((value) => value.outcome)).toEqual(["plan"]);
		expect(sessions.get("/p/a")).not.toBe(null);

		const again = await open("/p/a");
		again.controller.acceptPlan(PLAN, MODEL);
		const accepted = await nextCall(2);

		expect(accepted.plan).toEqual(PLAN);
		finish(accepted, created());
		await waitFor(() => again.session.state()!.files["screens/home.tsx"] === SCREEN);
	});

	test("two projects generate at once and events go to their own run", async () => {
		const { open, nextCall, emit, finish } = setup();
		const a = await open("/p/a");
		const runA = a.controller.run("Habits", {}, MODEL);
		const paramsA = await nextCall(1);
		a.close();

		const b = await open("/p/b");
		const runB = b.controller.run("Coffee", {}, MODEL);
		const paramsB = await nextCall(2);

		const start = (path: string) => ({ type: "file.start", path, kind: "screen" }) as const;

		emit({ generationId: paramsA.generationId, attempt: 1, event: start("screens/a.tsx") });
		emit({ generationId: paramsB.generationId, attempt: 1, event: start("screens/b.tsx") });
		await tick();

		expect(Object.keys(a.controller.get().generation?.writing ?? {})).toEqual(["screens/a.tsx"]);
		expect(Object.keys(b.controller.get().generation?.writing ?? {})).toEqual(["screens/b.tsx"]);

		finish(paramsA, created("screens/a.tsx"));
		finish(paramsB, created("screens/b.tsx"));
		await Promise.all([runA, runB]);

		expect(Object.keys(a.session.state()!.files)).toContain("screens/a.tsx");
		expect(Object.keys(a.session.state()!.files)).not.toContain("screens/b.tsx");
		expect(Object.keys(b.session.state()!.files)).toContain("screens/b.tsx");
	});

	test("a reply goes to the chat its run started in", async () => {
		const { open, nextCall, finish, stored } = setup();
		const { session, controller } = await open("/p/a");

		session.addMessages([{ id: "u1", role: "user", content: "Habits", createdAt: new Date().toISOString() }]);
		const running = controller.run("Habits", {}, MODEL);
		const params = await nextCall(1);
		session.newChat();
		finish(params, created());
		await running;

		expect(params.chatId).toBe("chat-1");
		expect(session.state()!.chatId).not.toBe("chat-1");
		expect(session.state()!.messages).toEqual([]);
		expect(session.state()!.chats.find((chat) => chat.id === "chat-1")?.messageCount).toBe(2);
		await waitFor(() => stored("/p/a").chats.get("chat-1")?.length === 2);
	});

	test("releasing a project writes what is pending before closing it", async () => {
		const { sessions, open, log } = setup();
		const { session, close } = await open("/p/a");

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "PRODUCT.md": "# Product\n" } }));
		close();
		await waitFor(() => log.includes("close /p/a"));

		const closedAt = log.indexOf("close /p/a");

		expect(log.indexOf("write /p/a")).toBeLessThan(closedAt);
		expect(log.indexOf("save /p/a")).toBeLessThan(closedAt);
		expect(sessions.get("/p/a")).toBe(null);
	});

	test("Move to Trash stops the run and writes nothing", async () => {
		const { sessions, open, nextCall, log } = setup();
		const { controller, close } = await open("/p/a");
		const running = controller.run("Habits", {}, MODEL);
		await nextCall(1);
		close();

		const before = log.length;
		await sessions.discard("/p/a");
		await running;
		await tick();

		const after = log.slice(before);

		expect(after).toContain("stop");
		expect(after).toContain("close /p/a");
		expect(after.filter((entry) => /^(write|save|append)/.test(entry))).toEqual([]);
		expect(sessions.get("/p/a")).toBe(null);
		expect(sessions.activity("/p/a")).toBe(null);
	});

	test("a detached polish joins the generation's undo step", async () => {
		const { open, nextCall, finish, checks, stored } = setup({ polish: "polish" });
		const { session, controller, close } = await open("/p/a");
		const steps = session.state()!.history.past.length;
		const running = controller.run("Habits", {}, MODEL);
		const params = await nextCall(1);
		close();

		finish(params, created());
		const repair = await nextCall(2);

		expect(repair.task).toBe("repair");
		expect(checks[0]).toEqual(["screens/home.tsx"]);
		finish(repair, {
			ok: true,
			changes: [{ path: "screens/home.tsx", content: POLISHED }],
			frames: [],
			reply: "",
			problems: [],
			context: [],
		});
		await running;

		expect(session.state()!.files["screens/home.tsx"]).toBe(POLISHED);
		expect(session.state()!.history.past.length).toBe(steps + 1);
		expect(stored("/p/a").files["screens/home.tsx"]).toBe(POLISHED);
		expect(session.state()!.messages.at(-1)?.content).toContain("Polished 1 design problem");
	});

	test("undo after reattaching takes back the result that landed while away", async () => {
		const { open, nextCall, finish, sessions } = setup();
		const first = await open("/p/a");
		const running = first.controller.run("Habits", {}, MODEL);
		const params = await nextCall(1);
		first.close();
		finish(params, created());
		await running;

		const again = await open("/p/a");

		expect(sessions.activity("/p/a")).toBe(null);
		expect(again.session.state()!.canvas.selection).toEqual(["screens/home.tsx"]);
		again.session.undo();
		expect(again.session.state()!.files["screens/home.tsx"]).toBeUndefined();
		expect(again.session.state()!.canvas.frames).toEqual([]);
	});
});
