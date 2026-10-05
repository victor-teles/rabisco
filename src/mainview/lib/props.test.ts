import { describe, expect, test } from "bun:test";
import { findElement, parseJsx } from "../../shared/jsx";
import type { ComponentExport, PropSpec } from "../../shared/components/api";
import {
	componentSpec,
	controlKind,
	extraAttributes,
	isVoidElement,
	readChildrenText,
	readProp,
	setChildrenText,
	writeProp,
} from "./props";

const SOURCE = `export default function A() {
	return (
		<div>
			<Card title="Hello" count={3} open tone={"warm"} on={false} onClick={() => go()} className="p-4" />
			<Button variant="outline">
				Save changes
			</Button>
			<Badge>{"New"}</Badge>
			<Row><span /></Row>
		</div>
	);
}
`;

const at = (source: string, needle: string) => {
	const start = source.indexOf(needle);

	return { start, element: findElement(parseJsx(source), start)! };
};

const spec = (name: string, type: PropSpec["type"], rest: Partial<PropSpec> = {}): PropSpec => ({
	name,
	type,
	optional: true,
	...rest,
});

describe("readProp", () => {
	const { element } = at(SOURCE, "<Card");
	test("reads literals in every form", () => {
		expect(readProp(element, "title")).toEqual({ kind: "literal", value: "Hello" });
		expect(readProp(element, "count")).toEqual({ kind: "literal", value: 3 });
		expect(readProp(element, "open")).toEqual({ kind: "literal", value: true });
		expect(readProp(element, "tone")).toEqual({ kind: "literal", value: "warm" });
		expect(readProp(element, "on")).toEqual({ kind: "literal", value: false });
	});
	test("code is an expression, a missing prop is unset", () => {
		expect(readProp(element, "onClick")).toEqual({ kind: "expression", text: "() => go()" });
		expect(readProp(element, "size")).toEqual({ kind: "unset" });
	});
});

describe("readChildrenText", () => {
	test("joins text and string literals, null with elements", () => {
		expect(readChildrenText(at(SOURCE, "<Button").element)).toBe("Save changes");
		expect(readChildrenText(at(SOURCE, "<Badge").element)).toBe("New");
		expect(readChildrenText(at(SOURCE, "<Row").element)).toBeNull();
		expect(readChildrenText(at(SOURCE, "<Card").element)).toBe("");
	});
});

describe("controlKind", () => {
	test("maps types to controls, code to read-only", () => {
		expect(controlKind({ kind: "enum", options: ["a"] }, { kind: "unset" })).toBe("enum");
		expect(controlKind({ kind: "node" }, { kind: "literal", value: "x" })).toBe("string");
		expect(controlKind({ kind: "string" }, { kind: "expression", text: "x" })).toBe("readonly");
		expect(controlKind({ kind: "function", text: "() => void" }, { kind: "unset" })).toBe("readonly");
		expect(controlKind({ kind: "other", text: "any" }, { kind: "literal", value: 2 })).toBe("number");
	});
});

describe("extraAttributes", () => {
	test("lists written attributes the API doesn't declare", () => {
		const exp: ComponentExport = {
			name: "Card",
			props: [spec("title", { kind: "string" }), spec("count", { kind: "number" })],
			variants: {},
			acceptsChildren: false,
		};

		expect(extraAttributes(at(SOURCE, "<Card").element, exp)).toEqual(["open", "tone", "on", "onClick", "className"]);
	});
});

