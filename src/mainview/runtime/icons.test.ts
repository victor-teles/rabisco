import { describe, expect, test } from "bun:test";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { compileSource } from "../lib/render/compile";
import { externals } from "./externals";
import { registerIcon as register } from "./icons";
import { ModuleRegistry } from "./registry";

register("tabler/home", {
	name: "home",
	outline: [["path", { d: "M5 12l-2 0" }]],
	filled: [["path", { d: "M12 2l9 9" }]],
});

register("phosphor/house", {
	regular: [["path", { d: "M1 1" }]],
	thin: [["path", { d: "M2 2" }]],
	light: [["path", { d: "M3 3" }]],
	bold: [["path", { d: "M4 4" }]],
	fill: [["path", { d: "M5 5" }]],
	duotone: [["path", { d: "M6 6", opacity: "0.2" }]],
});

register("star", { name: "star", size: 24, node: [["path", { d: "M7 7" }]] });

function render(jsx: string) {
	const source = `import { IconHome, IconHomeFilled, IconUnloaded } from "@tabler/icons-react";
import { House, HouseIcon } from "@phosphor-icons/react";
import { Star } from "lucide-react";

export default function Screen() {
	return ${jsx};
}
`;

	const compiled = compileSource("screens/icons.tsx", source);
	const registry = new ModuleRegistry(externals);
	registry.apply({ "screens/icons.tsx": { source, code: compiled.code! } }, true);
	const Screen = registry.load("screens/icons.tsx").default;

	if (!(Screen instanceof Function)) throw new Error("No default export");

	// SAFETY: a screen default-exports a function component, and the check above made sure it is a function
	return renderToString(createElement(Screen as FunctionComponent));
}

describe("icon packs in frames", () => {
	test("a Tabler export draws its outline or filled style, with Tabler's props", () => {
		const outline = render(`<IconHome stroke={1.5} className="size-4" />`);
		expect(outline).toContain('stroke-width="1.5"');
		expect(outline).toContain('class="tabler-icon tabler-icon-home size-4"');
		expect(outline).toContain('d="M5 12l-2 0"');

		const filled = render(`<IconHomeFilled />`);
		expect(filled).toContain('fill="currentColor"');
		expect(filled).toContain('d="M12 2l9 9"');
	});

	test("a Phosphor export draws the weight it asks for, and both of its names work", () => {
		expect(render(`<House />`)).toContain('d="M1 1"');
		expect(render(`<House />`)).toContain('width="1em"');
		expect(render(`<HouseIcon weight="bold" />`)).toContain('d="M4 4"');
		expect(render(`<House weight="duotone" />`)).toContain('opacity="0.2"');
	});

	test("lucide still resolves by name, and an icon without a script renders a placeholder", () => {
		expect(render(`<Star />`)).toContain('d="M7 7"');
		expect(render(`<IconUnloaded size={20} />`)).toBe('<svg width="20" height="20" aria-hidden="true"></svg>');
	});
});
