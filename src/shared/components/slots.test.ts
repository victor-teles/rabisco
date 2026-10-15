import { describe, expect, test } from "bun:test";
import { findElement, parseJsx } from "../jsx";
import { componentApi } from "./api";
import { clearSlot, componentSlots, slotCounts, slotFill, slotUsages } from "./slots";

const CARD = `import type { ReactNode } from "react";

type CardProps = { title: string; icon?: ReactNode; action: React.ReactNode; children?: ReactNode };

export function Card({ title, icon, action, children }: CardProps) {
	return <section>{icon}<h2>{title}</h2>{children}{action}</section>;
}
`;

const card = componentApi("components/card.tsx", CARD).exports[0]!;

const fillOf = (source: string, slot: string) => {
	const element = findElement(parseJsx(source), source.indexOf("<Card"));

	return slotFill(element!, slot);
};

describe("componentSlots", () => {
	test("children first, then the ReactNode props", () => {
		expect(componentSlots(card)).toEqual([
			{ name: "children", optional: true },
			{ name: "icon", optional: true },
			{ name: "action", optional: false },
		]);
	});

	test("a component without node props or children has none", () => {
		const api = componentApi(
			"components/badge.tsx",
			`export function Badge({ label }: { label: string }) { return <span>{label}</span>; }`,
		);

		expect(componentSlots(api.exports[0]!)).toEqual([]);
	});
});

describe("slotFill", () => {
	test("reads text, elements, code and empty children", () => {
		expect(fillOf(`<Card title="a" />`, "children")).toEqual({ kind: "empty" });
		expect(fillOf(`<Card title="a">  Hello {"there"}  </Card>`, "children")).toEqual({
			kind: "text",
			text: "Hello there",
		});
		expect(fillOf(`<Card title="a">{label}</Card>`, "children")).toEqual({ kind: "code", text: "label" });

		const source = `<Card title="a">\n\t<p>One</p>\n\t{open && <Badge />}\n</Card>`;

		expect(fillOf(source, "children")).toEqual({
			kind: "elements",
			elements: [
				{ name: "p", start: source.indexOf("<p>") },
				{ name: "Badge", start: source.indexOf("<Badge") },
			],
		});
	});

	test("reads a node prop", () => {
		expect(fillOf(`<Card title="a" />`, "icon")).toEqual({ kind: "empty" });
		expect(fillOf(`<Card title="a" icon="★" />`, "icon")).toEqual({ kind: "text", text: "★" });
		expect(fillOf(`<Card title="a" icon={"★"} />`, "icon")).toEqual({ kind: "text", text: "★" });
		expect(fillOf(`<Card title="a" icon={null} />`, "icon")).toEqual({ kind: "empty" });
		expect(fillOf(`<Card title="a" icon={star} />`, "icon")).toEqual({ kind: "code", text: "star" });

		const source = `<Card title="a" icon={<Star />} />`;

		expect(fillOf(source, "icon")).toEqual({
			kind: "elements",
			elements: [{ name: "Star", start: source.indexOf("<Star") }],
		});
	});
});

describe("slotUsages", () => {
	const files = {
		"components/card.tsx": CARD,
		"screens/home.tsx": `import { Card } from "../components/card";
import { Star } from "lucide-react";

export default function Home() {
	return (
		<main>
			<Card title="One" icon={<Star />} action="Open">Body</Card>
			<Card title="Two" action={<button>Go</button>} />
		</main>
	);
}
`,
		"screens/other.tsx": `export default function Other() { return <Card title="Not imported" />; }`,
	};

	test("lists imported usages with each slot's fill", () => {
		const usages = slotUsages(files, "components/card.tsx", card);

		expect(usages.map((usage) => [usage.path, usage.line])).toEqual([
			["screens/home.tsx", 7],
			["screens/home.tsx", 8],
		]);
		expect(usages[0]!.fills.children).toEqual({ kind: "text", text: "Body" });
		expect(usages[1]!.fills.children).toEqual({ kind: "empty" });
		expect(usages[1]!.fills.action?.kind).toBe("elements");
	});

	test("counts usages by fill", () => {
		const usages = slotUsages(files, "components/card.tsx", card);

		expect(slotCounts(usages, "action")).toEqual({ empty: 0, text: 1, elements: 1, code: 0 });
		expect(slotCounts(usages, "icon")).toEqual({ empty: 1, text: 0, elements: 1, code: 0 });
	});
});

describe("clearSlot", () => {
	test("self-closes the tag and drops imports only the children used", () => {
		const source = `import { Badge } from "./badge";

export default () => <Card title="a">
	<Badge />
</Card>;
`;

		expect(clearSlot(source, source.indexOf("<Card"), "children")).toBe(`
export default () => <Card title="a" />;
`);
	});

	test("removes a node prop and keeps imports used elsewhere", () => {
		const source = `import { Star } from "lucide-react";

export default () => <div><Star /><Card title="a" icon={<Star />} /></div>;
`;

		expect(clearSlot(source, source.indexOf("<Card"), "icon")).toBe(`import { Star } from "lucide-react";

export default () => <div><Star /><Card title="a" /></div>;
`);
	});

	test("an empty slot stays as it is", () => {
		const source = `<Card title="a" />`;

		expect(clearSlot(source, 0, "children")).toBe(source);
		expect(clearSlot(source, 0, "icon")).toBe(source);
	});
});
