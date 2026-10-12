import { brandKitUrl, MAX_BRAND_KIT_BYTES } from "../shared/context/brand-kit";

export type FetchedBrandKit = { url: string; text: string; contentType: string };

const TIMEOUT_MS = 10_000;

export async function fetchBrandKit(input: string, fetcher: typeof fetch = fetch): Promise<FetchedBrandKit> {
	const url = brandKitUrl(input);

	if (!url) throw new Error("Enter a web address that starts with https://");
	let response: Response;

	try {
		response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (error) {
		const reason = error instanceof Error && error.name === "TimeoutError" ? "it took too long" : "it can't be reached";

		throw new Error(`Couldn't load ${url}: ${reason}.`);
	}

	if (!response.ok) throw new Error(`Couldn't load ${url}: the server answered ${response.status}.`);

	if (Number(response.headers.get("content-length") ?? 0) > MAX_BRAND_KIT_BYTES) {
		throw new Error(`That file is over ${MAX_BRAND_KIT_BYTES / 1024} KB.`);
	}

	const bytes = await response.arrayBuffer();

	if (bytes.byteLength > MAX_BRAND_KIT_BYTES) throw new Error(`That file is over ${MAX_BRAND_KIT_BYTES / 1024} KB.`);

	return {
		url: response.url || url,
		text: new TextDecoder().decode(bytes),
		contentType: response.headers.get("content-type") ?? "",
	};
}
