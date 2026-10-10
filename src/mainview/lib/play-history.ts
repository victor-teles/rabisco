import type { Direction, LinkTransition } from "../../shared/prototype/transitions";

export type Visit = { file: string; transition: LinkTransition };

export type PlayHistory = { stack: Visit[]; index: number };

export type PlayStep = { history: PlayHistory; transition: LinkTransition; direction: Direction };

export const startHistory = (file: string): PlayHistory => ({ stack: [{ file, transition: "instant" }], index: 0 });

export const currentVisit = (history: PlayHistory): Visit => history.stack[history.index]!;

export function pushVisit(history: PlayHistory, file: string, transition: LinkTransition): PlayStep | null {
	if (currentVisit(history).file === file) return null;

	return {
		history: { stack: [...history.stack.slice(0, history.index + 1), { file, transition }], index: history.index + 1 },
		transition,
		direction: "forward",
	};
}

export function stepBack(history: PlayHistory): PlayStep | null {
	if (history.index === 0) return null;

	return {
		history: { ...history, index: history.index - 1 },
		transition: currentVisit(history).transition,
		direction: "back",
	};
}

export function stepForward(history: PlayHistory): PlayStep | null {
	const next = history.stack[history.index + 1];

	if (!next) return null;

	return { history: { ...history, index: history.index + 1 }, transition: next.transition, direction: "forward" };
}
