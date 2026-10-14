// Relative URLs and a classic data script (not `fetch`) so the site works from `file://`. The runtime is
// inlined because a sandboxed `file://` frame can't load scripts from other files.
import {
	OVERLAY_MODES,
	overlayMotion,
	screenTransition,
	TRANSITIONS,
	type OverlayMotion,
	type ScreenTransition,
} from "../prototype/transitions";
import { iconFile } from "../icons";
import type { ExportFile } from "../types";
import { OPEN_SEALED_JS, type SealedSnapshot } from "./publish";
import type { ScreenRuntime, ShareSnapshot } from "./snapshot";

export const SNAPSHOT_GLOBAL = "__RABISCO_SHARE__";

export const SEALED_GLOBAL = "__RABISCO_SEALED__";

export const EXPIRES_GLOBAL = "__RABISCO_EXPIRES__";

/** Decision 0038: a published site can be sealed with a password, stop at a date and ask not to be indexed */
export type ViewerOptions = { sealed?: SealedSnapshot; expiresAt?: string; noindex?: boolean };

/** Browser copy of `normalizeTarget` in `src/shared/prototype/links.ts`; a test keeps them in step. */
export const NORMALIZE_TARGET_JS = `function normalizeTarget(to) {
	var path = String(to).trim().replace(/\\\\/g, "/").replace(/^(\\.\\/|\\/)+/, "");
	if (path.indexOf("/") === -1) path = "screens/" + path;
	if (!/\\.tsx$/.test(path)) path = path + ".tsx";
	return path;
}`;

export const LINK_OPTIONS_JS = `function parseTransition(value) {
	var name = String(value || "").trim().toLowerCase();
	return ${JSON.stringify(TRANSITIONS)}.indexOf(name) === -1 ? null : name;
}
function parseOverlayMode(value) {
	var name = String(value || "").trim().toLowerCase();
	if (name === "overlay" || name === "modal") return "overlay";
	return name === "sheet" ? "sheet" : null;
}
function overlayRect(mode, screen, overlay) {
	var height = Math.min(overlay.height, screen.height);
	if (mode === "sheet") return { x: 0, y: screen.height - height, width: screen.width, height: height };
	var width = Math.min(overlay.width, screen.width);
	return { x: (screen.width - width) / 2, y: (screen.height - height) / 2, width: width, height: height };
}`;

export const screenMotionKey = (transition: string, direction: string, reduced: boolean) =>
	`${transition}:${direction}:${reduced ? 1 : 0}`;

export const overlayMotionKey = (mode: string, transition: string, opening: boolean, reduced: boolean) =>
	`${mode}:${transition}:${opening ? "open" : "close"}:${reduced ? 1 : 0}`;

export function motionTables() {
	const screens: Record<string, ScreenTransition | null> = {};
	const overlays: Record<string, OverlayMotion | null> = {};

	for (const reduced of [false, true]) {
		for (const transition of TRANSITIONS) {
			for (const direction of ["forward", "back"] as const)
				screens[screenMotionKey(transition, direction, reduced)] = screenTransition(transition, direction, reduced);
		}

		for (const mode of OVERLAY_MODES) {
			for (const transition of [...TRANSITIONS, null]) {
				for (const opening of [true, false])
					overlays[overlayMotionKey(mode, transition ?? "", opening, reduced)] = overlayMotion(
						mode,
						transition,
						opening,
						reduced,
					);
			}
		}
	}

	return { screens, overlays };
}

const escapeHtml = (text: string) =>
	text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** JSON that is also safe inside an HTML `<script>` (should the file ever be inlined). */
