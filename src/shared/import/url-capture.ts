import { isString } from "../guards";
import { isJsonObject, type Json } from "../json";
import { CAPTURE_SCRIPT } from "./capture-script";
import { MAX_CAPTURED_BYTES, parseCapturedTree, type CapturedTree } from "./captured-tree";

export type PageVars = Record<string, string>;

export type UrlCapture = { url: string; tree: CapturedTree; vars: PageVars };

export type UrlCaptureResult = { kind: "captured"; capture: UrlCapture } | { kind: "error"; message: string };

export const SETTLE_MS = 500;

export const MAX_WAIT_MS = 15_000;

const MAX_VARS = 400;

const MAX_VAR_VALUE = 200;

const VAR_NAME = /^--[a-zA-Z0-9_-]{1,80}$/;

const MAX_MESSAGE_BYTES = MAX_CAPTURED_BYTES + 256 * 1024;

const varsScript = String.raw`
const style = getComputedStyle(document.documentElement);
const names = new Set();
for (let i = 0; i < style.length; i++) if (style[i].startsWith("--")) names.add(style[i]);
for (const sheet of document.styleSheets) {
	let rules;
	try { rules = sheet.cssRules; } catch { continue; }
	for (const rule of rules) {
		if (!rule.style || !/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText || "")) continue;
		for (let i = 0; i < rule.style.length; i++) if (rule.style[i].startsWith("--")) names.add(rule.style[i]);
	}
}
const vars = {};
let count = 0;
for (const name of names) {
	if (count++ >= ${MAX_VARS}) break;
	const value = style.getPropertyValue(name).trim();
	if (value && value.length <= ${MAX_VAR_VALUE}) vars[name] = value;
}
return vars;
`;

export function urlCaptureScript(nonce: string, settleMs = SETTLE_MS, maxWaitMs = MAX_WAIT_MS): string {
	return String.raw`(() => {
const nonce = ${JSON.stringify(nonce)};
const send = (payload) => window.__electrobunSendToHost && window.__electrobunSendToHost(JSON.stringify(Object.assign({ nonce }, payload)));
const started = Date.now();
let last = "";
let stable = started;
const signature = () => document.body ? document.documentElement.scrollHeight + ":" + document.body.getElementsByTagName("*").length : "";
const tick = () => {
	const now = Date.now();
	const current = signature();
	if (current !== last) { last = current; stable = now; }
	if (!document.body || (now - stable < ${settleMs} && now - started < ${maxWaitMs})) return void setTimeout(tick, 100);
	try {
		window.scrollTo(0, 0);
		send({ url: location.href, tree: ${CAPTURE_SCRIPT}, vars: (() => {${varsScript}})() });
	} catch (error) {
		send({ error: String((error && error.message) || error) });
	}
};
tick();
})()`;
}

function parseVars(json: Json | undefined) {
	const entries = isJsonObject(json) ? Object.entries(json).slice(0, MAX_VARS) : [];

	return Object.fromEntries(
		entries.flatMap(([name, value]) =>
			VAR_NAME.test(name) && isString(value) && value.length <= MAX_VAR_VALUE ? [[name, String(value)]] : [],
		),
	);
}

export function parseUrlCaptureMessage(text: string, nonce: string): UrlCaptureResult | null {
	if (text.length > MAX_MESSAGE_BYTES) return { kind: "error", message: "That page is too big to import." };
	let json: Json;

	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		json = JSON.parse(text) as Json;
	} catch {
		return null;
	}

	if (!isJsonObject(json) || json.nonce !== nonce) return null;

	if (isString(json.error)) return { kind: "error", message: `The page couldn't be read: ${json.error.slice(0, 200)}` };
	const tree = isString(json.tree) ? parseCapturedTree(json.tree) : null;
	const address = isString(json.url) ? String(json.url) : "";
	const url = /^https?:\/\//i.test(address) ? address.slice(0, 2000) : null;

	if (!tree || !url) return { kind: "error", message: "The page couldn't be read." };

	return { kind: "captured", capture: { url, tree, vars: parseVars(json.vars) } };
}
