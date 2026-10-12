import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../shared/json";
import { NO_PROJECT, TOOLS, type ToolResult } from "../../shared/mcp/tools";
import { emptyCanvas } from "../../shared/project";
import type { CanvasDoc, Frame, ProjectFiles } from "../../shared/types";
import { runAgentTool, type AgentCheck, type AgentContext, type AgentElement } from "./agent-tools";
import { commit, createHistory, nextSnapshot, undo, type History } from "./history";

const HOME = `import { StatCard } from "../components/stat-card";

export default function Home() {
	return (
		<main className="p-6">
			<h1 className="text-2xl">Welcome</h1>
			<section>
				<StatCard label="Visits" value="12" />
				<button className="rounded">Continue</button>
			</section>
		</main>
	);
}
`;

const SETTINGS = `export default function Settings() {
	return <div className="p-4">Settings</div>;
}
`;

const STAT_CARD = `import { Badge } from "@/components/ui/badge";
import { format } from "./format";

export function StatCard({ label, value }: { label: string; value: string }) {
	return <div><Badge>{label}</Badge>{format(value)}</div>;
}
`;

const DESIGN = `# Design

## Tokens

- primary: #2563eb
`;

const FILES: ProjectFiles = {
	"screens/home.tsx": HOME,
	"screens/settings.tsx": SETTINGS,
	"components/stat-card.tsx": STAT_CARD,
	"components/format.ts": "export const format = (value: string) => value;\n",
	"DESIGN.md": DESIGN,
	"PRODUCT.md": "# Product\n",
};

const frame = (file: string, name: string, x: number): Frame => ({
	file,
	name,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
});

function canvasOf(selection: string[]): CanvasDoc {
	const canvas = emptyCanvas("Demo", "mobile");

	return {
		...canvas,
		frames: [frame("screens/home.tsx", "Home", 0), frame("screens/settings.tsx", "Settings", 500)],
		selection,
		sections: [{ id: "s1", name: "Onboarding", color: "blue", x: -40, y: -40, width: 480, height: 940 }],
		comments: [
			{ id: "c1", file: "screens/home.tsx", x: 20, y: 30, text: "Bigger title", createdAt: "2026-10-01T00:00:00Z" },
			{ id: "c2", x: 900, y: 900, text: "Add a profile screen", createdAt: "2026-10-02T00:00:00Z" },
			{
				id: "c3",
				file: "screens/home.tsx",
				x: 1,
				y: 1,
				text: "Done",
				createdAt: "2026-10-03T00:00:00Z",
				resolved: true,
			},
		],
	};
}

const startOf = (text: string) => HOME.indexOf(text);

type Shot = { file: string; start: number | null };

function contextOf(overrides: Partial<AgentContext> = {}) {
	const shots: Shot[] = [];

	const context: AgentContext = {
		path: "/projects/demo.rabisco",
		canvas: canvasOf(["screens/home.tsx"]),
		files: FILES,
		elements: [{ file: "screens/home.tsx", start: startOf("<button") }],
		gitStatus: async () => ({ state: "none" }),
		screenshot: async (target, start) => {
			shots.push({ file: target.file, start });

			return "iVBORw0KGgo=";
		},
		elementAt: async (file): Promise<AgentElement | null> => ({ file, start: startOf("<h1") }),
		elementBox: async () => ({ x: 24, y: 40, width: 200, height: 32 }),
		change: () => {},
		step: "agent:call-1",
		busy: () => false,
		checkDesign: async (frames): Promise<AgentCheck[]> => frames.map((target) => ({ file: target.file, findings: [] })),
		exportWebsite: async (dir) => `${dir}/demo-site`,
		...overrides,
	};

	return { context, shots };
}

const call = (tool: string, args: JsonObject = {}, overrides: Partial<AgentContext> = {}) =>
	runAgentTool(tool, args, contextOf(overrides).context);

function json(result: ToolResult) {
	expect(result.isError).toBeUndefined();
	const [first] = result.content;

	if (first?.type !== "text") throw new Error("Expected text");

	return JSON.parse(first.text);
}