describe("writeProp", () => {
	const { start } = at(SOURCE, "<Card");

	const card = (source: string) =>
		source.slice(source.indexOf("<Card"), source.indexOf("/>", source.indexOf("<Card")) + 2);

	test("replaces and adds attributes", () => {
		expect(card(writeProp(SOURCE, start, "title", "Hi there")!)).toContain('title="Hi there"');
		expect(card(writeProp(SOURCE, start, "count", 7)!)).toContain("count={7}");
		expect(card(writeProp(SOURCE, start, "size", "lg")!)).toContain('className="p-4" size="lg" />');
	});

	test("the default value removes the attribute", () => {
		const out = writeProp(
			SOURCE,
			start,
			"tone",
			"warm",
			spec("tone", { kind: "enum", options: ["warm", "cool"] }, { default: "warm" }),
		)!;

		expect(card(out)).not.toContain("tone");
	});

	test("booleans: true is bare, false removes unless the default is true", () => {
		expect(card(writeProp(SOURCE, start, "open", false, spec("open", { kind: "boolean" }))!)).not.toContain(" open");
		expect(
			card(writeProp(SOURCE, start, "open", false, spec("open", { kind: "boolean" }, { default: true }))!),
		).toContain("open={false}");
		expect(card(writeProp(SOURCE, start, "on", true, spec("on", { kind: "boolean" }))!)).toContain(" on ");
	});

	test("null removes, a gone element is null", () => {
		expect(card(writeProp(SOURCE, start, "className", null)!)).not.toContain("className");
		expect(writeProp(SOURCE, start + 1, "title", "x")).toBeNull();
	});
});

describe("setChildrenText", () => {
	test("keeps the line layout of the children", () => {
		const { start } = at(SOURCE, "<Button");
		expect(setChildrenText(SOURCE, start, "Publish")).toContain(
			'<Button variant="outline">\n\t\t\t\tPublish\n\t\t\t</Button>',
		);
	});
	test("escapes text JSX can't hold and replaces string literals", () => {
		const { start } = at(SOURCE, "<Badge");
		expect(setChildrenText(SOURCE, start, "a {b}")).toContain('<Badge>{"a {b}"}</Badge>');
		expect(setChildrenText(SOURCE, start, "")).toContain("<Badge></Badge>");
	});
	test("opens a self-closing element", () => {
		const { start } = at(SOURCE, "<Card");
		expect(setChildrenText(SOURCE, start, "Body")).toContain('className="p-4">Body</Card>');
	});
	test("refuses children with elements", () => {
		expect(setChildrenText(SOURCE, at(SOURCE, "<Row").start, "x")).toBeNull();
	});
	test("refuses void elements, which React can't give children", () => {
		const source = `export default function A() {\n\treturn <form><input placeholder="Email" /><img src="a.png" /><br /><label /></form>;\n}\n`;

		for (const tag of ["<input", "<img", "<br"]) {
			const { start, element } = at(source, tag);
			expect(isVoidElement(element)).toBe(true);
			expect(setChildrenText(source, start, "abc")).toBeNull();
		}

		const label = at(source, "<label");
		expect(isVoidElement(label.element)).toBe(false);
		expect(setChildrenText(source, label.start, "Email")).toContain("<label>Email</label>");
	});
	test("a component named like a void tag is not void", () => {
		const source = `export default function A() {\n\treturn <Input />;\n}\n`;
		expect(isVoidElement(at(source, "<Input").element)).toBe(false);
	});
});

describe("componentSpec", () => {
	const files = {
		"components/stat-card.tsx": `export function StatCard({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" }) { return <div>{label}</div>; }`,
	};

	const ui = {
		badge: `import { cva, type VariantProps } from "class-variance-authority";\nconst badgeVariants = cva("", { variants: { variant: { default: "", outline: "" } }, defaultVariants: { variant: "default" } });\nfunction Badge({ variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) { return <span {...props} />; }\nexport { Badge, badgeVariants };`,
	};

	test("reads project and shadcn component APIs", () => {
		const project = componentSpec(
			{ source: "project", path: "components/stat-card.tsx", exportName: "StatCard" },
			files,
			ui,
		)!;

		expect(project.props.map((p) => [p.name, p.default])).toEqual([
			["label", undefined],
			["tone", "neutral"],
		]);
		const badge = componentSpec({ source: "ui", module: "badge", exportName: "Badge" }, files, ui)!;
		expect(badge.props.find((p) => p.name === "variant")?.type).toEqual({
			kind: "enum",
			options: ["default", "outline"],
		});
		expect(componentSpec({ source: "other", module: "lucide-react", exportName: "Star" }, files, ui)).toBeNull();
		expect(componentSpec({ source: "project", path: "components/missing.tsx", exportName: "X" }, files, ui)).toBeNull();
	});
});
