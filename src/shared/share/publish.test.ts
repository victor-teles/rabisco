import { describe, expect, test } from "bun:test";
import { assertPassword, generatePassphrase, OPEN_SEALED_JS, sealText, type SealedSnapshot } from "./publish";

type OpenSealed = (sealed: SealedSnapshot, password: string) => Promise<{ hello: string }>;

// SAFETY: OPEN_SEALED_JS declares `openSealed(sealed, password)`, which resolves to the parsed JSON
const openSealed = new Function(`${OPEN_SEALED_JS}; return openSealed;`)() as OpenSealed;

describe("sealing a snapshot", () => {
	test("the viewer's code opens what Rabisco sealed, with the right password only", async () => {
		const sealed = await sealText(JSON.stringify({ hello: "Ação ✓" }), "correct horse", 1000);

		expect(sealed).toMatchObject({ v: 1, kdf: "PBKDF2-SHA-256", rounds: 1000 });
		expect(atob(sealed.salt)).toHaveLength(16);
		expect(atob(sealed.iv)).toHaveLength(12);
		expect(sealed.data).not.toContain("hello");
		expect(await openSealed(sealed, "correct horse")).toEqual({ hello: "Ação ✓" });
		await expect(openSealed(sealed, "wrong horse")).rejects.toThrow();
	});

	test("each seal has its own salt and IV", async () => {
		const [a, b] = await Promise.all([sealText("x", "password", 1000), sealText("x", "password", 1000)]);

		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
	});

	test("passwords have at least 8 characters, and generated ones are four groups", () => {
		expect(() => assertPassword("short")).toThrow("at least 8");
		expect(() => assertPassword("long enough")).not.toThrow();
		expect(generatePassphrase()).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
		expect(generatePassphrase()).not.toBe(generatePassphrase());
	});
});
