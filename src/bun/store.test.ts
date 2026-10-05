import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { DESIGN_TEMPLATE, PRODUCT_TEMPLATE } from "../shared/context/templates";
import type { FileChange } from "../shared/types";
import {
	appendChat,
	assertProjectFilePath,
	createProjectFolder,
	freeProjectDir,
	loadProject,
	normalizeCanvas,
	parseChat,
	writeProjectFiles,
} from "./project-folder";
import { createProjectStore, type ProjectStore } from "./store";
import { tempDir } from "./test-utils";

describe("project files", () => {
	test("only screens, components and context files are writable", () => {
		for (const ok of [
			"screens/welcome.tsx",
			"screens/welcome.alt-1.tsx",
			"components/stat-card.tsx",
			"PRODUCT.md",
			"DESIGN.md",
		]) {
			expect(() => assertProjectFilePath(ok)).not.toThrow();
		}

		for (const bad of [
			"../evil.tsx",
			"/etc/passwd",
			"screens/../../evil.tsx",
			"screens/../rabisco.json",
			"rabisco.json",
			"chat.jsonl",
			"screens/sub/x.tsx",
			"screens\\x.tsx",
			"components/x.ts",
			"",
		]) {
			expect(() => assertProjectFilePath(bad)).toThrow();
		}
	});

	test("a bad path writes nothing", () => {
		const dir = tempDir();
		expect(() =>
			writeProjectFiles(dir, [
				{ path: "screens/a.tsx", content: "a" },
				{ path: "../b.tsx", content: "b" },
			]),
		).toThrow();
		expect(existsSync(join(dir, "screens"))).toBe(false);
	});

	test("writes create folders and null deletes", () => {
		const dir = tempDir();
		writeProjectFiles(dir, [{ path: "components/card.tsx", content: "x" }]);
		expect(readFileSync(join(dir, "components/card.tsx"), "utf-8")).toBe("x");
		writeProjectFiles(dir, [
			{ path: "components/card.tsx", content: null },
			{ path: "screens/gone.tsx", content: null },
		]);
		expect(existsSync(join(dir, "components/card.tsx"))).toBe(false);
	});

	test("opening a plain folder creates rabisco.json and frames for its screens", () => {
		const dir = join(tempDir(), "My App.rabisco");
		mkdirSync(join(dir, "screens"), { recursive: true });
		writeFileSync(join(dir, "screens/home.tsx"), "export default () => null");
		writeFileSync(join(dir, "screens/Ignored.tsx"), "");
		writeFileSync(join(dir, "PRODUCT.md"), "# Product");
		writeFileSync(join(dir, "notes.txt"), "not a project file");
		writeFileSync(join(dir, "chat.jsonl"), '{"id":"1","role":"user","content":"hi","createdAt":"x"}\nnot json\n{}\n');

		const project = loadProject(dir);
		expect(project.canvas.name).toBe("My App");
		expect(project.canvas.frames.map((f) => f.file)).toEqual(["screens/home.tsx"]);
		expect(Object.keys(project.files).sort()).toEqual(["PRODUCT.md", "screens/home.tsx"]);
		expect(project.messages).toHaveLength(1);
		expect(JSON.parse(readFileSync(join(dir, "rabisco.json"), "utf-8")).frames).toHaveLength(1);
	});

	test("new projects start with the context templates, opened folders don't get them", () => {
		const parent = tempDir();
		const created = loadProject(createProjectFolder(parent, "Fresh", "mobile"));
		expect(created.files).toEqual({ "PRODUCT.md": PRODUCT_TEMPLATE, "DESIGN.md": DESIGN_TEMPLATE });

		const existing = join(parent, "existing");
		mkdirSync(existing);
		writeFileSync(join(existing, "DESIGN.md"), "# Mine");
		expect(loadProject(existing).files).toEqual({ "DESIGN.md": "# Mine" });
		expect(existsSync(join(existing, "PRODUCT.md"))).toBe(false);
	});

	test("rejects paths that aren't folders", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "file.txt"), "");
		expect(() => loadProject(join(dir, "file.txt"))).toThrow(/Not a folder/);
		expect(() => loadProject(join(dir, "nope"))).toThrow(/not found/);
	});

	test("old rabisco.json without comments loads; malformed comments are dropped", () => {
		const old = {
			version: 1,
			name: "Old",
			device: "mobile",
			createdAt: "a",
			updatedAt: "b",
			frames: [],
			selection: [],
			alternates: [],
		};

		expect(normalizeCanvas(old, "x").comments).toEqual([]);

		const withComments = {
			...old,
			comments: [
				{ id: "1", x: 1, y: 2, text: "Hi", createdAt: "t" },
				{ id: "2", text: "no position" },
			],
		};

		expect(normalizeCanvas(withComments, "x").comments).toEqual([{ id: "1", x: 1, y: 2, text: "Hi", createdAt: "t" }]);
	});

	test("comments round-trip through rabisco.json and survive a screen deleted on disk", () => {
		const dir = createProjectFolder(tempDir(), "Pins", "mobile");
		writeProjectFiles(dir, [{ path: "screens/home.tsx", content: "export default () => null" }]);
		const first = loadProject(dir);
		const frame = first.canvas.frames[0]!;
		const comments = [{ id: "c", file: frame.file, x: 10, y: 20, text: "Bigger title", createdAt: "t" }];
		writeFileSync(join(dir, "rabisco.json"), JSON.stringify({ ...first.canvas, comments }));
		expect(loadProject(dir).canvas.comments).toEqual(comments);
		writeProjectFiles(dir, [{ path: "screens/home.tsx", content: null }]);
		expect(loadProject(dir).canvas.comments).toEqual([
			{ id: "c", x: frame.x + 10, y: frame.y + 20, text: "Bigger title", createdAt: "t" },
		]);
	});

	test("chat parsing skips bad lines", () => {
		expect(parseChat('\n{"id":"a","role":"assistant","content":"x","createdAt":"t"}\n{"id":1}\n[')).toHaveLength(1);
	});

	test("attached images are kept in attachments/ and load back with the chat", () => {
		const dir = createProjectFolder(tempDir(), "Pics", "mobile");

		const png = {
			name: "sketch.png",
			mediaType: "image/png" as const,
			data: Buffer.from("png bytes").toString("base64"),
		};

		appendChat(dir, [
			{ id: "m1", role: "user", content: "Like this", createdAt: "t", attachments: [png] },
			{ id: "m2", role: "assistant", content: "Done", createdAt: "t" },
		]);

		expect(readFileSync(join(dir, "attachments/m1-0.png"), "utf-8")).toBe("png bytes");
		const stored = readFileSync(join(dir, "chat.jsonl"), "utf-8");
		expect(stored).not.toContain(png.data);
		expect(stored).toContain('"path":"attachments/m1-0.png"');
		expect(loadProject(dir).messages.map((m) => m.attachments)).toEqual([[png], undefined]);
		// The AI history reads the chat without the images
		expect(parseChat(stored)[0]!.attachments).toBeUndefined();
	});

	test("missing or unsafe attachment paths are dropped", () => {
		const line = (path: string) =>
			JSON.stringify({
				id: "m",
				role: "user",
				content: "x",
				createdAt: "t",
				attachments: [{ name: "a.png", mediaType: "image/png", path }],
			});

		const read = (path: string) => (path === "attachments/m-0.png" ? "AA==" : "BB==");

		expect(parseChat(line("../secret.png"), read)[0]!.attachments).toBeUndefined();
		expect(parseChat(line("attachments/m-0.png"), read)[0]!.attachments).toEqual([
			{ name: "a.png", mediaType: "image/png", data: "AA==" },
		]);
		expect(parseChat(line("attachments/gone.png"), () => null)[0]!.attachments).toBeUndefined();
	});

	test("new project folders get a free name", () => {
		const parent = tempDir();
		expect(freeProjectDir(parent, "My App")).toBe(join(parent, "my-app.rabisco"));
		mkdirSync(join(parent, "my-app.rabisco"));
		expect(freeProjectDir(parent, "My App")).toBe(join(parent, "my-app-2.rabisco"));
		expect(freeProjectDir(parent, "???")).toBe(join(parent, "untitled.rabisco"));
	});
});

