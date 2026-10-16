import { describe, expect, test } from "bun:test";
import { currentVisit, pushVisit, startHistory, stepBack, stepForward } from "./play-history";

describe("play history", () => {
	test("a link pushes a visit with its transition and drops the forward entries", () => {
		const start = startHistory("screens/a.tsx");
		const toB = pushVisit(start, "screens/b.tsx", "push")!;
		expect(toB.transition).toBe("push");
		expect(toB.direction).toBe("forward");
		expect(currentVisit(toB.history)).toEqual({ file: "screens/b.tsx", transition: "push" });
		const back = stepBack(toB.history)!;
		const toC = pushVisit(back.history, "screens/c.tsx", "instant")!;
		expect(toC.history.stack.map((visit) => visit.file)).toEqual(["screens/a.tsx", "screens/c.tsx"]);
	});

	test("a link to the current screen does nothing", () => {
		expect(pushVisit(startHistory("screens/a.tsx"), "screens/a.tsx", "slide")).toBeNull();
	});

	test("back plays the transition that opened the screen it leaves, reversed", () => {
		const toB = pushVisit(startHistory("screens/a.tsx"), "screens/b.tsx", "slide")!;
		const back = stepBack(toB.history)!;
		expect(back.transition).toBe("slide");
		expect(back.direction).toBe("back");
		expect(currentVisit(back.history).file).toBe("screens/a.tsx");
		expect(stepBack(back.history)).toBeNull();
	});

	test("forward replays the transition of the screen it returns to", () => {
		const toB = pushVisit(startHistory("screens/a.tsx"), "screens/b.tsx", "dissolve")!;
		const forward = stepForward(stepBack(toB.history)!.history)!;
		expect(forward.transition).toBe("dissolve");
		expect(forward.direction).toBe("forward");
		expect(stepForward(forward.history)).toBeNull();
	});

	test("back and forward replay the timing of the link that opened the screen", () => {
		const timing = { duration: 150, easing: "ease-out" } as const;
		const toB = pushVisit(startHistory("screens/a.tsx"), "screens/b.tsx", "push", timing)!;
		expect(toB.timing).toEqual(timing);
		const back = stepBack(toB.history)!;
		expect(back.timing).toEqual(timing);
		expect(stepForward(back.history)!.timing).toEqual(timing);
		expect(stepBack(pushVisit(back.history, "screens/c.tsx", "push")!.history)!.timing).toEqual({
			duration: null,
			easing: null,
		});
	});
});
