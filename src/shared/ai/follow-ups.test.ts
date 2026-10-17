import { describe, expect, test } from "bun:test";
import { readLink } from "../prototype/links";
import type { Frame } from "../types";
import {
	everyScreen,
	everyScreenNote,
	everyScreenPrompt,
	nextScreenLink,
	nextScreenNote,
	nextScreenPrompt,
	responsivePrompt,
	SCREEN_STATES,
	statePrompt,
} from "./follow-ups";

const home = `export default function Home() {
	return (
		<main>
			<button>Checkout</button>
		</main>
	);
}
`;

const frame = (file: string): Frame => ({ file, name: file, device: "mobile", x: 0, y: 0, width: 390, height: 844 });

describe("follow-ups", () => {
	test("every state asks for a new alternate that keeps the layout", () => {
		for (const state of SCREEN_STATES) {
			const prompt = statePrompt(state);
			expect(prompt).toContain(`the ${state} state`);
			expect(prompt).toContain("Keep everything else of this screen");
			expect(prompt).toContain("new alternate");
		}
	});

	test("a responsive version names the size and keeps the content", () => {
		const prompt = responsivePrompt("mobile", "desktop");
		expect(prompt).toContain("desktop version of this mobile screen, for a 1280×800 frame");
		expect(prompt).toContain("Keep the same content");
	});

	test("the next screen matches its source and leaves it alone", () => {
		const prompt = nextScreenPrompt({
			element: "<button> “Checkout”",
			from: "Home",
			fromPath: "screens/home.tsx",
			description: "The order summary",
		});

		expect(prompt).toContain("opens: The order summary.");
		expect(prompt).toContain("Match screens/home.tsx exactly in style");
		expect(prompt).toContain("Don't change screens/home.tsx");
		expect(nextScreenPrompt({ element: "x", from: "Home", fromPath: "screens/home.tsx", description: " " })).toContain(
			"the natural next step",
		);
		expect(nextScreenNote("<button> “Checkout”", "Home", "")).toBe("Next screen from <button> “Checkout” on Home");
	});

	test("the element links to the first new screen", () => {
		const start = home.indexOf("<button>");
		const files = { "screens/home.tsx": home };
		const change = nextScreenLink(files, { file: "screens/home.tsx", start }, ["screens/summary.tsx"]);

		expect(change?.path).toBe("screens/home.tsx");
		expect(readLink({ "screens/home.tsx": change!.content! }, { file: "screens/home.tsx", start })).toBe(
			"screens/summary.tsx",
		);
	});

	test("no link without a new plain screen, or when the element is gone", () => {
		const files = { "screens/home.tsx": home };
		const start = home.indexOf("<button>");

		expect(nextScreenLink(files, { file: "screens/home.tsx", start }, [])).toBeNull();
		expect(nextScreenLink(files, { file: "screens/home.tsx", start }, ["screens/home.alt-1.tsx"])).toBeNull();
		expect(nextScreenLink(files, { file: "screens/gone.tsx", start }, ["screens/summary.tsx"])).toBeNull();
	});

	test("every screen: plain screens on the canvas, once each", () => {
		const files = { "screens/a.tsx": "", "screens/a.alt-1.tsx": "", "screens/b.tsx": "", "components/c.tsx": "" };
		const frames = ["screens/a.tsx", "screens/a.alt-1.tsx", "screens/b.tsx", "screens/gone.tsx"].map(frame);

		expect(everyScreen([...frames, frame("screens/a.tsx")], files)).toEqual(["screens/a.tsx", "screens/b.tsx"]);
		expect(everyScreenNote(" bolder headings ")).toBe("Every screen: bolder headings");
		expect(everyScreenPrompt("Bolder headings", "screens/a.tsx", 3)).toContain(
			"(3 screens). This run changes screens/a.tsx only",
		);
	});
});