describe("project store", () => {
	let store: ProjectStore | null = null;
	afterEach(() => store?.closeAll());

	function setup(poll = false) {
		const root = tempDir();
		const events: { path: string; changes: FileChange[] }[] = [];
		const trashed: string[] = [];
		store = createProjectStore({
			documentsDir: join(root, "Documents"),
			userDataDir: join(root, "userData"),
			moveToTrash: (path) => {
				trashed.push(path);
				renameSync(path, `${path}.trashed`);

				return true;
			},
			showItemInFolder: () => {},
			pickFolder: async () => [""],
			onFilesChanged: (path, changes) => events.push({ path, changes }),
			watchOptions: { poll, pollMs: 40, debounceMs: 20 },
		});

		return { store, root, events, trashed };
	}

	const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

	test("create, list, remove and delete", async () => {
		const { store, root, trashed } = setup();
		const a = store.createProject("Alpha", "desktop");
		expect(a.path).toBe(join(root, "Documents/Rabisco/alpha.rabisco"));
		expect(a.canvas.device).toBe("desktop");
		expect(Object.keys(a.files).sort()).toEqual(["DESIGN.md", "PRODUCT.md"]);
		await settle(5);
		const b = store.createProject("Beta", "mobile");
		store.writeFiles(b.path, [
			{ path: "screens/home.tsx", content: "home" },
			{ path: "components/card.tsx", content: "card" },
		]);
		store.saveCanvas(b.path, loadProject(b.path).canvas);

		const recents = store.listRecents();
		expect(recents.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
		expect(recents[0]!.cover).toMatchObject({
			entry: "screens/home.tsx",
			files: { "screens/home.tsx": "home", "components/card.tsx": "card", "DESIGN.md": DESIGN_TEMPLATE },
		});
		// The cover carries DESIGN.md for its theme, not PRODUCT.md
		expect(Object.keys(recents[0]!.cover!.files).sort()).toEqual([
			"DESIGN.md",
			"components/card.tsx",
			"screens/home.tsx",
		]);

		renameSync(a.path, `${a.path}.moved`);
		expect(store.listRecents()[1]).toMatchObject({ name: "alpha", missing: true });
		store.removeRecent(a.path);
		expect(store.listRecents()).toHaveLength(1);

		store.deleteProject(b.path);
		expect(trashed).toEqual([b.path]);
		expect(store.listRecents()).toEqual([]);
		expect(await store.pickProjectFolder()).toBeNull();
	});

	test("writes require a Rabisco project folder", () => {
		const { store, root } = setup();
		expect(() => store.writeFiles(root, [{ path: "PRODUCT.md", content: "x" }])).toThrow(/not a Rabisco project/);
		expect(() => store.deleteProject(root)).toThrow(/not a Rabisco project/);
	});

	test("appends chat lines", () => {
		const { store } = setup();
		const p = store.createProject("Chat", "mobile");
		const message = { id: "1", role: "user" as const, content: "hi", createdAt: "t" };
		store.appendMessages(p.path, [message]);
		store.appendMessages(p.path, [{ ...message, id: "2" }]);
		expect(store.openProject(p.path).messages.map((m) => m.id)).toEqual(["1", "2"]);
	});

	for (const poll of [false, true]) {
		test(`external edits are pushed, own writes are not (${poll ? "polling" : "fs.watch"})`, async () => {
			const { store, events } = setup(poll);
			const p = store.createProject("Watch", "mobile");
			store.writeFiles(p.path, [{ path: "screens/home.tsx", content: "v1" }]);
			store.saveCanvas(p.path, p.canvas);
			await settle();
			expect(events).toEqual([]);

			writeFileSync(join(p.path, "screens/home.tsx"), "v2");
			writeFileSync(join(p.path, "DESIGN.md"), "# Design");
			writeFileSync(join(p.path, "notes.txt"), "ignored");
			await settle();
			const changes = events.flatMap((e) => e.changes);
			expect(events.every((e) => e.path === p.path)).toBe(true);
			expect(changes).toContainEqual({ path: "screens/home.tsx", content: "v2" });
			expect(changes).toContainEqual({ path: "DESIGN.md", content: "# Design" });
			expect(changes).toHaveLength(2);

			events.length = 0;
			writeFileSync(join(p.path, "screens/home.tsx"), "v2");
			await settle();
			expect(events).toEqual([]);

			store.closeProject(p.path);
			writeFileSync(join(p.path, "screens/home.tsx"), "v3");
			await settle();
			expect(events).toEqual([]);
		});
	}
});
