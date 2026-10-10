import { describe, expect, test } from "bun:test";
import {
	defaultOverlayTransition,
	overlayMotion,
	overlayRect,
	parseOverlayMode,
	parseTransition,
	screenTransition,
	TRANSITION_MS,
} from "./transitions";

describe("reading link options", () => {
	test("transitions are forgiving about case and space, and unknown names are none", () => {
		expect(parseTransition("slide")).toBe("slide");
		expect(parseTransition(" Push ")).toBe("push");
		expect(parseTransition("fade")).toBeNull();
		expect(parseTransition("")).toBeNull();
		expect(parseTransition(null)).toBeNull();
		expect(parseTransition(undefined)).toBeNull();
	});

	test("overlay and modal open a modal, sheet a sheet, anything else navigates", () => {
		expect(parseOverlayMode("overlay")).toBe("overlay");
		expect(parseOverlayMode("Modal")).toBe("overlay");
		expect(parseOverlayMode(" sheet")).toBe("sheet");
		expect(parseOverlayMode("navigate")).toBeNull();
		expect(parseOverlayMode(null)).toBeNull();
	});
});

describe("screen transitions", () => {
	test("instant plays nothing", () => {
		expect(screenTransition("instant", "forward", false)).toBeNull();
		expect(screenTransition("instant", "back", true)).toBeNull();
	});

	test("dissolve fades the new screen in over the old one", () => {
		const plan = screenTransition("dissolve", "back", false)!;
		expect(plan.incoming).toEqual([{ opacity: 0 }, { opacity: 1 }]);
		expect(plan.outgoing).toEqual([]);
		expect(plan.top).toBe("incoming");
		expect(plan.duration).toBe(TRANSITION_MS);
	});

	test("slide covers the old screen, and back uncovers it", () => {
		const forward = screenTransition("slide", "forward", false)!;
		expect(forward.incoming[0]).toEqual({ transform: "translateX(100%)" });
		expect(forward.outgoing).toEqual([]);
		expect(forward.top).toBe("incoming");
		const back = screenTransition("slide", "back", false)!;
		expect(back.incoming).toEqual([]);
		expect(back.outgoing.at(-1)).toEqual({ transform: "translateX(100%)" });
		expect(back.top).toBe("outgoing");
	});

	test("push moves both screens, the other way on back", () => {
		const forward = screenTransition("push", "forward", false)!;
		expect(forward.outgoing.at(-1)).toEqual({ transform: "translateX(-100%)" });
		const back = screenTransition("push", "back", false)!;
		expect(back.incoming[0]).toEqual({ transform: "translateX(-100%)" });
		expect(back.outgoing.at(-1)).toEqual({ transform: "translateX(100%)" });
	});

	test("reduced motion turns movement into a fade", () => {
		expect(screenTransition("push", "forward", true)).toEqual(screenTransition("dissolve", "forward", false));
		expect(screenTransition("slide", "back", true)).toEqual(screenTransition("dissolve", "back", false));
	});
});

describe("overlays", () => {
	test("a sheet slides up and a modal fades in by default", () => {
		expect(defaultOverlayTransition("sheet")).toBe("slide");
		expect(defaultOverlayTransition("overlay")).toBe("dissolve");
		expect(overlayMotion("sheet", null, true, false)!.panel[0]).toEqual({ transform: "translateY(100%)" });
		expect(overlayMotion("overlay", null, true, false)!.panel).toEqual([{ opacity: 0 }, { opacity: 1 }]);
	});

	test("closing reverses the opening, and instant plays nothing", () => {
		const open = overlayMotion("sheet", "push", true, false)!;
		const close = overlayMotion("sheet", "push", false, false)!;
		expect(close.panel).toEqual([...open.panel].reverse());
		expect(close.backdrop).toEqual([{ opacity: 1 }, { opacity: 0 }]);
		expect(overlayMotion("overlay", "instant", true, false)).toBeNull();
	});

	test("reduced motion fades a sheet instead of sliding it", () => {
		expect(overlayMotion("sheet", null, true, true)!.panel).toEqual([{ opacity: 0 }, { opacity: 1 }]);
	});

	test("a modal is centered and a sheet sits on the bottom edge, both inside the screen", () => {
		const screen = { width: 390, height: 844 };
		expect(overlayRect("overlay", screen, { width: 310, height: 400 })).toEqual({
			x: 40,
			y: 222,
			width: 310,
			height: 400,
		});
		expect(overlayRect("sheet", screen, { width: 310, height: 400 })).toEqual({
			x: 0,
			y: 444,
			width: 390,
			height: 400,
		});
		expect(overlayRect("overlay", screen, { width: 1440, height: 1024 })).toEqual({
			x: 0,
			y: 0,
			width: 390,
			height: 844,
		});
	});
});
