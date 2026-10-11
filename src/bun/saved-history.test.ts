import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { commit, createHistory, type Snapshot } from "../mainview/lib/history";
import { packHistory, resumeHistory, unpackHistory } from "../mainview/lib/saved-history";
import { emptyCanvas } from "../shared/project";
import type { SavedHistory } from "../shared/saved-history";
import { CANVAS_FILE, createProjectFolder, loadProject, writeCanvas } from "./project-folder";
import {
	BACKUP_LIMIT,
	backupProject,
	backupsDir,
	historyFile,
	readSavedHistory,
	writeSavedHistory,
} from "./saved-history";
import { createProjectStore } from "./store";
import { tempDir } from "./test-utils";

const SCREEN = "export default function Home() {\n\treturn <main>Home</main>;\n}\n";

function projectWithScreen() {
	const dir = createProjectFolder(tempDir(), "Saved", "mobile");

	mkdirSync(join(dir, "screens"));
	writeFileSync(join(dir, "screens/home.tsx"), SCREEN);

	return dir;
}

function snapshotOf(dir: string): Snapshot {
	const { canvas, files } = loadProject(dir);

	return {
		frames: canvas.frames,
		files,
		comments: canvas.comments ?? [],
		theme: canvas.theme,
		name: canvas.name,
		device: canvas.device,
		locks: canvas.locks,
		sections: canvas.sections,
	};
}

type Saved = { saved: SavedHistory; disk: Snapshot };

function savedFor(dir: string): Saved {
	const disk = snapshotOf(dir);
	const edited = { ...disk, files: { ...disk.files, "screens/home.tsx": `${SCREEN}// edited\n` } };
	const history = commit(createHistory(disk), edited);

	return { saved: packHistory(history, [], new Date(0)), disk: edited };
}

describe("saved history on disk", () => {
	test("written history reads back for the same folder only", () => {
		const userData = tempDir();
		const dir = projectWithScreen();
		const { saved } = savedFor(dir);

		writeSavedHistory(userData, dir, saved);

		expect(readSavedHistory(userData, dir)).toEqual(saved);
		expect(readSavedHistory(userData, `${dir}-other`)).toBeNull();
		expect(historyFile(userData, dir).startsWith(join(userData, "history"))).toBe(true);
	});

	test("a saved history resumes against the canvas the folder holds", () => {
		const userData = tempDir();
		const dir = projectWithScreen();
		const { saved, disk } = savedFor(dir);

		writeSavedHistory(userData, dir, saved);
		writeFileSync(join(dir, "screens/home.tsx"), disk.files["screens/home.tsx"]!);
		const restored = unpackHistory(readSavedHistory(userData, dir)!);
		const resumed = resumeHistory(restored.history, snapshotOf(dir), (snapshot) => snapshot);

		expect(resumed.dropped).toBe(false);
		expect(resumed.history.past).toHaveLength(1);
	});

	test("a corrupt file, a bad file index or a path outside the project reads as none", () => {
		const userData = tempDir();
		const dir = projectWithScreen();
		const { saved } = savedFor(dir);
		const file = historyFile(userData, dir);

		mkdirSync(join(userData, "history"), { recursive: true });
		writeFileSync(file, "{ not json");
		expect(readSavedHistory(userData, dir)).toBeNull();

		writeSavedHistory(userData, dir, { ...saved, present: { ...saved.present, files: { "DESIGN.md": 99 } } });
		expect(readSavedHistory(userData, dir)).toBeNull();

		writeSavedHistory(userData, dir, { ...saved, present: { ...saved.present, files: { "../evil.tsx": 0 } } });
		expect(readSavedHistory(userData, dir)).toBeNull();
	});

	test("deleting a project forgets its history", () => {
		const userData = tempDir();
		const dir = projectWithScreen();

		const store = createProjectStore({
			documentsDir: tempDir(),
			userDataDir: userData,
			moveToTrash: () => true,
			showItemInFolder: () => {},
			pickFolder: async () => [],
			onFilesChanged: () => {},
		});

		store.openProject(dir);
		store.writeHistory(dir, savedFor(dir).saved);
		expect(store.readHistory(dir)).not.toBeNull();

		store.deleteProject(dir);
		store.closeAll();
		expect(existsSync(historyFile(userData, dir))).toBe(false);
	});
});

