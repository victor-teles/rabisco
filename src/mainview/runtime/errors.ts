import { SOURCE_URL_PREFIX, type FrameError } from "../lib/render/protocol";
import { RenderError } from "./registry";

const STACK_LOCATION = new RegExp(`${SOURCE_URL_PREFIX.replace(/[/.]/g, "\\$&")}([^\\s:)]+):(\\d+):(\\d+)`);

/** First project location in a stack trace (V8 and JavaScriptCore formats). */
export function locationFromStack(stack: string | undefined) {
	const match = stack?.match(STACK_LOCATION);
	if (!match) return null;
	return { file: match[1]!, line: Number(match[2]), column: Number(match[3]) };
}

/** Source lines around `line`, 1-based. */
export function excerptOf(source: string | undefined, line: number | undefined, context = 2) {
	if (!source || !line) return undefined;
	const lines = source.split("\n");
	const start = Math.max(1, line - context);
	const end = Math.min(lines.length, line + context);
	const excerpt: { line: number; text: string }[] = [];
	for (let n = start; n <= end; n++) excerpt.push({ line: n, text: lines[n - 1]! });
	return excerpt;
}

/** Turns anything thrown into a `FrameError` pointing at project source when possible. */
export function describeError(error: unknown, sourceOf: (path: string) => string | undefined): FrameError {
	if (error instanceof RenderError) {
		return {
			kind: error.kind,
			message: error.message,
			file: error.file,
			line: error.line,
			column: error.column,
			excerpt: error.file ? excerptOf(sourceOf(error.file), error.line) : undefined,
		};
	}
	const message =
		error instanceof Error ? `${error.name && error.name !== "Error" ? `${error.name}: ` : ""}${error.message}` : String(error);
	const location = locationFromStack(error instanceof Error ? error.stack : undefined);
	if (!location) return { kind: "runtime", message };
	return { kind: "runtime", message, ...location, excerpt: excerptOf(sourceOf(location.file), location.line) };
}

const TITLES: Record<FrameError["kind"], string> = {
	compile: "Syntax error",
	runtime: "Runtime error",
	"missing-module": "Missing module",
};

/** Shows `error` over the screen, replacing any previous overlay. */
export function showOverlay(error: FrameError) {
	let overlay = document.getElementById("rabisco-error");
	if (!overlay) {
		overlay = document.createElement("div");
		overlay.id = "rabisco-error";
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;box-sizing:border-box;" +
			"background:#fff;color:#1f1f1f;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;";
		document.body.appendChild(overlay);
	}
	overlay.replaceChildren();
	const add = (tag: string, css: string, text?: string) => {
		const node = document.createElement(tag);
		node.style.cssText = css;
		if (text !== undefined) node.textContent = text;
		overlay!.appendChild(node);
		return node;
	};
	add("div", "font-weight:600;color:#c4161c;margin-bottom:4px", TITLES[error.kind]);
	if (error.file) {
		const where = [error.file, error.line, error.column].filter((part) => part !== undefined).join(":");
		add("div", "font:12px/1.5 ui-monospace,monospace;color:#6b6b6b;margin-bottom:12px", where);
	}
	add("div", "white-space:pre-wrap;word-break:break-word;font-weight:500;margin-bottom:16px", error.message);
	if (error.excerpt?.length) {
		const pre = add("pre", "margin:0;padding:12px 0;border-radius:8px;background:#f5f5f5;overflow:auto;font:12px/1.6 ui-monospace,monospace");
		const width = String(error.excerpt.at(-1)!.line).length;
		for (const { line, text } of error.excerpt) {
			const row = document.createElement("div");
			const current = line === error.line;
			row.style.cssText = `padding:0 12px;white-space:pre;${current ? "background:#fde8e8;color:#8a1015" : ""}`;
			row.textContent = `${current ? ">" : " "} ${String(line).padStart(width)} | ${text}`;
			pre.appendChild(row);
		}
	}
}

export function hideOverlay() {
	document.getElementById("rabisco-error")?.remove();
}
