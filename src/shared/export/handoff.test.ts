import { describe, expect, test } from "bun:test";
import { exportFixture } from "./export-fixture";
import { tokensUsed } from "./handoff";
import { nextProject } from "./next-project";
import { reactRouterProject } from "./react-router-project";
import { viteProject } from "./vite-project";

const input = exportFixture();

const byPath = (project: ReturnType<typeof viteProject>) =>
	Object.fromEntries(project.files.map((file) => [file.path, file.content]));

test("classes map to the tokens they read", () => {
	const names = new Set([
		"primary",
		"muted-foreground",
		"radius",
		"radius-card",
		"color-brand",
		"font-display",
		"text-display",
		"spacing-gutter",
	]);

	const source = `<div className="hover:bg-primary/90 text-muted-foreground rounded-lg rounded-t-card bg-brand/10 font-display text-display p-gutter bg-blue-600 rounded-full" />`;

	expect(tokensUsed([source], names).sort()).toEqual([...names].sort());
	expect(tokensUsed(['<p className="text-sm bg-white" />'], names)).toEqual([]);
});

describe("handoff data", () => {
	const out = byPath(viteProject(input));
	const data = out["src/handoff/data.ts"]!;
	const handoff = JSON.parse(data.slice(data.indexOf("= ") + 2, data.lastIndexOf(";")));

	test("every screen with its route, size, components, UI kit and tokens", () => {
		const settings = handoff.screens.find((screen: { id: string }) => screen.id === "settings");

		expect(handoff.screens).toHaveLength(6);
		expect(settings).toMatchObject({
			name: "Settings",
			file: "src/screens/settings.tsx",
			url: "/#/settings",
			width: 390,
			height: 844,
			components: ["src/components/profile-row.tsx"],
		});
		expect(settings.ui).toContain("uai/metric-card");
		expect(settings.tokens).toEqual(
			expect.arrayContaining(["color-brand", "radius-card", "font-display", "spacing-gutter"]),
		);
	});

	test("every component and token, with the screens that use it", () => {
		expect(handoff.components).toContainEqual({ file: "src/components/profile-row.tsx", screens: ["settings"] });

		const brand = handoff.tokens.find((token: { name: string }) => token.name === "color-brand");

		expect(brand).toEqual({
			name: "color-brand",
			kind: "color",
			light: "#e11d48",
			dark: "#fb7185",
			screens: ["settings"],
		});
		expect(handoff.tokens.find((token: { name: string }) => token.name === "text-display").light).toBe("2rem/1.1");
	});

	test("the app opens it at #/handoff, and the README says so", () => {
		expect(out["src/App.tsx"]).toContain('if (id === "handoff") return null;');
		expect(out["src/App.tsx"]).toContain("if (!screen) return <Handoff />;");
		expect(out["README.md"]).toContain("The dev handoff page at `/#/handoff`");
	});
});

test("Next.js and React Router route it at /handoff", () => {
	const next = byPath(nextProject(input));
	const router = byPath(reactRouterProject(input));

	expect(next["src/app/handoff/page.tsx"]).toContain("return <Handoff />;");
	expect(next["src/handoff/data.ts"]).toContain('"url": "/settings"');
	expect(router["src/app/routes.ts"]).toContain('route("handoff", "routes/_handoff.tsx"),');
	expect(router["src/app/routes/_handoff.tsx"]).toContain("return <Handoff />;");
});

test("a screen called handoff keeps its route; the page moves to dev-handoff", () => {
	const files = { ...input.files, "screens/handoff.tsx": input.files["screens/settings.tsx"]! };
	const out = byPath(nextProject({ ...input, files }));

	expect(out["src/app/handoff/page.tsx"]).toContain("HandoffScreen");
	expect(out["src/app/dev-handoff/page.tsx"]).toContain("return <Handoff />;");
});
