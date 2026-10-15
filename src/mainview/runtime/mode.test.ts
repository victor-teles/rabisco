import { expect, test } from "bun:test";
import { applyMode } from "./mode";

function fakeRoot() {
	const classes = new Set<string>();
	const attributes = new Map<string, string>([["lang", "en"]]);

	return {
		classes,
		attributes,
		root: {
			classList: {
				toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name), force),
			},
			get attributes() {
				return [...attributes.keys()].map((name) => ({ name }));
			},
			setAttribute: (name: string, value: string) => void attributes.set(name, value),
			removeAttribute: (name: string) => void attributes.delete(name),
		},
	};
}

test("scheme is the .dark class and other groups are data-mode attributes", () => {
	const { root, classes, attributes } = fakeRoot();
	applyMode(root, { scheme: "dark", brand: "acme" });
	expect([...classes]).toEqual(["dark"]);
	expect(attributes.get("data-mode-brand")).toBe("acme");

	applyMode(root, { scheme: "light" });
	expect([...classes]).toEqual([]);
	expect([...attributes.keys()]).toEqual(["lang"]);
});

test("names that aren't slugs never become attributes", () => {
	const { root, attributes } = fakeRoot();
	applyMode(root, { scheme: "light", "on click": "x", brand: "A B" });
	expect([...attributes.keys()]).toEqual(["lang"]);
});
