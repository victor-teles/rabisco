import { watch, type FSWatcher } from "fs";
import { join } from "path";
import { isProjectFile } from "../shared/project";
import type { FileChange, ProjectFiles } from "../shared/types";
import { readFileIfExists, readProjectFiles } from "./project-folder";

type Options = {
	debounceMs?: number;
	/** Used only when recursive `fs.watch` is unavailable */
	pollMs?: number;
	/** Force polling (tests) */
	poll?: boolean;
};

/**
 * Watches a project folder and reports screen, component and context files
 * whose content on disk differs from the last known content. Rabisco's own
 * writes go through `noteWrite` first, so they are never echoed back.
 */
export class ProjectWatcher {
	private known = new Map<string, string>();
	private pending = new Set<string>();
	private rescan = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private watcher: FSWatcher | null = null;
	private poller: ReturnType<typeof setInterval> | null = null;
	private readonly debounceMs: number;

	constructor(
		readonly dir: string,
		files: ProjectFiles,
		private readonly onChange: (changes: FileChange[]) => void,
		options: Options = {},
	) {
		this.debounceMs = options.debounceMs ?? 50;
		this.reset(files);

		if (!options.poll) {
			try {
				this.watcher = watch(dir, { recursive: true }, (_event, name) => this.onEvent(name ? String(name) : null));
				this.watcher.on?.("error", () => this.startPolling(options.pollMs));

				return;
			} catch (error) {
				console.warn(`fs.watch unavailable for ${dir}, polling instead:`, error);
			}
		}

		this.startPolling(options.pollMs);
	}

	/** Replaces the known contents, e.g. after the project was read again. */
	reset(files: ProjectFiles) {
		this.known = new Map(Object.entries(files));
	}

	/** Records a write made by Rabisco so the resulting file event is ignored. */
	noteWrite(path: string, content: string | null) {
		if (content === null) this.known.delete(path);
		else this.known.set(path, content);
	}

	close() {
		if (this.timer) clearTimeout(this.timer);

		if (this.poller) clearInterval(this.poller);
		this.watcher?.close();
		this.timer = this.poller = null;
		this.watcher = null;
	}

	private startPolling(pollMs = 500) {
		this.watcher?.close();
		this.watcher = null;

		if (this.poller) return;
		this.poller = setInterval(() => {
			this.rescan = true;
			this.flush();
		}, pollMs);
	}

	private onEvent(name: string | null) {
		const path = name?.replace(/\\/g, "/");

		if (path && isProjectFile(path)) this.pending.add(path);
		// A null name, or a whole folder moved or deleted: compare everything
		else if (!path || path === "screens" || path === "components") this.rescan = true;
		else return;

		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
	}

	/** Compares pending paths with disk and emits what really changed. */
	flush() {
		this.timer = null;
		const paths = new Set(this.pending);
		this.pending.clear();

		if (this.rescan) {
			this.rescan = false;

			for (const path of this.known.keys()) paths.add(path);

			for (const path of Object.keys(readProjectFiles(this.dir))) paths.add(path);
		}

		const changes: FileChange[] = [];

		for (const path of [...paths].sort()) {
			const content = readFileIfExists(join(this.dir, path));

			if (content === (this.known.get(path) ?? null)) continue;
			this.noteWrite(path, content);
			changes.push({ path, content });
		}

		if (changes.length) this.onChange(changes);
	}
}
