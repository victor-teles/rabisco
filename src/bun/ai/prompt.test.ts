import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GenerationRequest } from "../../shared/ai/contract";
import { elementFocus } from "../../shared/ai/focus";
import { numberedSnippet, PROMPT_VERSION, systemPrompt, UI_MODULES, userPrompt, varyPrompt } from "./prompt";

const root = join(import.meta.dir, "../../mainview");

const request = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
	id: "g1",
	task: "create",
	model: "m",
	prompt: "A habit tracker",
	device: "mobile",
	context: {},
	files: [],
	...overrides,
});

describe("UI_MODULES", () => {
	test("matches the modules the frame runtime provides", () => {
		const source = readFileSync(join(root, "runtime/externals.ts"), "utf8");
		const runtime = [...source.matchAll(/^\t"@\/components\/ui\/([a-z0-9-]+)":/gm)].map((m) => m[1]!);
		expect(Object.keys(UI_MODULES).sort()).toEqual(runtime.sort());
	});

	test("lists each module's exports", () => {
		for (const [name, exports] of Object.entries(UI_MODULES)) {
			const source = readFileSync(join(root, `components/ui/${name}.tsx`), "utf8");
			const block = /^export \{([^}]*)\}/m.exec(source)?.[1] ?? "";

			const actual = block
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);

			expect([...exports].sort()).toEqual(actual.sort());
		}
	});

	test("every ui file is either in the runtime or deliberately left out", () => {
		const files = readdirSync(join(root, "components/ui"))
			.filter((f) => f.endsWith(".tsx"))
			.map((f) => f.replace(/\.tsx$/, ""));

		// Editor chrome only: screens never get a right-click, the breadcrumb is the inspector's, alert
		// dialogs confirm editor actions (screens use `dialog`), and the switch is for settings
		expect(files.filter((f) => !(f in UI_MODULES)).sort()).toEqual([
			"alert-dialog",
			"breadcrumb",
			"context-menu",
			"sonner",
			"switch",
		]);
	});
});

describe("systemPrompt", () => {
	test("text mode documents the tag protocol and the frame", () => {
		const prompt = systemPrompt(request(), "text");
		expect(prompt).toContain("<rabisco-file");
		expect(prompt).toContain("<rabisco-delete");
		expect(prompt).toContain('device="mobile"');
		expect(prompt).toContain("390×844");
		expect(prompt).toContain("@/components/ui/dropdown-menu: DropdownMenu");
		expect(prompt).toContain("export default function");
		expect(prompt).not.toContain("current directory");
	});

	test("agent mode tells the agent to write files with its tools", () => {
		const prompt = systemPrompt(request({ device: "desktop" }), "agent");
		expect(prompt).toContain("current directory");
		expect(prompt).toContain("1280×800");
		expect(prompt).not.toContain("<rabisco-file");
	});

	test("teaches theme token classes", () => {
		expect(systemPrompt(request(), "text")).toContain("re-themes every screen");
	});

	test("a DESIGN.md context task (or its repair) gets the token format; PRODUCT.md gets its sections", () => {
		const design = systemPrompt(request({ task: "context", targets: ["DESIGN.md"] }), "text");
		expect(design).toContain("## Tokens\n\n- primary: oklch(0.55 0.2 264)");
		expect(design).toContain("### Dark");
		expect(design).toContain("chart-1 to chart-5");
		expect(design).toContain('kind is "screen" or "component" ("context"');
		expect(systemPrompt(request({ task: "repair", targets: ["DESIGN.md"] }), "agent")).toContain("# DESIGN.md format");
		const product = systemPrompt(request({ task: "context", targets: ["PRODUCT.md"] }), "agent");
		expect(product).toContain("Product (what it is");
		expect(product).not.toContain("# DESIGN.md format");
		expect(systemPrompt(request(), "text")).not.toContain("# DESIGN.md format");
	});

	test("components come first: reuse, create only when needed, extend instead of forking", () => {
		for (const mode of ["text", "agent"] as const) {
			const prompt = systemPrompt(request(), mode);
			expect(prompt).toContain("# Components");
			expect(prompt).toContain('check the "# Project components" list');
			expect(prompt).toContain("2 or more places");
			expect(prompt).toContain("Never create a near-duplicate");
			expect(prompt).toContain("update every file that uses it");
		}
	});

	test("is versioned", () => {
		expect(PROMPT_VERSION).toBeGreaterThan(0);
	});
});

