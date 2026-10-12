import { describe, expect, test } from "bun:test";
import { canUndo } from "./history";
import { removeImage } from "./moodboard";
import { createProjectSession, type ProjectApi } from "./project-session";
import type { AssetDigests } from "../../shared/assets";
import { emptyCanvas } from "../../shared/project";
import type { SavedHistory } from "../../shared/saved-history";
import type { CanvasDoc, ProjectFiles } from "../../shared/types";

const PATH = "/p/saved";

const ok = { ok: true } as const;

type Disk = { canvas: CanvasDoc; files: ProjectFiles; assets: AssetDigests };

type Backup = { canvas: CanvasDoc; files: ProjectFiles };

const IMAGE = { id: "img-1", src: "/moodboard/cat.png", name: "cat.png", x: 0, y: 0, width: 100, height: 100 };

function diskApi() {
	const disk: Disk = { canvas: emptyCanvas("Saved", "mobile"), files: { "DESIGN.md": "# Design\n" }, assets: {} };
	const stash = new Set<string>();

	const histories: SavedHistory[] = [];
	const backups: Backup[] = [];

	const api: ProjectApi = {
		async openProject({ path }) {
			const { canvas, files, assets: assetDigests } = disk;

			return { path, canvas, files, assetDigests, chatId: "chat-1", messages: [], chats: [] };
		},
		async writeAssets({ writes }) {
			const assets = { ...disk.assets };
			const missing: string[] = [];

			for (const { src, digest } of writes) {
				const current = assets[src];

				if (current) stash.add(current);

				if (digest === null) delete assets[src];
				else if (stash.has(digest)) assets[src] = digest;
				else missing.push(src);
			}

			disk.assets = assets;

			return { missing };
		},
		async writeFiles({ changes }) {
			const files = { ...disk.files };

			for (const change of changes) {
				if (change.content === null) delete files[change.path];
				else files[change.path] = change.content;
			}

			disk.files = files;

			return ok;
		},
		async saveCanvas({ canvas }) {
			disk.canvas = JSON.parse(JSON.stringify(canvas));

			return ok;
		},
		async appendMessages() {
			return ok;
		},
		async openChat() {
			return [];
		},
		async deleteChat() {
			return ok;
		},
		async readHistory() {
			const saved = histories.at(-1);

			return saved ? JSON.parse(JSON.stringify(saved)) : null;
		},
		async writeHistory({ history }) {
			histories.push(history);

			return ok;
		},
		async backupProject({ files, canvas }) {
			backups.push({ files, canvas });

			return { dir: `/backups/${backups.length}` };
		},
	};

	return { api, disk, stash, histories, backups };
}

async function opened(
	api: ProjectApi,
	onBackup?: (dir: string) => void,
	onSaveError: (cause: unknown) => void = (cause) => {
		throw cause;
	},
) {
	const session = createProjectSession({
		path: PATH,
		api,
		onSaveError,
		onBackup,
		writeDelay: 1,
		saveDelay: 1,
		historyDelay: 1,
	});

	await session.load();

	return session;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("history across sessions", () => {
	test("undo works after the project is closed and opened again", async () => {
		const { api } = diskApi();
		const first = await opened(api);

		first.setMeta({ name: "Renamed" });
		first.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "DESIGN.md": "# Blue\n" } }));
		await first.flushCanvas();
		first.close();
		await settle();

		const second = await opened(api);

		expect(canUndo(second.state()!.history)).toBe(true);
		second.undo();
		expect(second.state()!.files["DESIGN.md"]).toBe("# Design\n");
		second.undo();
		expect(second.state()!.canvas.name).toBe("Saved");
	});

	test("history is written after a pause, not on every change", async () => {
		const { api, histories } = diskApi();
		const session = await opened(api);

		for (let i = 0; i < 5; i++) session.setMeta({ name: `Name ${i}` });

		expect(histories).toHaveLength(0);
		await settle();
		expect(histories).toHaveLength(1);
		await session.flushHistory();
		expect(histories).toHaveLength(1);
	});

	test("a canvas changed while closed is rebased, so undo still reaches the edits made before", async () => {
		const { api, disk, backups } = diskApi();
		const first = await opened(api);

		first.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "DESIGN.md": "# Blue\n" } }));
		first.setMeta({ name: "Mine" });
		await first.flushCanvas();
		first.close();
		await settle();

		disk.canvas = { ...disk.canvas, name: "Theirs" };
		const shown: string[] = [];
		const second = await opened(api, (dir) => shown.push(dir));

		await settle();
		expect(second.state()!.canvas.name).toBe("Theirs");
		second.undo();
		second.undo();
		expect(second.state()!.files["DESIGN.md"]).toBe("# Design\n");
		expect(second.state()!.canvas.name).toBe("Theirs");
		expect(backups).toEqual([]);
		expect(shown).toEqual([]);
	});

	test("a canvas change the rebase can't reproduce starts history again and backs up the old state", async () => {
		const { api, disk, backups } = diskApi();

		disk.files = { ...disk.files, "screens/a.tsx": "a", "screens/b.tsx": "b" };
		const first = await opened(api);

		first.setMeta({ name: "Mine" });
		await first.flushCanvas();
		first.close();
		await settle();

		disk.canvas = { ...disk.canvas, frames: [...disk.canvas.frames].reverse() };
		const shown: string[] = [];
		const second = await opened(api, (dir) => shown.push(dir));

		await settle();
		expect(second.state()!.canvas.frames.map((frame) => frame.file)).toEqual(["screens/b.tsx", "screens/a.tsx"]);
		expect(canUndo(second.state()!.history)).toBe(false);
		expect(backups.map((backup) => backup.canvas.frames.map((frame) => frame.file))).toEqual([
			["screens/a.tsx", "screens/b.tsx"],
		]);
		expect(shown).toEqual(["/backups/1"]);
	});

	test("a reload keeps history when it can rebase and backs up when it must clear it", async () => {
		const { api, disk, backups } = diskApi();

		disk.files = { ...disk.files, "screens/a.tsx": "a", "screens/b.tsx": "b" };
		const session = await opened(api);

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "PRODUCT.md": "# Product\n" } }));
		await session.flushCanvas();

		disk.files = { ...disk.files, "DESIGN.md": "# Pulled\n" };
		disk.canvas = { ...disk.canvas, name: "Pulled" };
		const kept = await session.reloadFromDisk();

		expect(kept?.hadHistory).toBe(false);
		expect(kept?.backup).toBeNull();
		expect(canUndo(session.state()!.history)).toBe(true);

		disk.canvas = { ...disk.canvas, frames: [...disk.canvas.frames].reverse() };
		const cleared = await session.reloadFromDisk();

		expect(cleared?.hadHistory).toBe(true);
		expect(cleared?.backup).toBe("/backups/1");
		expect(backups[0]!.files["PRODUCT.md"]).toBe("# Product\n");
		expect(canUndo(session.state()!.history)).toBe(false);
	});

	test("opening reports the backup a migration made", async () => {
		const { api } = diskApi();
		const shown: string[] = [];

		const withBackup: ProjectApi = {
			...api,
			openProject: async (params) => ({ ...(await api.openProject(params)), backup: "/backups/migration" }),
		};

		await opened(withBackup, (dir) => shown.push(dir));
		expect(shown).toEqual(["/backups/migration"]);
	});
});

