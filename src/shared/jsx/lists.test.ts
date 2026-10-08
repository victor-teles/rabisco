import { describe, expect, test } from "bun:test";
import { mappedEntries, moveMappedEntry } from "./lists";

const NAV = `import { Home, User } from "lucide-react";

const navItems: { id: string; label: string }[] = [
	{ id: "home", label: "Home", icon: <Home /> },
	{ id: "shop", label: "Shop", icon: null },
	{ id: "account", label: "Account", icon: <User /> },
];

export default function Nav() {
	return (
		<nav className="flex">
			{navItems.map((item) => (
				<button key={item.id}>{item.label}</button>
			))}
		</nav>
	);
}
`;

const at = (source: string, needle: string) => {
	const index = source.indexOf(needle);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

const labels = (source: string) => [...source.matchAll(/label: "(\w+)"/g)].map((match) => match[1]);

describe("mappedEntries", () => {
	test("finds the entries of the array a .map renders from", () => {
		const entries = mappedEntries(NAV, at(NAV, "<button"))!;

		expect(entries.map((entry) => NAV.slice(entry.start, entry.end))).toEqual([
			`{ id: "home", label: "Home", icon: <Home /> }`,
			`{ id: "shop", label: "Shop", icon: null }`,
			`{ id: "account", label: "Account", icon: <User /> }`,
		]);
	});

	test("reads an inline array", () => {
		const source = `const A = () => <ul>{["a", "b", \`c\${1}\`].map((x) => <li key={x}>{x}</li>)}</ul>;`;

		expect(mappedEntries(source, at(source, "<li"))?.length).toBe(3);
	});

	test("refuses what doesn't render one item per entry", () => {
		const filtered = NAV.replace("navItems.map", "navItems.filter(Boolean).map");
		const spread = NAV.replace("= [\n", "= [\n\t...more,\n");
		const reassignable = NAV.replace("const navItems", "let navItems");
		const shadowed = NAV.replace("function Nav()", "function Nav({ navItems })");

		expect(mappedEntries(filtered, at(filtered, "<button"))).toBeNull();
		expect(mappedEntries(spread, at(spread, "<button"))).toBeNull();
		expect(mappedEntries(reassignable, at(reassignable, "<button"))).toBeNull();
		expect(mappedEntries(shadowed, at(shadowed, "<button"))).toBeNull();
		expect(mappedEntries(NAV, at(NAV, "<nav"))).toBeNull();
	});
});

describe("moveMappedEntry", () => {
	test("moves an entry forward and back, keeping the element's offset", () => {
		const start = at(NAV, "<button");
		const forward = moveMappedEntry(NAV, start, 0, 2)!;

		expect(labels(forward)).toEqual(["Shop", "Account", "Home"]);
		expect(forward.indexOf("<button")).toBe(start);
		expect(labels(moveMappedEntry(NAV, start, 2, 0)!)).toEqual(["Account", "Home", "Shop"]);
	});

	test("refuses a move to the same place or out of range", () => {
		const start = at(NAV, "<button");

		expect(moveMappedEntry(NAV, start, 1, 1)).toBeNull();
		expect(moveMappedEntry(NAV, start, 0, 3)).toBeNull();
	});
});
