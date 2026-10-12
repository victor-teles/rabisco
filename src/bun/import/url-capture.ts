import { randomUUID } from "crypto";
import {
	MAX_WAIT_MS,
	parseUrlCaptureMessage,
	urlCaptureScript,
	type UrlCapture,
} from "../../shared/import/url-capture";

export type CaptureViewEvents = {
	ready: () => void;
	message: (detail: string) => void;
	download: () => void;
};

export type CaptureView = { run: (script: string) => void; close: () => void };

export type OpenCaptureView = (url: string, width: number, events: CaptureViewEvents) => CaptureView;

export type CaptureTimings = { settleMs?: number; maxWaitMs?: number; readyFallbackMs: number; timeoutMs: number };

const TIMINGS: CaptureTimings = { readyFallbackMs: 8_000, timeoutMs: MAX_WAIT_MS + 5_000 };

export function captureAddress(input: string): string {
	const trimmed = input.trim();
	let url: URL;

	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new Error("Enter a web address, like https://example.com");
	}

	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("Rabisco imports http and https pages only.");

	return url.href;
}

const REACH_TIMEOUT_MS = 8_000;

export async function assertReachable(url: string, fetcher: typeof fetch = fetch) {
	const { host } = new URL(url);

	try {
		await fetcher(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(REACH_TIMEOUT_MS) });
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError")
			throw new Error(`${host} took too long to answer.`);

		throw new Error(`Rabisco couldn't reach ${host}. Check the address and your connection.`);
	}
}

export function createUrlCapture(open: OpenCaptureView, timings: CaptureTimings = TIMINGS) {
	let stopCurrent: (() => void) | null = null;

	function capture(input: string, width: number): Promise<UrlCapture> {
		const url = captureAddress(input);

		stopCurrent?.();

		return new Promise<UrlCapture>((resolve, reject) => {
			const nonce = randomUUID();
			const script = urlCaptureScript(nonce, timings.settleMs, timings.maxWaitMs);
			let view: CaptureView | null = null;
			let ran = false;
			let done = false;

			const finish = (error: Error | null, result?: UrlCapture) => {
				if (done) return;
				done = true;
				clearTimeout(fallback);
				clearTimeout(timeout);
				stopCurrent = null;
				view?.close();

				if (error) reject(error);
				else resolve(result!);
			};

			const run = () => {
				if (done) return;
				ran = true;
				view?.run(script);
			};

			const fallback = setTimeout(() => ran || run(), timings.readyFallbackMs);

			const timeout = setTimeout(
				() => finish(new Error(`${new URL(url).host} took too long to load.`)),
				timings.timeoutMs,
			);

			stopCurrent = () => finish(new Error("Import stopped."));

			try {
				view = open(url, width, {
					ready: run,
					message: (detail) => {
						const result = parseUrlCaptureMessage(detail, nonce);

						if (result?.kind === "captured") finish(null, result.capture);
						else if (result) finish(new Error(result.message));
					},
					download: () => finish(new Error("That address is a file download, not a page.")),
				});
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}

			if (done) view?.close();
		});
	}

	return { capture, stop: () => stopCurrent?.() };
}