describe("project backups", () => {
	test("a backup copies the files, the canvas and the saved history", () => {
		const userData = tempDir();
		const dir = projectWithScreen();

		writeSavedHistory(userData, dir, savedFor(dir).saved);
		const backup = backupProject(userData, dir, "migration");

		expect(backup.startsWith(backupsDir(userData, dir))).toBe(true);
		expect(readFileSync(join(backup, "screens/home.tsx"), "utf-8")).toBe(SCREEN);
		expect(readFileSync(join(backup, CANVAS_FILE), "utf-8")).toBe(readFileSync(join(dir, CANVAS_FILE), "utf-8"));
		expect(existsSync(join(backup, "history.json"))).toBe(true);
	});

	test("a backup from the editor writes the state it was given", () => {
		const userData = tempDir();
		const dir = projectWithScreen();
		const canvas = { ...emptyCanvas("Before", "mobile"), frames: [] };
		const backup = backupProject(userData, dir, "reload", { files: { "DESIGN.md": "# Before\n" }, canvas });

		expect(readFileSync(join(backup, "DESIGN.md"), "utf-8")).toBe("# Before\n");
		expect(existsSync(join(backup, "screens/home.tsx"))).toBe(false);
		expect(JSON.parse(readFileSync(join(backup, CANVAS_FILE), "utf-8")).name).toBe("Before");
	});

	test(`only the newest ${BACKUP_LIMIT} backups are kept`, () => {
		const userData = tempDir();
		const dir = projectWithScreen();

		for (let i = 0; i < BACKUP_LIMIT + 3; i++) backupProject(userData, dir, "reload", undefined, new Date(i * 1000));
		const kept = readdirSync(backupsDir(userData, dir)).sort();

		expect(kept).toHaveLength(BACKUP_LIMIT);
		expect(kept[0]!.startsWith(new Date(3000).toISOString().slice(0, 19).replace(/:/g, "-"))).toBe(true);
	});

	test("opening backs up a project before a migration rewrites it", () => {
		const legacy = projectWithScreen();

		writeFileSync(join(legacy, "chat.jsonl"), "");
		const calls: string[] = [];
		const migrated = loadProject(legacy, () => (calls.push("legacy"), "/backup/legacy"));

		expect(migrated.backup).toBe("/backup/legacy");

		const dropped = projectWithScreen();
		const canvas = loadProject(dropped).canvas;

		writeCanvas(dropped, { ...canvas, frames: [...canvas.frames, { ...canvas.frames[0]!, file: "screens/gone.tsx" }] });
		loadProject(dropped, () => (calls.push("dropped"), "/backup/dropped"));

		const plain = loadProject(projectWithScreen(), () => (calls.push("plain"), "/backup/plain"));

		expect(calls).toEqual(["legacy", "dropped"]);
		expect(plain.backup).toBeUndefined();
	});

	test("the store keeps the migration backup in app data and says where", () => {
		const userData = tempDir();
		const dir = projectWithScreen();

		writeFileSync(join(dir, "chat.jsonl"), "");

		const store = createProjectStore({
			documentsDir: tempDir(),
			userDataDir: userData,
			moveToTrash: () => true,
			showItemInFolder: () => {},
			pickFolder: async () => [],
			onFilesChanged: () => {},
		});

		const project = store.openProject(dir);

		store.closeAll();
		expect(project.backup?.startsWith(backupsDir(userData, dir))).toBe(true);
		expect(existsSync(join(project.backup!, "chat.jsonl"))).toBe(true);
	});
});
