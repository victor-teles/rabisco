/** Test helpers: a fake `fetch` that records requests and answers with canned responses or SSE streams. */

export type RecordedRequest = { url: string; init: RequestInit; body: any };

/** A streaming body that emits `chunks` one by one, erroring if `signal` aborts. */
export function streamOf(chunks: string[], signal?: AbortSignal | null, delayMs = 0): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let i = 0;
	return new ReadableStream({
		async pull(controller) {
			if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (signal?.aborted) {
				controller.error(new DOMException("The operation was aborted.", "AbortError"));
				return;
			}
			if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]!));
			else controller.close();
		},
	});
}

export const sse = (events: unknown[], named = false) =>
	events.map((event) => `${named ? `event: ${(event as { type: string }).type}\n` : ""}data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");

/** Splits `text` into chunks of `size` characters, to exercise chunk boundaries. */
export const chunked = (text: string, size = 7) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, i * size + size));

export function fakeFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
	const requests: RecordedRequest[] = [];
	const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
		const request = { url: String(input), init, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
		requests.push(request);
		return handler(request);
	};
	return { fetch: fn as unknown as typeof fetch, requests };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iterable) out.push(item);
	return out;
}
