import { describe, expect, test } from "bun:test";
import { encode } from "uqr";
import { qrPath } from "./qr-code";

describe("qrPath", () => {
	const url = "http://192.168.1.20:52341/Zm9vYmFyYmF6cXV4cXV1eA/";

	test("draws one square per dark module, inside a quiet zone", () => {
		const { size, path } = qrPath(url);
		const { data } = encode(url, { ecc: "M", border: 2 });
		const dark = data.flat().filter(Boolean).length;

		expect(size).toBe(data.length);
		expect(path.match(/M/g)?.length).toBe(dark);
		expect(data[0]!.some(Boolean)).toBe(false);
		expect(data[2]![2]).toBe(true);
	});

	test("a share link fits a small code", () => {
		expect(qrPath(url).size).toBeLessThanOrEqual(37 + 4);
	});
});
