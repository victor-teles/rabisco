import { describe, expect, test } from "bun:test";
import { eventPaste } from "./clipboard";
import { readElement } from "./element-clipboard";
import { readScreens } from "./new-screens";

const SCREEN = `export default function Settings() {\n\treturn <main className="p-4">Settings</main>;\n}\n`;

const data = (text: string, files: File[] = []) => ({
	getData: (format: string) => (format === "text/plain" ? text : ""),
	files,
});

describe("eventPaste", () => {
	test("reads the event's text and the files of the accepted types", async () => {
		const png = new File(["png"], "a.png", { type: "image/png" });
		const pdf = new File(["pdf"], "a.pdf", { type: "application/pdf" });
		const paste = eventPaste(data("hello", [png, pdf]));

		expect(await paste.text()).toBe("hello");
		expect(await paste.blobs((type) => type.startsWith("image/"))).toEqual([png]);
	});

	test("reads nothing without data", async () => {
		const paste = eventPaste(null);

		expect(await paste.text()).toBe("");
		expect(await paste.blobs(() => true)).toEqual([]);
	});
});

describe("pasting from the event", () => {
	test("element code becomes an element", async () => {
		expect(await readElement(eventPaste(data("  <Button>Save</Button>\n")))).toEqual({
			code: "<Button>Save</Button>",
			imports: [],
		});
	});

	test("other text is not an element", async () => {
		expect(await readElement(eventPaste(data("hello from another app")))).toBeNull();
	});

	test("a screen's TSX becomes a screen", async () => {
		const screens = await readScreens("mobile", eventPaste(data(SCREEN)));

		expect(screens.map((screen) => screen.name)).toEqual(["Settings"]);
	});

	test("an image alone is not a screen", async () => {
		const png = new File(["png"], "a.png", { type: "image/png" });

		expect(await readScreens("mobile", eventPaste(data("", [png])))).toEqual([]);
	});
});
