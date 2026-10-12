import { describe, expect, test } from "bun:test";
import { currentAncestors, textProp, type Fiber } from "./inspect";

const fiber = (loc: string | null, children: Fiber[] = []): Fiber => {
	const node: Fiber = {
		memoizedProps: loc === null ? {} : { "data-rabisco-loc": loc },
		stateNode: null,
		return: null,
		child: children[0] ?? null,
		sibling: null,
		alternate: null,
	};

	children.forEach((child, index) => {
		child.return = node;
		child.sibling = children[index + 1] ?? null;
	});

	return node;
};

const pair = (previous: Fiber, next: Fiber) => {
	previous.alternate = next;
	next.alternate = previous;
};

const locs = (start: Fiber, props: Fiber["memoizedProps"]) =>
	[...currentAncestors(start, props)].map((node) => textProp(node, "data-rabisco-loc"));

describe("currentAncestors", () => {
	const previousC3 = fiber("s.tsx:120");
	const previousColumn = fiber("s.tsx:60", [fiber("s.tsx:70"), fiber("s.tsx:95"), previousC3]);
	const previousRoot = fiber("s.tsx:10", [fiber("s.tsx:20"), previousColumn]);
	const nextC3 = fiber("s.tsx:128");
	const nextColumn = fiber("s.tsx:60", [fiber("s.tsx:70"), fiber("s.tsx:95"), nextC3]);
	const nextRoot = fiber("s.tsx:10", [fiber("s.tsx:20"), nextColumn]);

	pair(previousC3, nextC3);
	pair(previousColumn, nextColumn);
	pair(previousRoot, nextRoot);

	test("reads the committed props after a class edit moves later offsets", () => {
		expect(locs(previousC3, nextC3.memoizedProps)).toEqual(["s.tsx:128", "s.tsx:60", "s.tsx:10"]);
	});

	test("keeps the expando fiber when it holds the committed props", () => {
		expect(locs(previousC3, previousC3.memoizedProps)).toEqual(["s.tsx:120", "s.tsx:60", "s.tsx:10"]);
	});

	test("switches to the parent copy that holds the node", () => {
		const card = fiber("s.tsx:240");
		const previousWrap = fiber("s.tsx:220", [fiber("s.tsx:230")]);
		const nextWrap = fiber("s.tsx:228", [card]);

		pair(previousWrap, nextWrap);
		card.return = previousWrap;

		expect(locs(card, card.memoizedProps)).toEqual(["s.tsx:240", "s.tsx:228"]);
	});
});
