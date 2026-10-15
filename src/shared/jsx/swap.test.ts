import { describe, expect, test } from "bun:test";
import { swapComponent, type SwapTarget } from "./swap";

const SCREEN = `import { Badge } from "@/components/ui/badge";
import { StatCard } from "../components/stat-card";

export default function Home() {
	return (
		<div>
			<StatCard
				label="Streak"
				value="12 days"
				change="+2"
				className="w-full"
			/>
			<Badge variant="secondary" className="ml-2">
				New
			</Badge>
		</div>
	);
}
`;

const METRIC: SwapTarget = {
	name: "MetricTile",
	path: "components/metric-tile.tsx",
	props: ["label", "value", "className"],
	acceptsChildren: false,
	extendsElement: false,
};

const startOf = (source: string, tag: string) => source.indexOf(`<${tag}`);

const swap = (source: string, tag: string, target: SwapTarget) =>
	swapComponent(source, "screens/home.tsx", startOf(source, tag), target);

describe("swapComponent", () => {
	test("keeps matching props, drops the rest, and moves the import", () => {
		const result = swap(SCREEN, "StatCard", METRIC);

		if ("error" in result) throw new Error(result.error);
		expect(result.dropped).toEqual(["change"]);
		expect(result.source).toContain(
			`\t\t\t<MetricTile\n\t\t\t\tlabel="Streak"\n\t\t\t\tvalue="12 days"\n\t\t\t\tclassName="w-full"\n\t\t\t/>`,
		);
		expect(result.source).toContain(`import { MetricTile } from "../components/metric-tile";`);
		expect(result.source).not.toContain("stat-card");
		expect(result.source.slice(result.start, result.start + 11)).toBe("<MetricTile");
	});

	test("renames both tags and keeps children the target takes", () => {
		const pill: SwapTarget = {
			...METRIC,
			name: "Pill",
			path: "components/pill.tsx",
			props: ["variant"],
			acceptsChildren: true,
		};

		const result = swap(SCREEN, "Badge", pill);

		if ("error" in result) throw new Error(result.error);
		expect(result.dropped).toEqual(["className"]);
		expect(result.source).toContain(`<Pill variant="secondary">\n\t\t\t\tNew\n\t\t\t</Pill>`);
		expect(result.source).not.toContain("@/components/ui/badge");
		expect(result.source.slice(result.start, result.start + 5)).toBe("<Pill");
	});

	test("closes the tag when the target takes no children", () => {
		const result = swap(SCREEN, "Badge", { ...METRIC, props: ["variant"] });

		if ("error" in result) throw new Error(result.error);
		expect(result.dropped).toEqual(["children", "className"]);
		expect(result.source).toContain(`<MetricTile variant="secondary" />`);
	});

	test("a target that takes DOM attributes keeps every prop", () => {
		const result = swap(SCREEN, "Badge", { ...METRIC, props: [], acceptsChildren: true, extendsElement: true });

		if ("error" in result) throw new Error(result.error);
		expect(result.dropped).toEqual([]);
		expect(result.source).toContain(`<MetricTile variant="secondary" className="ml-2">`);
	});

	test("uses an existing import of the target", () => {
		const source = SCREEN.replace(
			`import { StatCard } from "../components/stat-card";`,
			`import { StatCard } from "../components/stat-card";\nimport { MetricTile as Tile } from "../components/metric-tile";`,
		);

		const result = swap(source, "Badge", { ...METRIC, acceptsChildren: true });

		if ("error" in result) throw new Error(result.error);
		expect(result.source).toContain('<Tile className="ml-2">');
		expect(result.source.match(/metric-tile/g)?.length).toBe(1);
	});

	test("refuses a name the file already uses for something else", () => {
		expect(swap(SCREEN, "StatCard", { ...METRIC, name: "Badge" })).toEqual({
			error: "Badge is already a name in this file",
		});
		expect(swap(SCREEN, "StatCard", { ...METRIC, name: "StatCard", path: "components/other.tsx" })).toEqual({
			error: "This file imports another StatCard. Rename one of them first",
		});
		expect(swapComponent(SCREEN, "screens/home.tsx", startOf(SCREEN, "div"), METRIC)).toEqual({
			error: "Select a component usage to swap",
		});
	});
});
