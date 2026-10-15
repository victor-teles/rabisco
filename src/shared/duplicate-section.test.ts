import { describe, expect, test } from "bun:test";
import { duplicateWithMode } from "./duplicate-section";
import { FRAME_GAP } from "./project";
import type { CanvasSection, Frame } from "./types";

const frame = (file: string, x: number, modes?: Frame["modes"]): Frame => {
	const made: Frame = { file, name: file.slice(8, -4), device: "mobile", x, y: 0, width: 100, height: 200 };

	if (modes) made.modes = modes;

	return made;
};

const light: CanvasSection = {
	id: "light",
	name: "Light",
	color: "gray",
	x: -50,
	y: -50,
	width: 400,
	height: 300,
	modes: { scheme: "light", density: "compact" },
	tokens: { light: { primary: "red" }, dark: {} },
};

const canvas = {
	sections: [light],
	frames: [
		frame("screens/home.tsx", 0, { scheme: "light", density: "roomy" }),
		frame("screens/settings.tsx", 200),
		frame("screens/outside.tsx", 900),
	],
	files: {
		"screens/home.tsx": `export default () => <div><a data-link-to="screens/settings.tsx">S</a><a data-link-to="screens/outside.tsx">O</a></div>;`,
		"screens/settings.tsx": `export default () => <a data-link-to="screens/home.tsx" href="#/home">Back</a>;`,
		"screens/outside.tsx": `export default () => <a data-link-to="screens/home.tsx">Home</a>;`,
	},
};

describe("duplicateWithMode", () => {
	const result = duplicateWithMode(canvas, "light", { group: "scheme", option: "dark" }, "dark")!;
	const copy = result.sections.find((section) => section.id === "dark")!;
	const copies = result.frames.slice(canvas.frames.length);

	test("places the copy one gap to the right with the picked option and the draft", () => {
		expect(copy).toEqual({
			...light,
			id: "dark",
			name: "Dark",
			x: light.x + light.width + FRAME_GAP,
			modes: { scheme: "dark", density: "compact" },
		});
	});

	test("copies only the member screens, which drop their choice for the group", () => {
		expect(copies.map((f) => [f.file, f.name, f.x, f.modes])).toEqual([
			["screens/home-2.tsx", "home copy", 520, { density: "roomy" }],
			["screens/settings-2.tsx", "settings copy", 720, undefined],
		]);
		expect(result.frames.slice(0, 3)).toEqual(canvas.frames);
	});

	test("points links between copies at the copies and keeps the rest", () => {
		expect(result.files["screens/home-2.tsx"]).toContain(`data-link-to="screens/settings-2.tsx"`);
		expect(result.files["screens/home-2.tsx"]).toContain(`data-link-to="screens/outside.tsx"`);
		expect(result.files["screens/settings-2.tsx"]).toContain(`data-link-to="screens/home-2.tsx"`);
		expect(result.files["screens/settings-2.tsx"]).toContain(`href="#/home-2"`);
		expect(result.files["screens/home.tsx"]).toBe(canvas.files["screens/home.tsx"]);
		expect(result.files["screens/outside.tsx"]).toBe(canvas.files["screens/outside.tsx"]);
	});

	test("copies nested sections, which follow the new section", () => {
		const inner: CanvasSection = {
			...light,
			id: "inner",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			modes: { scheme: "light" },
		};

		const nested = duplicateWithMode(
			{ ...canvas, sections: [light, inner] },
			"light",
			{ group: "scheme", option: "dark" },
			"dark",
		)!;

		const innerCopy = nested.sections.at(-1)!;

		expect(nested.sections).toHaveLength(4);
		expect(innerCopy.x).toBe(inner.x + light.width + FRAME_GAP);
		expect(innerCopy.modes).toBeUndefined();
	});

	test("keeps the source name when it doesn't name the mode", () => {
		const named = duplicateWithMode(
			{ ...canvas, sections: [{ ...light, name: "Onboarding" }] },
			"light",
			{ group: "scheme", option: "dark" },
			"dark",
		)!;

		expect(named.sections.at(-1)!.name).toBe("Onboarding Dark");
	});

	test("returns null for an unknown section", () => {
		expect(duplicateWithMode(canvas, "nope", { group: "scheme", option: "dark" }, "dark")).toBeNull();
	});
});
