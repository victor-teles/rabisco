import { describe, expect, test } from "bun:test";
import { designTokensOf } from "./context/tokens";
import {
	countStatus,
	keepMine,
	LIBRARY_FILE,
	LIBRARY_MARKER,
	libraryStatus,
	makeLibrary,
	parseLibraryLink,
	parseLibraryMarker,
	publishToLibrary,
	takeFromLibrary,
	unlinkLibrary,
	withDependencies,
	type LibraryContents,
} from "./libraries";
import type { ProjectFiles } from "./types";

const BUTTON = `export function Button() {\n\treturn <button className="bg-brand">Go</button>;\n}\n`;

const CARD = `export function Card() {\n\treturn <div className="rounded-card" />;\n}\n`;

const DESIGN = "# Acme\n\n## Tokens\n\n- color-brand: #e11d48\n- radius-card: 12px\n";

const library = (files: ProjectFiles = {}): LibraryContents => ({
	id: "lib-1",
	name: "Acme UI",
	files: { "DESIGN.md": DESIGN, "components/button.tsx": BUTTON, "components/card.tsx": CARD, ...files },
});

const keys = (changes: { key: string }[]) => changes.map((change) => change.key);

describe("using a library", () => {
	test("copies its components and tokens into an empty project and records the sync", () => {
		const project = takeFromLibrary({ "DESIGN.md": "# My app\n" }, library());

		expect(project["components/button.tsx"]).toBe(BUTTON);
		expect(project["components/card.tsx"]).toBe(CARD);
		expect(designTokensOf(project["DESIGN.md"]).light).toEqual({ "color-brand": "#e11d48", "radius-card": "12px" });
		expect(project["DESIGN.md"]!.startsWith("# My app")).toBe(true);

		const link = parseLibraryLink(project[LIBRARY_FILE])!;

		expect(link.id).toBe("lib-1");
		expect(Object.keys(link.files).sort()).toEqual(["components/button.tsx", "components/card.tsx"]);
		expect(link.tokens.light).toEqual({ "color-brand": "#e11d48", "radius-card": "12px" });
		expect(countStatus(libraryStatus(project, link, library()))).toBe(0);
	});

	test("keeps the project's own version of a component that differs, as a conflict", () => {
		const mine = `export function Button() {\n\treturn <button>Mine</button>;\n}\n`;
		const project = takeFromLibrary({ "components/button.tsx": mine }, library());
		const status = libraryStatus(project, parseLibraryLink(project[LIBRARY_FILE]), library());

		expect(project["components/button.tsx"]).toBe(mine);
		expect(keys(status.conflicts)).toEqual(["components/button.tsx"]);
	});

	test("lists project-only components and tokens as additions", () => {
		const project = takeFromLibrary(
			{
				"components/tab-bar.tsx": "export function TabBar() {}\n",
				"DESIGN.md": "## Tokens\n\n- color-highlight: #000\n",
			},
			library(),
		);

		const status = libraryStatus(project, parseLibraryLink(project[LIBRARY_FILE]), library());

		expect(keys(status.additions)).toEqual(["components/tab-bar.tsx", "token:light:color-highlight"]);
		expect(status.changes).toEqual([]);
	});
});

describe("three-way status", () => {
	const synced = () => takeFromLibrary({}, library());

	test("a library change is an update, a project change is a change to publish", () => {
		const project: ProjectFiles = { ...synced(), "components/card.tsx": `${CARD}// mine\n` };
		const changed = library({ "components/button.tsx": `${BUTTON}// theirs\n` });
		const status = libraryStatus(project, parseLibraryLink(project[LIBRARY_FILE]), changed);

		expect(keys(status.updates)).toEqual(["components/button.tsx"]);
		expect(keys(status.changes)).toEqual(["components/card.tsx"]);
		expect(status.conflicts).toEqual([]);
	});

	test("both sides changing a token differently is a conflict; to the same value is in sync", () => {
		const project = synced();
		const design = project["DESIGN.md"]!.replace("#e11d48", "#2563eb").replace("12px", "8px");
		const ours = { ...project, "DESIGN.md": design };
		const theirs = library({ "DESIGN.md": DESIGN.replace("#e11d48", "#16a34a").replace("12px", "8px") });
		const status = libraryStatus(ours, parseLibraryLink(project[LIBRARY_FILE]), theirs);

		expect(keys(status.conflicts)).toEqual(["token:light:color-brand"]);
		expect(countStatus(status)).toBe(1);
	});

	test("a component deleted here is a change; removed from the library is an update", () => {
		const project = synced();
		const ours = { ...project };
		delete ours["components/card.tsx"];
		const theirs = library();
		delete theirs.files["components/button.tsx"];
		const status = libraryStatus(ours, parseLibraryLink(project[LIBRARY_FILE]), theirs);

		expect(status.changes).toEqual([
			{
				key: "components/card.tsx",
				item: { kind: "file", path: "components/card.tsx" },
				project: undefined,
				library: CARD,
			},
		]);
		expect(keys(status.updates)).toEqual(["components/button.tsx"]);
	});
});

