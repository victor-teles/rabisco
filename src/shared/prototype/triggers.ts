import { parseDuration } from "./transitions";

export const LINK_TRIGGER_ATTRIBUTE = "data-link-trigger";

/** Decision 0046: what sets a link off in play mode */
export type LinkTrigger =
	| { kind: "click" }
	| { kind: "hover" }
	| { kind: "press" }
	| { kind: "after"; ms: number }
	| { kind: "key"; key: string };

export type TriggerKind = LinkTrigger["kind"];

export const CLICK: LinkTrigger = { kind: "click" };

export const DEFAULT_DELAY_MS = 800;

export const DEFAULT_KEY = "ArrowRight";

/** Single characters are case-insensitive; names keep `KeyboardEvent.key` case */
const keyName = (key: string) => (key.toLowerCase() === "space" ? " " : key.length === 1 ? key.toLowerCase() : key);

/** `hover`, `press`, `after 800ms` or `key Enter`; anything else is a click */
export function parseTrigger(value: string | null | undefined): LinkTrigger {
	const text = value?.trim() ?? "";
	const lower = text.toLowerCase();

	if (lower === "hover" || lower === "press") return { kind: lower };
	const after = /^after\s+(.+)$/i.exec(text);
	const ms = after ? parseDuration(after[1]) : null;

	if (ms !== null) return { kind: "after", ms };
	const key = /^key\s+(\S+)$/i.exec(text);

	return key ? { kind: "key", key: keyName(key[1]!) } : CLICK;
}

/** `null` for a click, which needs no attribute */
export function formatTrigger(trigger: LinkTrigger): string | null {
	if (trigger.kind === "click") return null;

	if (trigger.kind === "after") return `after ${trigger.ms}ms`;

	return trigger.kind === "key" ? `key ${trigger.key === " " ? "Space" : trigger.key}` : trigger.kind;
}

export const matchesKey = (trigger: LinkTrigger, key: string) => trigger.kind === "key" && trigger.key === keyName(key);

const KEY_LABELS = new Map([
	["ArrowUp", "↑"],
	["ArrowDown", "↓"],
	["ArrowLeft", "←"],
	["ArrowRight", "→"],
	["Enter", "↵"],
	["Escape", "Esc"],
	[" ", "Space"],
	["Backspace", "⌫"],
	["Tab", "⇥"],
]);

export const keyLabel = (key: string) => KEY_LABELS.get(key) ?? (key.length === 1 ? key.toUpperCase() : key);

export function triggerLabel(trigger: LinkTrigger): string {
	if (trigger.kind === "after") return `After ${trigger.ms} ms`;

	if (trigger.kind === "key") return `Key ${keyLabel(trigger.key)}`;

	return { click: "On click", hover: "On hover", press: "On press" }[trigger.kind];
}
