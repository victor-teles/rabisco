// Play mode (decision 0007). Links are read from React fibers so components that don't forward the prop still link.
import {
	LINK_DURATION_ATTRIBUTE,
	LINK_EASING_ATTRIBUTE,
	LINK_MODE_ATTRIBUTE,
	LINK_TO_ATTRIBUTE,
	LINK_TRANSITION_ATTRIBUTE,
	LINK_TRIGGER_ATTRIBUTE,
	type FrameMessage,
	type LinkOptions,
} from "../lib/render/protocol";
import { matchesKey, parseTrigger, type LinkTrigger } from "../../shared/prototype/triggers";
import { fiberOf, hostElements, rootFiber, textProp, type Fiber } from "./inspect";

/** Marks the DOM of linked component elements, which don't carry `data-link-to` themselves. */
const MARK = "data-rabisco-link";

const POINTER_CSS = `:is([${LINK_TO_ATTRIBUTE}], [${MARK}]), :is([${LINK_TO_ATTRIBUTE}], [${MARK}]) * { cursor: pointer !important; }`;

const linkOf = (fiber: Fiber) => textProp(fiber, LINK_TO_ATTRIBUTE)?.trim() || null;

export type LinkClick = { to: string } & LinkOptions;

/** A link with what sets it off, and the DOM it covers */
type FoundLink = { link: LinkClick; trigger: LinkTrigger; elements: Element[] };

const optional = (value: string | null | undefined) => value?.trim() || undefined;

function fromFiber(fiber: Fiber, to: string): FoundLink {
	return {
		link: {
			to,
			transition: optional(textProp(fiber, LINK_TRANSITION_ATTRIBUTE)),
			mode: optional(textProp(fiber, LINK_MODE_ATTRIBUTE)),
			duration: optional(textProp(fiber, LINK_DURATION_ATTRIBUTE)),
			easing: optional(textProp(fiber, LINK_EASING_ATTRIBUTE)),
		},
		trigger: parseTrigger(textProp(fiber, LINK_TRIGGER_ATTRIBUTE)),
		elements: hostElements(fiber),
	};
}

function fromElement(element: Element, to: string): FoundLink {
	return {
		link: {
			to,
			transition: optional(element.getAttribute(LINK_TRANSITION_ATTRIBUTE)),
			mode: optional(element.getAttribute(LINK_MODE_ATTRIBUTE)),
			duration: optional(element.getAttribute(LINK_DURATION_ATTRIBUTE)),
			easing: optional(element.getAttribute(LINK_EASING_ATTRIBUTE)),
		},
		trigger: parseTrigger(element.getAttribute(LINK_TRIGGER_ATTRIBUTE)),
		elements: [element],
	};
}

function foundAt(target: EventTarget | null): FoundLink | null {
	const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;

	if (!element) return null;

	for (let fiber = fiberOf(element); fiber; fiber = fiber.return) {
		const to = linkOf(fiber);

		if (to) return fromFiber(fiber, to);
	}

	const linked = element.closest(`[${LINK_TO_ATTRIBUTE}]`);
	const value = linked?.getAttribute(LINK_TO_ATTRIBUTE)?.trim();

	return linked && value ? fromElement(linked, value) : null;
}

export function linkAt(target: EventTarget | null): LinkClick | null {
	return foundAt(target)?.link ?? null;
}

/** Every link of the rendered screen, in source order */
function linksOf(container: Element): FoundLink[] {
	const found: FoundLink[] = [];
	const root = rootFiber(container);

	const visit = (fiber: Fiber) => {
		for (let node: Fiber | null = fiber; node; node = node.sibling) {
			const to = linkOf(node);

			if (to) found.push(fromFiber(node, to));

			if (node.child) visit(node.child);
		}
	};

	if (root?.child) visit(root.child);

	return found;
}

const reducedMotion = () => "matchMedia" in window && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Escape, ⌘[ and ⌘] belong to play mode */
const isPlayKey = (event: KeyboardEvent) => event.key === "Escape" || event.metaKey || event.ctrlKey || event.altKey;

const isTyping = (target: EventTarget | null) =>
	target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

