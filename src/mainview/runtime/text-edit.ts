/**
 * Editing a screen element's text in place, inside the frame, so it keeps the
 * screen's exact fonts and layout. The DOM is borrowed: when the edit ends,
 * the nodes React rendered are put back as they were, and the host writes the
 * new text to the source, which re-renders the screen.
 */

export type TextEdit = { finish: (commit: boolean) => void };

/** Text as the screen shows it, for comparing with the source's: whitespace collapsed. */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Makes `elements` (one rendered instance of a source element) editable, when
 * it is a single element whose text is `expected`: anything else (an icon
 * next to the text, text the component adds) would not map back to the
 * source's text. `done` receives the new text, or `null` when cancelled.
 * Enter and a click elsewhere keep the text, Escape puts the old one back.
 */
export function startTextEdit(
	elements: Element[],
	expected: string,
	done: (text: string | null) => void,
): TextEdit | null {
	const only = elements.length === 1 ? elements[0] : null;

	if (
		!(only instanceof HTMLElement) ||
		only.children.length ||
		normalize(only.textContent ?? "") !== normalize(expected)
	)
		return null;
	const element: HTMLElement = only;

	const nodes = [...element.childNodes];
	// Typing changes text nodes in place: keep their text to put it back
	const texts = nodes.map((node) => (node instanceof Text ? node.data : null));

	const attributes = {
		contenteditable: element.getAttribute("contenteditable"),
		spellcheck: element.getAttribute("spellcheck"),
	};

	const style = { outline: element.style.outline, cursor: element.style.cursor, userSelect: element.style.userSelect };

	element.setAttribute("contenteditable", "plaintext-only");

	// Engines without `plaintext-only` drop the attribute value; rich text is fine since only the text is read
	if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
	element.setAttribute("spellcheck", "false");
	element.style.outline = "none";
	element.style.cursor = "text";
	element.style.userSelect = "text";
	element.focus();
	const range = document.createRange();
	range.selectNodeContents(element);
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range);

	let finished = false;
	/** The click that follows a press outside ends the edit; it must not reach the screen */
	let swallowClick = false;

	const onKeyDown = (event: KeyboardEvent) => {
		event.stopPropagation();

		if (event.key === "Enter") {
			event.preventDefault();
			finish(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			finish(false);
		}
	};

	const onPaste = (event: ClipboardEvent) => {
		event.preventDefault();
		const text = event.clipboardData?.getData("text/plain") ?? "";
		document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.target instanceof Node && element.contains(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		swallowClick = true;
		finish(true);
	};

	const onClick = (event: MouseEvent) => {
		if (!swallowClick && event.target instanceof Node && element.contains(event.target)) {
			// Clicks inside place the caret, but never trigger the screen's handlers (a button's onClick)
			event.preventDefault();
			event.stopPropagation();

			return;
		}

		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();

		if (finished) document.removeEventListener("click", onClick, true);
	};

	const onBlur = () => finish(true);

	element.addEventListener("keydown", onKeyDown);
	element.addEventListener("paste", onPaste);
	element.addEventListener("blur", onBlur);
	document.addEventListener("pointerdown", onPointerDown, true);
	document.addEventListener("click", onClick, true);

	function finish(commit: boolean) {
		if (finished) return;
		finished = true;
		const text = normalize(element.innerText ?? element.textContent ?? "");
		element.removeEventListener("keydown", onKeyDown);
		element.removeEventListener("paste", onPaste);
		element.removeEventListener("blur", onBlur);
		document.removeEventListener("pointerdown", onPointerDown, true);

		// The click of a press that ended the edit comes later, on release: `onClick` removes itself then
		if (swallowClick) setTimeout(() => document.removeEventListener("click", onClick, true), 2000);
		else document.removeEventListener("click", onClick, true);
		window.getSelection()?.removeAllRanges();
		// Put React's nodes back, with their old text: React updates them when the new source renders
		nodes.forEach((node, i) => {
			if (node instanceof Text && texts[i] !== null) node.data = texts[i]!;
		});
		element.replaceChildren(...nodes);

		for (const [name, value] of Object.entries(attributes)) {
			if (value === null) element.removeAttribute(name);
			else element.setAttribute(name, value);
		}

		Object.assign(element.style, style);
		done(commit ? text : null);
	}

	return { finish };
}