describe("userPrompt", () => {
	const files = [
		{ path: "screens/home.tsx", content: "export default function Home() {}\n" },
		{ path: "components/tab-bar.tsx", content: "export function TabBar() {}\n" },
	];

	test("create: context, inlined files, taken paths and the prompt last", () => {
		const prompt = userPrompt(request({ context: { product: "Habits app", design: "Warm colors" }, files }), "text");
		expect(prompt).toContain("<product>\nHabits app\n</product>");
		expect(prompt).toContain("<design>\nWarm colors\n</design>");
		expect(prompt).toContain(
			'<project-file path="components/tab-bar.tsx">\nexport function TabBar() {}\n</project-file>',
		);
		expect(prompt).toContain("Existing screens (pick other paths): screens/home.tsx");
		expect(prompt.endsWith("<request>\nA habit tracker\n</request>")).toBe(true);
	});

	test("agent mode lists files instead of inlining them", () => {
		const prompt = userPrompt(request({ files }), "agent");
		expect(prompt).toContain("- components/tab-bar.tsx");
		expect(prompt).not.toContain("export function TabBar");
	});

	test("agent mode carries the chat so far; text mode sends it as messages instead", () => {
		const history = [
			{ role: "user" as const, content: "A habit tracker" },
			{ role: "assistant" as const, content: `Made it. ${"x".repeat(900)}` },
			{ role: "user" as const, content: "  " },
		];

		const prompt = userPrompt(request({ history, prompt: "Make it calmer" }), "agent");
		expect(prompt).toContain("<conversation>");
		expect(prompt).toContain("User: A habit tracker");
		expect(prompt).toContain(`You: Made it. ${"x".repeat(100)}`);
		expect(prompt).not.toContain("x".repeat(900));
		expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<request>"));
		expect(userPrompt(request({ history }), "text")).not.toContain("<conversation>");
		expect(userPrompt(request(), "agent")).not.toContain("<conversation>");
	});

	test("edit lists the targets", () => {
		const prompt = userPrompt(
			request({ task: "edit", files, targets: ["screens/home.tsx"], prompt: "Make it dark" }),
			"text",
		);

		expect(prompt).toContain("Task: edit");
		expect(prompt).toContain("- screens/home.tsx");
	});

	test("repair lists the problems", () => {
		const prompt = userPrompt(
			request({
				task: "repair",
				files,
				targets: ["screens/home.tsx"],
				problems: [{ path: "screens/home.tsx", line: 3, message: "Unexpected token" }],
			}),
			"text",
		);

		expect(prompt).toContain("Task: repair");
		expect(prompt).toContain("- screens/home.tsx:3: Unexpected token");
	});

	test("context is sent without its HTML comments; an untouched template is left out", () => {
		const prompt = userPrompt(
			request({
				context: { product: "# Product\n<!-- What is it? -->\nHabits", design: "# Design\n<!-- tokens -->\n" },
			}),
			"text",
		);

		expect(prompt).toContain("<product>\n# Product\n\nHabits\n</product>");
		expect(prompt).not.toContain("<design>");
		expect(prompt).not.toContain("What is it?");
	});

	test("context task: DESIGN.md infers from the screens; output by mode", () => {
		const target = { path: "DESIGN.md", content: "# Design\n<!-- template -->\n" };

		const text = userPrompt(
			request({ task: "context", targets: ["DESIGN.md"], files: [target, ...files], prompt: "" }),
			"text",
		);

		expect(text).toContain(
			"Task: context. Write DESIGN.md: infer the design language from the project's existing screens",
		);
		expect(text).toContain('<rabisco-file path="DESIGN.md" kind="context">');
		expect(text).toContain("keep what it says that still holds");
		const agent = userPrompt(request({ task: "context", targets: ["DESIGN.md"], files }), "agent");
		expect(agent).toContain("Write DESIGN.md in the current directory");
		expect(agent).not.toContain("keep what it says");
	});

	test("context task: PRODUCT.md comes from the interview answers", () => {
		const prompt = userPrompt(
			request({ task: "context", targets: ["PRODUCT.md"], prompt: "Who is it for?\nParents" }),
			"text",
		);

		expect(prompt).toContain("Write PRODUCT.md from the answers");
		expect(prompt).toContain('<rabisco-file path="PRODUCT.md" kind="context">');
		expect(prompt.endsWith("<request>\nWho is it for?\nParents\n</request>")).toBe(true);
	});

	test("mentions attachments", () => {
		const prompt = userPrompt(
			request({ attachments: [{ name: "sketch.png", mediaType: "image/png", data: "AA==" }] }),
			"text",
		);

		expect(prompt).toContain("sketch.png");
		expect(prompt).toContain("sent with this message");
	});

	test("points agents at the staged copies of the attachments", () => {
		const prompt = userPrompt(
			request({
				attachments: [
					{ name: "Sketch 1.PNG", mediaType: "image/png", data: "AA==" },
					{ name: "mood.jpeg", mediaType: "image/jpeg", data: "AA==" },
				],
			}),
			"agent",
		);

		expect(prompt).toContain("- .rabisco/attachments/1-sketch-1.png (Sketch 1.PNG)");
		expect(prompt).toContain("- .rabisco/attachments/2-mood.jpg (mood.jpeg)");
		expect(prompt).toContain("Open each one with your file tools");
	});

	test("variation runs ask for a distinct direction, in both modes", () => {
		for (const mode of ["text", "agent"] as const) {
			expect(userPrompt(request({ variation: { index: 1, count: 3 } }), mode)).toContain("variation 2 of 3");
			expect(userPrompt(request({ variation: { index: 0, count: 1 } }), mode)).not.toContain("variation 1 of 1");
		}
	});

	test("references are called out as read-only", () => {
		const files = [
			{ path: "screens/a.tsx", content: "a" },
			{ path: "screens/a.alt-1.tsx", content: "b" },
		];

		for (const mode of ["text", "agent"] as const) {
			const prompt = userPrompt(
				request({ task: "edit", targets: ["screens/a.tsx"], references: ["screens/a.alt-1.tsx"], files }),
				mode,
			);

			expect(prompt).toMatch(/Reference only \(read them, don't change or write them\):\n- screens\/a\.alt-1\.tsx/);
		}
	});

	test("vary prompt keeps the screen's purpose and takes a direction", () => {
		expect(varyPrompt("bolder")).toContain("Direction: bolder.");
		expect(varyPrompt("  ")).toContain("Direction: a distinct alternative.");
		expect(varyPrompt("")).toContain("Keep its purpose and content");
	});

	describe("project components", () => {
		const statCard = `export function StatCard({ label, tone = "default" }: { label: string; tone?: "default" | "success" }) { return <div>{label}</div>; }\n`;

		const components = [
			{
				path: "components/stat-card.tsx",
				signature: ['StatCard({ label: string; tone?: "default" | "success" = "default" })'],
				usedBy: ["screens/home.tsx"],
			},
			{ path: "components/tab-bar.tsx", signature: ["TabBar({ active?: number = 0 })"] },
		];

		test("lists every component with its signature and users, in both modes", () => {
			for (const mode of ["text", "agent"] as const) {
				const prompt = userPrompt(
					request({ components, files: [{ path: "components/tab-bar.tsx", content: "export function TabBar() {}" }] }),
					mode,
				);

				expect(prompt).toContain("# Project components\nReuse these for any matching UI");
				expect(prompt).toContain(
					'- components/stat-card.tsx (used by screens/home.tsx)\n  StatCard({ label: string; tone?: "default" | "success" = "default" })',
				);
				expect(prompt).toContain("- components/tab-bar.tsx\n  TabBar({ active?: number = 0 })");
				expect(prompt).toContain("import them anyway, their signature is all you need");
				expect(prompt.indexOf("# Project components")).toBeLessThan(prompt.indexOf("Task: create"));
			}
		});

		test("without a catalog, it is built from the component files in the request", () => {
			const prompt = userPrompt(
				request({
					files: [
						{ path: "components/stat-card.tsx", content: statCard },
						{ path: "screens/home.tsx", content: 'import { StatCard } from "../components/stat-card";' },
					],
				}),
				"text",
			);

			expect(prompt).toContain(
				'- components/stat-card.tsx (used by screens/home.tsx)\n  StatCard({ label: string; tone?: "default" | "success" = "default" })',
			);
			expect(prompt).not.toContain("import them anyway");
		});

		test("left out when there are none, and for context tasks", () => {
			expect(userPrompt(request(), "text")).not.toContain("# Project components");
			expect(userPrompt(request({ task: "context", targets: ["DESIGN.md"], components }), "text")).not.toContain(
				"# Project components",
			);
			expect(userPrompt(request({ task: "repair", targets: ["screens/a.tsx"], components }), "agent")).toContain(
				"# Project components",
			);
		});

		test("a component file without exported components says so", () => {
			const prompt = userPrompt(request({ components: [{ path: "components/empty.tsx", signature: [] }] }), "text");
			expect(prompt).toContain("- components/empty.tsx\n  (no exported components found)");
		});
	});

	describe("focus (point and prompt)", () => {
		const path = "screens/welcome.tsx";
		const source = `export default function Welcome() {\n\treturn (\n\t\t<main>\n\t\t\t<Button size="lg">\n\t\t\t\tGet started\n\t\t\t</Button>\n\t\t</main>\n\t);\n}\n`;
		const focus = elementFocus(source, path, source.indexOf("<Button"))!;

		const edit = request({
			task: "edit",
			targets: [path],
			files: [{ path, content: source }],
			focus,
			prompt: "Make it outline",
		});

		test("an edit says to change that element only, keep the rest, and quotes its lines", () => {
			const prompt = userPrompt(edit, "text");
			expect(prompt).toContain(`# Focus\nThe user selected one element in ${path}: <Button> “Get started”, lines 4–6.`);
			expect(prompt).toContain("Keep the rest of screens/welcome.tsx exactly as it is");
			expect(prompt).toContain("imports, or a small helper component");
			expect(prompt).toContain("Still write the whole file in its <rabisco-file> tag");
			expect(prompt).toContain(`4 | \t\t\t<Button size="lg">\n5 | \t\t\t\tGet started\n6 | \t\t\t</Button>`);
			// Before the request, after the task
			expect(prompt.indexOf("# Focus")).toBeGreaterThan(prompt.indexOf("Task: edit"));
			expect(prompt.indexOf("# Focus")).toBeLessThan(prompt.indexOf("<request>"));
		});

		test("agent mode edits the file in place and still quotes the lines", () => {
			const prompt = userPrompt(edit, "agent");
			expect(prompt).toContain("Edit screens/welcome.tsx in place");
			expect(prompt).not.toContain("<rabisco-file>");
			expect(prompt).toContain("5 | \t\t\t\tGet started");
		});

		test("a repair of the focused file gets a reminder, without the stale lines", () => {
			const prompt = userPrompt({ ...edit, task: "repair", problems: [{ path, message: "Unexpected token" }] }, "text");
			expect(prompt).toContain("The request was about one element of screens/welcome.tsx: <Button> “Get started”.");
			expect(prompt).not.toContain("# Focus");
			expect(userPrompt({ ...edit, task: "repair", targets: ["components/row.tsx"] }, "text")).not.toContain(
				"one element of",
			);
		});

		test("ignored when its file isn't a target", () => {
			expect(userPrompt({ ...edit, targets: ["screens/other.tsx"] }, "text")).not.toContain("# Focus");
		});

		test("numberedSnippet pads numbers, falls back to the snippet and cuts long elements", () => {
			expect(numberedSnippet(focus)).toBe(`4 | <Button size="lg">\n5 | \t\t\t\tGet started\n6 | \t\t\t</Button>`);
			const lines = Array.from({ length: 130 }, (_, i) => `<p>${i}</p>`);
			const long = { ...focus, startLine: 5, endLine: 134, snippet: lines.join("\n") };
			const out = numberedSnippet(long).split("\n");
			expect(out[0]).toBe("  5 | <p>0</p>");
			expect(out).toHaveLength(121);
			expect(out.at(-1)).toBe("… 10 more lines, to line 134");
		});
	});
});

describe("theme task", () => {
	const theme = () => request({ task: "theme", prompt: "", context: { design: "## Colors\n\nBrand blue #0052ff." } });

	test("the system prompt only covers reading tokens", () => {
		const prompt = systemPrompt(theme(), "text");
		expect(prompt).toContain("## Tokens");
		expect(prompt).toContain("muted-foreground");
		expect(prompt).toContain("only if the document describes a dark theme");
		expect(prompt).toContain("4.5:1");
		expect(prompt).toContain("DESIGN.md stays as it is");
		expect(prompt).not.toContain("<rabisco-file");
		expect(prompt).not.toContain("@/components/ui");
	});

	test("the user prompt is DESIGN.md and the task, without a request", () => {
		const text = userPrompt(theme(), "text");
		expect(text).toContain("<design>\n## Colors");
		expect(text).toContain("Task: theme.");
		expect(text).not.toContain("<request>");
		expect(text).not.toContain("Project components");
		expect(userPrompt(theme(), "agent")).toContain("Don't write any file");
	});
});