/** `rendered` names what the frame last rendered, `""` before that: a delay starts again when it changes */
export function createPlay(container: Element, post: (message: FrameMessage) => void, rendered: () => string) {
	let playing = false;
	const style = document.createElement("style");
	/** A press link fired on pointer-down: its click must not fire a click link too */
	let pressed = false;
	let timers: number[] = [];
	let timedScreen: string | null = null;

	// Decision 0046: `#id` scrolls this screen; everything else goes to the host
	const fire = (link: LinkClick) => {
		if (!link.to.startsWith("#")) return post({ type: "navigate", ...link });
		const target = document.getElementById(link.to.slice(1));
		target?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
	};

	const clearTimers = () => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
	};

	const stopTimers = () => {
		clearTimers();
		timedScreen = null;
	};

	const startTimers = () => {
		if (!rendered() || timedScreen === rendered()) return;
		stopTimers();
		timedScreen = rendered();

		for (const { link, trigger } of linksOf(container))
			if (trigger.kind === "after")
				timers.push(
					window.setTimeout(() => {
						// The first delay to run out wins, until the screen shows again
						clearTimers();

						if (playing) fire(link);
					}, trigger.ms),
				);
	};

	const pressKey = (key: string) => {
		const found = linksOf(container).find(({ trigger }) => matchesKey(trigger, key));

		if (found) fire(found.link);

		return !!found;
	};

	const refresh = () => {
		for (const marked of container.querySelectorAll(`[${MARK}]`)) marked.removeAttribute(MARK);

		if (!playing) return;
		const root = rootFiber(container);

		const visit = (fiber: Fiber) => {
			for (let node: Fiber | null = fiber; node; node = node.sibling) {
				if (linkOf(node) && !(node.stateNode instanceof Element))
					for (const element of hostElements(node)) element.setAttribute(MARK, "");

				if (node.child) visit(node.child);
			}
		};

		if (root?.child) visit(root.child);
		startTimers();
	};

	// Capture phase: the link wins over the screen's own handlers and defaults
	window.addEventListener(
		"click",
		(event) => {
			if (!playing || event.button !== 0) return;
			const found = foundAt(event.target);

			if (found && (found.trigger.kind === "click" || pressed)) {
				event.preventDefault();
				event.stopPropagation();

				if (!pressed) fire(found.link);
				pressed = false;

				return;
			}

			// A plain `<a href="/x">` would load another page into the frame
			const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;

			if (anchor && !anchor.getAttribute("href")!.startsWith("#")) event.preventDefault();
		},
		true,
	);
	window.addEventListener(
		"pointerdown",
		(event) => {
			pressed = false;

			if (!playing || event.button !== 0) return;
			const found = foundAt(event.target);

			if (found?.trigger.kind !== "press") return;
			event.stopPropagation();
			pressed = true;
			fire(found.link);
		},
		true,
	);
	window.addEventListener(
		"pointerover",
		(event) => {
			if (!playing) return;
			const found = foundAt(event.target);

			if (found?.trigger.kind !== "hover") return;
			const from = event.relatedTarget instanceof Node ? event.relatedTarget : null;

			// Moving between the element's own children isn't entering it
			if (from && found.elements.some((element) => element.contains(from))) return;
			fire(found.link);
		},
		true,
	);
	// Bubble phase: a dialog or menu of the screen that closes on Escape keeps it
	window.addEventListener("keydown", (event) => {
		if (!playing || event.defaultPrevented) return;

		if (event.key === "Escape") return post({ type: "escape" });

		if (isPlayKey(event) || event.repeat || isTyping(event.target)) return;

		if (pressKey(event.key)) event.preventDefault();
	});

	return {
		get playing() {
			return playing;
		},
		set(on: boolean) {
			if (on === playing) return;
			playing = on;

			if (on) {
				style.textContent = POINTER_CSS;
				document.head.appendChild(style);
			} else {
				style.remove();
				stopTimers();
			}

			refresh();
		},
		refresh,
		/** From the play view, while the frame doesn't have focus */
		key(key: string) {
			if (playing) pressKey(key);
		},
	};
}
