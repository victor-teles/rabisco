// Inlines tailwindcss/index.css so both the main process and the webview can use it without file access.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const css = readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8");
writeFileSync(join(import.meta.dir, "generated/tailwind-index.ts"), `export default ${JSON.stringify(css)};\n`);
console.log("wrote generated/tailwind-index.ts");