describe("updating", () => {
	test("takes every update, and keeps a component the library removed, unlinked", () => {
		const project = takeFromLibrary({}, library());
		const theirs = library({ "DESIGN.md": DESIGN.replace("#e11d48", "#16a34a") });
		delete theirs.files["components/card.tsx"];
		const updated = takeFromLibrary(project, theirs);
		const link = parseLibraryLink(updated[LIBRARY_FILE])!;

		expect(designTokensOf(updated["DESIGN.md"]).light["color-brand"]).toBe("#16a34a");
		expect(updated["components/card.tsx"]).toBe(CARD);
		expect(Object.keys(link.files)).toEqual(["components/button.tsx"]);
		expect(link.tokens.light["color-brand"]).toBe("#16a34a");
		expect(keys(libraryStatus(updated, link, theirs).additions)).toEqual(["components/card.tsx"]);
	});

	test("conflicts stay until picked: the library's version, or mine to publish", () => {
		const project = takeFromLibrary({}, library());
		const ours = { ...project, "components/button.tsx": "export function Button() { return null; }\n" };
		const theirs = library({ "components/button.tsx": `${BUTTON}// theirs\n` });

		expect(takeFromLibrary(ours, theirs)["components/button.tsx"]).toBe(ours["components/button.tsx"]);

		const taken = takeFromLibrary(ours, theirs, ["components/button.tsx"]);

		expect(taken["components/button.tsx"]).toBe(theirs.files["components/button.tsx"]);
		expect(countStatus(libraryStatus(taken, parseLibraryLink(taken[LIBRARY_FILE]), theirs))).toBe(0);

		const kept = keepMine(ours, theirs, ["components/button.tsx"]);
		const status = libraryStatus(kept, parseLibraryLink(kept[LIBRARY_FILE]), theirs);

		expect(kept["components/button.tsx"]).toBe(ours["components/button.tsx"]);
		expect(keys(status.changes)).toEqual(["components/button.tsx"]);
		expect(status.conflicts).toEqual([]);
	});
});

describe("publishing", () => {
	test("writes changed components and tokens into the library and marks them synced", () => {
		const project = takeFromLibrary({}, library());
		const design = project["DESIGN.md"]!.replace("#e11d48", "#2563eb");
		const ours = { ...project, "DESIGN.md": design, "components/card.tsx": `${CARD}// v2\n` };

		const { library: changes, project: next } = publishToLibrary(ours, library(), [
			"components/card.tsx",
			"token:light:color-brand",
		]);

		expect(changes.map((change) => change.path).sort()).toEqual(["DESIGN.md", "components/card.tsx"]);
		expect(designTokensOf(changes.find((change) => change.path === "DESIGN.md")!.content!).light["color-brand"]).toBe(
			"#2563eb",
		);

		const published: LibraryContents = { ...library(), files: { ...library().files } };

		for (const change of changes) published.files[change.path] = change.content!;

		expect(countStatus(libraryStatus(next, parseLibraryLink(next[LIBRARY_FILE]), published))).toBe(0);
	});

	test("adds a new component and deletes one removed here", () => {
		const project = takeFromLibrary({}, library());
		const ours: ProjectFiles = { ...project, "components/tab-bar.tsx": "export function TabBar() {}\n" };
		delete ours["components/card.tsx"];

		const { library: changes, project: next } = publishToLibrary(ours, library(), [
			"components/tab-bar.tsx",
			"components/card.tsx",
		]);

		expect(changes).toEqual([
			{ path: "components/card.tsx", content: null },
			{ path: "components/tab-bar.tsx", content: "export function TabBar() {}\n" },
		]);
		expect(Object.keys(parseLibraryLink(next[LIBRARY_FILE])!.files).sort()).toEqual([
			"components/button.tsx",
			"components/tab-bar.tsx",
		]);
	});

	test("brings the project components a published component imports", () => {
		const files: ProjectFiles = {
			"components/stat-card.tsx": `import { Card } from "./card";\nimport { Button } from "@/components/ui/button";\nexport function StatCard() {}\n`,
			"components/card.tsx": `import { Icon } from "../components/icon";\nexport function Card() {}\n`,
			"components/icon.tsx": "export function Icon() {}\n",
			"components/other.tsx": "export function Other() {}\n",
		};

		expect(withDependencies(files, ["components/stat-card.tsx"]).sort()).toEqual([
			"components/card.tsx",
			"components/icon.tsx",
			"components/stat-card.tsx",
		]);
	});
});

describe("making and unlinking", () => {
	test("a new library takes the project's components and tokens, and links the project", () => {
		const project: ProjectFiles = {
			"DESIGN.md": "# Mine\n\nProse that stays here.\n\n## Tokens\n\n- color-brand: #e11d48\n",
			"components/card.tsx": CARD,
			"screens/home.tsx": "export default function Home() {}\n",
		};

		const made = makeLibrary(project, "lib-2", "Mine UI");

		expect(Object.keys(made.library).sort()).toEqual(["DESIGN.md", "components/card.tsx", LIBRARY_MARKER]);
		expect(parseLibraryMarker(made.library[LIBRARY_MARKER])).toEqual({ id: "lib-2", name: "Mine UI" });
		expect(made.library["DESIGN.md"]).not.toContain("Prose that stays here");
		expect(designTokensOf(made.library["DESIGN.md"]).light).toEqual({ "color-brand": "#e11d48" });

		const link = parseLibraryLink(made.project[LIBRARY_FILE])!;

		expect(countStatus(libraryStatus(made.project, link, { id: "lib-2", name: "Mine UI", files: made.library }))).toBe(
			0,
		);
		expect(unlinkLibrary(made.project)[LIBRARY_FILE]).toBeUndefined();
	});

	test("ignores a library.json or marker that isn't one", () => {
		expect(parseLibraryLink("not json")).toBeNull();
		expect(parseLibraryLink(`{"id": 1}`)).toBeNull();
		expect(parseLibraryMarker(`{"id": "", "name": "x"}`)).toBeNull();
		expect(parseLibraryLink(`{"id": "a", "name": "b", "files": {"x": 2}}`)).toEqual({
			id: "a",
			name: "b",
			files: {},
			tokens: { light: {}, dark: {} },
		});
	});
});
