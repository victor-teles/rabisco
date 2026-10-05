// Play mode (decision 0007). Links are read from React fibers so components that don't forward the prop still link.
import { LINK_TO_ATTRIBUTE, type FrameMessage } from "../lib/render/protocol";
import { fiberOf, hostElements, rootFiber, textProp, type Fiber } from "./inspect";

/** Marks the DOM of linked component elements, which don't carry `data-link-to` themselves. */
const MARK = "data-rabisco-link";

const POINTER_CSS = `:is([${LINK_TO_ATTRIBUTE}], [${MARK}]), :is([${LINK_TO_ATTRIBUTE}], [${MARK}]) * { cursor: pointer !important; }`;

const linkOf = (fiber: Fiber) => textProp(fiber, LINK_TO_ATTRIBUTE)?.trim() || null;

export function linkAt(target: EventTarget | null): string | null {
	const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;

	if (!element) return null;

	for (let fiber = fiberOf(element); fiber; fiber = fiber.return) {
		const to = linkOf(fiber);

		if (to) return to;
	}

	const value = element.closest(`[${LINK_TO_ATTRIBUTE}]`)?.getAttribute(LINK_TO_ATTRIBUTE)?.trim();

	return value || null;
}

export function createPlay(container: Element, post: (message: FrameMessage) => void) {
	let playing = false;
	const style = document.createElement("style");

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
	};

	// Capture phase: the link wins over the screen's own handlers and defaults
	window.addEventListener(
		"click",
		(event) => {
			if (!playing || event.button !== 0) return;
			const to = linkAt(event.target);

			if (to) {
				event.preventDefault();
				event.stopPropagation();
				post({ type: "navigate", to });

				return;
			}

			// A plain `<a href="/x">` would load another page into the frame
			const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;

			if (anchor && !anchor.getAttribute("href")!.startsWith("#")) event.preventDefault();
		},
		true,
	);
	// Bubble phase: a dialog or menu of the screen that closes on Escape keeps it
	window.addEventListener("keydown", (event) => {
		if (playing && event.key === "Escape" && !event.defaultPrevented) post({ type: "escape" });
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
			} else style.remove();
			refresh();
		},
		refresh,
	};
}
