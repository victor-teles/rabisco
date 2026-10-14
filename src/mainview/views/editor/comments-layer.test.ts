import { describe, expect, test } from "bun:test";
import { holdFocus } from "./comments-layer";

function fakeTextarea() {
	const textarea = { focused: false, focus: () => (textarea.focused = true) };

	return textarea;
}

function fakeFrames() {
	const pending: (() => void)[] = [];

	const schedule = (run: () => void) => {
		pending.push(run);

		return () => pending.splice(pending.indexOf(run), 1);
	};

	return { pending, schedule };
}

describe("holdFocus", () => {
	test("focuses again after the press that opened the draft moves focus to the page", () => {
		const textarea = fakeTextarea();
		const frames = fakeFrames();

		holdFocus(textarea, frames.schedule);

		expect(textarea.focused).toBe(true);

		textarea.focused = false;

		for (const run of frames.pending) run();

		expect(textarea.focused).toBe(true);
	});

	test("cancels the refocus when the composer closes first", () => {
		const frames = fakeFrames();
		const release = holdFocus(fakeTextarea(), frames.schedule);

		release();

		expect(frames.pending).toHaveLength(0);
	});
});
