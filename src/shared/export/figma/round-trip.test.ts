import { describe, expect, test } from "bun:test";
import { parseCapturedTree, TEXT_TAG, type CapturedNode, type CapturedTree } from "../../import/captured-tree";
import { readFigmaClipboard } from "../../import/figma/clipboard";
import { figmaToCaptured } from "../../import/figma/to-captured";
import { figmaClipboard } from "./clipboard";
import { fontSet, type FontFile } from "./font";
import type { NodeFields } from "./node-change";
import { screensToFigma, type FigmaScreen } from "./to-figma";

const FIXTURES = ["dashboard", "form", "landing", "settings", "mobile-list"];

type Fixture = { name: string; tree: CapturedTree };

async function fixture(name: string): Promise<Fixture> {
	const text = await Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).text();
	const { name: title, tree }: { name: string; tree: CapturedTree } = JSON.parse(text);
	const parsed = parseCapturedTree(JSON.stringify(tree));

	if (!parsed) throw new Error(`${name} isn't a captured tree`);

	return { name: title, tree: parsed };
}

type Written = { change: NodeFields; children: Written[] };

const guidKey = (change: NodeFields) => `${change.guid?.sessionID}:${change.guid?.localID}`;

function writtenTree(changes: NodeFields[]): Written[] {
	const byKey = new Map<string, Written>(changes.map((change) => [guidKey(change), { change, children: [] }]));
	const roots: Written[] = [];

	for (const written of byKey.values()) {
		const parent = written.change.parentIndex;
		const owner = parent && byKey.get(`${parent.guid.sessionID}:${parent.guid.localID}`);

		if (owner && owner.change.type !== "DOCUMENT" && owner.change.type !== "CANVAS") owner.children.push(written);
		else if (written.change.type !== "DOCUMENT" && written.change.type !== "CANVAS") roots.push(written);
	}

	return roots;
}

const px = (value: number | undefined) => `${Math.round((value ?? 0) * 100) / 100}px`;

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

const JUSTIFY = new Map([
	["MIN", "flex-start"],
	["CENTER", "center"],
	["MAX", "flex-end"],
	["SPACE_BETWEEN", "space-between"],
]);

const ALIGN = new Map([
	["MIN", "flex-start"],
	["CENTER", "center"],
	["MAX", "flex-end"],
	["BASELINE", "baseline"],
]);

type Problem = string;

type Parent = { origin: { x: number; y: number }; row: boolean | null };

function checkSizing(change: NodeFields, read: CapturedNode, parent: Parent, at: string, out: Problem[]) {
	const row = change.stackMode === "HORIZONTAL";
	const grows = (change.stackChildPrimaryGrow ?? 0) > 0;
	const stretches = change.stackChildAlignSelf === "STRETCH";
	const primaryHug = change.stackPrimarySizing !== "FIXED";
	const counterHug = change.stackCounterSizing !== "FIXED";
	const fillsWidth = parent.row === null ? false : parent.row ? grows : stretches;
	const fillsHeight = parent.row === null ? false : parent.row ? stretches : grows;
	const hugsWidth = (row ? primaryHug : counterHug) || fillsWidth;
	const hugsHeight = (row ? counterHug : primaryHug) || fillsHeight;

	if ((read.styles.width === undefined) !== hugsWidth) out.push(`${at}: width ${read.styles.width}`);

	if ((read.styles.height === undefined) !== hugsHeight) out.push(`${at}: height ${read.styles.height}`);
}

