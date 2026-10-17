import { describe, expect, test } from "bun:test";
import type { AttachCallbacks } from "./generation-session";
import { createProjectSessions, type Landed, type SessionsApi } from "./project-sessions";
import type { ViewerCommented } from "./rpc";
import type { GenerationPlan } from "../../shared/ai/contract";
import { elementFocus } from "../../shared/ai/focus";
import type { PolishMode } from "../../shared/design/polish";
import { emptyCanvas } from "../../shared/project";
import type { SavedHistory } from "../../shared/saved-history";
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
	const histories = new Map<string, SavedHistory>();
	const backups: string[] = [];

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
		async readHistory({ path }) {
			return histories.get(path) ?? null;
		},
		async writeHistory({ path, history }) {
			histories.set(path, history);

			return ok;
		},
		async writeAssets() {
			return { missing: [] };
		},
		async backupProject({ path, reason }) {
			backups.push(`${reason} ${path}`);

			return { dir: `/backups/${backups.length}` };
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

	return { api, log, calls, stored: project, finish, histories, backups };
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
	const viewerComments = new Set<(message: ViewerCommented) => void>();
	const commented: string[] = [];

	const sessions = createProjectSessions({
		api: memory.api,
		onFilesChanged: () => () => {},
		onAssetsChanged: () => () => {},
		onViewerComment: (listener) => {
			viewerComments.add(listener);

			return () => void viewerComments.delete(listener);
		},
		onViewerCommentAdded: (path, text) => void commented.push(`${path}: ${text}`),
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

	const comment = (message: ViewerCommented) => {
		for (const listener of viewerComments) listener(message);
	};

	return { ...memory, sessions, landed, emit, open, nextCall, placed, checks, comment, commented };
}

describe("project sessions", () => {
	test("a viewer's comment is a new thread on its screen and one undo step", async () => {
		const { open, comment, commented } = setup();
		const { session } = await open("/p/a");

		const home = {
			file: "screens/home.tsx",
			name: "Home",
			device: "mobile" as const,
			x: 0,
			y: 0,
			width: 390,
			height: 844,
		};

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [home.file]: SCREEN }, frames: [home] }));
		comment({ path: "/p/b", comment: { screen: home.file, x: 10, y: 10, text: "Not open" } });
		comment({ path: "/p/a", comment: { screen: home.file, x: 500, y: 1200, text: "Bigger button" } });

		expect(session.state()!.canvas.comments).toEqual([
			{
				id: expect.any(String),
				file: home.file,
				x: 390,
				y: 1200,
				text: "Bigger button",
				createdAt: expect.any(String),
			},
		]);
		expect(commented).toEqual(["/p/a: Bigger button"]);

		session.undo();
		expect(session.state()!.canvas.comments ?? []).toEqual([]);
		expect(session.state()!.canvas.frames).toEqual([home]);
	});

	test("an outside edit of the canvas file lands in every undo step and isn't saved back", async () => {
		const { open, stored, log } = setup();
		const { session } = await open("/p/a");

		const home = {
			file: "screens/home.tsx",
			name: "Home",
			device: "mobile" as const,
			x: 0,
			y: 0,
			width: 390,
			height: 844,
		};

		session.change((snapshot) => ({
			...snapshot,
			files: { ...snapshot.files, "screens/home.tsx": SCREEN },
			frames: [home],
		}));
		await session.flushCanvas();
		const saves = log.filter((line) => line.startsWith("save")).length;

		session.canvasChanged({ ...stored("/p/a").canvas, name: "Pulled", frames: [{ ...home, x: 500 }] });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(session.state()!.canvas.name).toBe("Pulled");
		expect(session.state()!.canvas.frames.map((frame) => frame.x)).toEqual([500]);
		expect(log.filter((line) => line.startsWith("save")).length).toBe(saves);

		session.undo();
		expect(session.state()!.canvas.frames).toEqual([]);
		expect(session.state()!.canvas.name).toBe("Pulled");

		session.redo();
		expect(session.state()!.canvas.frames.map((frame) => frame.x)).toEqual([500]);
	});

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
		expect(again.session.state()!.messages).toEqual([]);
		expect(again.controller.get().failure).toMatchObject({ code: "aborted", retryable: true });
		expect(again.controller.get().generation).toBe(null);
	});

	test("a failed write is written again by the next flush", async () => {
		const { open, api, stored } = setup();
		const { session } = await open("/p/a");
		const write = api.writeFiles;
		let failing = true;

		api.writeFiles = async (params) => {
			if (!failing) return write(params);
			failing = false;
			throw new Error("Disk full");
		};

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "screens/home.tsx": SCREEN } }));

		expect(await session.flushCanvas()).toBe(false);
		expect(await session.flushCanvas()).toBe(true);
		expect(stored("/p/a").files["screens/home.tsx"]).toBe(SCREEN);
	});

	test("save all writes the pending files, canvas and undo history at once", async () => {
		const { open, sessions, stored, histories } = setup();
		const { session } = await open("/p/a");

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "screens/home.tsx": SCREEN } }));
		await sessions.saveAll();

		expect(stored("/p/a").files["screens/home.tsx"]).toBe(SCREEN);
		expect(histories.get("/p/a")?.past).toHaveLength(1);
	});

	test("save all reports a failed write", async () => {
		const { open, sessions, api } = setup();
		const { session } = await open("/p/a");

		api.writeFiles = async () => {
			throw new Error("Disk full");
		};

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "screens/home.tsx": SCREEN } }));

		expect(await sessions.saveAll()).toBe(false);
	});

	test("a plan that fails says so, then runs in one go", async () => {
		const { open, nextCall, finish } = setup({ plan: true });
		const { session, controller } = await open("/p/a");
		const running = controller.run("A habit tracker", {}, MODEL);

		finish(await nextCall(1), {
			ok: false,
			error: { code: "network", message: "The provider is offline.", retryable: true },
		});
		const params = await nextCall(2);

		expect(params.task).toBe("create");
		finish(params, created());
		await running;

		expect(session.state()!.messages.map((m) => m.content)).toEqual([
			"Couldn't plan this first (The provider is offline), so it ran in one go.",
			"Made the home screen.",
		]);
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

	test("a recreate skips the plan, lands beside its image and is one undo step with its polish", async () => {
		const { open, nextCall, finish } = setup({ polish: "polish", plan: true });
		const { session, controller } = await open("/p/a");
		const shot = { id: "shot", src: "/moodboard/shot.png", name: "shot.png", x: 1000, y: 200, width: 480, height: 300 };
		session.change((snapshot) => ({ ...snapshot, images: [shot] }));
		const steps = session.state()!.history.past.length;
		const reference = { name: "shot.png", mediaType: "image/png" as const, data: "iVBORw0KGgo=" };

		const running = controller.run(
			"Recreate it",
			{ attachments: [reference], recreate: { image: shot, device: "desktop", reference } },
			MODEL,
		);

		const params = await nextCall(1);

		expect(params.task).toBe("create");
		expect(params.device).toBe("desktop");

		finish(params, {
			ok: true,
			changes: [{ path: "screens/home.tsx", content: SCREEN }],
			frames: [{ file: "screens/home.tsx", name: "Home", device: "desktop", x: 0, y: 0, width: 1280, height: 800 }],
			reply: "Made the home screen.",
			problems: [],
			context: [],
		});

		const repair = await nextCall(2);

		expect(repair.task).toBe("repair");
		finish(repair, {
			ok: true,
			changes: [{ path: "screens/home.tsx", content: POLISHED }],
			frames: [],
			reply: "",
			problems: [],
			context: [],
		});
		await running;

		const [placed] = session.state()!.canvas.frames;

		expect(placed).toMatchObject({ x: 1000 + 480 + 80, y: 200, width: 1280, height: 800, reference: "shot" });
		expect(session.state()!.files["screens/home.tsx"]).toBe(POLISHED);
		expect(session.state()!.history.past.length).toBe(steps + 1);
	});

	test("the review of a focused edit keeps the focus, and the guard sees its edits too", async () => {
		const { open, nextCall, finish } = setup({ polish: "polish" });
		const { session, controller } = await open("/p/a");
		const path = "screens/home.tsx";
		const card = `export default function Home() {\n\treturn (\n\t\t<main>\n\t\t\t<p className="text-success">+5 this week</p>\n\t\t\t<button>Log watering</button>\n\t\t</main>\n\t);\n}\n`;
		const edited = card.replace("Log watering", "Water Monstera now");
		const reviewed = edited.replace("text-success", "text-foreground");
		const focus = elementFocus(card, path, card.indexOf("<button>"))!;
		const home = { file: path, name: "Home", device: "mobile" as const, x: 0, y: 0, width: 390, height: 844 };

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [path]: card }, frames: [home] }));

		const running = controller.run(
			"Make this button say 'Water Monstera now'",
			{ targets: [path], focus: [focus] },
			MODEL,
		);

		const edit = await nextCall(1);

		expect(edit.focus).toEqual([focus]);
		finish(edit, {
			ok: true,
			changes: [{ path, content: edited }],
			frames: [],
			reply: "Done.",
			problems: [],
			context: [],
		});
		const review = await nextCall(2);

		expect(review.task).toBe("repair");
		expect(review.focus).toEqual([focus]);
		finish(review, {
			ok: true,
			changes: [{ path, content: reviewed }],
			frames: [],
			reply: "",
			problems: [],
			context: [],
		});
		await running;

		expect(session.state()!.files[path]).toBe(reviewed);
		expect(session.state()!.messages.at(-1)?.content).toBe(
			`Done.\n\nNote: this also changed ${path} outside <button> “Log watering” (line 4). Undo reverts the whole edit.\n\nPolished 1 design problem the check found.`,
		);
	});

	test("a focused edit's note is not repeated when its review stays inside the element", async () => {
		const { open, nextCall, finish } = setup({ polish: "polish" });
		const { session, controller } = await open("/p/a");
		const path = "screens/home.tsx";
		const card = `export default function Home() {\n\treturn (\n\t\t<main>\n\t\t\t<p>+5 this week</p>\n\t\t\t<button>Log watering</button>\n\t\t</main>\n\t);\n}\n`;
		const edited = card.replace("Log watering", "Water now").replace("+5", "+6");
		const reviewed = edited.replace("<button>", "<button className='font-medium'>");
		const focus = elementFocus(card, path, card.indexOf("<button>"))!;
		const note = `Note: this also changed ${path} outside <button> “Log watering” (line 4). Undo reverts the whole edit.`;
		const home = { file: path, name: "Home", device: "mobile" as const, x: 0, y: 0, width: 390, height: 844 };

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [path]: card }, frames: [home] }));
		const running = controller.run("Water now", { targets: [path], focus: [focus] }, MODEL);
		const reply = `Done.\n\n${note}`;
		finish(await nextCall(1), {
			ok: true,
			changes: [{ path, content: edited }],
			frames: [],
			reply,
			problems: [],
			context: [],
		});
		finish(await nextCall(2), {
			ok: true,
			changes: [{ path, content: reviewed }],
			frames: [],
			reply: "",
			problems: [],
			context: [],
		});
		await running;

		expect(session.state()!.messages.at(-1)?.content).toBe(`${reply}\n\nPolished 1 design problem the check found.`);
	});

	test("a polish that fails says so in the reply", async () => {
		const { open, nextCall, finish } = setup({ polish: "polish" });
		const { session, controller } = await open("/p/a");
		const running = controller.run("Habits", {}, MODEL);
		finish(await nextCall(1), created());

		finish(await nextCall(2), {
			ok: false,
			error: { code: "rate_limited", message: "Too many requests.", retryable: true },
		});
		await running;

		expect(session.state()!.files["screens/home.tsx"]).toBe(SCREEN);
		expect(session.state()!.messages.at(-1)?.content).toBe(
			"Made the home screen.\n\nCouldn't polish the screens (Too many requests), so they are as generated.",
		);
	});

	test("an AI change is a version in the session, recorded after its polish", async () => {
		const { open, nextCall, finish } = setup({ polish: "polish" });
		const { session, controller } = await open("/p/a");
		const running = controller.run("Habits\nwith streaks", {}, MODEL);
		finish(await nextCall(1), created());
		const repair = await nextCall(2);

		finish(repair, {
			ok: true,
			changes: [{ path: "screens/home.tsx", content: POLISHED }],
			frames: [],
			reply: "",
			problems: [],
			context: [],
		});
		await running;

		const [version] = session.state()!.versions;
		expect(session.state()!.versions).toHaveLength(1);
		expect(version).toMatchObject({ kind: "ai", label: "Habits", changed: ["screens/home.tsx"] });
		expect(version!.snapshot).toBe(session.state()!.history.present);
		expect(version!.snapshot.files["screens/home.tsx"]).toBe(POLISHED);
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

describe("follow-ups", () => {
	test("a next screen skips the plan, links its element and is one undo step", async () => {
		const { open, nextCall, finish } = setup({ plan: true });
		const { session, controller } = await open("/p/next");

		const frame = {
			file: "screens/home.tsx",
			name: "Home",
			device: "tablet" as const,
			x: 0,
			y: 0,
			width: 834,
			height: 1194,
		};

		session.change((snapshot) => ({
			...snapshot,
			files: { ...snapshot.files, "screens/home.tsx": SCREEN },
			frames: [frame],
		}));

		const steps = session.state()!.history.past.length;
		const start = SCREEN.indexOf("<main>");

		const running = controller.run(
			"Make the next screen",
			{ references: ["screens/home.tsx"], link: { file: "screens/home.tsx", start }, device: "tablet" },
			MODEL,
		);

		const params = await nextCall(1);

		expect([params.task, params.device, params.references]).toEqual(["create", "tablet", ["screens/home.tsx"]]);
		finish(params, created("screens/summary.tsx"));
		await running;

		expect(session.state()!.files["screens/home.tsx"]).toContain('<main data-link-to="screens/summary.tsx">');
		expect(session.state()!.canvas.frames.map((f) => f.file)).toEqual(["screens/home.tsx", "screens/summary.tsx"]);
		expect(session.state()!.history.past.length).toBe(steps + 1);
	});

	test("a dark mode pass sends its modes, and every screen runs on its own", async () => {
		const { open, nextCall, finish } = setup();
		const { controller } = await open("/p/dark");
		const modes = { "screens/home.tsx": { scheme: "dark" } };

		const running = controller.run(
			"Fix dark mode",
			{
				targets: ["screens/home.tsx", "screens/b.tsx"],
				repair: { problems: [{ path: "screens/home.tsx", message: "Low contrast" }] },
				each: true,
				modes,
			},
			MODEL,
		);

		const params = await nextCall(1);

		expect([params.task, params.each, params.modes]).toEqual(["repair", true, modes]);
		finish(params, { ok: true, changes: [], frames: [], reply: "", problems: [], context: [] });
		await running;
	});
});