const scriptJson = (value: ShareSnapshot | SealedSnapshot | string) => JSON.stringify(value).replace(/</g, "\\u003c");

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
#scaler{position:relative;transform-origin:top left}
.layer{position:absolute;inset:0;background:#fff}
.layer.leaving{pointer-events:none}
iframe{display:block;border:0;width:100%;height:100%}
.overlay{position:absolute;inset:0;z-index:10}
.overlay.closing{pointer-events:none}
.backdrop{position:absolute;inset:0;background:rgb(0 0 0/.4)}
.panel{position:absolute;overflow:hidden;background:#fff;box-shadow:0 10px 40px -12px rgb(0 0 0/.35)}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;padding:8px 14px;border-radius:8px;background:#18181b;color:#fafafa;opacity:0;pointer-events:none;transition:opacity .2s}
#toast.show{opacity:1}
:focus-visible{outline:2px solid #a1a1aa;outline-offset:1px}
#gate{display:none;flex:1;align-items:center;justify-content:center;padding:24px}
body.gated>header,body.gated>.body{display:none}
body.gated #gate{display:flex}
#gate form{display:flex;flex-direction:column;gap:8px;width:100%;max-width:320px}
#gate h1{margin:0;font-size:15px;font-weight:600}
#gate p{margin:0;color:#52525b}
#gate input{height:40px;padding:0 10px;border:1px solid #d4d4d8;border-radius:6px;font:inherit;font-size:16px;background:#fff}
#gate button{height:36px;border:0;border-radius:6px;background:#18181b;color:#fafafa;cursor:pointer}
#gate button:disabled{opacity:.6;cursor:default}
#gate .error{color:#b91c1c;min-height:1.4em}
@media (max-width:700px){nav{display:none}}
@media (prefers-reduced-motion:reduce){#toast{transition:none}}
`;

const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;

const ICON_RESTART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

function indexHtml(snapshot: ShareSnapshot, options: ViewerOptions) {
	const name = options.sealed ? "Shared design" : escapeHtml(snapshot.name || "Untitled design");

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="referrer" content="no-referrer" />
		<meta name="generator" content="Rabisco" />
		${options.noindex ? '<meta name="robots" content="noindex" />\n\t\t' : ""}		<title>${name}</title>
		<style>${VIEWER_CSS}</style>
	</head>
	<body>
		<header>
			<button class="icon" id="back" type="button" aria-label="Back" title="Back" disabled>${ICON_BACK}</button>
			<button class="icon" id="restart" type="button" aria-label="Restart" title="Restart">${ICON_RESTART}</button>
			<span class="sep"></span>
			<h1 id="name">${name}</h1>
			<span class="current" id="current"></span>
		</header>
		<div class="body">
			<nav aria-label="Screens">
				<ol id="screens"></ol>
				<p>Read-only prototype. Click links to move between screens.</p>
			</nav>
			<main id="stage">
				<div id="device"><div id="scaler"><div class="layer"><iframe id="frame" title="Screen" sandbox="allow-scripts"${options.sealed ? "" : ' src="runtime/frame.html"'}></iframe></div></div></div>
			</main>
		</div>
		<div id="gate">
			<form id="gate-form">
				<h1 id="gate-title">This design is protected</h1>
				<p id="gate-text">Type the password you got with the link.</p>
				<input id="gate-password" type="password" autocomplete="current-password" aria-label="Password" />
				<button id="gate-submit" type="submit">Open</button>
				<p class="error" id="gate-error" role="alert"></p>
			</form>
		</div>
		<div id="toast" role="status" aria-live="polite"></div>
		<script src="snapshot.js"></script>
		<script src="viewer.js"></script>
	</body>
</html>
`;
}

/** Same messages as `FrameHost`; the screen lives in the URL hash so links and the back button work. */
const viewerJs = () => `(function () {
	"use strict";

	${OPEN_SEALED_JS}

	function gate(title, text, form) {
		document.body.className = "gated";
		document.getElementById("gate-title").textContent = title;
		document.getElementById("gate-text").textContent = text;
		var password = document.getElementById("gate-password");
		var submit = document.getElementById("gate-submit");
		if (!form) {
			password.remove();
			submit.remove();
		}
		return { password: password, submit: submit };
	}

	function boot() {
		var expires = window.${EXPIRES_GLOBAL};
		if (expires && Date.now() >= Date.parse(expires)) return gate("This link has expired", "Ask the person who sent it for a new one.", false);
		var sealed = window.${SEALED_GLOBAL};
		if (!sealed) return start(window.${SNAPSHOT_GLOBAL});
		var fields = gate("This design is protected", "Type the password you got with the link.", true);
		var error = document.getElementById("gate-error");
		fields.password.focus();
		document.getElementById("gate-form").addEventListener("submit", function (event) {
			event.preventDefault();
			fields.submit.disabled = true;
			error.textContent = "";
			openSealed(sealed, fields.password.value).then(function (data) {
				document.body.className = "";
				start(data);
			}, function (cause) {
				fields.submit.disabled = false;
				error.textContent = cause && cause.message === "unsupported" ? "This browser can't open protected links." : "Wrong password";
				fields.password.select();
			});
		});
	}

	function start(data) {
	var MOTIONS = ${JSON.stringify(motionTables())};
	var PADDING = 32;
	var PAINT_TIMEOUT_MS = 1000;
	var byFile = {};
	data.screens.forEach(function (screen) { byFile[screen.file] = screen; });
	var device = document.getElementById("device");
	var scaler = document.getElementById("scaler");
	var stage = document.getElementById("stage");
	var list = document.getElementById("screens");
	var label = document.getElementById("current");
	var backButton = document.getElementById("back");
	var toastEl = document.getElementById("toast");
	var current = null;
	var depth = 0;
	var arrivedWith = "instant";
	var toastTimer = 0;
	var frames = [];
	var layers = [];
	var overlays = [];
	var motion = null;

	${NORMALIZE_TARGET_JS}

	${LINK_OPTIONS_JS}

	function reducedMotion() {
		return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	}

	function animate(element, keyframes, options) {
		return keyframes.length && element.animate ? element.animate(keyframes, options) : null;
	}

	function post(record, message) {
		// The frame has an opaque origin: no target origin can match it
		if (record.iframe.contentWindow) record.iframe.contentWindow.postMessage(message, "*");
	}

	function watch(iframe, file) {
		var record = { iframe: iframe, file: file, ready: false, onRendered: null };
		frames.push(record);
		return record;
	}

	function unwatch(record) {
		frames = frames.filter(function (other) { return other !== record; });
	}

	function newFrame(file) {
		var iframe = document.createElement("iframe");
		iframe.title = "Screen";
		iframe.setAttribute("sandbox", "allow-scripts");
		iframe.src = "runtime/frame.html";
		return watch(iframe, file);
	}

	function whenRendered(record, run) {
		var done = false;
		function once() {
			if (done) return;
			done = true;
			run();
		}
		record.onRendered = once;
		setTimeout(once, PAINT_TIMEOUT_MS);
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

	function overlayOpen() {
		return overlays.some(function (overlay) { return !overlay.closing; });
	}

	function updateBack() {
		backButton.disabled = depth === 0 && !overlayOpen();
	}

	function layout() {
		var screen = byFile[current];
		if (!screen) return;
		var scale = Math.max(0.1, Math.min(1, (stage.clientWidth - PADDING * 2) / screen.width, (stage.clientHeight - PADDING * 2) / screen.height));
		scaler.style.width = screen.width + "px";
		scaler.style.height = screen.height + "px";
		scaler.style.transform = "scale(" + scale + ")";
		device.style.width = screen.width * scale + "px";
		device.style.height = screen.height * scale + "px";
		device.style.borderRadius = (screen.device === "desktop" ? 6 : 28) * scale + "px";
	}

	function settle() {
		if (!motion) return;
		clearTimeout(motion.timer);
		motion.animations.forEach(function (animation) { if (animation) animation.cancel(); });
		motion = null;
		while (layers.length > 1) {
			var old = layers.shift();
			unwatch(old.record);
			old.element.remove();
		}
		layers[0].element.style.visibility = "";
		layers[0].element.style.zIndex = "";
	}

	function play(layer, plan) {
		if (!motion || motion.layer !== layer) return;
		var outgoing = layers[layers.length - 2];
		layer.element.style.visibility = "";
		(plan.top === "incoming" ? layer : outgoing).element.style.zIndex = "1";
		var timing = { duration: plan.duration, easing: plan.easing };
		motion.animations = [
			animate(layer.element, plan.incoming, timing),
			animate(outgoing.element, plan.outgoing, { duration: plan.duration, easing: plan.easing, fill: "forwards" }),
		];
		motion.timer = setTimeout(settle, plan.duration);
	}

	function show(file, plan) {
		settle();
		current = file;
		var screen = byFile[file];
		label.textContent = screen.name;
		document.title = screen.name + " · " + data.name;
		updateBack();
		Array.prototype.forEach.call(list.querySelectorAll("button"), function (button) {
			if (button.getAttribute("data-file") === file) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});
		layout();
		var top = layers[0];
		if (!plan || !top.record.ready) {
			top.record.file = file;
			if (top.record.ready) post(top.record, { type: "modules", entry: file, modules: {} });
			return;
		}
		var element = document.createElement("div");
		element.className = "layer";
		element.style.visibility = "hidden";
		var record = newFrame(file);
		element.appendChild(record.iframe);
		var layer = { element: element, record: record };
		top.element.className = "layer leaving";
		layers.push(layer);
		scaler.insertBefore(element, overlays.length ? overlays[0].element : null);
		motion = { layer: layer, animations: [], timer: 0 };
		whenRendered(record, function () { play(layer, plan); });
	}

	function screenMotion(transition, direction) {
		return MOTIONS.screens[transition + ":" + direction + ":" + (reducedMotion() ? 1 : 0)] || null;
	}

	function overlayMotion(overlay, opening) {
		return MOTIONS.overlays[overlay.mode + ":" + (overlay.transition || "") + ":" + (opening ? "open" : "close") + ":" + (reducedMotion() ? 1 : 0)] || null;
	}

	function removeOverlay(overlay) {
		overlays = overlays.filter(function (other) { return other !== overlay; });
		unwatch(overlay.record);
		overlay.element.remove();
		updateBack();
	}

	function clearOverlays() {
		overlays.slice().forEach(removeOverlay);
	}

	function openOverlay(file, mode, transition) {
		var screen = byFile[current];
		var target = byFile[file];
		var rect = overlayRect(mode, screen, target);
		var element = document.createElement("div");
		element.className = "overlay";
		var backdrop = document.createElement("div");
		backdrop.className = "backdrop";
		var panel = document.createElement("div");
		panel.className = "panel";
		panel.style.left = rect.x + "px";
		panel.style.top = rect.y + "px";
		panel.style.width = rect.width + "px";
		panel.style.height = rect.height + "px";
		element.style.visibility = "hidden";
		var record = newFrame(file);
		panel.appendChild(record.iframe);
		element.appendChild(backdrop);
		element.appendChild(panel);
		var overlay = { element: element, backdrop: backdrop, panel: panel, record: record, mode: mode, transition: transition, closing: false, animations: [] };
		backdrop.addEventListener("click", closeOverlay);
		overlays.push(overlay);
		scaler.appendChild(element);
		updateBack();
		whenRendered(record, function () {
			if (overlay.closing) return;
			element.style.visibility = "";
			var plan = overlayMotion(overlay, true);
			if (!plan) return;
			var timing = { duration: plan.duration, easing: plan.easing };
			overlay.animations = [animate(panel, plan.panel, timing), animate(backdrop, plan.backdrop, timing)];
		});
	}

	function closeOverlay() {
		var open = overlays.filter(function (overlay) { return !overlay.closing; });
		var overlay = open[open.length - 1];
		if (!overlay) return;
		overlay.closing = true;
		overlay.element.className = "overlay closing";
		updateBack();
		overlay.animations.forEach(function (animation) { if (animation) animation.cancel(); });
		var plan = overlay.element.style.visibility === "hidden" ? null : overlayMotion(overlay, false);
		if (!plan) return removeOverlay(overlay);
		var timing = { duration: plan.duration, easing: plan.easing, fill: "forwards" };
		animate(overlay.panel, plan.panel, timing);
		animate(overlay.backdrop, plan.backdrop, timing);
		setTimeout(function () { removeOverlay(overlay); }, plan.duration);
	}

	function go(file, transition) {
		clearOverlays();
		if (file === current) return;
		depth++;
		arrivedWith = transition || "instant";
		try { history.pushState({ depth: depth, transition: arrivedWith }, "", "#" + encodeURIComponent(file)); }
		catch (error) { /* some file:// pages refuse pushState: the screen still changes */ }
		show(file, screenMotion(arrivedWith, "forward"));
	}

	function back() {
		if (overlayOpen()) closeOverlay();
		else if (depth > 0) history.back();
		else toast("This is the first screen");
	}

	function follow(message) {
		if (String(message.to).trim().toLowerCase() === "back") return back();
		var file = normalizeTarget(message.to);
		if (!byFile[file]) return toast("This link goes nowhere yet");
		var mode = parseOverlayMode(message.mode);
		var transition = parseTransition(message.transition);
		if (mode) openOverlay(file, mode, transition);
		else go(file, transition);
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
		var next = (event.state && event.state.depth) || 0;
		var transition = (event.state && event.state.transition) || "instant";
		var plan = next < depth ? screenMotion(arrivedWith, "back") : next > depth ? screenMotion(transition, "forward") : null;
		depth = next;
		arrivedWith = transition;
		clearOverlays();
		show(fromHash(), plan);
	});
	window.addEventListener("resize", layout);
	window.addEventListener("keydown", function (event) {
		if (event.key === "Escape" && overlayOpen()) closeOverlay();
	});
	window.addEventListener("message", function (event) {
		var record = frames.filter(function (frame) { return event.source === frame.iframe.contentWindow; })[0];
		if (!record) return;
		var message = event.data || {};
		if (message.type === "ready") {
			// A (re)loaded frame starts empty: send everything, then turn play mode on
			record.ready = true;
			if (data.assets) post(record, { type: "assets", assets: data.assets, reset: true });
			post(record, { type: "modules", entry: record.file, modules: data.modules, css: data.css, theme: data.theme, reset: true });
			post(record, { type: "play", on: true });
		} else if (message.type === "rendered" || message.type === "error") {
			if (record.onRendered) record.onRendered();
		} else if (message.type === "navigate" && typeof message.to === "string") {
			follow(message);
		} else if (message.type === "escape" && overlayOpen()) {
			closeOverlay();
		}
	});

	var first = document.getElementById("frame");
	layers.push({ element: scaler.querySelector(".layer"), record: watch(first, data.start) });
	// A sealed site loads the frame only now, so its "ready" doesn't arrive before the listener
	if (!first.getAttribute("src")) first.src = "runtime/frame.html";
	try { history.replaceState({ depth: 0, transition: "instant" }, "", location.hash || "#" + encodeURIComponent(data.start)); } catch (error) {}
	document.getElementById("name").textContent = data.name || "Untitled design";
	show(fromHash(), null);
	}

	boot();
})();
`;

const RUNTIME_SCRIPT = /<script\s+src=["']\.\/frame\.js["']\s*><\/script>/;

/** `</script` and `<!--` can't appear in an inline script, so they become `<\/script`, `<\!--`. */
export function inlineRuntime(runtime: ScreenRuntime): string {
	if (!RUNTIME_SCRIPT.test(runtime.html)) throw new Error("The screen runtime's frame.html doesn't load frame.js");
	const js = runtime.js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

	return runtime.html.replace(RUNTIME_SCRIPT, () => `<script>${js}</script>`);
}

function iconFiles(snapshot: ShareSnapshot, runtime: ScreenRuntime): ExportFile[] {
	const files = new Set<string>();

	for (const module of Object.values(snapshot.modules)) {
		for (const name of module.icons ?? []) {
			const file = iconFile(name);

			if (file) files.add(file);
		}
	}

	const result: ExportFile[] = [];

	for (const file of files) {
		const content = runtime.icon?.(file);

		if (content) result.push({ path: `runtime/icons/${file}.js`, content });
	}

	return result;
}

function snapshotJs(snapshot: ShareSnapshot, options: ViewerOptions) {
	const data = options.sealed
		? `window.${SEALED_GLOBAL} = ${scriptJson(options.sealed)};\n`
		: `window.${SNAPSHOT_GLOBAL} = ${scriptJson(snapshot)};\n`;

	return options.expiresAt ? `${data}window.${EXPIRES_GLOBAL} = ${scriptJson(options.expiresAt)};\n` : data;
}

export function viewerFiles(
	snapshot: ShareSnapshot,
	runtime: ScreenRuntime,
	options: ViewerOptions = {},
): ExportFile[] {
	return [
		{ path: "index.html", content: indexHtml(snapshot, options) },
		{ path: "viewer.js", content: viewerJs() },
		{ path: "snapshot.js", content: snapshotJs(snapshot, options) },
		{ path: "runtime/frame.html", content: inlineRuntime(runtime) },
		...iconFiles(snapshot, runtime),
	];
}
