import { toast } from "sonner";
import type { Structure } from "@/hooks/use-structure";
import type { Action } from "@/lib/actions";
import { systemPaste, type PasteData } from "@/lib/clipboard";
import { readElement, usedImports, writeElement } from "@/lib/element-clipboard";
import { isLocked, lockedStarts } from "@/lib/element-locks";
import { arrowSteps, moveSteps, parentOf, type ArrowKey } from "@/lib/element-flow";
import { siblingStart } from "@/lib/element-nav";
import { outermost } from "@/lib/element-selection";
import { findElement, parseJsx, type JsxElement } from "../../../shared/jsx";
import { matchingStarts } from "../../../shared/jsx/matching";
import { dedent, indentAt } from "../../../shared/jsx/text";
import { readClassName } from "../../../shared/tailwind/classes";
import { baseClasses, isHidden } from "../../../shared/tailwind/properties";
import type { ElementLock, ProjectFiles } from "../../../shared/types";
import { type MenuEntry, SEPARATOR } from "./action-menu";
import type { ElementRef } from "./canvas";
import type { ImageFormat } from "./export/image-export";
import { LINK_MENU } from "./link-actions";

/** Right-click on an element, on the canvas or in the structure tree */
export const ELEMENT_MENU: MenuEntry[] = [
	"edit-text",
	"ask-ai",
	SEPARATOR,
	"select-parent",
	"select-children",
	"select-matching",
	SEPARATOR,
	"cut-element",
	"copy-element",
	"paste-element",
	"duplicate-element",
	{
		label: "Copy/Paste as",
		items: [
			"copy-element-code",
			"copy-element-png",
			"copy-element-svg",
			"copy-for-agent",
			SEPARATOR,
			"copy-properties",
			"paste-properties",
		],
	},
	SEPARATOR,
	"toggle-hidden",
	"toggle-locked",
	SEPARATOR,
	LINK_MENU,
	SEPARATOR,
	"wrap-element",
	"wrap-element-in-stack",
	"unwrap-element",
	"make-component",
	{
		label: "Instance",
		items: ["edit-component", "go-to-component", SEPARATOR, "reset-overrides", "apply-overrides", "detach-instance"],
	},
	SEPARATOR,
	"move-element-earlier",
	"move-element-later",
	{
		label: "Align",
		items: ["align-left", "align-h-center", "align-right", SEPARATOR, "align-top", "align-v-middle", "align-bottom"],
	},
	{ label: "Distribute", items: ["distribute-horizontal", "distribute-vertical"] },
	SEPARATOR,
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

let copiedProperties: string | null = null;

function copyProperties(source: string, start: number) {
	const info = readClassName(source, start);

	if (!info?.editable) {
		toast("This element's classes are computed, so they can't be copied");

		return;
	}

	copiedProperties = baseClasses(info.classes);
	toast.success("Copied properties");
}

export function hiddenState(source: string, starts: readonly number[]) {
	return starts.every((start) => isHidden(readClassName(source, start)?.classes ?? ""));
}

export function lockedState(
	locks: readonly ElementLock[] | undefined,
	file: string,
	source: string,
	starts: readonly number[],
) {
	const locked = lockedStarts(locks, file, source);

	return starts.every((start) => isLocked(source, locked, start));
}

type Options = {
	/** The selected element, when it is in the one selected screen */
	element: ElementRef | null;
	/** Elements ⇧-click added to it: actions that make sense for one only are off */
	extras: ElementRef[];
	/** The width of the element's screen, for the breakpoints its parent's layout uses */
	width: number | null;
	files: ProjectFiles;
	locks?: ElementLock[];
	structure: Structure;
	selectParent: () => void;
	editText: () => void;
	askAI: () => void;
	showSource: () => void;
	/** ⌘V when the clipboard holds no element code: screens, or a screen's TSX */
	pasteScreens: (data: PasteData) => void;
	/** Renders the elements at `starts` in the element's screen */
	copyImage: (format: ImageFormat, starts: number[]) => void;
	instance: InstanceActions;
};

export type InstanceActions = {
	usage: boolean;
	overridden: boolean;
	enter: () => void;
	goTo: () => void;
	reset: () => void;
	apply: () => void;
	detach: () => void;
};

/** Go after the editor's hidden Escape action, which wins the Esc key that `select-parent` only shows */
const ARROW_KEYS: readonly ArrowKey[] = ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];