describe("images in history", () => {
	const withImage = (disk: Disk) => {
		disk.canvas = { ...disk.canvas, images: [IMAGE] };
		disk.assets = { [IMAGE.src]: "a".repeat(32) };
	};

	test("deleting a moodboard image removes its file, and undo brings it back after a reopen", async () => {
		const { api, disk } = diskApi();

		withImage(disk);
		const first = await opened(api);

		first.change((snapshot) => removeImage(snapshot, IMAGE.id));
		await first.flushCanvas();
		expect(disk.assets).toEqual({});
		expect(disk.canvas.images).toEqual([]);
		first.close();
		await settle();

		const second = await opened(api);

		second.undo();
		await second.flushCanvas();
		expect(disk.assets).toEqual({ [IMAGE.src]: "a".repeat(32) });
		expect(disk.canvas.images).toEqual([IMAGE]);
	});

	test("an image a screen still uses keeps its file", async () => {
		const { api, disk } = diskApi();

		withImage(disk);
		disk.files = { ...disk.files, "screens/home.tsx": `<img src="${IMAGE.src}" />` };
		const session = await opened(api);

		session.change((snapshot) => removeImage(snapshot, IMAGE.id));
		await session.flushCanvas();
		expect(disk.assets).toEqual({ [IMAGE.src]: "a".repeat(32) });
	});

	test("an image changed outside Rabisco is folded in, so undo doesn't revert it", async () => {
		const { api, disk } = diskApi();
		const session = await opened(api);

		session.setMeta({ name: "Mine" });
		disk.assets = { "/images/logo.png": "b".repeat(32) };
		session.assetsChanged([{ src: "/images/logo.png", data: "AAAA", digest: "b".repeat(32) }]);
		session.undo();
		await session.flushCanvas();
		expect(session.state()!.history.present.assets).toEqual({ "/images/logo.png": "b".repeat(32) });
		expect(disk.assets).toEqual({ "/images/logo.png": "b".repeat(32) });
	});

	test("an image with no saved copy left is dropped from history and reported once", async () => {
		const { api, disk, stash } = diskApi();
		const errors: string[] = [];

		withImage(disk);
		const session = await opened(api, undefined, (cause) => errors.push(String(cause)));

		session.change((snapshot) => removeImage(snapshot, IMAGE.id));
		await session.flushCanvas();
		stash.clear();
		session.undo();
		await session.flushCanvas();
		await session.flushCanvas();
		expect(errors).toEqual([`Error: Couldn't bring back ${IMAGE.src}: no saved copy is left.`]);
		expect(session.state()!.history.present.assets).toEqual({});
		expect(disk.canvas.images).toEqual([IMAGE]);
	});
});
