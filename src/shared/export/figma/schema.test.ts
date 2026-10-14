import { describe, expect, test } from "bun:test";
import { decompressSync } from "fflate";
import { parseCapturedTree, type CapturedTree } from "../../import/captured-tree";
import { readFigKiwi, readFigmaClipboard } from "../../import/figma/clipboard";
import { decodeSchema } from "../../import/figma/kiwi";
import { figmaClipboard } from "./clipboard";
import { FIG_KIWI_VERSION, FIGMA_SCHEMA_CHUNK } from "./figma-schema";
import { encodeKiwiMessage } from "./kiwi-writer";

const FIGMA_COPY = new URL("./fixtures/figma-copy.html", import.meta.url);

const figmaBuffer = (html: string) =>
	readFigKiwi(Buffer.from(/\(figma\)([A-Za-z0-9+/=\s]*)\(\/figma\)/.exec(html)?.[1] ?? "", "base64"));

async function capturedScreens() {
	const screens = [];

	for (const name of ["dashboard", "form", "landing", "settings", "mobile-list"]) {
		const text = await Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).text();
		const { tree }: { tree: CapturedTree } = JSON.parse(text);
		const parsed = parseCapturedTree(JSON.stringify(tree));

		if (parsed) screens.push({ name, x: 0, y: 0, tree: parsed, images: new Map() });
	}

	return screens;
}

describe("the export schema", () => {
	test("is the schema of the real Figma copy", async () => {
		const real = figmaBuffer(await Bun.file(FIGMA_COPY).text());

		expect(FIG_KIWI_VERSION).toBe(real.version);
		expect(FIGMA_SCHEMA_CHUNK).toBe(Buffer.from(real.schema).toString("base64"));
	});

	test("encodes the fixture screens with Figma's field numbers", async () => {
		const { html, copied } = figmaClipboard(await capturedScreens());
		const ours = figmaBuffer(html);
		const { message } = readFigmaClipboard(html);

		expect(copied).toBe(5);
		expect(ours.version).toBe(FIG_KIWI_VERSION);
		expect(Buffer.from(ours.schema).toString("base64")).toBe(FIGMA_SCHEMA_CHUNK);
		expect(message.pasteEditorType).toBe("DESIGN");
		expect(message.clipboardSelectionRegions).toHaveLength(1);
	});

	test("rejects a field Figma's schema doesn't have", () => {
		const schema = decodeSchema(decompressSync(Buffer.from(FIGMA_SCHEMA_CHUNK, "base64")));

		expect(() => encodeKiwiMessage(schema, "Message", { type: "NODE_CHANGES", rabisco: true })).toThrow(
			"Message has no field rabisco",
		);
	});
});