function compare(written: Written, read: CapturedNode, parent: Parent, path: string, out: Problem[]) {
	const { origin } = parent;
	const { change } = written;
	const at = `${path}/${change.name}`;
	const x = origin.x + (change.transform?.m02 ?? 0);
	const y = origin.y + (change.transform?.m12 ?? 0);

	if (read.name !== change.name) out.push(`${at}: read as ${read.name}`);

	if (
		!near(read.box.x, x) ||
		!near(read.box.y, y) ||
		!near(read.box.width, change.size?.x ?? 0) ||
		!near(read.box.height, change.size?.y ?? 0)
	)
		out.push(`${at}: box ${JSON.stringify(read.box)}`);

	if (change.type === "TEXT") {
		const text = read.children.find((child) => child.tag === TEXT_TAG)?.text;
		const font = change.fontName;
		const paint = change.fillPaints?.[0];
		const color = paint?.color;

		if (text !== change.textData?.characters) out.push(`${at}: text ${JSON.stringify(text)}`);

		if (read.styles["font-family"] !== `"${font?.family}"`) out.push(`${at}: font ${read.styles["font-family"]}`);

		if (read.styles["font-size"] !== px(change.fontSize)) out.push(`${at}: size ${read.styles["font-size"]}`);

		if (color && paint) {
			const channel = (value: number) => Math.round(value * 255);
			const rgb = `${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}`;
			const alpha = Math.round(paint.opacity * 1000) / 1000;

			if (read.styles.color !== (alpha >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`))
				out.push(`${at}: color ${read.styles.color}`);
		}

		return;
	}

	if (change.stackMode) {
		const row = change.stackMode === "HORIZONTAL";

		if (parent.row !== null) checkSizing(change, read, parent, at, out);

		const expected: [string, string | undefined][] = [
			["display", "flex"],
			["flex-direction", row ? "row" : "column"],
			["justify-content", JUSTIFY.get(change.stackPrimaryAlignItems ?? "MIN")],
			["align-items", ALIGN.get(change.stackCounterAlignItems ?? "MIN")],
			["flex-wrap", change.stackWrap === "WRAP" ? "wrap" : undefined],
			[
				row ? "column-gap" : "row-gap",
				change.stackSpacing && change.stackPrimaryAlignItems !== "SPACE_BETWEEN" ? px(change.stackSpacing) : undefined,
			],
			["padding-left", change.stackHorizontalPadding ? px(change.stackHorizontalPadding) : undefined],
			["padding-top", change.stackVerticalPadding ? px(change.stackVerticalPadding) : undefined],
			["padding-right", change.stackPaddingRight ? px(change.stackPaddingRight) : undefined],
			["padding-bottom", change.stackPaddingBottom ? px(change.stackPaddingBottom) : undefined],
		];

		for (const [property, value] of expected) {
			if (read.styles[property] !== value) out.push(`${at}: ${property} ${read.styles[property]}, wrote ${value}`);
		}
	}

	const children = change.type === "VECTOR" ? [] : written.children;

	if (read.children.length !== children.length) {
		out.push(`${at}: ${read.children.length} children, wrote ${children.length}`);

		return;
	}

	const row = change.stackMode ? change.stackMode === "HORIZONTAL" : null;

	children.forEach((child, i) => {
		const absolute = child.change.stackPositioning === "ABSOLUTE";

		compare(child, read.children[i]!, { origin: { x, y }, row: absolute ? null : row }, at, out);
	});
}

describe("Copy to Figma round trip on captured screens", () => {
	for (const name of FIXTURES) {
		test(name, async () => {
			const { name: title, tree } = await fixture(name);
			const screen: FigmaScreen = { name: title, x: 0, y: 0, tree, images: new Map() };
			const [written] = writtenTree(screensToFigma([screen]).nodeChanges);
			const { html } = figmaClipboard([screen]);
			const imported = figmaToCaptured(readFigmaClipboard(html).message);
			const read = imported.screens[0];
			const problems: Problem[] = [];

			expect(written).toBeDefined();
			expect(read?.title).toBe(title);

			if (written && read)
				compare(
					written,
					read.root,
					{ origin: { x: -(written.change.transform?.m02 ?? 0), y: -(written.change.transform?.m12 ?? 0) }, row: null },
					"",
					problems,
				);
			expect(problems).toEqual([]);
		});
	}

	test("every text layer carries glyph outlines that sit inside it, one baseline per line", async () => {
		const files: FontFile[] = [];

		for (const subset of ["latin", "latin-ext"]) {
			for (const weight of [400, 500, 600, 700]) {
				const file = Bun.file(
					new URL(
						`../../../../node_modules/@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`,
						import.meta.url,
					),
				);

				files.push({ weight, unicodeRange: "", bytes: new Uint8Array(await file.arrayBuffer()) });
			}
		}

		const fonts = fontSet(files);
		const problems: Problem[] = [];

		for (const name of FIXTURES) {
			const { name: title, tree } = await fixture(name);
			const { html } = figmaClipboard([{ name: title, x: 0, y: 0, tree, images: new Map() }], fonts);
			const { message } = readFigmaClipboard(html);
			const changes: NodeFields[] = Array.isArray(message.nodeChanges) ? message.nodeChanges : [];

			for (const change of changes) {
				if (change.type !== "TEXT") continue;
				const glyphs = change.derivedTextData?.glyphs ?? [];
				const height = change.size?.y ?? 0;

				const lineHeight =
					change.lineHeight?.units === "PIXELS" ? change.lineHeight.value : (change.fontSize ?? 16) * 1.21;

				const lines = new Set(glyphs.map((glyph) => Math.round(glyph.position.y))).size;
				const at = `${name} "${change.textData?.characters}"`;

				if (!glyphs.length) problems.push(`${at}: no glyphs`);

				if (glyphs.some((glyph) => glyph.position.y <= 0 || glyph.position.y > height + 1))
					problems.push(`${at}: a baseline outside the layer`);

				if (!change.maxLines && lines !== Math.max(1, Math.round(height / lineHeight)))
					problems.push(`${at}: ${lines} lines in a layer ${height}px tall`);
			}
		}

		expect(problems).toEqual([]);
	});

	test("layers have names a designer would keep", async () => {
		for (const name of FIXTURES) {
			const { name: title, tree } = await fixture(name);
			const { nodeChanges } = screensToFigma([{ name: title, x: 0, y: 0, tree, images: new Map() }]);
			const names = nodeChanges.map((change) => change.name ?? "");

			expect(names.filter((layer) => /^(div|span|Frame \d+|Group \d+|[A-Z][a-z]?)$/.test(layer))).toEqual([]);
		}
	});
});
