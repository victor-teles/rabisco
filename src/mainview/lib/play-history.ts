import {
	DEFAULT_TIMING,
	type Direction,
	type LinkTiming,
	type LinkTransition,
} from "../../shared/prototype/transitions";

/** `timing` is set when the link that opened the screen has its own (decision 0046) */
export type Visit = { file: string; transition: LinkTransition; timing?: LinkTiming };

export type PlayHistory = { stack: Visit[]; index: number };

export type PlayStep = { history: PlayHistory; transition: LinkTransition; timing: LinkTiming; direction: Direction };

export const startHistory = (file: string): PlayHistory => ({ stack: [{ file, transition: "instant" }], index: 0 });

export const currentVisit = (history: PlayHistory): Visit => history.stack[history.index]!;

const isDefault = (timing: LinkTiming) => timing.duration === null && timing.easing === null;

export function pushVisit(
	history: PlayHistory,
	file: string,
	transition: LinkTransition,
	timing: LinkTiming = DEFAULT_TIMING,
): PlayStep | null {
	if (currentVisit(history).file === file) return null;
	const visit: Visit = { file, transition };

	if (!isDefault(timing)) visit.timing = timing;

	return {
		history: { stack: [...history.stack.slice(0, history.index + 1), visit], index: history.index + 1 },
		transition,
		timing,
		direction: "forward",
	};
}

export function stepBack(history: PlayHistory): PlayStep | null {
	if (history.index === 0) return null;
	const leaving = currentVisit(history);

	return {
		history: { ...history, index: history.index - 1 },
		transition: leaving.transition,
		timing: leaving.timing ?? DEFAULT_TIMING,
		direction: "back",
	};
}

export function stepForward(history: PlayHistory): PlayStep | null {
	const next = history.stack[history.index + 1];

	if (!next) return null;

	return {
		history: { ...history, index: history.index + 1 },
		transition: next.transition,
		timing: next.timing ?? DEFAULT_TIMING,
		direction: "forward",
	};
}
