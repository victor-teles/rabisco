import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { decompressSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import { isString } from "../../guards";
import { isJsonArray, isJsonObject, type Json } from "../../json";
import { parseCapturedTree, type CapturedTree } from "../../import/captured-tree";
import { readFigKiwi } from "../../import/figma/clipboard";
import { decodeSchema } from "../../import/figma/kiwi";
import { EXPORT_SCHEMA } from "./schema";
import { screensToFigma } from "./to-figma";

const FIGMA_COPY = new URL("./fixtures/figma-copy.html", import.meta.url);

const definitionOf = (name: string) => EXPORT_SCHEMA.find((definition) => definition.name === name);

function fieldsOf(name: string) {
	return new Map(
		(definitionOf(name)?.fields ?? []).flatMap((field) => (isString(field) ? [] : [[field[0], field] as const])),
	);
}

const FIELD_TYPES = new Map([
	["parentIndex", "ParentIndex"],
	["textData", "TextData"],
	["styleOverrideTable", "NodeChange"],
	["fillPaints", "Paint"],
	["strokePaints", "Paint"],
	["effects", "Effect"],
	["image", "Image"],
	["vectorData", "VectorData"],
	["fillGeometry", "Path"],
]);

function unknownFields(type: string, value: Json, path: string, out: string[]) {
	if (!isJsonObject(value)) return;
	const fields = fieldsOf(type);

	for (const [key, field] of Object.entries(value)) {
		if (field === undefined) continue;

		if (!fields.has(key)) out.push(`${path}.${key}`);
		const nested = FIELD_TYPES.get(key);

		if (!nested) continue;

		for (const item of isJsonArray(field) ? field : [field]) unknownFields(nested, item, `${path}.${key}`, out);
	}
}

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
	test("has every field the encoder writes", async () => {
		const { nodeChanges } = screensToFigma(await capturedScreens());
		const unknown: string[] = [];

		// SAFETY: JSON.parse without a reviver only produces JSON values
		const changes = JSON.parse(JSON.stringify(nodeChanges)) as Json[];

		for (const change of changes) unknownFields("NodeChange", change, "NodeChange", unknown);

		expect([...new Set(unknown)]).toEqual([]);
	});

	test("names only types it defines", () => {
		const names = new Set(EXPORT_SCHEMA.map((definition) => definition.name));
		const builtins = new Set(["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"]);

		const missing = EXPORT_SCHEMA.flatMap((definition) =>
			definition.fields.flatMap((field) =>
				isString(field) || names.has(field[1]) || builtins.has(field[1]) ? [] : [field[1]],
			),
		);

		expect(missing).toEqual([]);
	});

	test.skipIf(!existsSync(FIGMA_COPY))("matches the schema of a real Figma copy", async () => {
		const html = await Bun.file(FIGMA_COPY).text();
		const encoded = /\(figma\)([A-Za-z0-9+/=\s]*)\(\/figma\)/.exec(html)?.[1] ?? "";

		const { schema: chunk } = readFigKiwi(
			Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (char) => char.charCodeAt(0)),
		);

		const zstd = chunk[0] === 0x28 && chunk[1] === 0xb5;
		const real = decodeSchema(zstd ? zstdDecompress(chunk) : decompressSync(chunk));
		const problems: string[] = [];

		for (const definition of EXPORT_SCHEMA) {
			const figma = real.definitions.get(definition.name);

			if (!figma) {
				problems.push(`${definition.name} is missing`);
				continue;
			}

			for (const field of definition.fields) {
				const [name, type, isArray] = isString(field) ? [field, "", false] : field;
				const match = figma.fields.find((candidate) => candidate.name === name);

				if (!match) problems.push(`${definition.name}.${name} is missing`);
				else if (match.type !== type || match.isArray !== !!isArray)
					problems.push(`${definition.name}.${name} is ${match.type}${match.isArray ? "[]" : ""}`);
			}
		}

		expect(problems).toEqual([]);
	});
});
