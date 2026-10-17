import { expect, test } from "bun:test";
import { fixPrompt } from "./fix-prompt";

test("lists the findings by screen, with their place", () => {
	const prompt = fixPrompt("Fix these accessibility problems:", [
		{
			name: "Home",
			findings: [
				{ rule: "label", severity: "error", message: "<button> has no label", path: "screens/home.tsx", line: 12 },
			],
		},
		{ name: "Empty", findings: [] },
		{ name: "Profile", findings: [{ rule: "landmarks", severity: "warning", message: "No <main>" }] },
	]);

	expect(prompt).toBe(
		[
			"Fix these accessibility problems:",
			"Home\n- Missing label: <button> has no label (screens/home.tsx:12)",
			"Profile\n- Landmarks: No <main>",
		].join("\n\n"),
	);
});

test("is empty without findings", () => {
	expect(fixPrompt("Fix:", [{ name: "Home", findings: [] }])).toBe("");
});
