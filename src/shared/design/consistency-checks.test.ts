import { describe, expect, test } from "bun:test";
import {
	consistencyFindings,
	type BarSample,
	type ControlSample,
	type SampledScreen,
	type ScreenSample,
} from "./consistency-checks";

function button(fields: Partial<ControlSample> = {}): ControlSample {
	return {
		path: "screens/home.tsx",
		start: 10,
		kind: "button",
		fill: "filled",
		text: "Continue",
		height: 40,
		radius: 8,
		fontSize: 14,
		slot: "button",
		...fields,
	};
}

function bar(fields: Partial<BarSample> = {}): BarSample {
	return { kind: "nav", placement: "bottom", size: 64, items: ["Home", "Search", "Profile"], ...fields };
}

function screen(file: string, fields: Partial<ScreenSample> = {}): SampledScreen {
	return {
		file,
		name: file,
		sample: { width: 390, inset: 24, controls: [button({ path: file })], bars: [bar()], ...fields },
	};
}

const rulesOf = (found: Map<string, { rule: string }[]>, file: string) =>
	(found.get(file) ?? []).map((finding) => finding.rule);

describe("components", () => {
	test("flags the button that differs from the one most screens use", () => {
		const odd = screen("c", { controls: [button({ path: "c", start: 4, height: 48, radius: 24 })] });
		const found = consistencyFindings([screen("a"), screen("b"), odd]);

		expect(rulesOf(found, "a")).toEqual([]);

		const [finding] = found.get("c") ?? [];

		expect(finding?.rule).toBe("component-drift");
		expect(finding?.path).toBe("c");
		expect(finding?.start).toBe(4);
		expect(finding?.message).toContain("48px tall, round ends");
		expect(finding?.message).toContain("40px tall, 8px corners");
	});

	test("flags a hand-made button when other screens use the component", () => {
		const odd = screen("c", { controls: [button({ path: "c", slot: null })] });
		const found = consistencyFindings([screen("a"), screen("b"), odd]);

		expect(found.get("c")?.[0]?.message).toContain("hand-made <button>");
		expect(found.get("c")?.[0]?.message).toContain("<Button>");
	});

	test("compares buttons of the same fill only", () => {
		const outline = screen("c", { controls: [button({ path: "c", fill: "outline", height: 36 })] });

		expect(consistencyFindings([screen("a"), screen("b"), outline]).get("c")).toBeUndefined();
	});
});

describe("spacing", () => {
	test("flags a screen whose content starts at another inset", () => {
		const found = consistencyFindings([screen("a"), screen("b"), screen("c", { inset: 16 })]);
		const [finding] = found.get("c") ?? [];

		expect(finding?.rule).toBe("spacing-drift");
		expect(finding?.message).toContain("16px");
		expect(finding?.message).toContain("24px");
	});

	test("compares screens of the same width only", () => {
		const desktop = screen("d", { width: 1440, inset: 80 });

		expect(consistencyFindings([screen("a"), screen("b"), desktop]).get("d")).toBeUndefined();
	});
});

describe("navigation", () => {
	test("flags a nav with other items, and names what differs", () => {
		const odd = screen("c", { bars: [bar({ items: ["Home", "Profile", "Settings"] })] });
		const [finding] = consistencyFindings([screen("a"), screen("b"), odd]).get("c") ?? [];

		expect(finding?.rule).toBe("nav-drift");
		expect(finding?.message).toContain('lacks "Search"');
		expect(finding?.message).toContain('adds "Settings"');
	});

	test("flags a nav of another height", () => {
		const odd = screen("c", { bars: [bar({ size: 56 })] });

		expect(consistencyFindings([screen("a"), screen("b"), odd]).get("c")?.[0]?.message).toContain("56px tall");
	});

	test("flags a screen without the nav most screens have", () => {
		const found = consistencyFindings([screen("a"), screen("b"), screen("c"), screen("d", { bars: [] })]);

		expect(found.get("d")?.[0]?.message).toContain("no bottom nav, while 3 of 4 screens do");
	});

	test("leaves a pair of screens without a majority alone about missing navs", () => {
		expect(consistencyFindings([screen("a"), screen("b", { bars: [] })]).get("b")).toBeUndefined();
	});
});
