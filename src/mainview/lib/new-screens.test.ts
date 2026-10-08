import { describe, expect, test } from "bun:test";
import { compileTsx } from "../../bun/test-utils";
import type { Frame } from "../../shared/types";
import { blankScreen, centeredOn, copyScreens, placeScreens, screenFromCode } from "./new-screens";

const frame = (file: string, x: number, y: number): Frame => ({
	file,
	name: file.replace(/^screens\/|\.tsx$/g, ""),
	device: "mobile",
	x,
	y,
	width: 390,
	height: 844,
});

describe("blankScreen", () => {
	test("is a screen that compiles, sized for the device", () => {
		const screen = blankScreen("Order history", "desktop");

		expect(screen.source).toContain("export default function OrderHistory()");
		expect(() => compileTsx(screen.source)).not.toThrow();
		expect(screen).toMatchObject({ width: 1280, height: 800, dx: 0, dy: 0 });
	});

	test("takes a preset size", () => {
		expect(blankScreen("Tablet", "mobile", { width: 834, height: 1194 })).toMatchObject({
			device: "mobile",
			width: 834,
			height: 1194,
		});
	});

	test("names a component that can't start with a digit", () => {
		expect(blankScreen("2 step", "mobile").source).toContain("function Screen2Step()");
	});
});

describe("screenFromCode", () => {
	test("takes TSX with a default export and names it after the component", () => {
		const screen = screenFromCode("export default function OrderHistory() { return <div />; }", "mobile");

		expect(screen?.name).toBe("Order history");
		expect(screen?.source).toContain("OrderHistory");
	});

	test("ignores other text", () => {
		expect(screenFromCode("hello world", "mobile")).toBeNull();
		expect(screenFromCode("const a = 'export default';", "mobile")).toBeNull();
	});
});

describe("placeScreens", () => {
	const frames = [frame("screens/home.tsx", 0, 100), frame("screens/settings.tsx", 500, 300)];
	const files = { "screens/home.tsx": "home", "screens/settings.tsx": "settings" };

	test("keeps the copied layout at the point, with unique paths", () => {
		const placed = placeScreens(files, frames, copyScreens(frames, files), { x: 1000, y: 0 });

		expect(placed.frames.map((added) => [added.file, added.x, added.y])).toEqual([
			["screens/home-2.tsx", 1000, 0],
			["screens/settings-2.tsx", 1500, 200],
		]);
		expect(placed.files["screens/settings-2.tsx"]).toBe("settings");
		expect(Object.keys(placed.files)).toHaveLength(2);
	});

	test("goes right of every frame without a point", () => {
		const placed = placeScreens(files, frames, [blankScreen("Untitled", "mobile")]);

		expect(placed.frames[0]).toMatchObject({ file: "screens/untitled.tsx", x: 890 + 240, y: 100 });
	});
});

describe("centeredOn", () => {
	test("centers the copied layout, not only the first screen, on the pointer", () => {
		const frames = [frame("screens/home.tsx", 0, 100), frame("screens/settings.tsx", 500, 300)];
		const copies = copyScreens(frames, { "screens/home.tsx": "home", "screens/settings.tsx": "settings" });

		// The pair spans 890 × 1044
		expect(centeredOn(copies, { x: 1000, y: 1000 })).toEqual({ x: 1000 - 445, y: 1000 - 522 });
	});

	test("centers a single screen", () => {
		expect(centeredOn([blankScreen("Untitled", "mobile")], { x: 0, y: 0 })).toEqual({ x: -195, y: -422 });
	});
});
