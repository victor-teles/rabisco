import { describe, expect, test } from "bun:test";
import { deflateSync } from "fflate";
import { encodeMessage, encodeSchema, figKiwi, figmaClipboardHtml, FIGMA_SCHEMA } from "./figma-fixture";
import { FigmaFormatError, hasFigmaData, readFigKiwi, readFigmaClipboard, UNREADABLE_FIGMA } from "./clipboard";
import { decodeMessage, decodeSchema, KiwiError } from "./kiwi";

const node = {
	guid: { sessionID: 3, localID: 300 },
	name: "Café ☕",
	opacity: 0.25,
	signed: -42,
	int64Field: -9_000_000_000n,
	fillPaints: [{ type: "IMAGE", image: { hash: new Uint8Array([1, 2, 250]), name: "photo" } }],
	transform: { m00: 1, m01: 0, m02: 12.5, m10: 0, m11: 1, m12: -3 },
};

describe("kiwi", () => {
	test("decodes a message with its own schema", () => {
		const schema = decodeSchema(encodeSchema(FIGMA_SCHEMA));

		const message = decodeMessage(
			schema,
			encodeMessage(FIGMA_SCHEMA, "Message", { type: "NODE_CHANGES", nodeChanges: [node] }),
			"Message",
		);

		expect(message.type).toBe("NODE_CHANGES");
		expect(message.nodeChanges).toEqual([
			{
				guid: { sessionID: 3, localID: 300 },
				name: "Café ☕",
				opacity: 0.25,
				signed: -42,
				int64Field: -9_000_000_000,
				fillPaints: [{ type: "IMAGE", image: { hash: new Uint8Array([1, 2, 250]), name: "photo" } }],
				transform: { m00: 1, m01: 0, m02: 12.5, m10: 0, m11: 1, m12: -3 },
			},
		]);
	});

	test("fails on truncated data and unknown fields", () => {
		const schema = decodeSchema(encodeSchema(FIGMA_SCHEMA));
		const bytes = encodeMessage(FIGMA_SCHEMA, "Message", { nodeChanges: [node] });

		expect(() => decodeMessage(schema, bytes.subarray(0, bytes.length - 6), "Message")).toThrow(KiwiError);
		expect(() => decodeMessage(schema, new Uint8Array([99]), "Message")).toThrow(KiwiError);
		expect(() => decodeMessage(schema, bytes, "Missing")).toThrow(KiwiError);
	});

	test("rejects an array longer than its data", () => {
		const schema = decodeSchema(encodeSchema(FIGMA_SCHEMA));

		expect(() => decodeMessage(schema, new Uint8Array([2, 0xff, 0xff, 0xff, 0x0f]), "Message")).toThrow(KiwiError);
	});
});

describe("Figma clipboard", () => {
	test("reads deflate and zstd copies with their metadata", () => {
		for (const zstd of [false, true]) {
			const html = figmaClipboardHtml([{ guid: { sessionID: 1, localID: 2 }, type: "FRAME", name: "Home" }], { zstd });
			const clipboard = readFigmaClipboard(html);

			expect(hasFigmaData(html)).toBe(true);
			expect(clipboard.meta.fileKey).toBe("abc");
			expect(clipboard.version).toBe(70);
			expect(clipboard.message.nodeChanges).toEqual([
				{ guid: { sessionID: 1, localID: 2 }, type: "FRAME", name: "Home" },
			]);
		}
	});

	test("fails fast on a format it can't read", () => {
		const unreadable = (html: string) => {
			try {
				readFigmaClipboard(html);
			} catch (error) {
				return error instanceof FigmaFormatError ? error.message : "other error";
			}

			return "no error";
		};

		expect(unreadable(figmaClipboardHtml([], { version: 5 }))).toBe(UNREADABLE_FIGMA);
		expect(unreadable(figmaClipboardHtml([], { version: 999 }))).toBe(UNREADABLE_FIGMA);
		expect(unreadable(`<span data-buffer="<!--(figma)${btoa("not kiwi")}(/figma)-->"></span>`)).toBe(UNREADABLE_FIGMA);
		expect(unreadable("<p>Hello</p>")).toBe("The clipboard has no Figma data");
		expect(hasFigmaData("<p>Hello</p>")).toBe(false);
	});

	test("reads the fig-kiwi chunks", () => {
		const schema = deflateSync(new Uint8Array([1, 2, 3]));
		const data = deflateSync(new Uint8Array([4]));
		const archive = readFigKiwi(figKiwi(schema, data, 48));

		expect(archive.version).toBe(48);
		expect([...archive.schema]).toEqual([...schema]);
		expect([...archive.data]).toEqual([...data]);
		expect(() => readFigKiwi(figKiwi(schema, data).subarray(0, 20))).toThrow(FigmaFormatError);
	});
});
