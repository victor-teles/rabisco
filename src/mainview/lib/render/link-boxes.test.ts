import { describe, expect, test } from "bun:test";
import { linkBoxes, setLinkBoxes, subscribeLinkBoxes } from "./link-boxes";

const BOX = { x: 10, y: 20, width: 100, height: 40 };

describe("link boxes", () => {
	test("stores the boxes by screen and tells listeners only when they change", () => {
		let calls = 0;
		const unsubscribe = subscribeLinkBoxes(() => calls++);

		setLinkBoxes("screens/a.tsx", "v1", 390, [{ start: 5, box: BOX }]);
		const first = linkBoxes();
		setLinkBoxes("screens/a.tsx", "v1", 390, [{ start: 5, box: { ...BOX } }]);
		expect(linkBoxes()).toBe(first);
		expect(calls).toBe(1);

		setLinkBoxes("screens/a.tsx", "v1", 390, [{ start: 5, box: { ...BOX, y: 30 } }]);
		expect(calls).toBe(2);
		expect(linkBoxes().get("screens/a.tsx")?.boxes.get(5)?.y).toBe(30);

		setLinkBoxes("screens/a.tsx", "v2", 390, []);
		expect(linkBoxes().get("screens/a.tsx")).toEqual({ version: "v2", width: 390, boxes: new Map() });
		unsubscribe();
	});
});
