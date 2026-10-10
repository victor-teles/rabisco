import { describe, expect, test } from "bun:test";
import { extractComponent, type ExtractResult } from "./extract";
import { ANALYTICS, compiles, DASHBOARD, TAB_BAR } from "./test-fixtures";

const files = {
	"screens/dashboard.tsx": DASHBOARD,
	"screens/analytics.tsx": ANALYTICS,
	"components/tab-bar.tsx": TAB_BAR,
};

const at = (source: string, needle: string, nth = 0) => {
	let index = -1;

	for (let i = 0; i <= nth; i++) index = source.indexOf(needle, index + 1);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

function ok(result: ExtractResult) {
	if (!result.ok) throw new Error(result.reason);

	for (const change of result.changes) expect(compiles(change.content!)).toBe(true);

	return result;
}

const content = (result: Extract<ExtractResult, { ok: true }>, path: string) =>
	result.changes.find((c) => c.path === path)?.content ?? null;

describe("extractComponent", () => {
	test("extracts a repeated card and replaces every occurrence across screens", () => {
		const result = ok(
			extractComponent({ files, path: "screens/dashboard.tsx", start: at(DASHBOARD, "<Card "), name: "Stat card" }),
		);

		expect(result.componentPath).toBe("components/stat-card.tsx");
		expect(result.exportName).toBe("StatCard");
		expect(result.props).toEqual([
			{ name: "label", type: "string", source: "slot" },
			{ name: "value", type: "string", source: "slot" },
		]);
		expect(content(result, "components/stat-card.tsx")).toBe(`import { Card, CardContent } from "@/components/ui/card";

type StatCardProps = {
	label: string;
	value: string;
};

export function StatCard({ label, value }: StatCardProps) {
	return (
		<Card className="gap-1 py-4">
			<CardContent className="px-4">
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className="text-2xl font-semibold">{value}</p>
			</CardContent>
		</Card>
	);
}
`);
		expect(result.replaced).toEqual([
			{ path: "screens/dashboard.tsx", count: 2 },
			{ path: "screens/analytics.tsx", count: 1 },
		]);
		const dashboard = content(result, "screens/dashboard.tsx")!;
		expect(dashboard).toContain(
			`\t\t\t\t<StatCard label="Revenue" value="$12,480" />\n\t\t\t\t<StatCard label="Orders" value="318" />\n`,
		);
		expect(dashboard).toContain(`import { StatCard } from "../components/stat-card";`);
		// Card is no longer used in the dashboard; the analytics screen still uses it
		expect(dashboard).not.toContain("@/components/ui/card");
		const analytics = content(result, "screens/analytics.tsx")!;
		expect(analytics).toContain(`<StatCard label="Visitors" value="8,210" />`);
		expect(analytics).toContain(`import { Card, CardContent } from "@/components/ui/card";`);
		expect(content(result, "components/tab-bar.tsx")).toBeNull();
	});

	test("works the same from any occurrence", () => {
		const fromAnalytics = ok(
			extractComponent({ files, path: "screens/analytics.tsx", start: at(ANALYTICS, "<Card "), name: "stat-card" }),
		);

		expect(fromAnalytics.replaced.map((r) => r.count).reduce((a, b) => a + b)).toBe(3);
		expect(content(fromAnalytics, "screens/analytics.tsx")).toContain(`<StatCard label="Visitors" value="8,210" />`);
	});

	test("a list item keeps its key at the call site and gets outside values as typed props", () => {
		const result = ok(
			extractComponent({ files, path: "screens/dashboard.tsx", start: at(DASHBOARD, "<li"), name: "OrderRow" }),
		);

		expect(result.props).toEqual([
			{ name: "order", type: "{ id: string; name: string; price: string }", source: "identifier" },
		]);
		const component = content(result, "components/order-row.tsx")!;
		expect(component).toContain(`export function OrderRow({ order }: OrderRowProps) {`);
		expect(component).toContain(`\t\t<li className="flex items-center justify-between py-3">`);
		expect(component).not.toContain("key=");
		expect(content(result, "screens/dashboard.tsx")).toContain(
			`{ORDERS.map((order) => (\n\t\t\t\t\t<OrderRow key={order.id} order={order} />\n\t\t\t\t))}`,
		);
	});

	test("state and setters become props with their types; icon imports move", () => {
		const result = ok(
			extractComponent({ files, path: "screens/dashboard.tsx", start: at(DASHBOARD, "<a "), name: "Reports link" }),
		);

		expect(result.props).toEqual([
			{ name: "setOpen", type: "(value: boolean) => void", source: "identifier" },
			{ name: "open", type: "boolean", source: "identifier" },
		]);
		const component = content(result, "components/reports-link.tsx")!;
		expect(component).toStartWith(`import { ArrowUpRight } from "lucide-react";\n\n`);
		const dashboard = content(result, "screens/dashboard.tsx")!;
		expect(dashboard).toContain(`<ReportsLink setOpen={setOpen} open={open} />`);
		expect(dashboard).toContain(`import { Bell, Search } from "lucide-react";`);
	});

	test("texts that differ become props; quotes and entities survive", () => {
		const source = `import { Badge } from "@/components/ui/badge";

export default function A() {
	return (
		<section className="p-4">
			<div className="flex gap-2">
				<Badge>New</Badge>
				<span>Say "hi" &amp; wave</span>
			</div>
			<div className="flex gap-2">
				<Badge>Old</Badge>
				<span>Fish &amp; chips</span>
			</div>
		</section>
	);
}
`;

		const result = ok(
			extractComponent({
				files: { "screens/a.tsx": source },
				path: "screens/a.tsx",
				start: at(source, `<div className="flex`),
				name: "Tag row",
			}),
		);

		expect(result.props.map((p) => p.name)).toEqual(["label", "text"]);
		const screen = content(result, "screens/a.tsx")!;
		expect(screen).toContain(`<TagRow label="New" text={"Say \\"hi\\" & wave"} />`);
		expect(screen).toContain(`<TagRow label="Old" text="Fish & chips" />`);
		expect(screen).not.toContain("@/components/ui/badge");
	});

	test("string attributes and texts that differ become props; equal ones stay inline", () => {
		const source = `export default function Nav() {
	return (
		<nav>
			<a href="/home" className="px-2" target="_self"><span className="i">→</span>Home</a>
			<a href="/team" className="px-2" target="_self"><span className="i">→</span>Team</a>
		</nav>
	);
}
`;

		const result = ok(
			extractComponent({
				files: { "screens/nav.tsx": source },
				path: "screens/nav.tsx",
				start: at(source, "<a "),
				name: "nav link",
			}),
		);

		const component = content(result, "components/nav-link.tsx")!;
		expect(component).toContain(
			`return <a href={href} className="px-2" target="_self"><span className="i">→</span>{label}</a>;`,
		);
		expect(content(result, "screens/nav.tsx")).toContain(`<NavLink href="/home" label="Home" />`);
	});

	test("destructured components from a map become ElementType props", () => {
		const source = `import { House, User } from "lucide-react";

const TABS = [
	{ label: "Home", icon: House },
	{ label: "Profile", icon: User },
];

export function Tabs() {
	return (
		<nav>
			{TABS.map(({ label, icon: Icon }) => (
				<div key={label} className="flex flex-col">
					<Icon className="size-5" />
					<span>{label}</span>
				</div>
			))}
		</nav>
	);
}
`;

		const result = ok(
			extractComponent({
				files: { "components/tabs.tsx": source },
				path: "components/tabs.tsx",
				start: at(source, "<div"),
				name: "Tab",
			}),
		);

		expect(result.props).toEqual([
			{ name: "Icon", type: "ElementType", source: "identifier" },
			{ name: "label", type: "string", source: "identifier" },
		]);
		expect(content(result, "components/tab.tsx")).toStartWith(
			`import type { ElementType } from "react";\n\ntype TabProps`,
		);
		expect(content(result, "components/tabs.tsx")).toContain(`<Tab key={label} Icon={Icon} label={label} />`);
		expect(content(result, "components/tabs.tsx")).toContain(`import { Tab } from "../components/tab";`);
	});

	test("relative imports are rewritten for the components folder", () => {
		const source = `import { TabBar } from "./tab-bar";

export function Shell() {
	return (
		<div className="h-full">
			<TabBar active={1} />
		</div>
	);
}
`;

		const result = ok(
			extractComponent({
				files: { ...files, "components/shell.tsx": source },
				path: "components/shell.tsx",
				start: at(source, "<div"),
				name: "Frame",
			}),
		);

		expect(content(result, "components/frame.tsx")).toStartWith(`import { TabBar } from "../components/tab-bar";`);
	});

	test("a taken path gets a number; spaces indentation is kept", () => {
		const source = `export default function A() {\n  return (\n    <ul>\n      <li>\n        <b>One</b>\n      </li>\n    </ul>\n  );\n}\n`;

		const result = ok(
			extractComponent({
				files: { "screens/a.tsx": source, "components/item.tsx": "export function Other() {}\n" },
				path: "screens/a.tsx",
				start: at(source, "<li"),
				name: "item",
			}),
		);

		expect(result.componentPath).toBe("components/item-2.tsx");
		expect(content(result, "components/item-2.tsx")).toBe(
			`export function Item() {\n  return (\n    <li>\n      <b>One</b>\n    </li>\n  );\n}\n`,
		);
	});

	test("refuses what it can't do", () => {
		const reason = (input: Partial<Parameters<typeof extractComponent>[0]>) => {
			const result = extractComponent({
				files,
				path: "screens/dashboard.tsx",
				start: at(DASHBOARD, "<Card "),
				name: "Stat card",
				...input,
			});

			return result.ok ? null : result.reason;
		};

		expect(reason({ path: "screens/missing.tsx" })).toContain("doesn't exist");
		expect(reason({ files: { ...files, "screens/dashboard.tsx": "const a = <div>" } })).toContain("syntax error");
		expect(reason({ start: 1 })).toContain("Select an element");
		expect(reason({ name: "  " })).toContain("name");
		expect(reason({ name: "Tab bar" })).toContain("components/tab-bar.tsx already has a component named TabBar");
		expect(reason({ name: "Header" })).toContain("already uses the name Header");
		expect(reason({ start: at(DASHBOARD, "<TabBar") })).toContain("already the TabBar component");
		const fragment = `export default function A() {\n\treturn <><b /></>;\n}\n`;
		expect(
			reason({ files: { "screens/a.tsx": fragment }, path: "screens/a.tsx", start: at(fragment, "<>") }),
		).toContain("fragment");
		expect(reason({ start: at(DASHBOARD, `<div className="flex h-full`), name: "Page" })).toContain(
			"<Header>, which is defined in screens/dashboard.tsx",
		);
	});
});
