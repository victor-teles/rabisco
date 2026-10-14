import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromeBox, ChromePortal, snapToPixel, zoomed } from "./chrome-layer";

describe("chromeBox", () => {
	test("places a canvas box in screen pixels, through the view's zoom", () => {
		expect(chromeBox({ x: 1020, y: -40.5, width: 390, height: 844 })).toEqual({
			left: "calc(1020px * var(--zoom))",
			top: "calc(-40.5px * var(--zoom))",
			width: "calc(390px * var(--zoom))",
			height: "calc(844px * var(--zoom))",
		});
	});

	test("a point has no size", () => {
		expect(chromeBox({ x: 12, y: 8 })).toMatchObject({
			width: "calc(0px * var(--zoom))",
			height: "calc(0px * var(--zoom))",
		});
	});
});

describe("snapToPixel", () => {
	test("rounds an offset to the nearest device pixel", () => {
		expect(snapToPixel(238.9016, 2)).toBe(239);
		expect(snapToPixel(69.7, 2)).toBe(69.5);
		expect(snapToPixel(10.4, 1)).toBe(10);
	});
});

describe("zoomed", () => {
	test("turns a canvas length into screen pixels", () => {
		expect(zoomed(28)).toBe("calc(28px * var(--zoom))");
	});
});

describe("ChromePortal", () => {
	test("renders nothing outside a canvas", () => {
		expect(renderToStaticMarkup(createElement(ChromePortal, { box: { x: 0, y: 0 } }, "Reminders"))).toBe("");
	});
});
