import { describe, expect, test } from "bun:test";
import { normalizeLocks } from "../../shared/locks";
import {
	isElementLocked,
	isLocked,
	lockedStarts,
	lockOf,
	remapLocks,
	toggleLocks,
	unlockedStarts,
} from "./element-locks";

const FILE = "screens/home.tsx";

const SOURCE = `export default function Home() {
	return (
		<main className="p-4">
			<header className="flex">
				<h1>Title</h1>
			</header>
			<Card>
				<p>Body</p>
			</Card>
		</main>
	);
}
`;

const at = (source: string, text: string) => source.indexOf(text);

describe("lockOf", () => {
	test("names the element by its tree path and tag", () => {
		expect(lockOf(FILE, SOURCE, at(SOURCE, "<Card"))).toEqual({ file: FILE, path: [0, 1], name: "Card" });
		expect(lockOf(FILE, SOURCE, at(SOURCE, "<h1"))).toEqual({ file: FILE, path: [0, 0, 0], name: "h1" });
		expect(lockOf(FILE, SOURCE, 2)).toBeNull();
	});
});

describe("lockedStarts and isLocked", () => {
	const locks = [lockOf(FILE, SOURCE, at(SOURCE, "<header"))!];
	const locked = lockedStarts(locks, FILE, SOURCE);

	test("resolve in their own file only", () => {
		expect(locked).toEqual([at(SOURCE, "<header")]);
		expect(lockedStarts(locks, "screens/other.tsx", SOURCE)).toEqual([]);
	});

	test("lock the element and everything inside it", () => {
		expect(isLocked(SOURCE, locked, at(SOURCE, "<header"))).toBe(true);
		expect(isLocked(SOURCE, locked, at(SOURCE, "<h1"))).toBe(true);
		expect(isLocked(SOURCE, locked, at(SOURCE, "<main"))).toBe(false);
		expect(isLocked(SOURCE, locked, at(SOURCE, "<Card"))).toBe(false);
	});

	test("a click on a locked element reaches its unlocked ancestors", () => {
		const hit = [at(SOURCE, "<h1"), at(SOURCE, "<header"), at(SOURCE, "<main")];
		expect(unlockedStarts(SOURCE, locked, hit)).toEqual([at(SOURCE, "<main")]);
	});

	test("a lock whose tag no longer matches is ignored", () => {
		expect(lockedStarts([{ file: FILE, path: [0, 0], name: "nav" }], FILE, SOURCE)).toEqual([]);
	});
});

describe("toggleLocks", () => {
	const header = at(SOURCE, "<header");
	const card = at(SOURCE, "<Card");

	test("locks every element unless all are locked, then unlocks them", () => {
		const one = toggleLocks([], FILE, SOURCE, [header]);
		expect(one).toEqual([{ file: FILE, path: [0, 0], name: "header" }]);
		const both = toggleLocks(one, FILE, SOURCE, [header, card]);
		expect(both).toHaveLength(2);
		expect(toggleLocks(both, FILE, SOURCE, [card, header])).toEqual([]);
	});
});

describe("remapLocks", () => {
	const locks = [lockOf(FILE, SOURCE, at(SOURCE, "<Card"))!];

	test("follows the element when a sibling is added before it", () => {
		const next = SOURCE.replace("\t\t\t<header", "\t\t\t<nav />\n\t\t\t<header");
		expect(remapLocks(locks, { [FILE]: SOURCE }, { [FILE]: next })).toEqual([
			{ file: FILE, path: [0, 2], name: "Card" },
		]);
	});

	test("keeps the same array when the element stays put", () => {
		const next = SOURCE.replace("Title", "Welcome back");
		expect(remapLocks(locks, { [FILE]: SOURCE }, { [FILE]: next })).toBe(locks);
	});

	test("drops the lock with its element or its file", () => {
		const next = SOURCE.replace(/\t\t\t<Card>[\s\S]*<\/Card>\n/, "");
		expect(remapLocks(locks, { [FILE]: SOURCE }, { [FILE]: next })).toEqual([]);
		expect(remapLocks(locks, { [FILE]: SOURCE }, {})).toEqual([]);
	});

	test("keeps the lock while the source doesn't parse", () => {
		expect(remapLocks(locks, { [FILE]: SOURCE }, { [FILE]: `${SOURCE}<div` })).toBe(locks);
	});
});

describe("normalizeLocks", () => {
	test("drops malformed and repeated entries", () => {
		const raw = [
			{ file: FILE, path: [0, 1], name: "Card" },
			{ file: FILE, path: [0, 1], name: "Card" },
			{ file: FILE, path: [], name: "div" },
			{ file: FILE, path: [0, -1], name: "div" },
			{ file: FILE, path: [0], name: 3 },
			"x",
		];

		expect(normalizeLocks(raw)).toEqual([{ file: FILE, path: [0, 1], name: "Card" }]);
		expect(normalizeLocks(undefined)).toEqual([]);
	});
});

describe("isElementLocked", () => {
	test("checks the element and its ancestors against the file's locks", () => {
		const locks = [lockOf(FILE, SOURCE, at(SOURCE, "<header"))!];
		expect(isElementLocked(locks, FILE, SOURCE, at(SOURCE, "<h1"))).toBe(true);
		expect(isElementLocked(locks, FILE, SOURCE, at(SOURCE, "<Card"))).toBe(false);
		expect(isElementLocked(locks, FILE, undefined, at(SOURCE, "<h1"))).toBe(false);
		expect(isElementLocked(undefined, FILE, SOURCE, at(SOURCE, "<h1"))).toBe(false);
	});
});
