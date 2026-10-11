import type { AppliedTheme } from "./context/theme";
import type { CanvasComment, CanvasSection, Device, ElementLock, Frame } from "./types";

export type SavedSnapshot = {
	frames: Frame[];
	files: Record<string, number>;
	comments: CanvasComment[];
	theme?: AppliedTheme;
	name: string;
	device: Device;
	locks: ElementLock[];
	sections: CanvasSection[];
};

export type SavedVersionKind = "checkpoint" | "ai";

export type SavedVersion = {
	id: string;
	kind: SavedVersionKind;
	label: string;
	at: string;
	changed: string[];
	snapshot: SavedSnapshot;
};

export type SavedHistory = {
	version: 1;
	savedAt: string;
	contents: string[];
	past: SavedSnapshot[];
	present: SavedSnapshot;
	future: SavedSnapshot[];
	versions: SavedVersion[];
};

export type BackupReason = "migration" | "reload";
