import { describe, expect, test } from "bun:test";
import { parseFile } from "../jsx/tree";
import { MOTION_PRESETS, motionPreset } from "./presets";
import { demoClasses, motionPreviewModule } from "./preview";

describe("motion previews", () => {
	test("hover and press play on a data attribute the preview switches", () => {
		expect(demoClasses(motionPreset("hover-lift")!)).toBe(
			"transition motion-safe:data-[on]:-translate-y-0.5 data-[on]:shadow-md duration-200 ease-out",
		);
		expect(demoClasses(motionPreset("press-shrink")!)).toContain("motion-safe:data-[on]:scale-95");
		expect(demoClasses(motionPreset("appear-rise")!)).toContain("motion-safe:slide-in-from-bottom-4");
	});

	test("every preview is a module the screen compiler can read", () => {
		for (const preset of MOTION_PRESETS) {
			const module = motionPreviewModule(preset);

			expect(parseFile(module).ok).toBe(true);
			expect(module).toContain("export default function MotionPreview()");
		}
	});

	test("a loop needs no timer, an appear remounts", () => {
		expect(motionPreviewModule(motionPreset("loop-spin")!)).not.toContain("useEffect");
		expect(motionPreviewModule(motionPreset("appear-fade")!)).toContain("key={round}");
	});
});
