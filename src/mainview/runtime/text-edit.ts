// The DOM is borrowed: React's nodes are restored when the edit ends, then the new source re-renders.

import { mergeRuns, type RichRun } from "../../shared/jsx/rich-text";

export type TextEdit = { finish: (commit: boolean) => void };

/** `runs` only for a rich edit */
export type EditedText = { text: string; runs: RichRun[] | null };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const FORMATTING = new Set(["STRONG", "B", "EM", "I", "A"]);

const onlyFormatting = (element: Element): boolean =>
	[...element.children].every((child) => FORMATTING.has(child.tagName) && onlyFormatting(child));

type Marks = { bold: boolean; italic: boolean; href: string | null };

/** Tags, and the inline weight or style an engine writes when it unbolds part of a `<strong>` */
function marksOf(element: HTMLElement, marks: Marks): Marks {
	const weight = element.style.fontWeight;
	const style = element.style.fontStyle;
	const tag = element.tagName;

	return {
		bold:
			tag === "STRONG" || tag === "B" || weight === "bold" || Number(weight) >= 600
				? true
				: weight === "normal" || (weight !== "" && Number(weight) < 600)
					? false
					: marks.bold,
		italic: tag === "EM" || tag === "I" || style === "italic" ? true : style === "normal" ? false : marks.italic,
		href: tag === "A" ? (element.getAttribute("href") ?? "#") : marks.href,
	};
}

/** Spaces collapse across runs, as the text will render */
function readRuns(element: HTMLElement): RichRun[] {
	const runs: RichRun[] = [];

	const walk = (node: Node, marks: Marks) => {
		if (node instanceof Text) {
			const run: RichRun = { text: node.data.replace(/\s+/g, " ") };

			if (marks.bold) run.bold = true;

			if (marks.italic) run.italic = true;

			if (marks.href !== null) run.href = marks.href;
			runs.push(run);
		} else if (node instanceof HTMLBRElement) runs.push({ text: " " });
		else if (node instanceof HTMLElement) {
			const inner = marksOf(node, marks);

			for (const child of node.childNodes) walk(child, inner);
		}
	};

	for (const child of element.childNodes) walk(child, { bold: false, italic: false, href: null });
	const merged = mergeRuns(runs);

	merged.forEach((run, i) => {
		if (i > 0 && merged[i - 1]!.text.endsWith(" ")) run.text = run.text.replace(/^ /, "");
	});

	if (merged[0]) merged[0].text = merged[0].text.trimStart();
	const last = merged[merged.length - 1];

	if (last) last.text = last.text.trimEnd();

	return mergeRuns(merged);
}

/** ⌘K links the selection, or unlinks it when it is in a link; the inspector sets the `href` */
function toggleLink(element: HTMLElement) {
	const anchor = window.getSelection()?.anchorNode;
	const start = anchor instanceof Element ? anchor : anchor?.parentElement;
	const link = start?.closest("a");

	if (link && element.contains(link)) document.execCommand("unlink");
	else if (!window.getSelection()?.isCollapsed) document.execCommand("createLink", false, "#");
}

/** Every element's children and every text's data, so React's tree can be put back after the engine edits it */
function snapshot(root: HTMLElement) {
	const children = new Map<Node, ChildNode[]>();
	const texts = new Map<Text, string>();

	const walk = (node: Node) => {
		if (node instanceof Text) texts.set(node, node.data);
		else {
			children.set(node, [...node.childNodes]);

			for (const child of node.childNodes) walk(child);
		}
	};

	walk(root);

	return () => {
		for (const [text, data] of texts) text.data = data;

		for (const [node, kids] of children) if (node instanceof Element) node.replaceChildren(...kids);
	};
}

/**
 * Refuses unless it is a single element whose text is `expected`, so the edit maps back to source. A `rich` edit
 * takes `<strong>`, `<em>` and `<a>` inside, and ⌘B, ⌘I and ⌘K format the selection.
 */
export function startTextEdit(
	elements: Element[],
	expected: string,
	rich: boolean,
	done: (edited: EditedText | null) => void,
): TextEdit | null {
	const only = elements.length === 1 ? elements[0] : null;

	if (
		!(only instanceof HTMLElement) ||
		(rich ? !onlyFormatting(only) : only.children.length > 0) ||
		normalize(only.textContent ?? "") !== normalize(expected)
	)
		return null;
	const element: HTMLElement = only;
	// Typing changes text nodes in place and formatting moves nodes: keep both to put them back
	const restore = snapshot(element);

	const attributes = {
		contenteditable: element.getAttribute("contenteditable"),
		spellcheck: element.getAttribute("spellcheck"),
	};

	const style = { outline: element.style.outline, cursor: element.style.cursor, userSelect: element.style.userSelect };

	element.setAttribute("contenteditable", rich ? "true" : "plaintext-only");

	// Engines without `plaintext-only` drop the attribute value; rich text is fine since only the text is read
	if (!rich && element.contentEditable !== "plaintext-only") element.contentEditable = "true";

	// `<b>` and `<i>`, not `<span style>`, so the runs read back from tags
	if (rich) document.execCommand("styleWithCSS", false, "false");
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
	// The click that follows a press outside ends the edit; it must not reach the screen
	let swallowClick = false;

	const onKeyDown = (event: KeyboardEvent) => {
		event.stopPropagation();

		const mod = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

		if (rich && mod && (event.code === "KeyB" || event.code === "KeyI" || event.code === "KeyK")) {
			event.preventDefault();

			if (event.code === "KeyK") toggleLink(element);
			else document.execCommand(event.code === "KeyB" ? "bold" : "italic");
		} else if (event.key === "Enter") {
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
		const runs = rich ? readRuns(element) : null;

		const text = runs
			? runs.map((run) => run.text).join("")
			: normalize(element.innerText ?? element.textContent ?? "");

		element.removeEventListener("keydown", onKeyDown);
		element.removeEventListener("paste", onPaste);
		element.removeEventListener("blur", onBlur);
		document.removeEventListener("pointerdown", onPointerDown, true);

		// The click of a press that ended the edit comes later, on release: `onClick` removes itself then
		if (swallowClick) setTimeout(() => document.removeEventListener("click", onClick, true), 2000);
		else document.removeEventListener("click", onClick, true);
		window.getSelection()?.removeAllRanges();
		// Put React's nodes back, with their old text: React updates them when the new source renders
		restore();

		for (const [name, value] of Object.entries(attributes)) {
			if (value === null) element.removeAttribute(name);
			else element.setAttribute(name, value);
		}

		Object.assign(element.style, style);
		done(commit ? { text, runs } : null);
	}

	return { finish };
}
