// Copies the schema chunk of the checked-in real Figma copy into the Copy to Figma encoder (decision 0039).
// Run it after you capture a new `src/shared/export/figma/fixtures/figma-copy.html`.

import { readFigKiwi } from "../src/shared/import/figma/clipboard";

const FIXTURE = new URL("../src/shared/export/figma/fixtures/figma-copy.html", import.meta.url);

const OUT = new URL("../src/shared/export/figma/figma-schema.ts", import.meta.url);

const encoded = /\(figma\)([A-Za-z0-9+/=\s]*)\(\/figma\)/.exec(await Bun.file(FIXTURE).text())?.[1];

if (!encoded) throw new Error("The fixture has no Figma buffer");

const { version, schema } = readFigKiwi(Buffer.from(encoded.replace(/\s+/g, ""), "base64"));

await Bun.write(
	OUT,
	`export const FIG_KIWI_VERSION = ${version};\n\nexport const FIGMA_SCHEMA_CHUNK =\n\t"${Buffer.from(schema).toString("base64")}";\n`,
);

console.log(`Wrote the version ${version} schema (${schema.length} bytes) to ${OUT.pathname}`);
