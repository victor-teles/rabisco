/// <reference types="vite/client" />
// Every icon of a pack, for the icon picker and the assets panel. Imported lazily, and each pack loads as its own
// chunk, so the editor bundle keeps only the icons its chrome uses (decision 0050).
import { createElement, type ComponentType } from "react";
import { icons as lucideIcons } from "lucide-react";
import { isString } from "../../shared/guards";
import { iconBase, type IconPack } from "../../shared/icons";
import { isJsonArray, isJsonObject, type Json } from "../../shared/json";

type SvgNode = [string, Record<string, string>][];

/** `name` is what a screen imports (`Star`, `IconStarFilled`); `base` is what the editor shows */
export type CatalogIcon = { name: string; base: string; Icon: ComponentType<{ className?: string }> };

function isSvgNode(value: Json | undefined): value is SvgNode {
	return (
		isJsonArray(value) &&
		value.every(
			(part) =>
				isJsonArray(part) &&
				isString(part[0]) &&
				isJsonObject(part[1]) &&
				Object.values(part[1]).every((attribute) => isString(attribute)),
		)
	);
}

function parseNodes(text: string): Map<string, SvgNode> {
	const parsed: Json = JSON.parse(text);
	const nodes = new Map<string, SvgNode>();

	if (!isJsonObject(parsed)) return nodes;

	for (const [name, node] of Object.entries(parsed)) if (isSvgNode(node)) nodes.set(name, node);

	return nodes;
}

/** Phosphor's SVGs hold only `<path>`s */
const svgPaths = (svg: string) => [...svg.matchAll(/<path\s[^>]*?\bd="([^"]*)"/g)].map((match) => match[1]!);

function nodeIcon(node: SvgNode, paint: Record<string, string>, viewBox: string): CatalogIcon["Icon"] {
	return function CatalogNodeIcon({ className }) {
		return createElement(
			"svg",
			{ xmlns: "http://www.w3.org/2000/svg", viewBox, className, "aria-hidden": true, ...paint },
			node.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs })),
		);
	};
}

const TABLER_OUTLINE = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: "2",
	strokeLinecap: "round",
	strokeLinejoin: "round",
};

/** @tabler/icons-react's names: `a-b-2` → `IconAB2` */
const tablerName = (name: string) => `Icon${name.replace(/(^\w|-\w)/g, (part) => part.replace("-", "").toUpperCase())}`;

async function tablerCatalog(): Promise<CatalogIcon[]> {
	const [{ default: outline }, { default: filled }] = await Promise.all([
		import("../../../node_modules/@tabler/icons/tabler-nodes-outline.json?raw"),
		import("../../../node_modules/@tabler/icons/tabler-nodes-filled.json?raw"),
	]);

	const icons: CatalogIcon[] = [];

	for (const [file, node] of parseNodes(outline)) {
		const name = tablerName(file);
		icons.push({ name, base: iconBase("tabler", name), Icon: nodeIcon(node, TABLER_OUTLINE, "0 0 24 24") });
	}

	for (const [file, node] of parseNodes(filled)) {
		const name = `${tablerName(file)}Filled`;
		icons.push({ name, base: iconBase("tabler", name), Icon: nodeIcon(node, { fill: "currentColor" }, "0 0 24 24") });
	}

	return icons;
}

async function phosphorCatalog(): Promise<CatalogIcon[]> {
	const [{ icons }, { svgs }] = await Promise.all([import("@phosphor-icons/core"), import("./phosphor-svgs")]);
	const catalog: CatalogIcon[] = [];

	for (const icon of icons) {
		const svg = svgs[`../../../node_modules/@phosphor-icons/core/assets/regular/${icon.name}.svg`];

		if (!svg) continue;
		const node: SvgNode = svgPaths(svg).map((d) => ["path", { d }]);
		catalog.push({
			name: icon.pascal_name,
			base: icon.pascal_name,
			Icon: nodeIcon(node, { fill: "currentColor" }, "0 0 256 256"),
		});
	}

	return catalog;
}

export async function iconCatalog(pack: IconPack): Promise<CatalogIcon[]> {
	if (pack === "tabler") return tablerCatalog();

	if (pack === "phosphor") return phosphorCatalog();

	return Object.entries(lucideIcons).map(([name, Icon]) => ({ name, base: name, Icon }));
}
