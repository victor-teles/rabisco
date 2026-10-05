/**
 * The read-only viewer (decision 0008): a static site that plays a project's
 * screens with the real screen runtime, so it looks exactly like the canvas.
 *
 * ```
 * index.html          screen list, stage, back and restart
 * viewer.js           feeds the frame, follows `data-link-to` (decision 0007)
 * snapshot.js         window.__RABISCO_SHARE__ = { modules, css, theme, screens… }
 * runtime/frame.html  the screen runtime with frame.js inlined, in a sandboxed frame (allow-scripts only)
 * ```
 *
 * Every URL is relative and the data is a classic script (not `fetch`), so the
 * folder works from any path, on any static host, and from `file://`. The
 * runtime is inlined because browsers don't let a sandboxed `file://` frame
 * load scripts from other files.
 */
import type { ExportFile } from "../types";
import type { ScreenRuntime, ShareSnapshot } from "./snapshot";

/** The global `snapshot.js` sets. */
export const SNAPSHOT_GLOBAL = "__RABISCO_SHARE__";

/**
 * `normalizeTarget` from `src/shared/prototype/links.ts`, as browser JavaScript
 * for the viewer (a test keeps the two in step).
 */
export const NORMALIZE_TARGET_JS = `function normalizeTarget(to) {
	var path = String(to).trim().replace(/\\\\/g, "/").replace(/^(\\.\\/|\\/)+/, "");
	if (path.indexOf("/") === -1) path = "screens/" + path;
	if (!/\\.tsx$/.test(path)) path = path + ".tsx";
	return path;
}`;

const escapeHtml = (text: string) =>
	text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** JSON that is also safe inside an HTML `<script>` (should the file ever be inlined). */
const scriptJson = (value: unknown) =>
	JSON.stringify(value).replace(/</g, "\\u003c");

