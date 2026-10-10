import { useCallback, useEffect, useRef } from "react";

/** Closer than this to the bottom still counts as reading the latest message */
const THRESHOLD = 48;

const viewportOf = (root: HTMLElement | null) =>
	root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;

/**
 * Keeps a ScrollArea at the bottom while its content grows, until the reader scrolls up.
 * It sets `scrollTop` on the viewport only: `scrollIntoView` also scrolls every ancestor that can scroll.
 */
export function useStickToBottom<T extends HTMLElement>() {
	const rootRef = useRef<T>(null);
	const stuck = useRef(true);

	const follow = useCallback(() => {
		const viewport = viewportOf(rootRef.current);

		if (viewport && stuck.current) viewport.scrollTop = viewport.scrollHeight;
	}, []);

	useEffect(() => {
		const viewport = viewportOf(rootRef.current);
		// Radix wraps the children in one element, which is what grows
		const content = viewport?.firstElementChild;

		if (!viewport || !content) return;

		const onScroll = () => {
			stuck.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < THRESHOLD;
		};

		const observer = new ResizeObserver(follow);
		observer.observe(content);
		viewport.addEventListener("scroll", onScroll, { passive: true });
		follow();

		return () => {
			observer.disconnect();
			viewport.removeEventListener("scroll", onScroll);
		};
	}, [follow]);

	/** Back to the bottom, for a message the reader just sent */
	const pin = useCallback(() => {
		stuck.current = true;
		follow();
	}, [follow]);

	return { rootRef, pin };
}
