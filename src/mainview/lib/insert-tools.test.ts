import { describe, expect, test } from "bun:test";
import { dropTarget } from "./component-drop";
import {
	imageAlt,
	imageSnippet,
	insertIntoScreen,
	insertSnippet,
	isInsertTool,
	newFrameRect,
	boxSize,
	sizeClass,
	BOX_SIZE,
} from "./insert-tools";
import { sourceVersion } from "./render/protocol";
import { findElement, parseJsx } from "../../shared/jsx";

const SCREEN = `export default function Home() {
	return (
		<main className="flex flex-col gap-4 p-6">
			<h1>Hi</h1>
			<p>Body</p>
		</main>
	);
}
`;

const rect = (width: number, height: number) => ({ x: 10, y: 20, width, height });

describe("isInsertTool", () => {
	test("knows the insert tools", () => {
		expect(isInsertTool("text")).toBe(true);
		expect(isInsertTool("ellipse")).toBe(true);
		expect(isInsertTool("move")).toBe(false);
		expect(isInsertTool("comment")).toBe(false);
	});
});

describe("sizeClass", () => {
	test("rounds to the spacing scale", () => {
		expect(sizeClass("w", 96)).toBe("w-24");
		expect(sizeClass("h", 101)).toBe("h-25");
		expect(sizeClass("w", 103)).toBe("w-26");
	});

	test("never goes below one step", () => {
		expect(sizeClass("w", 0)).toBe("w-1");
	});

	test("fills the parent when it reaches its size", () => {
		expect(sizeClass("w", 340, 340)).toBe("w-full");
		expect(sizeClass("w", 400, 340)).toBe("w-full");
		expect(sizeClass("w", 300, 340)).toBe("w-75");
	});
});

describe("boxSize", () => {
	test("a click makes the default size", () => {
		expect(boxSize({ rect: rect(0, 0), dragged: false })).toEqual({ width: BOX_SIZE, height: BOX_SIZE });
	});

	test("a drag keeps its size", () => {
		expect(boxSize({ rect: rect(120, 40), dragged: true })).toEqual({ width: 120, height: 40 });
	});
});

describe("insertSnippet", () => {
	const click = { rect: rect(0, 0), dragged: false, available: null };

	test("text is a paragraph, with a width when dragged", () => {
		expect(insertSnippet({ ...click, tool: "text" })).toBe("<p>Text</p>");
		expect(insertSnippet({ tool: "text", rect: rect(192, 4), dragged: true, available: null })).toBe(
			'<p className="w-48">Text</p>',
		);
	});

	test("a frame is a sized div", () => {
		expect(insertSnippet({ tool: "frame", rect: rect(200, 80), dragged: true, available: null })).toBe(
			'<div className="h-20 w-50" />',
		);
	});

	test("a rectangle uses the muted fill and the radius token", () => {
		expect(insertSnippet({ ...click, tool: "rectangle" })).toBe('<div className="h-24 w-24 rounded-lg bg-muted" />');
	});

	test("an ellipse is fully rounded", () => {
		expect(insertSnippet({ ...click, tool: "ellipse" })).toBe('<div className="h-24 w-24 rounded-full bg-muted" />');
	});

	test("a drag across the parent fills it", () => {
		const available = { width: 342, height: 600 };

		expect(insertSnippet({ tool: "rectangle", rect: rect(360, 40), dragged: true, available })).toBe(
			'<div className="h-10 w-full rounded-lg bg-muted" />',
		);
	});
});

describe("images", () => {
	test("alt text comes from the file name", () => {
		expect(imageAlt("/images/team-photo_2.png")).toBe("Team photo 2");
		expect(imageAlt("/images/.png")).toBe("Image");
	});

	test("the snippet points at the project image", () => {
		expect(imageSnippet("/images/logo.svg")).toBe(
			'<img src="/images/logo.svg" alt="Logo" className="h-auto max-w-full" />',
		);
	});
});

describe("insertIntoScreen", () => {
	const main = SCREEN.indexOf("<main");

	test("inserts at the placed slot", () => {
		const target = { parent: main, index: 1, version: sourceVersion(SCREEN) };
		const out = insertIntoScreen(SCREEN, target, "<p>Text</p>")!;

		expect(out.source).toContain("<h1>Hi</h1>\n\t\t\t<p>Text</p>\n\t\t\t<p>Body</p>");
		expect(findElement(parseJsx(out.source), out.start)?.name).toBe("p");
		expect(out.source.slice(out.start, out.start + 11)).toBe("<p>Text</p>");
	});

	test("a target from another version appends to the screen", () => {
		const target = { parent: main, index: 0, version: "stale" };
		const out = insertIntoScreen(SCREEN, target, '<div className="h-24 w-24" />')!;
		const root = dropTarget(out.source, null)!;

		expect(out.start).toBe(root.slots.at(-1)!.start);
	});

	test("a screen that doesn't parse takes nothing", () => {
		expect(insertIntoScreen("export default function X() { return <div>; }", null, "<p>Text</p>")).toBeNull();
	});
});

describe("newFrameRect", () => {
	test("a drag makes a screen of that size", () => {
		expect(newFrameRect({ rect: { x: 10.4, y: 20.6, width: 300.2, height: 500.7 }, dragged: true }, "mobile")).toEqual({
			x: 10,
			y: 21,
			width: 300,
			height: 501,
		});
	});

	test("a click makes a screen of the project's device", () => {
		expect(newFrameRect({ rect: rect(0, 0), dragged: false }, "desktop")).toEqual({
			x: 10,
			y: 20,
			width: 1280,
			height: 800,
		});
	});

	test("tiny drags keep the smallest frame", () => {
		expect(newFrameRect({ rect: rect(5, 5), dragged: true }, "mobile").width).toBe(40);
	});
});
