// Relative URLs and a classic data script (not `fetch`) so the site works from `file://`. The runtime is
// inlined because a sandboxed `file://` frame can't load scripts from other files.
import {
	EASINGS,
	MAX_DURATION_MS,
	OVERLAY_MODES,
	overlayMotion,
	screenTransition,
	TRANSITIONS,
	type OverlayMotion,
	type ScreenTransition,
} from "../prototype/transitions";
import { iconFile } from "../icons";
import { DEFAULT_MODE } from "../modes";
import type { ExportFile } from "../types";
import { COMMENT_MAX_LENGTH } from "./comments";
import { GAP_FILL, PADDING_FILL } from "./marks";
import { OPEN_SEALED_JS, type SealedSnapshot } from "./publish";
import type { ScreenRuntime, ShareSnapshot } from "./snapshot";

export const SNAPSHOT_GLOBAL = "__RABISCO_SHARE__";

export const SEALED_GLOBAL = "__RABISCO_SEALED__";

export const EXPIRES_GLOBAL = "__RABISCO_EXPIRES__";

/** Decision 0038: a published site can be sealed with a password, stop at a date and ask not to be indexed. Only the
 * LAN share has `comments`: a route on the same server takes them */
export type ViewerOptions = { sealed?: SealedSnapshot; expiresAt?: string; noindex?: boolean; comments?: boolean };

/** Browser copy of `normalizeTarget` in `src/shared/prototype/links.ts`; a test keeps them in step. */
export const NORMALIZE_TARGET_JS = `function normalizeTarget(to) {
	var path = String(to).trim().replace(/\\\\/g, "/").replace(/^(\\.\\/|\\/)+/, "");
	if (path.indexOf("/") === -1) path = "screens/" + path;
	if (!/\\.tsx$/.test(path)) path = path + ".tsx";
	return path;
}`;

export const LINK_OPTIONS_JS = `var EASINGS = ${JSON.stringify(EASINGS)};
function parseDuration(value) {
	var match = /^(\\d+(?:\\.\\d+)?)\\s*(ms|s)?$/.exec(String(value || "").trim().toLowerCase());
	if (!match) return null;
	var ms = Math.round(Number(match[1]) * (match[2] === "s" ? 1000 : 1));
	return ms <= ${MAX_DURATION_MS} ? ms : null;
}
function parseEasing(value) {
	var name = String(value || "").trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(EASINGS, name) ? name : null;
}
function timed(plan, timing) {
	if (!plan || !timing) return plan;
	var next = {};
	for (var key in plan) next[key] = plan[key];
	if (timing.duration !== null && timing.duration !== undefined) next.duration = timing.duration;
	if (timing.easing) next.easing = EASINGS[timing.easing];
	return next;
}
function parseTransition(value) {
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
header .tools{display:flex;gap:4px}
.tool{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;cursor:pointer;white-space:nowrap}
.tool:hover{background:#f4f4f5}
.tool[aria-pressed="true"]{background:#18181b;color:#fafafa}
.tool svg{width:16px;height:16px;flex-shrink:0}
#inspector{display:none;width:288px;flex-shrink:0;overflow:auto;background:#fff;border-left:1px solid #e4e4e7}
body.inspecting #inspector{display:block}
#inspector .empty{margin:16px;color:#71717a}
#inspector section{padding:12px 16px;border-bottom:1px solid #f4f4f5}
#inspector section:last-child{border-bottom:0}
#inspector h2{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#71717a}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.el-name{font-weight:600;overflow-wrap:anywhere}
.el-where{margin-top:2px;color:#71717a;font-size:12px;overflow-wrap:anywhere}
#inspector dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0}
#inspector dt{color:#71717a;white-space:nowrap}
#inspector dd{margin:0;min-width:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.key{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:2px;vertical-align:-1px}
.swatch{display:inline-block;width:14px;height:14px;margin-right:6px;border-radius:4px;vertical-align:-3px;box-shadow:inset 0 0 0 1px rgb(0 0 0/.12)}
.hex{margin-left:6px;color:#71717a}
.code-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
#inspector .code-head h2{margin:0}
.small{height:28px;padding:0 10px;border:1px solid #e4e4e7;border-radius:6px;background:#fff;font-size:12px;cursor:pointer}
.small:hover{background:#f4f4f5}
#inspector pre{margin:0;padding:10px;max-height:320px;overflow:auto;border-radius:6px;background:#f4f4f5;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2;white-space:pre}
#composer{position:fixed;z-index:30;display:none;flex-direction:column;gap:8px;width:288px;max-width:calc(100vw - 24px);padding:10px;border:1px solid #e4e4e7;border-radius:10px;background:#fff;box-shadow:0 10px 40px -12px rgb(0 0 0/.35)}
#composer.open{display:flex}
#composer textarea{min-height:84px;padding:8px 10px;border:1px solid #d4d4d8;border-radius:6px;font:inherit;resize:vertical}
@media (hover:none){#composer textarea{font-size:16px}}
#composer .row{display:flex;justify-content:flex-end;gap:6px}
#composer .row button{height:32px;padding:0 12px;border:0;border-radius:6px;cursor:pointer}
#composer-cancel{background:transparent}
#composer-cancel:hover{background:#f4f4f5}
#composer-send{background:#18181b;color:#fafafa}
#composer-send:disabled{opacity:.6;cursor:default}
#composer .error{margin:0;color:#b91c1c;font-size:12px}
#composer .error:empty{display:none}
@media (max-width:700px){nav{display:none}.tool{width:32px;padding:0;justify-content:center}.tool span{display:none}body.inspecting .body{flex-direction:column}#inspector{width:auto;max-height:45vh;border-left:0;border-top:1px solid #e4e4e7}#composer{left:12px!important;right:12px;top:auto!important;bottom:calc(12px + env(safe-area-inset-bottom));width:auto;max-width:none}}
@media (prefers-reduced-motion:reduce){#toast{transition:none}}
`;

