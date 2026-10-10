import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { componentName, legacyHtmlToTsx, migrateLegacyProjects, splitHtmlDocument } from "./migrate";
import { loadProject } from "./project-folder";
import { compileTsx, renderScreen, tempDir } from "./test-utils";

const LEGACY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
.btn{color:#fff}</style></head><body><div class="btn">Get "started" \`now\` \${x} </script></div><p>Café</p></body></html>`;

describe("legacy HTML → TSX", () => {
	test("splits styles and body", () => {
		const { css, markup } = splitHtmlDocument(LEGACY_HTML);
		expect(css).toContain(".btn{color:#fff}");
		expect(markup.startsWith('<div class="btn">')).toBe(true);
		expect(markup).not.toContain("<body");
	});

	test("handles fragments without a body", () => {
		expect(splitHtmlDocument("<style>a{}</style><p>Hi</p>")).toEqual({ css: "a{}", markup: "<p>Hi</p>" });
	});

	test("component names are valid identifiers", () => {
		expect(componentName("order history")).toBe("OrderHistory");
		expect(componentName("2fa setup")).toBe("Screen2faSetup");
		expect(componentName("Ação")).toBe("Acao");
	});

	test("renders the old HTML faithfully", () => {
		const source = legacyHtmlToTsx(LEGACY_HTML, "Welcome");
		expect(() => compileTsx(source)).not.toThrow();
		expect(source).toContain("export default function Welcome()");
		const html = renderScreen(source);
		expect(html).toContain(".btn{color:#fff}");
		expect(html).toContain(
			'<div class="relative h-full overflow-hidden"><div class="btn">Get "started" `now` ${x} </script></div><p>Café</p></div>',
		);
	});
});

describe("migrateLegacyProjects", () => {
	function setup() {
		const root = tempDir();
		const legacyDir = join(root, "userData/projects");
		const projectsDir = join(root, "Documents/Rabisco");
		mkdirSync(legacyDir, { recursive: true });

		const legacy = {
			id: "abc",
			name: "Fitness App",
			device: "mobile",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-02-01T00:00:00.000Z",
			screens: [
				{ id: "1", name: "Welcome", device: "mobile", x: 0, y: 0, width: 390, height: 844, html: LEGACY_HTML },
				{ id: "2", name: "Welcome", device: "mobile", x: 510, y: 40, width: 390, height: 844, html: "<p>2</p>" },
			],
			messages: [{ id: "m1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z" }, { broken: true }],
		};

		writeFileSync(join(legacyDir, "abc.json"), JSON.stringify(legacy));
		writeFileSync(join(legacyDir, "bad.json"), "{not json");

		return { legacyDir, projectsDir };
	}

	test("migrates each project into a folder, once", () => {
		const { legacyDir, projectsDir } = setup();
		const migrated = migrateLegacyProjects(legacyDir, projectsDir);
		expect(migrated).toEqual([
			{ path: join(projectsDir, "fitness-app.rabisco"), openedAt: "2026-02-01T00:00:00.000Z" },
		]);

		const project = loadProject(migrated[0]!.path);
		expect(project.canvas.name).toBe("Fitness App");
		expect(project.canvas.frames.map((f) => [f.file, f.x, f.y])).toEqual([
			["screens/welcome.tsx", 0, 0],
			["screens/welcome-2.tsx", 510, 40],
		]);
		expect(Object.keys(project.files).sort()).toEqual(["screens/welcome-2.tsx", "screens/welcome.tsx"]);
		expect(project.messages.map((m) => m.id)).toEqual(["m1"]);

		expect(readdirSync(legacyDir).sort()).toEqual(["abc.json.migrated", "bad.json"]);
		expect(migrateLegacyProjects(legacyDir, projectsDir)).toEqual([]);
		expect(readdirSync(projectsDir)).toEqual(["fitness-app.rabisco"]);
	});

	test("a missing legacy dir is a no-op", () => {
		expect(migrateLegacyProjects("/nonexistent/rabisco", "/nonexistent/out")).toEqual([]);
	});

	test("rabisco.json holds no code", () => {
		const { legacyDir, projectsDir } = setup();
		const [entry] = migrateLegacyProjects(legacyDir, projectsDir);
		const json = readFileSync(join(entry!.path, "rabisco.json"), "utf-8");
		expect(json).not.toContain("<div");
		expect(json).toContain('\t"frames"');
		expect(readdirSync(join(entry!.path, "chats"))).toHaveLength(1);
	});
});
