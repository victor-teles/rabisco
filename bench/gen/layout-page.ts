import type { DesignFinding } from "../../src/shared/design/findings";
import {
	isFrameMessage,
	type FrameMessage,
	type HostMessage,
	type ModulePayload,
} from "../../src/mainview/lib/render/protocol";

export type LintRequest = {
	entry: string;
	width: number;
	height: number;
	modules: Record<string, ModulePayload>;
	css: string;
	theme: string;
	assets: Record<string, string>;
};

export type LintReply = { ok: true; findings: DesignFinding[] } | { ok: false; error: string };

declare global {
	interface Window {
		__rabiscoLint?: (request: LintRequest) => Promise<LintReply>;
	}
}

const GROW_PASSES = 3;

const TIMEOUT_MS = 15_000;

const FRAME_STYLE = "position:absolute;left:0;top:0;border:0";

type Waiter = { match: (message: FrameMessage) => boolean; resolve: (message: FrameMessage | null) => void };

let requestId = 0;

function channelOf(iframe: HTMLIFrameElement) {
	const waiters = new Set<Waiter>();

	const listen = (event: MessageEvent) => {
		if (event.source !== iframe.contentWindow || !isFrameMessage(event.data)) return;
		const message = event.data;

		for (const waiter of waiters) if (waiter.match(message)) waiter.resolve(message);
	};

	window.addEventListener("message", listen);

	return {
		next(match: Waiter["match"]): Promise<FrameMessage | null> {
			return new Promise((resolve) => {
				const waiter: Waiter = {
					match,
					resolve: (message) => {
						clearTimeout(timer);
						waiters.delete(waiter);
						resolve(message);
					},
				};

				const timer = setTimeout(() => waiter.resolve(null), TIMEOUT_MS);
				waiters.add(waiter);
			});
		},
		post(message: HostMessage) {
			iframe.contentWindow?.postMessage(message, "*");
		},
		close() {
			window.removeEventListener("message", listen);
		},
	};
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function lintIn(iframe: HTMLIFrameElement, request: LintRequest): Promise<LintReply> {
	const channel = channelOf(iframe);

	try {
		const ready = channel.next((message) => message.type === "ready");
		iframe.src = "runtime/frame.html";
		document.body.appendChild(iframe);

		if (!(await ready)) return { ok: false, error: "The screen runtime didn't load" };

		if (Object.keys(request.assets).length) channel.post({ type: "assets", assets: request.assets, reset: true });
		const rendered = channel.next((message) => message.type === "rendered" || message.type === "error");
		const { entry, modules, css, theme } = request;
		channel.post({ type: "modules", entry, modules, css, theme, reset: true });
		const outcome = await rendered;

		if (outcome?.type === "error") {
			const { file, line, message } = outcome.error;

			return { ok: false, error: `${file ?? entry}${line ? `:${line}` : ""}: ${message}` };
		}

		if (!outcome) return { ok: false, error: "The screen didn't render in time" };
		let height = request.height;

		for (let pass = 0; pass < GROW_PASSES; pass++) {
			const id = ++requestId;
			const reply = channel.next((message) => message.type === "measured" && message.id === id);
			channel.post({ type: "measure", id });
			const measured = await reply;

			if (measured?.type !== "measured" || measured.height <= height) break;
			height = measured.height;
			iframe.style.height = `${height}px`;
			await wait(50);
		}

		const id = ++requestId;
		const reply = channel.next((message) => message.type === "lint" && message.id === id);
		channel.post({ type: "lint", id });
		const linted = await reply;

		if (linted?.type !== "lint") return { ok: false, error: "The screen didn't answer the checks in time" };

		return "error" in linted ? { ok: false, error: linted.error } : { ok: true, findings: linted.findings };
	} finally {
		channel.close();
	}
}

window.__rabiscoLint = async (request) => {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.style.cssText = FRAME_STYLE;
	iframe.style.width = `${request.width}px`;
	iframe.style.height = `${request.height}px`;

	try {
		return await lintIn(iframe, request);
	} finally {
		iframe.remove();
	}
};