const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;

const ICON_RESTART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

const ICON_INSPECT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`;

const ICON_COMMENT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>`;

const COMMENT_BUTTON = `<button class="tool" id="comment" type="button" aria-pressed="false" aria-label="Comment" title="Comment (C)">${ICON_COMMENT}<span>Comment</span></button>`;

const COMPOSER = `<form id="composer" aria-label="New comment">
			<textarea id="composer-text" aria-label="Comment" placeholder="Add a comment" maxlength="${COMMENT_MAX_LENGTH}"></textarea>
			<p class="error" id="composer-error" role="alert"></p>
			<div class="row"><button type="button" id="composer-cancel">Cancel</button><button type="submit" id="composer-send">Send</button></div>
		</form>`;

function indexHtml(snapshot: ShareSnapshot, options: ViewerOptions) {
	const name = options.sealed ? "Shared design" : escapeHtml(snapshot.name || "Untitled design");

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
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
			<div class="tools">
				<button class="tool" id="inspect" type="button" aria-pressed="false" aria-label="Inspect" title="Inspect (I)">${ICON_INSPECT}<span>Inspect</span></button>
				${options.comments ? COMMENT_BUTTON : ""}
			</div>
		</header>
		<div class="body">
			<nav aria-label="Screens">
				<ol id="screens"></ol>
				<p>Read-only prototype. Click links to move between screens.</p>
			</nav>
			<main id="stage">
				<div id="device"><div id="scaler"><div class="layer"><iframe id="frame" title="Screen" sandbox="allow-scripts"${options.sealed ? "" : ' src="runtime/frame.html"'}></iframe></div></div></div>
			</main>
			<aside id="inspector" aria-label="Inspect"></aside>
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
		${options.comments ? COMPOSER : ""}
		<script src="snapshot.js"></script>
		<script src="viewer.js"></script>
	</body>
</html>
`;
}

/** Inspect and comment modes (decision 0038); runs inside `start`, next to the frames it talks to */
const PICK_JS = `var inspectButton = document.getElementById("inspect");
	var commentButton = document.getElementById("comment");
	var inspector = document.getElementById("inspector");
	var composer = document.getElementById("composer");
	var composerText = document.getElementById("composer-text");
	var composerError = document.getElementById("composer-error");
	var composerSend = document.getElementById("composer-send");
	var TOUCH = !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
	var ROLES = { fill: "Fill", text: "Text", border: "Border" };
	var pickMode = null;
	var pending = null;
	var sentPins = {};

	function pinsFor(record) {
		var pins = (sentPins[record.file] || []).slice();
		if (pending && pending.record === record) pins.push({ x: pending.x, y: pending.y });
		return pins;
	}

	function syncPick(record) {
		post(record, { type: "play", on: !pickMode });
		post(record, { type: "pick-mode", mode: pickMode });
		post(record, { type: "pins", pins: pinsFor(record) });
	}

	function setPickMode(next) {
		closeComposer();
		pickMode = next;
		inspectButton.setAttribute("aria-pressed", String(next === "inspect"));
		if (commentButton) commentButton.setAttribute("aria-pressed", String(next === "point"));
		document.body.classList.toggle("inspecting", next === "inspect");
		showInspected(null, null);
		frames.forEach(function (record) { if (record.ready) syncPick(record); });
		if (next === "point") toast((TOUCH ? "Tap" : "Click") + " where you want to comment");
	}

	function node(tag, className, text) {
		var element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}

	function num(value) {
		return String(Math.round(value * 10) / 10);
	}

	function sides(values) {
		if (values[0] === values[1] && values[1] === values[2] && values[2] === values[3]) return num(values[0]);
		if (values[0] === values[2] && values[1] === values[3]) return num(values[0]) + " " + num(values[1]);
		return values.map(num).join(" ");
	}

	function insets(box) {
		return sides([box.top, box.right, box.bottom, box.left]);
	}

	function elementCode(file, start) {
		var module = data.modules[file];
		var spans = module && module.elements;
		if (!spans) return null;
		for (var i = 0; i < spans.length; i += 2) {
			if (spans[i] !== start) continue;
			var lineStart = module.source.lastIndexOf("\\n", start - 1) + 1;
			var indent = /^[ \\t]*/.exec(module.source.slice(lineStart, start))[0];
			return module.source.slice(start, spans[i + 1]).split("\\n").map(function (line, index) {
				return index > 0 && indent && line.indexOf(indent) === 0 ? line.slice(indent.length) : line;
			}).join("\\n");
		}
		return null;
	}

	function section(title) {
		var element = node("section");
		if (title) element.appendChild(node("h2", "", title));
		inspector.appendChild(element);
		return element;
	}

	function rows(parent, items) {
		var list = node("dl");
		items.forEach(function (item) {
			var term = node("dt");
			if (item.key) {
				var key = node("span", "key");
				key.style.background = item.key;
				term.appendChild(key);
			}
			term.appendChild(document.createTextNode(item.label));
			var value = node("dd");
			if (item.content) value.appendChild(item.content);
			else value.textContent = item.value;
			list.appendChild(term);
			list.appendChild(value);
		});
		parent.appendChild(list);
	}

	function colorValue(color) {
		var wrap = node("span");
		var swatch = node("span", "swatch");
		swatch.style.background = color.hex;
		swatch.style.opacity = String(color.alpha);
		wrap.appendChild(swatch);
		var hex = color.hex + (color.alpha < 1 ? " " + Math.round(color.alpha * 100) + "%" : "");
		wrap.appendChild(node("span", "mono", color.token || hex));
		if (color.token) wrap.appendChild(node("span", "mono hex", hex));
		return wrap;
	}

	function copyCode(text) {
		function fallback() {
			var area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.opacity = "0";
			document.body.appendChild(area);
			area.select();
			var done = false;
			try { done = document.execCommand("copy"); } catch (error) {}
			area.remove();
			toast(done ? "Code copied" : "Couldn't copy. Select the code and copy it.");
		}
		// A LAN link is plain http, where the Clipboard API is off
		if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast("Code copied"); }, fallback);
		else fallback();
	}

	function showInspected(record, element) {
		inspector.replaceChildren();
		if (!element) {
			inspector.appendChild(node("p", "empty", (TOUCH ? "Tap" : "Click") + " an element to see its size, spacing, colors and code."));
			layout();
			return;
		}
		var module = data.modules[record.file];
		var code = elementCode(record.file, element.start);
		var tag = code && /^<([A-Za-z0-9_.:-]*)/.exec(code);
		var line = module ? module.source.slice(0, element.start).split("\\n").length : 0;
		var head = section("");
		head.appendChild(node("div", "el-name mono", tag ? "<" + tag[1] + ">" : "Element"));
		head.appendChild(node("div", "el-where", record.file + (line ? ", line " + line : "")));
		var box = [{ label: "Size", value: num(element.width) + " × " + num(element.height) }];
		box.push({ label: "Padding", value: insets(element.padding), key: "${PADDING_FILL}" });
		if (element.margin.top || element.margin.right || element.margin.bottom || element.margin.left) box.push({ label: "Margin", value: insets(element.margin) });
		if (element.gap && (element.gap.row || element.gap.column)) box.push({ label: "Gap", value: element.gap.row === element.gap.column ? num(element.gap.row) : num(element.gap.row) + " " + num(element.gap.column), key: "${GAP_FILL}" });
		if (element.radius.some(Boolean)) box.push({ label: "Radius", value: sides(element.radius) });
		if (element.opacity < 1) box.push({ label: "Opacity", value: Math.round(element.opacity * 100) + "%" });
		rows(section("Layout"), box);
		if (element.font) rows(section("Text"), [
			{ label: "Font", value: element.font.family },
			{ label: "Size", value: num(element.font.size) + (element.font.lineHeight ? " / " + num(element.font.lineHeight) : "") },
			{ label: "Weight", value: element.font.weight },
		]);
		if (element.colors.length) rows(section("Colors"), element.colors.map(function (color) {
			return { label: ROLES[color.role] || color.role, content: colorValue(color) };
		}));
		if (code) {
			var block = section("");
			var codeHead = node("div", "code-head");
			codeHead.appendChild(node("h2", "", "Code"));
			var copy = node("button", "small", "Copy");
			copy.type = "button";
			copy.addEventListener("click", function () { copyCode(code); });
			codeHead.appendChild(copy);
			block.appendChild(codeHead);
			var pre = node("pre");
			pre.appendChild(node("code", "", code));
			block.appendChild(pre);
		}
		layout();
	}

	function openComposer(record, message) {
		var rect = record.iframe.getBoundingClientRect();
		var scale = record.iframe.offsetWidth ? rect.width / record.iframe.offsetWidth : 1;
		var x = rect.left + message.clientX * scale;
		var y = rect.top + message.clientY * scale;
		pending = { record: record, file: record.file, x: message.x, y: message.y };
		post(record, { type: "pins", pins: pinsFor(record) });
		composerError.textContent = "";
		composer.className = "open";
		var left = x + 16 + composer.offsetWidth > window.innerWidth - 12 ? x - 16 - composer.offsetWidth : x + 16;
		composer.style.left = Math.max(12, left) + "px";
		composer.style.top = Math.max(12, Math.min(y - 12, window.innerHeight - composer.offsetHeight - 12)) + "px";
		composerText.focus();
	}

	function closeComposer() {
		if (!composer) return;
		composer.className = "";
		var record = pending && pending.record;
		pending = null;
		if (record && frames.indexOf(record) !== -1) post(record, { type: "pins", pins: pinsFor(record) });
	}

	function sendComment(event) {
		event.preventDefault();
		var text = composerText.value.trim();
		if (!pending || !text) return composerText.focus();
		var sending = pending;
		composerSend.disabled = true;
		composerError.textContent = "";
		fetch("comments", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ screen: sending.file, x: sending.x, y: sending.y, text: text }),
		}).then(function (response) {
			if (response.ok) return null;
			return response.status === 429 ? response.text() : "Couldn't send the comment. Rabisco must be open on the designer's computer.";
		}, function () {
			return "Couldn't reach Rabisco. Check that you're on the same network as the designer.";
		}).then(function (error) {
			composerSend.disabled = false;
			if (error) {
				composerError.textContent = error;
				return;
			}
			(sentPins[sending.file] = sentPins[sending.file] || []).push({ x: sending.x, y: sending.y });
			composerText.value = "";
			if (pending === sending) closeComposer();
			toast("Comment sent");
		});
	}

	/** Composer, then mode, then overlay */
	function escape() {
		if (pending) closeComposer();
		else if (pickMode) setPickMode(null);
		else if (overlayOpen()) closeOverlay();
	}

	inspectButton.addEventListener("click", function () { setPickMode(pickMode === "inspect" ? null : "inspect"); });
	if (commentButton) commentButton.addEventListener("click", function () { setPickMode(pickMode === "point" ? null : "point"); });
	if (composer) {
		composer.addEventListener("submit", sendComment);
		document.getElementById("composer-cancel").addEventListener("click", closeComposer);
		composerText.addEventListener("keydown", function (event) {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendComment(event);
		});
	}
	window.addEventListener("keydown", function (event) {
		if (event.key === "Escape") return escape();
		var target = event.target;
		if (event.metaKey || event.ctrlKey || event.altKey || (target && /^(INPUT|TEXTAREA)$/.test(target.tagName))) return;
		var key = event.key.toLowerCase();
		if (key === "i") setPickMode(pickMode === "inspect" ? null : "inspect");
		else if (key === "c" && commentButton) setPickMode(pickMode === "point" ? null : "point");
		else if (!event.repeat) playKey(event.key);
	});`;

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
	var DEFAULT_MODE = ${JSON.stringify(DEFAULT_MODE)};
	var byFile = {};
	data.screens.forEach(function (screen) { byFile[screen.file] = screen; });
	function modeOf(file) { return (byFile[file] && byFile[file].mode) || DEFAULT_MODE; }
	function themeOf(file) { return data.theme + ((byFile[file] && byFile[file].draft) || ""); }
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
	var arrivedTiming = null;
	var toastTimer = 0;
	var frames = [];
	var layers = [];
	var overlays = [];
	var motion = null;

	${NORMALIZE_TARGET_JS}

	${LINK_OPTIONS_JS}

	${PICK_JS}

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

	/** Key link triggers (decision 0046) while the viewer, not a frame, has focus */
	function playKey(key) {
		if (pickMode) return;
		var open = overlays.filter(function (overlay) { return !overlay.closing; });
		var record = open.length ? open[open.length - 1].record : layers[layers.length - 1].record;
		if (record && record.ready) post(record, { type: "play-key", key: key });
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
		closeComposer();
		if (pickMode === "inspect") showInspected(null, null);
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
			if (top.record.ready) {
				post(top.record, { type: "modules", entry: file, modules: {}, theme: themeOf(file), mode: modeOf(file) });
				syncPick(top.record);
			}
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
		return timed(MOTIONS.overlays[overlay.mode + ":" + (overlay.transition || "") + ":" + (opening ? "open" : "close") + ":" + (reducedMotion() ? 1 : 0)] || null, overlay.timing);
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

	function openOverlay(file, mode, transition, timing) {
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
		var overlay = { element: element, backdrop: backdrop, panel: panel, record: record, mode: mode, transition: transition, timing: timing, closing: false, animations: [] };
		backdrop.addEventListener("click", closeOverlay);
		overlays.push(overlay);
		scaler.appendChild(element);
		updateBack();
		whenRendered(record, function () {
			if (overlay.closing) return;
			element.style.visibility = "";
			var plan = overlayMotion(overlay, true);
			if (!plan) return;
			var options = { duration: plan.duration, easing: plan.easing };
			overlay.animations = [animate(panel, plan.panel, options), animate(backdrop, plan.backdrop, options)];
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

	function go(file, transition, timing) {
		clearOverlays();
		if (file === current) return;
		depth++;
		arrivedWith = transition || "instant";
		arrivedTiming = timing || null;
		try { history.pushState({ depth: depth, transition: arrivedWith, timing: arrivedTiming }, "", "#" + encodeURIComponent(file)); }
		catch (error) { /* some file:// pages refuse pushState: the screen still changes */ }
		show(file, timed(screenMotion(arrivedWith, "forward"), arrivedTiming));
	}

	function back() {
		if (overlayOpen()) closeOverlay();
		else if (depth > 0) history.back();
		else toast("This is the first screen");
	}

	function follow(message) {
		var to = String(message.to).trim();
		if (to.toLowerCase() === "back") return back();
		// Decision 0046: the frame scrolls to its own anchors; web and mail links leave the prototype
		if (to.charAt(0) === "#") return;
		if (/^(https?:\\/\\/|mailto:)/i.test(to)) return void window.open(to, "_blank", "noopener");
		var file = normalizeTarget(message.to);
		if (!byFile[file]) return toast("This link goes nowhere yet");
		var mode = parseOverlayMode(message.mode);
		var transition = parseTransition(message.transition);
		var timing = { duration: parseDuration(message.duration), easing: parseEasing(message.easing) };
		if (mode) openOverlay(file, mode, transition, timing);
		else go(file, transition, timing);
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
		var timing = (event.state && event.state.timing) || null;
		var plan = next < depth ? timed(screenMotion(arrivedWith, "back"), arrivedTiming) : next > depth ? timed(screenMotion(transition, "forward"), timing) : null;
		depth = next;
		arrivedWith = transition;
		arrivedTiming = timing;
		clearOverlays();
		show(fromHash(), plan);
	});
	window.addEventListener("resize", layout);
	window.addEventListener("message", function (event) {
		var record = frames.filter(function (frame) { return event.source === frame.iframe.contentWindow; })[0];
		if (!record) return;
		var message = event.data || {};
		if (message.type === "ready") {
			// A (re)loaded frame starts empty: send everything, then turn play mode on
			record.ready = true;
			if (data.assets) post(record, { type: "assets", assets: data.assets, reset: true });
			post(record, { type: "modules", entry: record.file, modules: data.modules, css: data.css, theme: themeOf(record.file), mode: modeOf(record.file), reset: true });
			syncPick(record);
		} else if (message.type === "rendered" || message.type === "error") {
			if (record.onRendered) record.onRendered();
		} else if (message.type === "navigate" && typeof message.to === "string") {
			follow(message);
		} else if (message.type === "escape") {
			escape();
		} else if (message.type === "inspected" && pickMode === "inspect") {
			// One selection across the screen and its overlays
			frames.forEach(function (other) { if (other !== record && other.ready) post(other, { type: "pick-mode", mode: "inspect" }); });
			showInspected(record, message.element);
		} else if (message.type === "pointed" && pickMode === "point" && composer) {
			openComposer(record, message);
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
