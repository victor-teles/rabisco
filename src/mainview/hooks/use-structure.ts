import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChangeOptions, ProjectState } from "@/hooks/use-project";
import { pasteCopy, type ElementCopy } from "@/lib/element-clipboard";
import { adjacentRange, editEach, outermost, toggleStart, wrapRange } from "@/lib/element-selection";
import { applyFileChanges, type Snapshot } from "@/lib/history";
import { atPath, pathOf, remapStart } from "@/lib/outline";
import { setChildrenText, writeProp, type Literal } from "@/lib/props";
import {
	duplicateElement,
	extractComponent,
	findElement,
	moveAmongSiblings,
	moveElement,
	moveMappedEntry,
	parseJsx,
	removeElement,
	STACK_CLASSES,
	unwrapElement,
	wrapElement,
	wrapInStack,
} from "../../shared/jsx";
import type { PropSpec } from "../../shared/components/api";
import { readClassName, setClassName } from "../../shared/tailwind/classes";
import type { ProjectFiles } from "../../shared/types";

export type StructureNode = { file: string; start: number };

/** `extras` are the other elements ⇧-click added, in the same file: a multi-file selection isn't supported */
type Tracked = StructureNode & { source: string; extras: number[] };

type Options = {
	files: ProjectFiles;
	file: string | null;
	stateRef: React.RefObject<ProjectState | null>;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	onShowCode: () => void;
	/** Edits are refused while a generation runs, since its result would overwrite them. */
	busy?: boolean;
};

const BUSY_MESSAGE = "Wait for the generation to finish";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function madeComponentMessage(exportName: string, replaced: { path: string; count: number }[]) {
	const total = replaced.reduce((sum, item) => sum + item.count, 0);

	return total > 1
		? `Made ${exportName} · replaced ${total} in ${plural(replaced.length, "file")}`
		: `Made ${exportName}`;
}