export function elementActions({
	element,
	extras,
	width,
	files,
	locks,
	structure,
	selectParent,
	editText,
	askAI,
	showSource,
	pasteScreens,
	copyImage,
	instance,
}: Options): Action[] {
	const source = element ? files[element.file] : undefined;
	const child = element && source !== undefined ? firstChildStart(source, element.start) : null;
	const on = element !== null;
	const one = on && !extras.length;
	const starts = element ? [element.start, ...extras.map((extra) => extra.start)] : [];

	const hidden = on && source !== undefined && hiddenState(source, starts);
	const locked = element !== null && source !== undefined && lockedState(locks, element.file, source, starts);

	const pasteProperties = () => {
		if (copiedProperties === null) toast("Copy an element's properties first (⌥⌘C)");
		else structure.pastePropertiesNodes(copiedProperties);
	};

	const selectMatching = () => {
		if (!element || source === undefined) return;
		const matching = matchingStarts(source, element.start);
		structure.selectMany(element.file, matching);
		toast(matching.length === 1 ? "No other matching elements" : `Selected ${matching.length} matching elements`);
	};

	const flow = one && source !== undefined ? (parentOf(source, element.start, width)?.flow ?? null) : null;
	const rows = flow?.kind === "grid" && flow.columns > 1 ? flow.columns : 0;

	const arrows = (steps: number) => ARROW_KEYS.flatMap((key) => (arrowSteps(flow, key) === steps ? [{ key }] : []));

	const canMove = (steps: number) =>
		one && source !== undefined && steps !== 0 && moveSteps(source, element.start, steps) !== null;

	const paste = async (data: PasteData) => {
		const copy = await readElement(data);

		if (copy) structure.pasteIntoNode(copy);
		else pasteScreens(data);
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
			id: "edit-component",
			label: "Edit component",
			group: "Element",
			chords: [{ key: "Enter" }],
			enabled: one && instance.usage,
			run: instance.enter,
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
			id: "copy-properties",
			label: "Copy properties",
			group: "Element",
			chords: [{ code: "KeyC", mod: true, alt: true }],
			enabled: one,
			run: () => element && source !== undefined && copyProperties(source, element.start),
		},
		{
			id: "paste-properties",
			label: "Paste properties",
			group: "Element",
			chords: [{ code: "KeyV", mod: true, alt: true }],
			enabled: on,
			run: pasteProperties,
		},
		{
			id: "toggle-hidden",
			label: hidden ? "Show" : "Hide",
			group: "Element",
			chords: [{ code: "KeyH", mod: true, shift: true }],
			enabled: on,
			run: () => structure.toggleHiddenNodes(),
		},
		{
			id: "toggle-locked",
			label: locked ? "Unlock" : "Lock",
			group: "Element",
			chords: [{ code: "KeyL", mod: true, shift: true }],
			enabled: on,
			run: () => structure.toggleLockNodes(),
		},
		{
			id: "select-matching",
			label: "Select matching",
			group: "Element",
			chords: [{ code: "KeyA", mod: true, alt: true }],
			enabled: one,
			run: selectMatching,
		},
		{
			// After the selected element, or into it when it is an empty container (`pasteElement`)
			id: "paste-element",
			label: "Paste",
			group: "Element",
			chords: [{ code: "KeyV", mod: true }],
			enabled: one,
			run: () => void paste(systemPaste),
			paste: (data) => void paste(data),
		},
		{
			// Figma reorders auto layout children with the arrows along the parent's direction. Passive: without an element they nudge screens
			id: "move-element-earlier",
			label: "Move earlier",
			group: "Element",
			chords: arrows(-1),
			enabled: canMove(-1),
			passive: true,
			run: () => structure.moveNodeBy(-1),
		},
		{
			id: "move-element-later",
			label: "Move later",
			group: "Element",
			chords: arrows(1),
			enabled: canMove(1),
			passive: true,
			run: () => structure.moveNodeBy(1),
		},
		{
			id: "move-element-row-up",
			label: "Move up a row",
			group: "Element",
			chords: arrows(-rows),
			enabled: canMove(-rows),
			hidden: true,
			passive: true,
			run: () => structure.moveNodeBy(-rows),
		},
		{
			id: "move-element-row-down",
			label: "Move down a row",
			group: "Element",
			chords: arrows(rows),
			enabled: canMove(rows),
			hidden: true,
			passive: true,
			run: () => structure.moveNodeBy(rows),
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
			id: "go-to-component",
			label: "Go to component",
			group: "Element",
			enabled: one && instance.usage,
			run: instance.goTo,
		},
		{
			id: "reset-overrides",
			label: "Reset overrides",
			group: "Element",
			enabled: one && instance.overridden,
			run: instance.reset,
		},
		{
			id: "apply-overrides",
			label: "Apply to component",
			group: "Element",
			enabled: one && instance.overridden,
			run: instance.apply,
		},
		{
			id: "detach-instance",
			label: "Detach instance",
			group: "Element",
			chords: [{ code: "KeyB", mod: true, alt: true }],
			enabled: one && instance.usage,
			run: instance.detach,
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
			// Figma's Copy as PNG. Before the screens' ⇧⌘C, which it wins while an element is selected
			id: "copy-element-png",
			label: "Copy as PNG",
			group: "Element",
			chords: [{ code: "KeyC", mod: true, shift: true }],
			enabled: on,
			run: () => element && source !== undefined && copyImage("png", outermost(source, starts)),
		},
		{
			id: "copy-element-svg",
			label: "Copy as SVG",
			group: "Element",
			enabled: on,
			run: () => element && source !== undefined && copyImage("svg", outermost(source, starts)),
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
