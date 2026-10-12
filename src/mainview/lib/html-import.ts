import type { DesignTokens } from "../../shared/context/tokens";
import { CAPTURE_SCRIPT } from "../../shared/import/capture-script";
import { parseCapturedTree, type CapturedTree } from "../../shared/import/captured-tree";
import { treeToTsx } from "../../shared/import/to-tsx";
import { FRAME_SIZE } from "../../shared/project";
import type { Device } from "../../shared/types";
import { importedScreen, type ScreenCopy } from "./new-screens";
import { OFFSTAGE_FRAME_STYLE, offstage } from "./render/offstage";
import { SCREEN_THEME_CSS } from "./render/theme";

const CAPTURE_TIMEOUT_MS = 5000;

const FRAME_HEIGHT = 900;

const INLINE_TAGS = new Set([
	"span",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"a",
	"font",
	"br",
	"small",
	"code",
	"sub",
	"sup",
	"mark",
]);

const IGNORED_TAGS = new Set(["meta", "style", "title", "link", "script"]);

type ScreenTheme = Record<string, string>;

const defaultTheme = () => {
	const block = /:root\s*\{([^}]*)\}/.exec(SCREEN_THEME_CSS)?.[1] ?? "";
	const theme: ScreenTheme = {};

	for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
		const value = match[2]!.trim();

		if (!value.includes("var(")) theme[match[1]!] = value;
	}

	return theme;
};

const DEFAULT_THEME = defaultTheme();

export function appliedTheme(tokens?: DesignTokens) {
	return { ...DEFAULT_THEME, ...tokens?.light };
}

export function isImportableHtml(html: string): boolean {
	const body = new DOMParser().parseFromString(html, "text/html").body;

	for (const element of body.querySelectorAll("*")) {
		const tag = element.localName;

		if (!INLINE_TAGS.has(tag) && !IGNORED_TAGS.has(tag)) return true;
	}

	return false;
}

const frameScript = `
const DROPPED = "script,iframe,frame,frameset,object,embed,link,meta,base,template,noscript";
const sanitize = (root) => {
	for (const element of root.querySelectorAll(DROPPED)) element.remove();
	for (const element of root.querySelectorAll("*")) {
		for (const attr of [...element.attributes]) {
			const value = attr.value.trim();
			if (/^on/i.test(attr.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(attr.name) && /^(javascript|vbscript|data:(?!image\\/))/i.test(value))) element.removeAttribute(attr.name);
		}
	}
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
addEventListener("message", async (event) => {
	if (event.source !== parent || typeof event.data?.html !== "string") return;
	const source = new DOMParser().parseFromString(event.data.html, "text/html");
	sanitize(source.documentElement);
	for (const style of source.head.querySelectorAll("style")) document.head.appendChild(document.adoptNode(style));
	const style = source.body.getAttribute("style");
	if (style) document.body.setAttribute("style", style);
	document.body.replaceChildren(...[...source.body.childNodes].map((node) => document.adoptNode(node)));
	document.title = source.title;
	await nextFrame();
	await nextFrame();
	let tree = "";
	try {
		tree = ${CAPTURE_SCRIPT};
	} catch {}
	parent.postMessage({ rabiscoCapture: tree }, "*");
});
parent.postMessage({ rabiscoCaptureReady: true }, "*");
`;

function frameDocument(nonce: string) {
	const policy = `default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}'`;

	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0}body{font-family:ui-sans-serif,system-ui,sans-serif}</style><script nonce="${nonce}">${frameScript}</script></head><body></body></html>`;
}

type CaptureMessage = { rabiscoCaptureReady?: boolean; rabiscoCapture?: string };

const isCaptureMessage = (data: CaptureMessage | null): data is CaptureMessage =>
	typeof data === "object" && data !== null && ("rabiscoCaptureReady" in data || "rabiscoCapture" in data);

export function captureHtml(html: string, width: number): Promise<CapturedTree | null> {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.title = "Import HTML";
	iframe.tabIndex = -1;
	iframe.setAttribute("aria-hidden", "true");
	iframe.style.cssText = OFFSTAGE_FRAME_STYLE;
	iframe.style.width = `${width}px`;
	iframe.style.height = `${FRAME_HEIGHT}px`;
	iframe.srcdoc = frameDocument(crypto.randomUUID().replaceAll("-", ""));

	return new Promise((resolve) => {
		const finish = (tree: CapturedTree | null) => {
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			iframe.remove();
			resolve(tree);
		};

		const onMessage = (event: MessageEvent<CaptureMessage | null>) => {
			if (event.source !== iframe.contentWindow || !isCaptureMessage(event.data)) return;

			if (event.data.rabiscoCaptureReady) iframe.contentWindow?.postMessage({ html }, "*");
			else finish(event.data.rabiscoCapture ? parseCapturedTree(event.data.rabiscoCapture) : null);
		};

		const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
		window.addEventListener("message", onMessage);
		offstage().appendChild(iframe);
	});
}

export async function htmlScreen(html: string, device: Device, tokens?: DesignTokens): Promise<ScreenCopy | null> {
	if (!isImportableHtml(html)) return null;
	const tree = await captureHtml(html, FRAME_SIZE[device].width);

	return tree ? importedScreen(treeToTsx(tree, appliedTheme(tokens), tree.title || "Pasted"), device) : null;
}
