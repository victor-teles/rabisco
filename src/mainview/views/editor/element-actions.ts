import { toast } from "sonner";
import type { Structure } from "@/hooks/use-structure";
import type { Action } from "@/lib/actions";
import { readElement, usedImports, writeElement } from "@/lib/element-clipboard";
import { siblingStart } from "@/lib/element-nav";
import { outermost } from "@/lib/element-selection";
import { findElement, moveAmongSiblings, parseJsx, type JsxElement } from "../../../shared/jsx";
import { dedent, indentAt } from "../../../shared/jsx/text";
import type { ProjectFiles } from "../../../shared/types";
import { type MenuEntry, SEPARATOR } from "./action-menu";
import type { ElementRef } from "./canvas";

/** Right-click on an element, on the canvas or in the structure tree */
export const ELEMENT_MENU: MenuEntry[] = [
	"edit-text",
	"ask-ai",
	SEPARATOR,
	"select-parent",
	"select-children",
	SEPARATOR,
	"cut-element",
	"copy-element",
	"paste-element",
	"duplicate-element",
	SEPARATOR,
	"wrap-element",
	"wrap-element-in-stack",
	"unwrap-element",
	"make-component",
	SEPARATOR,
	"move-element-earlier",
	"move-element-later",
	SEPARATOR,
	"copy-element-code",
	"go-to-source",
	SEPARATOR,
	"delete-element",
];

/** Fragments have no props of their own, so selection goes through them */
function firstChild(element: JsxElement): JsxElement | null {
	for (const child of element.children) {
		const found = child.kind === "element" ? child : child.kind === "expression" ? child.elements[0] : undefined;

		if (!found) continue;

		if (found.name !== null) return found;
		const inner = firstChild(found);

		if (inner) return inner;
	}

	return null;
}

export function firstChildStart(source: string, start: number) {
	const element = findElement(parseJsx(source), start);

	return element ? (firstChild(element)?.start ?? null) : null;
}

/** Its lines indented as if it stood alone */
export function elementCode(source: string, start: number) {
	const element = findElement(parseJsx(source), start);

	return element ? dedent(source.slice(element.start, element.end), indentAt(source, element.start)) : null;
}

/** Several elements in file order, one after another; one inside another comes with it */
export function elementsCode(source: string, starts: readonly number[]) {
	const codes = outermost(source, starts)
		.sort((a, b) => a - b)
		.flatMap((start) => elementCode(source, start) ?? []);

	return codes.length ? codes.join("\n") : null;
}

async function copyElementCode(source: string, starts: readonly number[]) {
	const code = elementsCode(source, starts);

	if (code === null) return;

	try {
		await navigator.clipboard.writeText(code);
		toast.success(starts.length > 1 ? "Copied the elements’ code" : "Copied the element’s code");
	} catch (error) {
		toast.error("Couldn't copy the code", { description: error instanceof Error ? error.message : String(error) });
	}
}

/** Copies the text selected on the page instead, as the screens' ⌘C does. `false` when no element was copied */
async function copyElement(source: string, starts: readonly number[]) {
	const text = window.getSelection()?.toString() ?? "";

	if (text) {
		await navigator.clipboard.writeText(text).catch(() => undefined);

		return false;
	}

	const code = elementsCode(source, starts);

	if (code === null) return false;

	try {
		await writeElement({ code, imports: usedImports(source, code) });

		return true;
	} catch (error) {
		toast.error("Couldn't copy the element", { description: error instanceof Error ? error.message : String(error) });

		return false;
	}
}

type Options = {
	/** The selected element, when it is in the one selected screen */
	element: ElementRef | null;
	/** Elements ⇧-click added to it: actions that make sense for one only are off */
	extras: ElementRef[];
	files: ProjectFiles;
	structure: Structure;
	selectParent: () => void;
	editText: () => void;
	askAI: () => void;
	showSource: () => void;
	/** ⌘V when the clipboard holds no element code: screens, or a screen's TSX */
	pasteScreens: () => void;
};

