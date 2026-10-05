import { toKebab } from "../project";
import type { ComponentExport, PropSpec } from "./api";
import type { LibraryItem } from "./library";

/**
 * Preview modules for components: TSX files that default-export a small scene
 * rendering one component, for the frame renderer. They live at virtual paths
 * (`preview/<kebab>.tsx`) next to the project files, so project components are
 * imported relatively (`../components/<kebab>`).
 */

/** A prop value a preview can write as JSX: literals, a lucide icon by name, or a list. */
export type PreviewValue = string | number | boolean | { icon: string } | (string | number)[];

export type PreviewProps = Record<string, PreviewValue>;

/**
 * `center`: the component at its own size, centered. `stretch`: full width of a
 * centered column (cards, lists, forms). `fill`: the whole frame, no padding (bars, sidebars, layouts).
 */
export type PreviewLayout = "center" | "stretch" | "fill";

/** `preview/<kebab>.tsx` for a component or library item name. */
export const previewPath = (name: string) => `preview/${toKebab(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))}.tsx`;

/** `components/stat-card.tsx` → `../components/stat-card`, from a `preview/*` module. */
export const previewImport = (componentPath: string) => `../${componentPath.replace(/\.tsx?$/, "")}`;

/** `firstName` / `first_name` → `First name` */
export function humanize(name: string): string {
	const words = name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words ? words[0]!.toUpperCase() + words.slice(1) : "Text";
}

const ICON_TYPE = /\b(?:LucideIcon|ComponentType|ElementType|FC|FunctionComponent|IconType)\b/;

function sampleString(name: string): string {
	const key = name.toLowerCase();
	if (key.includes("email")) return "ana@example.com";
	if (/^(href|url|link|to)$/.test(key)) return "#";
	if (/(src|image)$/.test(key)) return "";
	if (key.includes("date")) return "Mar 14";
	if (/(price|amount|total|cost)/.test(key)) return "$24.00";
	if (/(initials)/.test(key)) return "AL";
	return humanize(name);
}

function sampleNumber(name: string): number {
	const key = name.toLowerCase();
	if (/(percent|progress|ratio)/.test(key)) return 64;
	if (/rating|stars/.test(key)) return 4;
	if (/(price|amount|total|value)/.test(key)) return 42;
	if (/(index|active|selected)/.test(key)) return 0;
	return 3;
}

function sampleOf(prop: PropSpec, owner: string): PreviewValue | undefined {
	const { type } = prop;
	switch (type.kind) {
		case "enum":
			return typeof prop.default === "string" && type.options.includes(prop.default) ? prop.default : type.options[0];
		case "boolean":
			return prop.optional ? undefined : typeof prop.default === "boolean" ? prop.default : false;
		case "string":
			return prop.optional ? undefined : typeof prop.default === "string" ? prop.default : sampleString(prop.name);
		case "number":
			return prop.optional ? undefined : typeof prop.default === "number" ? prop.default : sampleNumber(prop.name);
		case "node":
			return prop.optional && prop.name !== "children" ? undefined : prop.name === "children" ? humanize(owner) : humanize(prop.name);
		case "function":
			return undefined;
		case "other":
			if (prop.optional) return undefined;
			if (ICON_TYPE.test(type.text)) return { icon: "Star" };
			if (/^(?:string\[\]|Array<string>)$/.test(type.text)) return ["Design", "Research", "Launch"];
			if (/^(?:number\[\]|Array<number>)$/.test(type.text)) return [12, 18, 9, 24];
			if (/\[\]$|^Array</.test(type.text)) return [];
			return undefined;
	}
}

/**
 * Plausible props to render `exp` on its own: every required prop and every
 * enum/variant (default or first option). Strings come from the prop name,
 * children from the component name; functions are left out.
 */
export function sampleProps(exp: ComponentExport): PreviewProps {
	const props: PreviewProps = {};
	for (const prop of exp.props) {
		const value = sampleOf(prop, exp.name);
		if (value !== undefined) props[prop.name] = value;
	}
	if (exp.acceptsChildren && !("children" in props) && !exp.props.some((p) => p.name === "children")) props.children = humanize(exp.name);
	return props;
}

/** A layout that suits the component, from its name. */
export function previewLayout(name: string): PreviewLayout {
	if (/(Nav|Bar|Sidebar|Header|Footer|Layout|Shell|Navigation)$/.test(name)) return "fill";
	if (/(Card|List|Table|Form|Panel|Section|Item|Row|Tile|Group|Grid|Feed)$/.test(name)) return "stretch";
	return "center";
}

const SURFACE: Record<PreviewLayout, { outer: string; inner?: string }> = {
	center: { outer: "flex min-h-full items-center justify-center bg-background p-8 text-foreground" },
	stretch: { outer: "flex min-h-full items-center justify-center bg-background p-8 text-foreground", inner: "w-full max-w-md" },
	fill: { outer: "flex min-h-full flex-col bg-background text-foreground" },
};

