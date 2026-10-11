import { describe, expect, test } from "bun:test";
import { canUndo } from "./history";
import { createProjectSession, type ProjectApi } from "./project-session";
import { emptyCanvas } from "../../shared/project";
import type { SavedHistory } from "../../shared/saved-history";
import type { CanvasDoc, ProjectFiles } from "../../shared/types";

const PATH = "/p/saved";

const ok = { ok: true } as const;

type Disk = { canvas: CanvasDoc; files: ProjectFiles };

function diskApi() {
	const disk: Disk = { canvas: emptyCanvas("Saved", "mobile"), files: { "DESIGN.md": "# Design\n" } };

	const histories: SavedHistory[] = [];
	const backups: Disk[] = [];

	const api: ProjectApi = {
		async openProject({ path }) {
			return { path, canvas: disk.canvas, files: disk.files, chatId: "chat-1", messages: [], chats: [] };
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

	return { api, disk, histories, backups };
}

async function opened(api: ProjectApi, onBackup?: (dir: string) => void) {
	const session = createProjectSession({
		path: PATH,
		api,
		onSaveError: (cause) => {
			throw cause;
		},
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

	test("a canvas changed while closed starts history again and backs up the old state", async () => {
		const { api, disk, backups } = diskApi();
		const first = await opened(api);

		first.setMeta({ name: "Mine" });
		await first.flushCanvas();
		first.close();
		await settle();

		disk.canvas = { ...disk.canvas, name: "Theirs" };
		const shown: string[] = [];
		const second = await opened(api, (dir) => shown.push(dir));

		await settle();
		expect(second.state()!.canvas.name).toBe("Theirs");
		expect(canUndo(second.state()!.history)).toBe(false);
		expect(backups.map((backup) => backup.canvas.name)).toEqual(["Mine"]);
		expect(shown).toEqual(["/backups/1"]);
	});

	test("a reload keeps history when only files changed and backs up when it must clear it", async () => {
		const { api, disk, backups } = diskApi();
		const session = await opened(api);

		session.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "PRODUCT.md": "# Product\n" } }));
		await session.flushCanvas();

		disk.files = { ...disk.files, "DESIGN.md": "# Pulled\n" };
		const kept = await session.reloadFromDisk();

		expect(kept?.hadHistory).toBe(false);
		expect(kept?.backup).toBeNull();
		expect(canUndo(session.state()!.history)).toBe(true);

		disk.canvas = { ...disk.canvas, name: "Pulled" };
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
