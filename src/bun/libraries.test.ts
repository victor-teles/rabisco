import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { LIBRARY_MARKER, libraryMarker, makeLibrary } from "../shared/libraries";
import { createLibraryStore } from "./libraries";
import { tempDir } from "./test-utils";

const CARD = "export function Card() {}\n";

function setup(picked: string[] = []) {
	const documentsDir = tempDir();
	const userDataDir = tempDir();
	const revealed: string[] = [];

	const store = createLibraryStore({
		documentsDir,
		userDataDir,
		pickFolder: async () => picked,
		showItemInFolder: (path) => revealed.push(path),
	});

	return { store, documentsDir, userDataDir, revealed };
}

function libraryFolder(id: string, name: string) {
	const dir = tempDir();
	mkdirSync(join(dir, "components"));
	writeFileSync(join(dir, LIBRARY_MARKER), libraryMarker(id, name));
	writeFileSync(join(dir, "DESIGN.md"), "## Tokens\n\n- color-brand: #e11d48\n");
	writeFileSync(join(dir, "components/card.tsx"), CARD);
	writeFileSync(join(dir, "components/notes.md"), "not a component");

	return dir;
}

describe("library store", () => {
	test("makes a library in Documents and lists it with its counts", () => {
		const { store, documentsDir } = setup();

		const made = makeLibrary(
			{ "DESIGN.md": "## Tokens\n\n- color-brand: #e11d48\n- radius-card: 12px\n", "components/card.tsx": CARD },
			"lib-1",
			"Acme UI",
		);

		const summary = store.createLibrary("Acme UI", made.library);

		expect(summary).toEqual({
			id: "lib-1",
			name: "Acme UI",
			path: join(documentsDir, "Rabisco", "Libraries", "acme-ui"),
			components: 1,
			tokens: 2,
		});
		expect(store.listLibraries()).toEqual([summary]);
		expect(store.createLibrary("Acme UI", makeLibrary({}, "lib-2", "Acme UI").library).path).toEndWith("acme-ui-2");
	});

	test("adds a picked folder and reads only its DESIGN.md and components", async () => {
		const dir = libraryFolder("lib-9", "Team kit");
		const { store, userDataDir } = setup([dir]);

		expect((await store.addLibraryFolder())?.name).toBe("Team kit");
		expect(JSON.parse(readFileSync(join(userDataDir, "libraries.json"), "utf-8"))).toEqual([dir]);
		expect(store.readLibrary("lib-9")?.files).toEqual({
			"DESIGN.md": "## Tokens\n\n- color-brand: #e11d48\n",
			"components/card.tsx": CARD,
		});
		expect(store.readLibrary("missing")).toBeNull();
	});

	test("refuses a folder that isn't a library", async () => {
		const { store } = setup([tempDir()]);

		await expect(store.addLibraryFolder()).rejects.toThrow("is not a Rabisco library");
	});

	test("writes and deletes components, but nothing outside the library's files", async () => {
		const dir = libraryFolder("lib-3", "Kit");
		const { store, revealed } = setup([dir]);
		await store.addLibraryFolder();

		const summary = store.writeLibrary("lib-3", [
			{ path: "components/button.tsx", content: "export function Button() {}\n" },
			{ path: "components/card.tsx", content: null },
		]);

		expect(summary.components).toBe(1);
		expect(existsSync(join(dir, "components/card.tsx"))).toBe(false);
		expect(() => store.writeLibrary("lib-3", [{ path: "../escape.tsx", content: "x" }])).toThrow();
		expect(() => store.writeLibrary("lib-3", [{ path: "screens/home.tsx", content: "x" }])).toThrow();
		expect(() => store.writeLibrary("lib-3", [{ path: LIBRARY_MARKER, content: "{}" }])).toThrow();
		expect(() => store.writeLibrary("other", [])).toThrow("isn't on this Mac");

		store.revealLibrary("lib-3");

		expect(revealed).toEqual([dir]);
	});
});
