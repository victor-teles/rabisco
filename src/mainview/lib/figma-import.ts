import type { DesignTokens } from "../../shared/context/tokens";
import { isFiniteNumber, isString } from "../../shared/guards";
import { parseCapturedTree, type CapturedTree } from "../../shared/import/captured-tree";
import { UNREADABLE_FIGMA } from "../../shared/import/figma/clipboard";
import { figmaScreens, type FigmaScreens } from "../../shared/import/figma/screens";
import type { FigmaToken } from "../../shared/import/figma/to-captured";
import { isJsonArray, isJsonObject, type Json } from "../../shared/json";
import { appliedTheme } from "./html-import";

const DECODE_TIMEOUT_MS = 15_000;

type Decoded = { trees: CapturedTree[]; tokens: FigmaToken[]; placeholders: number };

function parseDecoded(json: Json): Decoded {
	if (!isJsonObject(json)) throw new Error(UNREADABLE_FIGMA);

	if (isString(json.error)) throw new Error(json.error);
	const trees: CapturedTree[] = [];
	const tokens: FigmaToken[] = [];

	for (const text of isJsonArray(json.trees) ? json.trees : []) {
		const tree = isString(text) ? parseCapturedTree(text) : null;

		if (tree) trees.push(tree);
	}

	for (const token of isJsonArray(json.tokens) ? json.tokens : []) {
		if (isJsonObject(token) && isString(token.name) && isString(token.value))
			tokens.push({ name: token.name, value: token.value });
	}

	return { trees, tokens, placeholders: isFiniteNumber(json.placeholders) ? json.placeholders : 0 };
}

function decode(html: string): Promise<Decoded> {
	const worker = new Worker(new URL("./figma-worker.ts", import.meta.url), { type: "module" });

	return new Promise<Decoded>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Reading the Figma copy took too long")), DECODE_TIMEOUT_MS);

		worker.addEventListener("message", (event: MessageEvent<Json>) => {
			clearTimeout(timer);

			try {
				resolve(parseDecoded(event.data));
			} catch (error) {
				reject(error);
			}
		});
		worker.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error(UNREADABLE_FIGMA));
		});
		worker.postMessage(html);
	}).finally(() => worker.terminate());
}

export async function figmaImport(html: string, tokens?: DesignTokens): Promise<FigmaScreens> {
	const { trees, tokens: variables, placeholders } = await decode(html);

	return figmaScreens(trees, variables, tokens?.light ?? {}, appliedTheme(tokens), placeholders);
}
