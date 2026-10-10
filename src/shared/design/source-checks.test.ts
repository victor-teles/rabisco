import { describe, expect, test } from "bun:test";
import { withLines } from "./locate";
import { sourceFindings } from "./source-checks";

const NO_TOKENS = { light: {}, dark: {} };

const screen = (body: string) => `import { cn } from "@/lib/utils";

export default function Home() {
	return (
${body}
	);
}
`;

describe("sourceFindings: raw-color", () => {
	test("reports neutral palette colors once per class, with a token to use", () => {
		const source = screen(`		<div className="bg-white p-4">
			<p className="text-gray-500">One</p>
			<p className="text-gray-500">Two</p>
			<p className={cn("hover:bg-zinc-100", active && "border-slate-200")}>Three</p>
		</div>`);

		const findings = sourceFindings("screens/home.tsx", source, NO_TOKENS);

		expect(findings.map((finding) => finding.message.split(" ")[0])).toEqual([
			"bg-white",
			"text-gray-500",
			"hover:bg-zinc-100",
			"border-slate-200",
		]);
		const [white, gray, hover] = findings;

		expect(white).toMatchObject({ rule: "raw-color", severity: "warning", path: "screens/home.tsx", line: 5 });
		expect(source.slice(white!.start!, white!.start! + 8)).toBe("bg-white");
		expect(gray!.message).toContain("(2×)");
		expect(gray!.message).toContain("text-muted-foreground");
		expect(hover!.message).toContain("hover:bg-muted");
	});

	test("reports arbitrary colors but not arbitrary sizes", () => {
		const source = screen(
			`		<div className="bg-[#123456] text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-[rgb(1,2,3)]" />`,
		);

		const findings = sourceFindings("screens/home.tsx", source, NO_TOKENS);

		expect(findings.map((finding) => finding.message.split(" ")[0])).toEqual(["bg-[#123456]", "text-[rgb(1,2,3)]"]);
	});

	test("ignores theme tokens, comments and JSX text", () => {
		const source = screen(`		// bg-gray-100 was too loud
		<div className="bg-background text-foreground border-border bg-primary/90 text-transparent">
			bg-black text in a sentence
		</div>`);

		expect(sourceFindings("screens/home.tsx", source, NO_TOKENS)).toEqual([]);
	});

	test("allows an accent and a status family, and reports a third once", () => {
		const two = screen(`		<div className="bg-blue-600 text-emerald-600 hover:bg-blue-700" />`);
		expect(sourceFindings("screens/home.tsx", two, NO_TOKENS)).toEqual([]);

		const three = screen(`		<div className="bg-blue-600 text-emerald-600">
			<span className="text-pink-500" />
			<span className="bg-violet-100 text-pink-600" />
		</div>`);

		const findings = sourceFindings("screens/home.tsx", three, NO_TOKENS);

		expect(findings).toHaveLength(1);
		expect(findings[0]!.message).toContain("4 palette color families (blue, emerald, pink, violet)");
		expect(three.slice(findings[0]!.start!).startsWith("text-pink-500")).toBe(true);
	});

	test("names the project's color tokens", () => {
		const tokens = { light: { "color-brand": "#ff5500", "radius-card": "12px" }, dark: {} };
		const [finding] = sourceFindings("screens/home.tsx", screen(`		<div className="bg-gray-900" />`), tokens);

		expect(finding!.message).toContain("bg-brand");
		expect(finding!.message).not.toContain("rounded-card");
	});

	test("an unparsable file has no findings", () => {
		expect(sourceFindings("screens/home.tsx", '<div className="bg-white"', NO_TOKENS)).toEqual([]);
	});
});

describe("withLines", () => {
	test("numbers findings from their file and keeps the rest", () => {
		const files = { "screens/a.tsx": "one\ntwo\nthree" };

		const findings = withLines(
			[
				{ rule: "overlap", severity: "warning", message: "a", path: "screens/a.tsx", start: 8 },
				{ rule: "overlap", severity: "warning", message: "b", path: "screens/missing.tsx", start: 3 },
				{ rule: "font-sizes", severity: "warning", message: "c" },
			],
			files,
		);

		expect(findings.map((finding) => finding.line)).toEqual([3, undefined, undefined]);
	});
});
