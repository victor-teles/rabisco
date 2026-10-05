import { describe, expect, test } from "bun:test";
import { transform } from "sucrase";
import { componentApi, type ComponentExport } from "./api";
import { LIBRARY } from "./library";
import { humanize, libraryPreviewModule, previewImport, previewLayout, previewModule, previewPath, sampleProps, variantAxes, variantGridModule } from "./preview";

const compiles = (source: string) => {
	transform(source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
	return true;
};
const exp = (source: string) => componentApi("components/x.tsx", source).exports[0]!;

const METRIC = exp(`import type { LucideIcon } from "lucide-react";
export function MetricTile({ label, value, change, percent, icon: Icon, tone = "neutral", live, onOpen, children, tags, rows }: {
	label: string;
	value: number;
	change?: string;
	percent: number;
	icon: LucideIcon;
	tone?: "neutral" | "positive" | "negative";
	live: boolean;
	onOpen: () => void;
	children: React.ReactNode;
	tags: string[];
	rows: { id: string }[];
}) {
	return <div>{label}</div>;
}
`);

describe("sampleProps", () => {
	test("required props, enums and children; functions and optional props left out", () => {
		expect(sampleProps(METRIC)).toEqual({
			label: "Label",
			value: 42,
			percent: 64,
			icon: { icon: "Star" },
			tone: "neutral",
			live: false,
			children: "Metric tile",
			tags: ["Design", "Research", "Launch"],
			rows: [],
		});
	});

	test("names become readable, special names get plausible values", () => {
		expect(humanize("firstName")).toBe("First name");
		expect(humanize("due_date")).toBe("Due date");
		const card = exp(`export function ContactCard({ fullName, email, href, dueDate, count }: { fullName: string; email: string; href: string; dueDate: string; count: number }) { return null; }`);
		expect(sampleProps(card)).toEqual({ fullName: "Full name", email: "ana@example.com", href: "#", dueDate: "Mar 14", count: 3 });
	});

	test("enum default wins over the first option; elements that take children get a label", () => {
		const button = exp(`import { cva, type VariantProps } from "class-variance-authority";
const v = cva("", { variants: { size: { sm: "", lg: "" } }, defaultVariants: { size: "lg" } });
export function Action(props: React.ComponentProps<"button"> & VariantProps<typeof v>) { return <button {...props} />; }`);
		expect(sampleProps(button)).toEqual({ size: "lg", children: "Action" });
	});
});

describe("previewModule", () => {
	test("renders the component with its props, centered on the background", () => {
		const source = previewModule({ componentPath: "components/metric-tile.tsx", exportName: "MetricTile", props: sampleProps(METRIC) });
		expect(source).toContain('import { Star as StarIcon } from "lucide-react";');
		expect(source).toContain('import { MetricTile } from "../components/metric-tile";');
		expect(source).toContain("export default function MetricTilePreview()");
		expect(source).toContain("flex min-h-full items-center justify-center bg-background p-8");
		expect(source).toContain('<MetricTile label={"Label"} value={42} percent={64} icon={StarIcon} tone={"neutral"} live={false} tags={["Design","Research","Launch"]} rows={[]}>{"Metric tile"}</MetricTile>');
		expect(compiles(source)).toBe(true);
	});

	test("layouts", () => {
		const stretch = previewModule({ componentPath: "components/a.tsx", exportName: "A", props: { on: true }, layout: "stretch" });
		expect(stretch).toContain('<div className="w-full max-w-md">');
		expect(stretch).toContain("<A on />");
		const fill = previewModule({ componentPath: "components/a.tsx", exportName: "A", props: {}, layout: "fill" });
		expect(fill).not.toContain("p-8");
		expect(compiles(stretch) && compiles(fill)).toBe(true);
		expect(previewLayout("TabBar")).toBe("fill");
		expect(previewLayout("StatCard")).toBe("stretch");
		expect(previewLayout("Pill")).toBe("center");
	});

	test("strings that would break JSX are escaped", () => {
		const source = previewModule({ componentPath: "components/a.tsx", exportName: "A", props: { title: 'Say "hi" {now} </A>', children: "<b>" } });
		expect(compiles(source)).toBe(true);
	});

	test("paths", () => {
		expect(previewPath("StatCard")).toBe("preview/stat-card.tsx");
		expect(previewImport("components/stat-card.tsx")).toBe("../components/stat-card");
	});
});

describe("variantGridModule", () => {
	test("one labelled instance per option of each axis", () => {
		const source = variantGridModule({ componentPath: "components/metric-tile.tsx", component: METRIC })!;
		expect(source).toContain('<p className="text-xs font-medium text-muted-foreground">tone</p>');
		for (const tone of ["neutral", "positive", "negative"]) expect(source).toContain(`tone={"${tone}"}`);
		expect(source).toContain('{"positive"}</span>');
		expect(source).toContain("export default function MetricTilePreviewVariants()");
		expect(compiles(source)).toBe(true);
	});

	test("cva variants are the axes when present", () => {
		const pill = exp(`import { cva, type VariantProps } from "class-variance-authority";
const v = cva("", { variants: { tone: { a: "", b: "" }, size: { sm: "", md: "" } } });
export function Pill({ shape = "round" }: VariantProps<typeof v> & { shape?: "round" | "square" }) { return null; }`);
		expect(variantAxes(pill).map((a) => a.name)).toEqual(["tone", "size"]);
		expect(compiles(variantGridModule({ componentPath: "components/pill.tsx", component: pill, props: {} })!)).toBe(true);
	});

	test("null without variants", () => {
		const plain: ComponentExport = { name: "Plain", props: [], variants: {}, acceptsChildren: false };
		expect(variantGridModule({ componentPath: "components/plain.tsx", component: plain })).toBeNull();
	});
});

describe("libraryPreviewModule", () => {
	test("every library item previews as a compilable module with its imports", () => {
		for (const item of LIBRARY) {
			const source = libraryPreviewModule(item);
			expect(compiles(source)).toBe(true);
			for (const { from, names } of item.imports) expect(source).toContain(`import { ${names.join(", ")} } from "${from}";`);
			expect(source).toMatch(/export default function [A-Z]\w*Preview\(\)/);
		}
	});
});

describe("previews render", () => {
	/** Evaluates `entry` from `files` like the frame does: runtime externals, relative project imports. */
	const render = async (files: Record<string, string>, entry: string) => {
		const { externals } = await import("../../mainview/runtime/externals");
		const { joinPath } = await import("../../mainview/lib/render/resolve");
		const { renderToString } = await import("react-dom/server");
		const { createElement } = await import("react");
		const cache = new Map<string, unknown>();
		const load = (path: string): any => {
			if (cache.has(path)) return cache.get(path);
			const { code } = transform(files[path]!, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
			const module = { exports: {} as Record<string, unknown> };
			cache.set(path, module.exports);
			const require = (specifier: string) => (specifier.startsWith(".") ? load(`${joinPath(path, specifier)}.tsx`) : externals[specifier]);
			new Function("require", "module", "exports", code)(require, module, module.exports);
			return module.exports;
		};
		return renderToString(createElement(load(entry).default));
	};

	test("library items", async () => {
		for (const item of LIBRARY) expect((await render({ "preview/item.tsx": libraryPreviewModule(item) }, "preview/item.tsx")).length).toBeGreaterThan(100);
	});

	test("a project component, its sample props and its variant grid", async () => {
		const source = `import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
export function MetricTile({ label, value, icon: Icon, tone = "neutral", tags }: { label: string; value: number; icon: LucideIcon; tone?: "neutral" | "positive"; tags: string[] }) {
	return <div className="rounded-lg border p-4"><Icon className="size-4" /><p>{label}</p><p>{value}</p><Badge>{tone}</Badge>{tags.map((t) => <span key={t}>{t}</span>)}</div>;
}
`;
		const tile = exp(source);
		const preview = previewModule({ componentPath: "components/metric-tile.tsx", exportName: "MetricTile", props: sampleProps(tile), layout: previewLayout(tile.name) });
		const html = await render({ "components/metric-tile.tsx": source, [previewPath(tile.name)]: preview }, previewPath(tile.name));
		expect(html).toContain("Label");
		expect(html).toContain("Research");
		const grid = variantGridModule({ componentPath: "components/metric-tile.tsx", component: tile })!;
		const gridHtml = await render({ "components/metric-tile.tsx": source, "preview/grid.tsx": grid }, "preview/grid.tsx");
		expect(gridHtml).toContain("positive");
	});
});