function error(result: ToolResult) {
	expect(result.isError).toBe(true);
	const [first] = result.content;

	return first?.type === "text" ? first.text : "";
}

describe("runAgentTool", () => {
	test("has a runner for every listed tool", async () => {
		// The app opens projects itself, with or without an editor (agent-open.ts)
		for (const tool of TOOLS.filter((each) => each.name !== "open_project")) {
			const [first] = (await call(tool.name)).content;

			expect(first?.type === "text" ? first.text : "").not.toContain("has no tool");
		}
	});

	test("says no project is open without an editor", async () => {
		expect(error(await runAgentTool("get_project", {}, null))).toBe(NO_PROJECT);
		expect(error(await call("rename_everything"))).toBe("Rabisco has no tool `rename_everything`.");
	});

	test("get_project", async () => {
		expect(
			json(await call("get_project", {}, { gitStatus: async () => ({ state: "unavailable", error: "x" }) })),
		).toEqual({
			name: "Demo",
			path: "/projects/demo.rabisco",
			device: "mobile",
			devices: ["mobile"],
			git: false,
			screens: [
				{
					file: "screens/home.tsx",
					name: "Home",
					device: "mobile",
					width: 390,
					height: 844,
					section: "Onboarding",
					alternate: false,
				},
				{
					file: "screens/settings.tsx",
					name: "Settings",
					device: "mobile",
					width: 390,
					height: 844,
					section: null,
					alternate: false,
				},
			],
			components: ["components/stat-card.tsx"],
			sections: ["Onboarding"],
			contextFiles: ["PRODUCT.md", "DESIGN.md"],
		});
	});

	test("get_selection names elements by path and line", async () => {
		expect(json(await call("get_selection"))).toEqual({
			screens: [{ file: "screens/home.tsx", name: "Home" }],
			elements: [{ file: "screens/home.tsx", path: "0.1.1", line: 9, label: "button", hint: "“Continue”" }],
		});

		expect(json(await call("get_selection", {}, { canvas: canvasOf([]), elements: [] }))).toEqual({
			screens: [],
			elements: [],
		});
	});

	test("get_screen returns the selected screen with the project files it imports", async () => {
		expect(json(await call("get_screen"))).toEqual({
			file: "screens/home.tsx",
			source: HOME,
			imports: [
				{ file: "components/format.ts", source: FILES["components/format.ts"] },
				{ file: "components/stat-card.tsx", source: STAT_CARD },
			],
		});
	});

	test("get_screen finds a screen by file, name or component", async () => {
		expect(json(await call("get_screen", { screen: "settings" })).file).toBe("screens/settings.tsx");
		expect(json(await call("get_screen", { screen: "Settings" })).file).toBe("screens/settings.tsx");
		expect(json(await call("get_screen", { screen: "screens/settings.tsx" })).file).toBe("screens/settings.tsx");
		expect(json(await call("get_screen", { screen: "components/stat-card.tsx" })).file).toBe(
			"components/stat-card.tsx",
		);
		expect(error(await call("get_screen", { screen: "../secrets" }))).toContain("There is no screen or component");
		expect(error(await call("get_screen", { screen: "DESIGN.md" }))).toContain("There is no screen or component");
		expect(error(await call("get_screen", { screen: 3 }))).toBe("`screen` must be a string.");
		expect(error(await call("get_screen", {}, { canvas: canvasOf([]) }))).toContain("No screen is selected");
	});

	test("get_element_tree", async () => {
		const tree = json(await call("get_element_tree", { screen: "home" }));

		expect(tree.file).toBe("screens/home.tsx");
		expect(tree.elements).toHaveLength(1);
		const [main] = tree.elements;

		expect(main).toMatchObject({ path: "0", line: 5, label: "main", kind: "intrinsic" });
		expect(main.children.map((child: { label: string }) => child.label)).toEqual(["h1", "section"]);
		expect(main.children[1].children).toMatchObject([
			{ path: "0.1.0", label: "StatCard", kind: "component" },
			{ path: "0.1.1", label: "button", hint: "“Continue”" },
		]);

		const broken = { ...FILES, "screens/home.tsx": "export default function Home() { return <div>; }" };
		expect(error(await call("get_element_tree", {}, { files: broken }))).toContain("doesn't parse");
	});

	test("get_screenshot of a screen or one element", async () => {
		const { context, shots } = contextOf();
		const screen = await runAgentTool("get_screenshot", {}, context);

		expect(screen.content).toEqual([
			{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
			{ type: "text", text: "Home (screens/home.tsx)" },
		]);

		const element = await runAgentTool("get_screenshot", { screen: "home", element: "0.1.1" }, context);
		expect(element.content[1]).toEqual({ type: "text", text: "Element 0.1.1 of Home (screens/home.tsx)" });
		expect(shots).toEqual([
			{ file: "screens/home.tsx", start: null },
			{ file: "screens/home.tsx", start: startOf("<button") },
		]);

		expect(error(await runAgentTool("get_screenshot", { element: "0.9" }, context))).toContain("has no element");
		expect(error(await runAgentTool("get_screenshot", { element: "../x" }, context))).toContain(
			"isn't an element path",
		);
		expect(error(await runAgentTool("get_screenshot", { screen: "stat-card" }, context))).toContain("no screen");
		expect(shots).toHaveLength(2);
	});

	test("get_screenshot reports a render failure", async () => {
		const failing = async () => {
			throw new Error("The screen didn't render");
		};

		expect(error(await call("get_screenshot", {}, { screenshot: failing }))).toBe(
			"get_screenshot failed: The screen didn't render",
		);
	});

	test("get_design_tokens", async () => {
		const tokens = json(await call("get_design_tokens"));

		expect(tokens).toEqual({
			applied: { light: { primary: "#2563eb" }, dark: {} },
			appliedFromCurrentDesign: true,
			designMd: DESIGN,
		});

		const canvas = { ...canvasOf([]), theme: { light: { primary: "red" }, dark: {}, source: "old" } };
		expect(json(await call("get_design_tokens", {}, { canvas })).appliedFromCurrentDesign).toBe(false);
	});

	test("list_components", async () => {
		const { project, library } = json(await call("list_components"));

		expect(project).toEqual([
			{
				file: "components/stat-card.tsx",
				exports: [
					{ name: "StatCard", signature: "StatCard({ label: string; value: string })", acceptsChildren: false },
				],
				usedBy: ["screens/home.tsx"],
			},
		]);
		expect(library).toContainEqual({ import: "@/components/ui/button", exports: ["Button", "buttonVariants"] });
	});

	test("list_comments lists open comments with their screen and element", async () => {
		expect(json(await call("list_comments"))).toEqual([
			{
				id: "c1",
				text: "Bigger title",
				createdAt: "2026-10-01T00:00:00Z",
				screen: { file: "screens/home.tsx", name: "Home" },
				element: { file: "screens/home.tsx", path: "0.0", line: 6, label: "h1", hint: "“Welcome”" },
				replies: [],
			},
			{
				id: "c2",
				text: "Add a profile screen",
				createdAt: "2026-10-02T00:00:00Z",
				screen: null,
				element: null,
				replies: [],
			},
		]);
	});
});

describe("CLI tools", () => {
	const contrast: AgentCheck = {
		file: "screens/home.tsx",
		findings: [
			{ rule: "contrast", severity: "error", message: "Text is hard to read", path: "screens/home.tsx", line: 6 },
			{ rule: "raw-color", severity: "warning", message: "Use a token" },
		],
	};

	test("check_design checks every screen but alternates, or the named ones", async () => {
		const checked: string[][] = [];

		const checkDesign = async (frames: Frame[]) => {
			checked.push(frames.map((each) => each.file));

			return frames.map((each) => (each.file === "screens/home.tsx" ? contrast : { file: each.file, findings: [] }));
		};

		expect(json(await call("check_design", {}, { checkDesign }))).toEqual({
			errors: 1,
			warnings: 1,
			screens: [
				{
					file: "screens/home.tsx",
					name: "Home",
					error: null,
					findings: [
						{
							severity: "error",
							rule: "contrast",
							title: "Low contrast",
							message: "Text is hard to read",
							file: "screens/home.tsx",
							line: 6,
						},
						{
							severity: "warning",
							rule: "raw-color",
							title: "Color without a token",
							message: "Use a token",
							file: "screens/home.tsx",
							line: null,
						},
					],
				},
				{ file: "screens/settings.tsx", name: "Settings", error: null, findings: [] },
			],
		});

		await call("check_design", { screens: ["Settings", "screens/settings.tsx"] }, { checkDesign });
		expect(checked).toEqual([["screens/home.tsx", "screens/settings.tsx"], ["screens/settings.tsx"]]);
		expect(error(await call("check_design", { screens: ["stat-card"] }))).toContain("no screen");
		expect(error(await call("check_design", { screens: "home" }))).toBe("`screens` must be a list of strings.");
	});

	test("check_design reports a screen that didn't render", async () => {
		const checkDesign = async () => [{ file: "screens/home.tsx", findings: [], error: "Boom" }];

		expect(json(await call("check_design", { screens: ["home"] }, { checkDesign })).screens[0].error).toBe("Boom");
	});

	test("export_website writes into an absolute folder", async () => {
		const result = await call("export_website", { path: "/tmp/out" });

		expect(result).toEqual({ content: [{ type: "text", text: "/tmp/out/demo-site" }] });
		expect(error(await call("export_website", { path: "out" }))).toBe("`path` must be an absolute folder path.");
		expect(error(await call("export_website", {}))).toBe("`path` must be an absolute folder path.");
	});
});

function session(overrides: Partial<AgentContext> = {}) {
	const canvas = overrides.canvas ?? canvasOf(["screens/home.tsx"]);
	const files = overrides.files ?? FILES;

	let history: History = createHistory({
		frames: canvas.frames,
		files,
		comments: canvas.comments,
		locks: canvas.locks,
	});

	const selections: string[][] = [];
	let calls = 0;

	const change: AgentContext["change"] = (recipe, options) => {
		history = commit(history, nextSnapshot(history.present, recipe(history.present)), options);

		if (options.select) selections.push(options.select);
	};

	return {
		run: (tool: string, args: JsonObject = {}) =>
			runAgentTool(tool, args, contextOf({ ...overrides, canvas, files, change, step: `agent:${++calls}` }).context),
		history: () => history,
		selections,
	};
}

const EDIT = `<<<<<<< SEARCH
			<h1 className="text-2xl">Welcome</h1>
=======
			<h1 className="text-3xl">Hello again</h1>
>>>>>>> REPLACE`;

describe("write tools", () => {
	test("edit_screen applies SEARCH/REPLACE blocks to the selected screen as one undo step", async () => {
		const { run, history } = session();

		expect(json(await run("edit_screen", { edits: EDIT }))).toEqual({ file: "screens/home.tsx", changed: true });
		expect(history().present.files["screens/home.tsx"]).toContain('<h1 className="text-3xl">Hello again</h1>');
		expect(history().past).toHaveLength(1);
		expect(history().coalesceKey).toBe("agent:1");
		expect(undo(history()).present.files["screens/home.tsx"]).toBe(HOME);
	});

	test("edit_screen takes whole code for a screen by name", async () => {
		const { run, history } = session();
		const code = SETTINGS.replace("Settings</div>", "Preferences</div>");

		expect(json(await run("edit_screen", { screen: "Settings", code })).file).toBe("screens/settings.tsx");
		expect(history().present.files["screens/settings.tsx"]).toBe(code);
		expect(json(await run("edit_screen", { screen: "settings", code })).changed).toBe(true);
	});

	test("edit_screen changes nothing when it can't apply cleanly", async () => {
		const { run, history } = session();
		const missing = EDIT.replace("Welcome", "Goodbye");

		expect(error(await run("edit_screen", { edits: missing }))).toBe(
			"SEARCH block 1 doesn't match the file in `screens/home.tsx`, so nothing changed.",
		);
		expect(error(await run("edit_screen", { edits: "just text" }))).toContain("no complete SEARCH/REPLACE block");
		expect(error(await run("edit_screen", {}))).toBe("Pass either `edits` or `code`.");
		expect(error(await run("edit_screen", { edits: EDIT, code: HOME }))).toBe("Pass either `edits` or `code`.");
		expect(error(await run("edit_screen", { code: "export default function Home() { return <div>; }" }))).toContain(
			"doesn't compile, so nothing changed",
		);
		expect(error(await run("edit_screen", { code: "export function Home() { return <div />; }" }))).toContain(
			"needs a default export",
		);
		expect(error(await run("edit_screen", { screen: "components/stat-card.tsx", code: HOME }))).toContain(
			"There is no screen",
		);
		expect(history().past).toHaveLength(0);
	});

	test("edit_screen refuses to touch a locked element", async () => {
		const canvas = {
			...canvasOf(["screens/home.tsx"]),
			locks: [{ file: "screens/home.tsx", path: [0, 0], name: "h1" }],
		};

		const { run, history } = session({ canvas });

		expect(error(await run("edit_screen", { edits: EDIT }))).toBe(
			"The change touches the locked <h1> in `screens/home.tsx`. Unlock it in Rabisco first.",
		);

		const button = EDIT.replace(
			'<h1 className="text-2xl">Welcome</h1>',
			'<button className="rounded">Continue</button>',
		).replace('<h1 className="text-3xl">Hello again</h1>', '<button className="rounded-full">Continue</button>');

		expect(json(await run("edit_screen", { edits: button })).changed).toBe(true);
		expect(history().past).toHaveLength(1);
	});

	test("writes wait while a generation runs", async () => {
		const { run, history } = session({ busy: () => true });

		expect(error(await run("edit_screen", { edits: EDIT }))).toContain("A generation is running");
		expect(error(await run("create_screen", { name: "Profile", code: SETTINGS }))).toContain("A generation is running");
		expect(error(await run("set_design_tokens", { light: { primary: "#000000" } }))).toContain(
			"A generation is running",
		);
		expect(history().past).toHaveLength(0);
	});

	test("create_screen adds a frame and its file as one step, and selects it", async () => {
		const { run, history, selections } = session();
		const code = SETTINGS.replace("Settings", "Profile");

		expect(json(await run("create_screen", { name: "Profile", code }))).toEqual({
			file: "screens/profile.tsx",
			name: "Profile",
			device: "mobile",
			x: 1130,
			y: 0,
			width: 390,
			height: 844,
		});
		expect(history().present.files["screens/profile.tsx"]).toBe(code);
		expect(history().present.frames.map((frame) => frame.file)).toContain("screens/profile.tsx");
		expect(selections).toEqual([["screens/profile.tsx"]]);
		expect(undo(history()).present.files["screens/profile.tsx"]).toBeUndefined();
		expect(undo(history()).present.frames).toHaveLength(2);
	});

	test("create_screen next to a screen skips frames in the way, and takes a device", async () => {
		const { run } = session();

		expect(json(await run("create_screen", { name: "Settings", code: SETTINGS, next_to: "Home" }))).toMatchObject({
			file: "screens/settings-2.tsx",
			x: 1010,
			y: 0,
		});
		expect(json(await run("create_screen", { name: "Wide", code: SETTINGS, device: "desktop" }))).toMatchObject({
			device: "desktop",
			width: 1280,
		});
		expect(error(await run("create_screen", { name: "Wide", code: SETTINGS, device: "watch" }))).toContain(
			"`device` must be",
		);
		expect(error(await run("create_screen", { name: "Lost", code: SETTINGS, next_to: "Nowhere" }))).toContain(
			"There is no screen",
		);
		expect(error(await run("create_screen", { code: SETTINGS }))).toBe("Pass `name`.");
	});

	test("write_component creates or replaces a component file, kept inside components/", async () => {
		const { run, history } = session();
		const badge = "export function Pill({ label }: { label: string }) {\n\treturn <span>{label}</span>;\n}\n";

		expect(json(await run("write_component", { component: "pill", code: badge }))).toEqual({
			file: "components/pill.tsx",
			created: true,
			changed: true,
		});
		expect(json(await run("write_component", { component: "components/stat-card.tsx", code: badge }))).toEqual({
			file: "components/stat-card.tsx",
			created: false,
			changed: true,
		});
		expect(history().past).toHaveLength(2);
		expect(undo(history()).present.files["components/stat-card.tsx"]).toBe(STAT_CARD);

		for (const component of ["../secrets", "/etc/passwd", "components/../../x", "screens/home.tsx", "Stat Card"])
			expect(error(await run("write_component", { component, code: badge }))).toContain("isn't a component file");
		expect(error(await run("write_component", { component: "pill", code: "export const x = <div>;" }))).toContain(
			"doesn't compile",
		);
		expect(history().past).toHaveLength(2);
	});

	test("set_design_tokens writes DESIGN.md and applies the theme as one step", async () => {
		const { run, history } = session();

		expect(
			json(
				await run("set_design_tokens", {
					light: { primary: "#111111", radius: "1rem" },
					dark: { "--primary": "#eeeeee" },
				}),
			),
		).toEqual({
			set: 3,
			tokens: { light: { primary: "#111111", radius: "1rem" }, dark: { primary: "#eeeeee" } },
		});
		expect(history().present.files["DESIGN.md"]).toContain("- primary: #111111");
		expect(history().present.theme?.light).toEqual({ primary: "#111111", radius: "1rem" });
		expect(history().past).toHaveLength(1);
		expect(undo(history()).present.files["DESIGN.md"]).toBe(DESIGN);

		expect(json(await run("set_design_tokens", { light: { primary: "" } })).tokens.light).toEqual({});
	});

	test("set_design_tokens checks names and values", async () => {
		const { run, history } = session();

		expect(error(await run("set_design_tokens", {}))).toBe("Pass `light` or `dark` with at least one token.");
		expect(error(await run("set_design_tokens", { light: { primary: "blue-ish" } }))).toContain(
			"Light primary: Not a color",
		);
		expect(error(await run("set_design_tokens", { dark: { sparkle: "#fff" } }))).toContain(
			"Dark sparkle: Unknown token",
		);
		expect(error(await run("set_design_tokens", { light: { primary: 3 } }))).toContain("must be a string");
		expect(error(await run("set_design_tokens", { light: "primary" }))).toContain("must map token names");
		expect(history().past).toHaveLength(0);
	});

	test("add_comment pins a comment on a screen or in the middle of an element", async () => {
		const { run, history } = session();

		const onScreen = json(await run("add_comment", { text: "Tighten the spacing" }));
		expect(onScreen).toMatchObject({ screen: { file: "screens/home.tsx", name: "Home" }, element: null });

		const onElement = json(await run("add_comment", { text: "Too loud", screen: "home", element: "0.0" }));
		expect(onElement.element).toBe("0.0");

		const added = (history().present.comments ?? []).slice(-2);
		expect(added).toMatchObject([
			{ id: onScreen.id, file: "screens/home.tsx", x: 16, y: 16, text: "Tighten the spacing" },
			{ id: onElement.id, file: "screens/home.tsx", x: 124, y: 56, text: "Too loud" },
		]);
		expect(history().past).toHaveLength(2);
		expect(undo(history()).present.comments).toHaveLength(4);

		expect(error(await run("add_comment", { text: "x", element: "0.9" }))).toContain("has no element");
		expect(error(await run("add_comment", {}))).toBe("Pass `text`.");
	});

	test("add_comment needs the element to render", async () => {
		const { run } = session({ elementBox: async () => null });

		expect(error(await run("add_comment", { text: "x", element: "0.0" }))).toBe(
			"Element 0.0 isn't visible on the screen.",
		);
	});
});
