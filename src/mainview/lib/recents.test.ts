import { describe, expect, test } from "bun:test";
import type { ProjectSummary } from "../../shared/types";
import { arrangeRecents, isRecentsSort } from "./recents";

const project = (name: string, updatedAt: string, path = `/designs/${name}`): ProjectSummary => ({
	path,
	name,
	device: "mobile",
	updatedAt,
	screenCount: 1,
	cover: null,
	missing: false,
});

// Most recently opened first, as the main process sends them
const projects = [
	project("Habit tracker", "2026-10-01T10:00:00.000Z"),
	project("Café menu", "2026-10-05T10:00:00.000Z"),
	project("Screen 10", "2026-09-01T10:00:00.000Z"),
	project("Screen 2", "2026-09-02T10:00:00.000Z", "/work/fintech"),
];

const names = (list: ProjectSummary[]) => list.map((p) => p.name);

describe("arrangeRecents", () => {
	test("last opened keeps the order it came in", () => {
		expect(names(arrangeRecents(projects, "", "opened"))).toEqual(names(projects));
	});

	test("last edited sorts by update time, newest first", () => {
		expect(names(arrangeRecents(projects, "", "edited"))).toEqual([
			"Café menu",
			"Habit tracker",
			"Screen 2",
			"Screen 10",
		]);
	});

	test("name sorts numbers naturally", () => {
		expect(names(arrangeRecents(projects, "", "name"))).toEqual([
			"Café menu",
			"Habit tracker",
			"Screen 2",
			"Screen 10",
		]);
	});

	test("search ignores case and accents, and matches the path", () => {
		expect(names(arrangeRecents(projects, "CAFE", "opened"))).toEqual(["Café menu"]);
		expect(names(arrangeRecents(projects, "fintech", "opened"))).toEqual(["Screen 2"]);
		expect(names(arrangeRecents(projects, "screen 1", "name"))).toEqual(["Screen 10"]);
	});

	test("does not change the list it was given", () => {
		const copy = [...projects];
		arrangeRecents(projects, "", "name");
		expect(projects).toEqual(copy);
	});
});

test("isRecentsSort", () => {
	expect(isRecentsSort("name")).toBe(true);
	expect(isRecentsSort("size")).toBe(false);
	expect(isRecentsSort(null)).toBe(false);
});
