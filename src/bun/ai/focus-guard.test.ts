import { describe, expect, test } from "bun:test";
import { elementFocus } from "../../shared/ai/focus";
import { changesOutside, focusNotes, lineRanges } from "./focus-guard";

const BEFORE = `import { Button } from "@/components/ui/button";

export default function Welcome() {
	return (
		<main className="flex flex-col gap-4 p-6">
			<h1 className="text-2xl font-semibold">Welcome back</h1>
			<Button size="lg">Get started</Button>
			<p className="text-sm text-muted-foreground">Terms apply</p>
		</main>
	);
}
`;

const PATH = "screens/welcome.tsx";
const focus = elementFocus(BEFORE, PATH, BEFORE.indexOf("<Button"))!;
const BUTTON = `<Button size="lg">Get started</Button>`;

describe("changesOutside", () => {
	test("a change inside the element only: nothing outside", () => {
		const after = BEFORE.replace(BUTTON, `<Button size="lg" className="w-full">\n\t\t\t\tGet started\n\t\t\t</Button>`);
		expect(changesOutside(BEFORE, after, focus)).toEqual([]);
	});

	test("new imports and a new top-level helper are allowed; blank lines are ignored", () => {
		const after = BEFORE.replace(`import { Button } from "@/components/ui/button";`, `import { ArrowRight } from "lucide-react";\nimport {\n\tButton,\n} from "@/components/ui/button";`)
			.replace("export default function", `function Cta() {\n\treturn <ArrowRight />;\n}\n\n\nexport default function`)
			.replace(BUTTON, `<Button size="lg">Get started <Cta /></Button>`);
		expect(changesOutside(BEFORE, after, focus)).toEqual([]);
	});

	test("changed and removed lines outside the element are reported, as lines of the new file", () => {
		const changed = BEFORE.replace("Welcome back", "Hello again").replace(BUTTON, `<Button>Start</Button>`);
		expect(changesOutside(BEFORE, changed, focus)).toEqual([6]);
		const removed = BEFORE.replace(`\t\t\t<p className="text-sm text-muted-foreground">Terms apply</p>\n`, "");
		expect(changesOutside(BEFORE, removed, focus)).toEqual([8]);
		const added = BEFORE.replace("\t\t</main>", `\t\t\t<footer>More</footer>\n\t\t</main>`);
		expect(changesOutside(BEFORE, added, focus)).toEqual([9]);
	});

	test("a change next to a rewritten element is still reported", () => {
		const after = BEFORE.replace(BUTTON, `<Button size="lg">\n\t\t\t\tStart now\n\t\t\t</Button>`).replace("Terms apply", "No card needed");
		expect(changesOutside(BEFORE, after, focus)).toEqual([10]);
	});

	test("a removed import is fine", () => {
		const after = BEFORE.replace(`import { Button } from "@/components/ui/button";\n`, "").replace(BUTTON, `<button>Get started</button>`);
		expect(changesOutside(BEFORE, after, focus)).toEqual([]);
	});
});

test("lineRanges", () => {
	expect(lineRanges([4])).toBe("line 4");
	expect(lineRanges([3, 4, 5, 9, 11, 12])).toBe("lines 3–5, 9, 11–12");
});

describe("focusNotes", () => {
	test("a note when the file changed outside the element, none otherwise", () => {
		const outside = BEFORE.replace("Welcome back", "Hello again");
		expect(focusNotes(focus, { [PATH]: BEFORE }, [{ path: PATH, content: outside }])).toEqual([
			`Note: this also changed ${PATH} outside <Button> “Get started” (line 6). Undo reverts the whole edit.`,
		]);
		const inside = BEFORE.replace("Get started", "Start now");
		expect(focusNotes(focus, { [PATH]: BEFORE }, [{ path: PATH, content: inside }])).toEqual([]);
		expect(focusNotes(focus, { [PATH]: BEFORE }, [{ path: "components/cta.tsx", content: "x" }])).toEqual([]);
		expect(focusNotes(undefined, { [PATH]: BEFORE }, [{ path: PATH, content: outside }])).toEqual([]);
	});

	test("deleting the file is a note too", () => {
		expect(focusNotes(focus, { [PATH]: BEFORE }, [{ path: PATH, content: null }])[0]).toContain("deleted");
	});
});