export function useStructure({ files, file, stateRef, change, onShowCode, busy = false }: Options) {
	const [tracked, setTracked] = useState<Tracked | null>(null);
	const [naming, setNaming] = useState(false);
	const busyRef = useRef(busy);

	useLayoutEffect(() => {
		busyRef.current = busy;
	}, [busy]);

	// Adjusting state while rendering avoids a frame with stale offsets
	let node: Tracked | null = tracked;

	if (tracked) {
		const source = files[tracked.file];

		if (tracked.file !== file || source === undefined) node = null;
		else if (source !== tracked.source && parseJsx(source).ok) {
			const remapped = [tracked.start, ...tracked.extras].flatMap(
				(start) => remapStart(tracked.source, source, start) ?? [],
			);

			const [start, ...extras] = [...new Set(remapped)];
			node = start === undefined ? null : { file: tracked.file, start, source, extras };
		}

		if (node !== tracked) setTracked(node);
	}

	if ((!node || busy || node.extras.length) && naming) setNaming(false);

	const select = useCallback(
		(next: StructureNode | null) => {
			const source = next ? stateRef.current?.files[next.file] : undefined;
			setTracked(next && source !== undefined ? { ...next, source, extras: [] } : null);

			if (!next) setNaming(false);
		},
		[stateRef],
	);

	/** ⇧-click: adds or removes an element. One in another screen file starts a new selection */
	const toggle = useCallback(
		(next: StructureNode) => {
			if (!node || node.file !== next.file) {
				select(next);

				return;
			}

			const [start, ...extras] = toggleStart([node.start, ...node.extras], next.start);
			setTracked(start === undefined ? null : { file: node.file, start, source: node.source, extras });
		},
		[node, select],
	);

	const editFile = useCallback(
		(path: string, edit: (source: string) => string | null, step?: string) => {
			if (busyRef.current) return;
			change(
				(snapshot) => {
					const source = snapshot.files[path];
					const next = source === undefined ? null : edit(source);

					return next === null || next === source
						? snapshot
						: { ...snapshot, files: { ...snapshot.files, [path]: next } };
				},
				{ coalesce: step },
			);
		},
		[change],
	);

	const editCode = useCallback(
		(path: string, text: string, step?: string) => editFile(path, () => text, step),
		[editFile],
	);

	const setProp = useCallback(
		(target: StructureNode, name: string, value: Literal | null, spec?: PropSpec, step?: string) =>
			editFile(target.file, (source) => writeProp(source, target.start, name, value, spec), step),
		[editFile],
	);

	/** Refused quietly when `className` isn't a literal the editor can write */
	const editClasses = useCallback(
		(target: StructureNode, edit: (classes: string) => string, step?: string) =>
			editFile(
				target.file,
				(source) => {
					const info = readClassName(source, target.start);

					if (!info?.editable) return null;
					const next = edit(info.classes);

					return next === info.classes ? null : setClassName(source, target.start, next);
				},
				step,
			),
		[editFile],
	);

	const setChildren = useCallback(
		(target: StructureNode, text: string, step?: string) =>
			editFile(target.file, (source) => setChildrenText(source, target.start, text), step),
		[editFile],
	);

	const removeNode = useCallback(() => {
		const source = node ? stateRef.current?.files[node.file] : undefined;

		if (!node || source === undefined) return;

		if (busyRef.current) {
			toast(BUSY_MESSAGE);

			return;
		}

		const starts = outermost(source, [node.start, ...node.extras]);

		const next = editEach(source, starts, (current, start) => {
			const removed = removeElement(current, start);

			return removed === null ? null : { source: removed, start };
		}).source;

		if (next === source) return;
		const tree = parseJsx(source);
		const parents = new Set(starts.map((start) => findElement(tree, start)?.parent ?? null));
		const [parent] = parents;
		change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [node.file]: next } }));
		// The parent starts before its children, so its offset doesn't move. Elements in several parents select none
		setTracked(
			parents.size === 1 && parent && parent.name !== null
				? { file: node.file, start: parent.start, source: next, extras: [] }
				: null,
		);
	}, [node, stateRef, change]);

	const makeComponent = useCallback(
		(name: string) => {
			const current = stateRef.current;

			if (!current || !node) return false;

			if (busyRef.current) {
				toast(BUSY_MESSAGE);

				return false;
			}

			const result = extractComponent({ files: current.files, path: node.file, start: node.start, name });

			if (!result.ok) {
				toast(result.reason);

				return false;
			}

			const before = current.files[node.file]!;
			change((snapshot) => ({ ...snapshot, files: applyFileChanges(snapshot.files, result.changes) }));
			toast(madeComponentMessage(result.exportName, result.replaced));
			const after = result.changes.find((c) => c.path === node.file)?.content ?? before;
			const path = pathOf(parseJsx(before), node.start);
			const usage = path ? atPath(parseJsx(after), path) : null;
			setTracked(
				usage && usage.name === result.exportName
					? { file: node.file, start: usage.start, source: after, extras: [] }
					: null,
			);
			setNaming(false);

			return true;
		},
		[stateRef, node, change],
	);

	/** ⌥⌘K and the element menus: names the selected element in the Code tab */
	const startNaming = useCallback(() => {
		onShowCode();

		if (busyRef.current) toast(BUSY_MESSAGE);
		else if (node?.extras.length) toast("Select one element to make a component");
		else if (node) setNaming(true);
		else
			toast("Select an element in Structure first", {
				description: "The Code tab shows the structure of the selected screen.",
			});
	}, [onShowCode, node]);

	/** One undo step; the element the edit returns becomes the selection. A `null` refusal refuses quietly */
	const replaceNode = useCallback(
		(edit: (source: string, start: number) => { source: string; start: number } | null, refusal: string | null) => {
			const source = node ? stateRef.current?.files[node.file] : undefined;

			if (!node || source === undefined) return;

			if (busyRef.current) {
				toast(BUSY_MESSAGE);

				return;
			}

			const result = edit(source, node.start);

			if (!result) {
				if (refusal) toast(refusal);

				return;
			}

			if (result.source !== source)
				change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [node.file]: result.source } }));
			setTracked({ file: node.file, start: result.start, source: result.source, extras: [] });
		},
		[node, stateRef, change],
	);

	/** `replaceNode` for several selected elements: one undo step, and the elements it returns become the selection */
	const replaceNodes = useCallback(
		(edit: (source: string, starts: number[]) => { source: string; starts: number[] } | null, refusal: string) => {
			const source = node ? stateRef.current?.files[node.file] : undefined;

			if (!node || source === undefined) return;

			if (busyRef.current) {
				toast(BUSY_MESSAGE);

				return;
			}

			const result = edit(source, outermost(source, [node.start, ...node.extras]));
			const [start, ...extras] = result?.starts ?? [];

			if (!result || start === undefined) {
				toast(refusal);

				return;
			}

			if (result.source !== source)
				change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [node.file]: result.source } }));
			setTracked({ file: node.file, start, source: result.source, extras });
		},
		[node, stateRef, change],
	);

	const multiple = (node?.extras.length ?? 0) > 0;

	/** Elements that can't be duplicated are left out; the copies become the selection */
	const duplicateNode = useCallback(() => {
		if (!multiple) {
			replaceNode(duplicateElement, "Only an element inside another element can be duplicated");

			return;
		}

		replaceNodes((source, starts) => {
			const result = editEach(source, starts, duplicateElement);

			return { source: result.source, starts: result.starts.flatMap((start) => start ?? []) };
		}, "Only elements inside another element can be duplicated");
	}, [multiple, replaceNode, replaceNodes]);

	/** Several elements go into one wrapper, which they need to be adjacent siblings for */
	const wrapNodes = useCallback(
		(className?: string) =>
			replaceNodes((source, starts) => {
				const range = adjacentRange(source, starts);
				const result = range && wrapRange(source, range, "div", className);

				return result && { source: result.source, starts: [result.start] };
			}, "Only adjacent siblings can be wrapped together"),
		[replaceNodes],
	);

	const wrapNode = useCallback(
		() => (multiple ? wrapNodes() : replaceNode(wrapElement, "This element can't be wrapped")),
		[multiple, wrapNodes, replaceNode],
	);

	const wrapInStackNode = useCallback(
		() => (multiple ? wrapNodes(STACK_CLASSES) : replaceNode(wrapInStack, "This element can't be wrapped")),
		[multiple, wrapNodes, replaceNode],
	);

	const unwrapNode = useCallback(
		() =>
			replaceNode(unwrapElement, "Only an element with children can be unwrapped, and a root needs one child element"),
		[replaceNode],
	);

	/** Arrow keys: at either end there is nowhere to go, which needs no message */
	const moveNodeAmongSiblings = useCallback(
		(delta: -1 | 1) => replaceNode((source, start) => moveAmongSiblings(source, start, delta), null),
		[replaceNode],
	);

	/** `index` counts the parent's slots before the move, as `dropTarget` reports them */
	const moveNodeTo = useCallback(
		(parentStart: number, index: number) =>
			replaceNode((source, start) => moveElement(source, start, parentStart, index), "This element can't move there"),
		[replaceNode],
	);

	/** For an item a `.map` renders: moves its array entry, so every item keeps its place in the selection */
	const moveNodeEntry = useCallback(
		(from: number, to: number) =>
			replaceNode((source, start) => {
				const next = moveMappedEntry(source, start, from, to);

				return next === null ? null : { source: next, start };
			}, "This item can't move there"),
		[replaceNode],
	);

	const pasteIntoNode = useCallback(
		(copy: ElementCopy) =>
			replaceNode((source, start) => pasteCopy(source, start, copy), "The clipboard can't be pasted here"),
		[replaceNode],
	);

	const nodeFile = node?.file ?? null;
	const nodeStart = node?.start ?? -1;

	const selected = useMemo<StructureNode | null>(
		() => (nodeFile === null ? null : { file: nodeFile, start: nodeStart }),
		[nodeFile, nodeStart],
	);

	const extraKey = node?.extras.join(" ") ?? "";

	/** Every selected element, the primary `node` first */
	const nodes = useMemo<StructureNode[]>(
		() =>
			nodeFile === null
				? []
				: [nodeStart, ...(extraKey ? extraKey.split(" ").map(Number) : [])].map((start) => ({ file: nodeFile, start })),
		[nodeFile, nodeStart, extraKey],
	);

	return {
		node: selected,
		nodes,
		select,
		toggle,
		busy,
		naming,
		setNaming,
		startNaming,
		makeComponent,
		removeNode,
		duplicateNode,
		wrapNode,
		wrapInStackNode,
		unwrapNode,
		moveNodeAmongSiblings,
		moveNodeTo,
		moveNodeEntry,
		pasteIntoNode,
		editCode,
		setProp,
		setChildren,
		editClasses,
	};
}

export type Structure = ReturnType<typeof useStructure>;
