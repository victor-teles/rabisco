import { describe, expect, test } from "bun:test";
import { agentContextMarkdown } from "./agent-context";

const files = {
	"screens/home.tsx": `import { StatCard } from "../components/stat-card";

export default function Home() {
	return <StatCard />;
}
`,
	"screens/settings.tsx": `import { StatCard } from "../components/stat-card";

export default function Settings() {
	return <pre>{"\`\`\`"}</pre>;
}
`,
	"components/stat-card.tsx": "export function StatCard() {\n\treturn null;\n}\n",
};

const home = {
	file: "screens/home.tsx",
	name: "Home",
	width: 390,
	height: 844,
	screenshot: "/tmp/rabisco-agent/home.png",
	elements: [{ path: "0.1", line: 4, label: "StatCard" }],
};

describe("agentContextMarkdown", () => {
	test("names each screen's mode", () => {
		const text = (mode?: Record<string, string>) =>
			agentContextMarkdown({
				project: "Banking",
				screens: [{ ...home, mode }],
				files,
				tokens: { light: {}, dark: {} },
			});

		expect(text({ scheme: "dark" })).toContain(
			'## Home (`screens/home.tsx`, 390 × 844)\n\nMode: dark (`class="dark"` on `<html>`)',
		);
		expect(text({ scheme: "light" })).toContain("Mode: light\n");
		expect(text()).not.toContain("Mode:");
	});

	test("has the screenshot, the code, the components and the tokens", () => {
		const text = agentContextMarkdown({
			project: "Banking",
			screens: [home],
			files,
			tokens: { light: { primary: "#0f62fe" }, dark: {} },
		});

		expect(text).toStartWith("# Rabisco design: Home\n");
		expect(text).toContain("## Home (`screens/home.tsx`, 390 × 844)");
		expect(text).toContain("Screenshot: /tmp/rabisco-agent/home.png");
		expect(text).toContain("- `StatCard` at line 4 (element path `0.1`)");
		expect(text).toContain("```tsx\nimport { StatCard }");
		expect(text).toContain("### `components/stat-card.tsx`");
		expect(text).toContain("--primary: #0f62fe;");
	});

	test("lists a shared component once, and fences code that has backticks in it", () => {
		const settings = { ...home, file: "screens/settings.tsx", name: "Settings", screenshot: null, elements: [] };

		const text = agentContextMarkdown({
			project: "Banking",
			screens: [home, settings],
			files,
			tokens: { light: {}, dark: {} },
		});

		expect(text.split("### `components/stat-card.tsx`")).toHaveLength(2);
		expect(text).toContain("````tsx\nimport { StatCard }");
		expect(text).not.toContain("Design tokens");
	});
});