const VIEWER_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b;background:#f4f4f5;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
header{display:flex;align-items:center;gap:8px;height:48px;flex-shrink:0;padding:0 12px;background:#fff;border-bottom:1px solid #e4e4e7}
header h1{margin:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .sep{width:1px;height:20px;background:#e4e4e7}
header .current{flex:1;min-width:0;color:#52525b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:6px;background:transparent;cursor:pointer}
.icon:hover:not(:disabled){background:#f4f4f5}
.icon:disabled{opacity:.4;cursor:default}
.icon svg{width:16px;height:16px}
.body{display:flex;flex:1;min-height:0}
nav{width:220px;flex-shrink:0;overflow:auto;padding:8px;background:#fff;border-right:1px solid #e4e4e7;display:flex;flex-direction:column}
nav ol{list-style:none;margin:0;padding:0;flex:1}
nav button{display:block;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav button:hover{background:#f4f4f5}
nav button[aria-current="page"]{background:#f4f4f5;font-weight:600}
nav p{margin:8px;color:#71717a;font-size:12px}
main{position:relative;flex:1;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
#device{overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgb(0 0 0/.08),0 10px 40px -12px rgb(0 0 0/.25)}
#scaler{transform-origin:top left}
#frame{display:block;border:0}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;padding:8px 14px;border-radius:8px;background:#18181b;color:#fafafa;opacity:0;pointer-events:none;transition:opacity .2s}
#toast.show{opacity:1}
:focus-visible{outline:2px solid #a1a1aa;outline-offset:1px}
@media (max-width:700px){nav{display:none}}
@media (prefers-reduced-motion:reduce){#toast{transition:none}}
`;

const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;
const ICON_RESTART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

function indexHtml(snapshot: ShareSnapshot) {
	const name = escapeHtml(snapshot.name || "Untitled design");
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="referrer" content="no-referrer" />
		<meta name="generator" content="Rabisco" />
		<title>${name}</title>
		<style>${VIEWER_CSS}</style>
	</head>
	<body>
		<header>
			<button class="icon" id="back" type="button" aria-label="Back" title="Back" disabled>${ICON_BACK}</button>
			<button class="icon" id="restart" type="button" aria-label="Restart" title="Restart">${ICON_RESTART}</button>
			<span class="sep"></span>
			<h1>${name}</h1>
			<span class="current" id="current"></span>
		</header>
		<div class="body">
			<nav aria-label="Screens">
				<ol id="screens"></ol>
				<p>Read-only prototype. Click links to move between screens.</p>
			</nav>
			<main id="stage">
				<div id="device"><div id="scaler"><iframe id="frame" title="Screen" sandbox="allow-scripts" src="runtime/frame.html"></iframe></div></div>
			</main>
		</div>
		<div id="toast" role="status" aria-live="polite"></div>
		<script src="snapshot.js"></script>
		<script src="viewer.js"></script>
	</body>
</html>
`;
}

/**
 * The viewer's host side, in plain browser JavaScript: the same `modules`,
 * `play` and `navigate` messages as `FrameHost` (src/mainview/lib/render).
 * The screen lives in the URL hash, so a link can open on any screen and the
 * browser's back button works.
 */
const VIEWER_JS = `(function () {
	"use strict";
	var data = window.${SNAPSHOT_GLOBAL};
	var PADDING = 32;
	var byFile = {};
	data.screens.forEach(function (screen) { byFile[screen.file] = screen; });
	var frame = document.getElementById("frame");
	var device = document.getElementById("device");
	var scaler = document.getElementById("scaler");
	var stage = document.getElementById("stage");
	var list = document.getElementById("screens");
	var label = document.getElementById("current");
	var backButton = document.getElementById("back");
	var toastEl = document.getElementById("toast");
	var current = null;
	var ready = false;
	var depth = 0;
	var toastTimer = 0;

	${NORMALIZE_TARGET_JS}

	function post(message) {
		// The frame has an opaque origin: no target origin can match it
		if (frame.contentWindow) frame.contentWindow.postMessage(message, "*");
	}

	function toast(text) {
		toastEl.textContent = text;
		toastEl.className = "show";
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { toastEl.className = ""; }, 2500);
	}

	function fromHash() {
		var file = "";
		try { file = decodeURIComponent(location.hash.slice(1)); } catch (error) {}
		return byFile[file] ? file : data.start;
	}

	function layout() {
		var screen = byFile[current];
		if (!screen) return;
		var scale = Math.max(0.1, Math.min(1, (stage.clientWidth - PADDING * 2) / screen.width, (stage.clientHeight - PADDING * 2) / screen.height));
		frame.style.width = screen.width + "px";
		frame.style.height = screen.height + "px";
		scaler.style.transform = "scale(" + scale + ")";
		device.style.width = screen.width * scale + "px";
		device.style.height = screen.height * scale + "px";
		device.style.borderRadius = (screen.device === "mobile" ? 28 : 6) * scale + "px";
	}

	function show(file) {
		current = file;
		var screen = byFile[file];
		label.textContent = screen.name;
		document.title = screen.name + " · " + data.name;
		backButton.disabled = depth === 0;
		Array.prototype.forEach.call(list.querySelectorAll("button"), function (button) {
			if (button.getAttribute("data-file") === file) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});
		layout();
		if (ready) post({ type: "modules", entry: file, modules: {} });
	}

	function go(file) {
		if (file === current) return;
		depth++;
		try { history.pushState({ depth: depth }, "", "#" + encodeURIComponent(file)); }
		catch (error) { /* some file:// pages refuse pushState: the screen still changes */ }
		show(file);
	}

	function back() {
		if (depth > 0) history.back();
		else toast("This is the first screen");
	}

	function follow(to) {
		if (String(to).trim().toLowerCase() === "back") return back();
		var file = normalizeTarget(to);
		if (byFile[file]) go(file);
		else toast("This link goes nowhere yet");
	}

	data.screens.forEach(function (screen) {
		var item = document.createElement("li");
		var button = document.createElement("button");
		button.type = "button";
		button.textContent = screen.name;
		button.setAttribute("data-file", screen.file);
		button.addEventListener("click", function () { go(screen.file); });
		item.appendChild(button);
		list.appendChild(item);
	});
	backButton.addEventListener("click", back);
	document.getElementById("restart").addEventListener("click", function () { go(data.start); });

	window.addEventListener("popstate", function (event) {
		depth = (event.state && event.state.depth) || 0;
		show(fromHash());
	});
	window.addEventListener("resize", layout);
	window.addEventListener("message", function (event) {
		if (event.source !== frame.contentWindow) return;
		var message = event.data || {};
		if (message.type === "ready") {
			// A (re)loaded frame starts empty: send everything, then turn play mode on
			ready = true;
			post({ type: "modules", entry: current, modules: data.modules, css: data.css, theme: data.theme, reset: true });
			post({ type: "play", on: true });
		} else if (message.type === "navigate" && typeof message.to === "string") {
			follow(message.to);
		}
	});

	try { history.replaceState({ depth: 0 }, "", location.hash || "#" + encodeURIComponent(data.start)); } catch (error) {}
	show(fromHash());
})();
`;

const RUNTIME_SCRIPT = /<script\s+src=["']\.\/frame\.js["']\s*><\/script>/;

/**
 * `frame.html` with `frame.js` inside it. `</script` and `<!--` can't appear
 * in an inline script, so they are escaped the way JavaScript reads them
 * the same (`<\/script`, `<\!--`).
 */
export function inlineRuntime(runtime: ScreenRuntime): string {
	if (!RUNTIME_SCRIPT.test(runtime.html)) throw new Error("The screen runtime's frame.html doesn't load frame.js");
	const js = runtime.js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
	return runtime.html.replace(RUNTIME_SCRIPT, () => `<script>${js}</script>`);
}

/** The files of the viewer for `snapshot`, relative to the site's root. */
export function viewerFiles(snapshot: ShareSnapshot, runtime: ScreenRuntime): ExportFile[] {
	return [
		{ path: "index.html", content: indexHtml(snapshot) },
		{ path: "viewer.js", content: VIEWER_JS },
		{ path: "snapshot.js", content: `window.${SNAPSHOT_GLOBAL} = ${scriptJson(snapshot)};\n` },
		{ path: "runtime/frame.html", content: inlineRuntime(runtime) },
	];
}
