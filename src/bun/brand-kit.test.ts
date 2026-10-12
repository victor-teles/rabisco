import { describe, expect, test } from "bun:test";
import { MAX_BRAND_KIT_BYTES } from "../shared/context/brand-kit";
import { fetchBrandKit } from "./brand-kit";

const serve = (body: string, init: ResponseInit = {}) => {
	const requested: string[] = [];

	const fetcher: typeof fetch = Object.assign(
		async (input: string | URL | Request) => {
			requested.push(String(input));

			return new Response(body, init);
		},
		{ preconnect: fetch.preconnect },
	);

	return { fetcher, requested };
};

describe("fetchBrandKit", () => {
	test("reads GitHub files raw and returns the text and type", async () => {
		const { fetcher, requested } = serve("# Acme", { headers: { "content-type": "text/markdown" } });
		const kit = await fetchBrandKit("https://github.com/acme/brand/blob/main/DESIGN.md", fetcher);

		expect(requested).toEqual(["https://raw.githubusercontent.com/acme/brand/main/DESIGN.md"]);
		expect(kit.text).toBe("# Acme");
		expect(kit.contentType).toBe("text/markdown");
	});

	test("rejects addresses that aren't http", async () => {
		await expect(fetchBrandKit("file:///etc/hosts", serve("").fetcher)).rejects.toThrow(/https:\/\//);
	});

	test("explains server errors and big files", async () => {
		await expect(fetchBrandKit("https://x.dev/a.md", serve("", { status: 404 }).fetcher)).rejects.toThrow(/404/);
		await expect(
			fetchBrandKit("https://x.dev/a.md", serve("x".repeat(MAX_BRAND_KIT_BYTES + 1)).fetcher),
		).rejects.toThrow(/over 512 KB/);
	});
});