/** JSX attributes and children for `props`; icons are collected into `icons` (alias → lucide name). */
function jsxProps(props: PreviewProps, icons: Map<string, string>): { attrs: string; children?: string } {
	const attrs: string[] = [];
	let children: string | undefined;
	for (const [name, value] of Object.entries(props)) {
		let expr: string;
		if (typeof value === "object" && !Array.isArray(value)) {
			const alias = `${value.icon}Icon`;
			icons.set(alias, value.icon);
			expr = alias;
		} else expr = JSON.stringify(value);
		if (name === "children") children = typeof value === "string" ? `{${expr}}` : `<${expr} />`;
		else attrs.push(typeof value === "boolean" && value ? name : `${name}={${expr}}`);
	}
	return { attrs: attrs.length ? ` ${attrs.join(" ")}` : "", children };
}

const element = (tag: string, props: PreviewProps, icons: Map<string, string>) => {
	const { attrs, children } = jsxProps(props, icons);
	return children === undefined ? `<${tag}${attrs} />` : `<${tag}${attrs}>${children}</${tag}>`;
};

const indent = (text: string, tabs: number) => text.split("\n").map((line) => (line ? "\t".repeat(tabs) + line : line)).join("\n");

function moduleSource(imports: string[], name: string, body: string, layout: PreviewLayout): string {
	const surface = SURFACE[layout];
	const content = surface.inner ? `<div className="${surface.inner}">\n${indent(body, 1)}\n</div>` : body;
	return `${imports.join("\n")}

export default function ${name}() {
	return (
		<div className="${surface.outer}">
${indent(content, 3)}
		</div>
	);
}
`;
}

const iconImport = (icons: Map<string, string>) =>
	icons.size ? [`import { ${[...icons].map(([alias, icon]) => `${icon} as ${alias}`).join(", ")} } from "lucide-react";`] : [];

const previewName = (name: string) => `${name.replace(/[^\w$]/g, "")}Preview`;

export type PreviewModuleParams = {
	/** `components/<kebab>.tsx` */
	componentPath: string;
	exportName: string;
	props: PreviewProps;
	layout?: PreviewLayout;
};

/** TSX of a module that default-exports a preview of one component with `props`. */
export function previewModule({ componentPath, exportName, props, layout = "center" }: PreviewModuleParams): string {
	const icons = new Map<string, string>();
	const body = element(exportName, props, icons);
	const imports = [...iconImport(icons), `import { ${exportName} } from "${previewImport(componentPath)}";`];
	return moduleSource(imports, previewName(exportName), body, layout);
}

/** The axes a variant grid shows: cva variants, or else enum props. */
export function variantAxes(exp: ComponentExport): { name: string; options: string[] }[] {
	const cva = Object.entries(exp.variants).map(([name, v]) => ({ name, options: v.options }));
	if (cva.length) return cva;
	return exp.props.flatMap((p) => (p.type.kind === "enum" ? [{ name: p.name, options: p.type.options }] : []));
}

export type VariantGridParams = {
	componentPath: string;
	component: ComponentExport;
	/** Base props for every instance; defaults to `sampleProps(component)` */
	props?: PreviewProps;
};

/**
 * TSX of a module showing one labelled instance per option of each variant
 * axis (one row per axis), or `null` when the component has no variants.
 */
export function variantGridModule({ componentPath, component, props }: VariantGridParams): string | null {
	const axes = variantAxes(component);
	if (!axes.length) return null;
	const base = props ?? sampleProps(component);
	const icons = new Map<string, string>();
	const rows = axes.map(({ name, options }) => {
		const cells = options.map((option) => {
			const instance = element(component.name, { ...base, [name]: option }, icons);
			return `<div className="flex flex-col items-center gap-2">\n\t${instance}\n\t<span className="text-[11px] text-muted-foreground">{${JSON.stringify(option)}}</span>\n</div>`;
		});
		return `<section className="flex flex-col gap-3">\n\t<p className="text-xs font-medium text-muted-foreground">${name}</p>\n\t<div className="flex flex-wrap items-end gap-6">\n${indent(cells.join("\n"), 2)}\n\t</div>\n</section>`;
	});
	const body = `<div className="flex flex-col gap-8">\n${indent(rows.join("\n"), 1)}\n</div>`;
	const imports = [...iconImport(icons), `import { ${component.name} } from "${previewImport(componentPath)}";`];
	return moduleSource(imports, `${previewName(component.name)}Variants`, body, "center");
}

/** TSX of a module previewing a shadcn library item's snippet. */
export function libraryPreviewModule(item: LibraryItem, layout: PreviewLayout = "center"): string {
	const imports = item.imports.map(({ from, names }) => `import { ${names.join(", ")} } from "${from}";`);
	const name = `${item.title.replace(/[^A-Za-z0-9]/g, "")}Preview`;
	return moduleSource(imports, /^[A-Z]/.test(name) ? name : `Item${name}`, item.snippet.trim(), layout);
}
