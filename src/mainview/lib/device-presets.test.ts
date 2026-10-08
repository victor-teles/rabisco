import { describe, expect, test } from "bun:test";
import { DEVICE_PRESETS, deviceForSize, PRESET_KINDS, parseSize } from "./device-presets";
import { FRAME_SIZE } from "../../shared/project";

describe("device presets", () => {
	test("have unique ids and a heading for every kind", () => {
		expect(new Set(DEVICE_PRESETS.map((preset) => preset.id)).size).toBe(DEVICE_PRESETS.length);

		for (const { kind } of PRESET_KINDS) expect(DEVICE_PRESETS.some((preset) => preset.kind === kind)).toBe(true);
	});

	test("include the default frame sizes", () => {
		const sizes = DEVICE_PRESETS.map(({ width, height }) => ({ width, height }));

		expect(sizes).toContainEqual(FRAME_SIZE.mobile);
		expect(sizes).toContainEqual(FRAME_SIZE.desktop);
	});

	test("phones and tablets render as mobile, desktops as desktop", () => {
		for (const preset of DEVICE_PRESETS)
			expect(deviceForSize(preset)).toBe(preset.kind === "desktop" ? "desktop" : "mobile");
	});
});

describe("parseSize", () => {
	test("reads whole pixels", () => {
		expect(parseSize("390", " 844.4 ")).toEqual({ width: 390, height: 844 });
	});

	test("clamps to the frame limits", () => {
		expect(parseSize("1", "99999")).toEqual({ width: 40, height: 8000 });
	});

	test("is null for anything but numbers", () => {
		expect(parseSize("", "100")).toBeNull();
		expect(parseSize("wide", "100")).toBeNull();
	});
});
