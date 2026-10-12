import { diffFiles, type Snapshot } from "@/lib/history";
import type { GitCheckpoint } from "../../shared/git";
import { appliedTheme } from "../../shared/project";
import { isAlternate } from "../../shared/variations";
import type { CanvasDoc, Frame, ProjectFiles } from "../../shared/types";

export type VersionKind = "checkpoint" | "ai";

export type SessionVersion = {
	id: string;
	kind: VersionKind;
	label: string;
	at: string;
	snapshot: Snapshot;
	changed: string[];
};

export type Version =
	| (SessionVersion & { source: "session" })
	| { id: string; kind: "checkpoint"; label: string; at: string; source: "git"; hash: string; short: string };

const LABEL_LIMIT = 80;

export const SESSION_VERSION_LIMIT = 50;

export function defaultCheckpointName(date: Date): string {
	const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
	const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);

	return `${day}, ${time}`;
}

export function versionLabel(prompt: string): string {
	const line = prompt.trim().split("\n")[0]?.trim() ?? "";

	if (!line) return "AI change";

	return line.length > LABEL_LIMIT ? `${line.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : line;
}

export function aiVersion(id: string, prompt: string, snapshot: Snapshot, changed: string[], at: Date): SessionVersion {
	return { id, kind: "ai", label: versionLabel(prompt), at: at.toISOString(), snapshot, changed };
}

export function checkpointVersion(name: string, snapshot: Snapshot, at: Date): SessionVersion {
	return { id: crypto.randomUUID(), kind: "checkpoint", label: name, at: at.toISOString(), snapshot, changed: [] };
}

export function withVersion(versions: SessionVersion[], version: SessionVersion): SessionVersion[] {
	const kept = versions.filter((entry) => entry.id !== version.id);

	kept.push(version);

	return kept.length > SESSION_VERSION_LIMIT ? kept.slice(kept.length - SESSION_VERSION_LIMIT) : kept;
}

export function listVersions(session: SessionVersion[], checkpoints: GitCheckpoint[]): Version[] {
	const versions: Version[] = [];

	for (const version of session) versions.push({ ...version, source: "session" });

	for (const checkpoint of checkpoints) {
		versions.push({
			id: checkpoint.hash,
			kind: "checkpoint",
			label: checkpoint.name,
			at: checkpoint.date,
			source: "git",
			hash: checkpoint.hash,
			short: checkpoint.short,
		});
	}

	return versions.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function versionSnapshot(canvas: CanvasDoc, files: ProjectFiles): Snapshot {
	return {
		frames: canvas.frames,
		files,
		theme: appliedTheme(canvas, files),
		locks: canvas.locks ?? [],
		sections: canvas.sections ?? [],
		images: canvas.images ?? [],
	};
}

export function restoredSnapshot(present: Snapshot, version: Snapshot): Snapshot {
	return {
		...present,
		frames: version.frames,
		files: version.files,
		theme: version.theme ?? present.theme,
		locks: version.locks ?? [],
		sections: version.sections ?? [],
		images: version.images ?? [],
		assets: present.assets && version.assets ? { ...present.assets, ...version.assets } : present.assets,
	};
}

const sameFrames = (a: Frame[], b: Frame[]) =>
	a.length === b.length &&
	a.every((frame, index) => {
		const other = b[index]!;

		return (
			frame.file === other.file &&
			frame.x === other.x &&
			frame.y === other.y &&
			frame.width === other.width &&
			frame.height === other.height
		);
	});

export const isCurrentVersion = (present: Snapshot, version: Snapshot) =>
	diffFiles(present.files, version.files).length === 0 && sameFrames(present.frames, version.frames);

export function previewFrames(snapshot: Snapshot): Frame[] {
	return snapshot.frames.filter((frame) => frame.file in snapshot.files && !isAlternate(frame.file));
}
