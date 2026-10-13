import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromeBox, ChromePortal } from "./chrome-layer";

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

describe("ChromePortal", () => {
	test("renders nothing outside a canvas", () => {
		expect(renderToStaticMarkup(createElement(ChromePortal, { box: { x: 0, y: 0 } }, "Reminders"))).toBe("");
	});
});
