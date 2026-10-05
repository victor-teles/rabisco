import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { projectNameFromPath, reconcileFrames, summarizeProject } from "../shared/project";
import type { ProjectSummary } from "../shared/types";
import { isDirectory, readCanvas, readProjectFiles } from "./project-folder";

export type RecentEntry = { path: string; openedAt: string };

export function readRecents(file: string): RecentEntry[] {
	try {
		const list = JSON.parse(readFileSync(file, "utf-8"));

		if (!Array.isArray(list)) return [];

		return list.filter((e): e is RecentEntry => !!e && typeof e.path === "string" && typeof e.openedAt === "string");
	} catch {
		return [];
	}
}

export function writeRecents(file: string, list: RecentEntry[]) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(list, null, "\t")}\n`);
}

/** Moves `path` to the front (or adds it), most recent first. */
export function touchRecent(list: RecentEntry[], path: string, openedAt = new Date().toISOString()): RecentEntry[] {
	return sortRecents([{ path, openedAt }, ...list.filter((e) => e.path !== path)]);
}

export const forgetRecent = (list: RecentEntry[], path: string) => list.filter((e) => e.path !== path);

export const sortRecents = (list: RecentEntry[]) => [...list].sort((a, b) => b.openedAt.localeCompare(a.openedAt));

export function missingSummary(entry: RecentEntry): ProjectSummary {
	return {
		path: entry.path,
		name: projectNameFromPath(entry.path),
		device: "mobile",
		updatedAt: entry.openedAt,
		screenCount: 0,
		cover: null,
		missing: true,
	};
}

/** Card data for one recent folder. Reads without writing, so listing never touches projects. */
export function summarizeFolder(entry: RecentEntry): ProjectSummary {
	const missing = missingSummary(entry);

	if (!isDirectory(entry.path)) return missing;
	const files = readProjectFiles(entry.path);
	let canvas;

	try {
		canvas = readCanvas(entry.path);
	} catch {
		canvas = null;
	}

	if (!canvas) {
		const screenCount = Object.keys(files).filter((f) => f.startsWith("screens/")).length;

		return { ...missing, screenCount, missing: false };
	}

	return summarizeProject(entry.path, reconcileFrames(canvas, files), files);
}