/** Go after the editor's hidden Escape action, which wins the Esc key that `select-parent` only shows */
export function elementActions({
	element,
	extras,
	files,
	structure,
	selectParent,
	editText,
	askAI,
	showSource,
	pasteScreens,
}: Options): Action[] {
	const source = element ? files[element.file] : undefined;
	const child = element && source !== undefined ? firstChildStart(source, element.start) : null;
	const on = element !== null;
	const one = on && !extras.length;
	const starts = element ? [element.start, ...extras.map((extra) => extra.start)] : [];

	const canMove = (delta: -1 | 1) =>
		one && element !== null && source !== undefined && moveAmongSiblings(source, element.start, delta) !== null;

	const paste = async () => {
		const copy = await readElement();

		if (copy) structure.pasteIntoNode(copy);
		else pasteScreens();
	};

	const selectSibling = (step: 1 | -1) => {
		const sibling = element && source !== undefined ? siblingStart(source, element.start, step) : null;

		if (element && sibling !== null) structure.select({ file: element.file, start: sibling });
	};

	return [
		{
			// Figma: ⇧↵ or Esc
			id: "select-parent",
			label: "Select parent",
			group: "Element",
			chords: [{ key: "Escape" }, { key: "Enter", shift: true }],
			enabled: on,
			run: selectParent,
		},
		{
			// Figma's ↵ selects children; on an element without any, `edit-text` takes the key
			id: "select-children",
			label: "Select first child",
			group: "Element",
			chords: [{ key: "Enter" }],
			enabled: one && child !== null,
			run: () => element && child !== null && structure.select({ file: element.file, start: child }),
		},
		{
			// Figma: ↵ on a text layer edits it. Double-click edits any element's text
			id: "edit-text",
			label: "Edit text",
			group: "Element",
			chords: [{ key: "Enter" }],
			enabled: one,
			run: editText,
		},
		{
			// Passive: without an element, Tab moves focus as usual
			id: "select-next-sibling",
			label: "Select next sibling",
			group: "Element",
			chords: [{ key: "Tab" }],
			enabled: one,
			passive: true,
			run: () => selectSibling(1),
		},
		{
			id: "select-previous-sibling",
			label: "Select previous sibling",
			group: "Element",
			chords: [{ key: "Tab", shift: true }],
			enabled: one,
			passive: true,
			run: () => selectSibling(-1),
		},
		{
			// Before the screens' ⌘D, which it wins while an element is selected
			id: "duplicate-element",
			label: "Duplicate",
			group: "Element",
			chords: [{ code: "KeyD", mod: true }],
			enabled: on,
			run: structure.duplicateNode,
		},
		{
			// Before the screens' ⌘C and ⌘V, which they win while an element is selected
			id: "copy-element",
			label: "Copy",
			group: "Element",
			chords: [{ code: "KeyC", mod: true }],
			enabled: on,
			run: () => element && source !== undefined && void copyElement(source, starts),
		},
		{
			id: "cut-element",
			label: "Cut",
			group: "Element",
			chords: [{ code: "KeyX", mod: true }],
			enabled: on,
			run: () =>
				element &&
				source !== undefined &&
				void copyElement(source, starts).then((copied) => copied && structure.removeNode()),
		},
		{
			// After the selected element, or into it when it is an empty container (`pasteElement`)
			id: "paste-element",
			label: "Paste",
			group: "Element",
			chords: [{ code: "KeyV", mod: true }],
			enabled: one,
			run: () => void paste(),
		},
		{
			// Figma reorders auto layout children with the arrow keys. Passive: without an element they nudge screens
			id: "move-element-earlier",
			label: "Move earlier",
			group: "Element",
			chords: [{ key: "ArrowUp" }, { key: "ArrowLeft" }],
			enabled: canMove(-1),
			passive: true,
			run: () => structure.moveNodeAmongSiblings(-1),
		},
		{
			id: "move-element-later",
			label: "Move later",
			group: "Element",
			chords: [{ key: "ArrowDown" }, { key: "ArrowRight" }],
			enabled: canMove(1),
			passive: true,
			run: () => structure.moveNodeAmongSiblings(1),
		},
		{
			// Figma's Frame selection
			id: "wrap-element",
			label: "Wrap in div",
			group: "Element",
			chords: [{ code: "KeyG", mod: true, alt: true }],
			enabled: on,
			run: structure.wrapNode,
		},
		{
			// Figma's Add auto layout
			id: "wrap-element-in-stack",
			label: "Wrap in flex stack",
			group: "Element",
			chords: [{ code: "KeyA", shift: true }],
			enabled: on,
			run: structure.wrapInStackNode,
		},
		{
			// Figma's Ungroup
			id: "unwrap-element",
			label: "Unwrap",
			group: "Element",
			chords: [{ code: "KeyG", mod: true, shift: true }],
			enabled: one,
			run: structure.unwrapNode,
		},
		{
			// Enabled without an element, so the keys still say how to pick one
			id: "make-component",
			label: "Make component",
			group: "Element",
			chords: [{ code: "KeyK", mod: true, alt: true }],
			enabled: true,
			global: true,
			run: structure.startNaming,
		},
		{
			id: "ask-ai",
			label: "Ask AI about this",
			group: "Element",
			enabled: one,
			run: askAI,
		},
		{
			id: "copy-element-code",
			label: "Copy code",
			group: "Element",
			enabled: on,
			run: () => element && source !== undefined && void copyElementCode(source, starts),
		},
		{
			id: "go-to-source",
			label: "Go to source",
			group: "Element",
			enabled: one,
			run: showSource,
		},
	];
}
