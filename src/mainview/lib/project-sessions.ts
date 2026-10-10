import {
	createGenerationController,
	type ControllerEnv,
	type GenerationApi,
	type GenerationController,
	type Outcome,
} from "@/lib/generation-session";
import { createProjectSession, type ProjectApi, type ProjectSession } from "@/lib/project-session";
import type { AssetsChanged, FilesChanged, RabiscoApi } from "@/lib/rpc";
import type { GenerationEventMessage } from "../../shared/types";

export type Hold = "editor" | "work" | "unseen";

export type Activity = "generating" | "plan" | "ready" | "failed" | null;

export type Landed = { path: string; name: string; outcome: Outcome };

export type SessionsApi = ProjectApi & GenerationApi & Pick<RabiscoApi, "closeProject">;

type Subscribe<T> = (listener: (value: T) => void) => () => void;

export type SessionsOptions = {
	api: SessionsApi;
	onFilesChanged: Subscribe<FilesChanged>;
	onAssetsChanged: Subscribe<AssetsChanged>;
	onGenerationEvent: Subscribe<GenerationEventMessage>;
	onSaveError: (cause: unknown) => void;
	generation: Pick<ControllerEnv, "schedule" | "check" | "watchRenderErrors" | "polishMode" | "planMode">;
	unseenLimit?: number;
	writeDelay?: number;
	saveDelay?: number;
};

export type ProjectEntry = { session: ProjectSession; controller: GenerationController };

type Entry = ProjectEntry & {
	holds: Set<Hold>;
	unseen: "ready" | "failed" | null;
	unseenAt: number;
	opened: boolean;
};

const UNSEEN_LIMIT = 4;

export type ProjectSessions = ReturnType<typeof createProjectSessions>;

export function createProjectSessions(options: SessionsOptions) {
	const { api, unseenLimit = UNSEEN_LIMIT } = options;
	const entries = new Map<string, Entry>();
	const routes = new Map<string, (message: GenerationEventMessage) => void>();
	const listeners = new Set<() => void>();
	const landedListeners = new Set<(landed: Landed) => void>();
	let unseenOrder = 0;

	options.onGenerationEvent((message) => routes.get(message.generationId)?.(message));
	options.onFilesChanged((message) => entries.get(message.path)?.session.filesChanged(message.changes));
	options.onAssetsChanged((message) => entries.get(message.path)?.session.assetsChanged(message.changes));

	const notify = () => {
		for (const listener of listeners) listener();
	};

	const isLive = (entry: Entry) => entries.get(entry.session.path) === entry;

	async function flushAll() {
		await Promise.all([...entries.values()].map((entry) => entry.session.flushFiles()));
	}

	const route = (generationId: string, listener: (message: GenerationEventMessage) => void) => {
		routes.set(generationId, listener);

		return () => void routes.delete(generationId);
	};

	function release(entry: Entry) {
		if (entry.holds.size || !isLive(entry)) return;

		void entry.session.flushCanvas().then(() => {
			if (entry.holds.size || !isLive(entry)) return;
			entries.delete(entry.session.path);
			entry.controller.dispose();
			entry.session.close();

			if (entry.opened) api.closeProject({ path: entry.session.path }).catch(() => {});
			notify();
		});
	}

	function evict() {
		const idle = [...entries.values()]
			.filter((entry) => entry.holds.size === 1 && entry.holds.has("unseen"))
			.sort((a, b) => a.unseenAt - b.unseenAt);

		for (const entry of idle.slice(0, Math.max(0, idle.length - unseenLimit))) {
			entry.unseen = null;
			entry.holds.delete("unseen");
			release(entry);
		}
	}

	function sync(entry: Entry) {
		if (!isLive(entry)) return;

		if (entry.controller.working()) entry.holds.add("work");
		else if (entry.holds.delete("work")) release(entry);
		notify();
	}

	function settled(entry: Entry, outcome: Outcome | null) {
		if (!outcome || !isLive(entry) || entry.holds.has("editor")) return;

		if (outcome !== "plan") {
			entry.unseen = outcome;
			entry.unseenAt = ++unseenOrder;
			entry.holds.add("unseen");
			evict();
		}

		const landed = { path: entry.session.path, name: entry.session.state()?.canvas.name ?? "Untitled design", outcome };

		for (const listener of landedListeners) listener(landed);
		notify();
	}

	function entryOf(path: string): Entry {
		const existing = entries.get(path);

		if (existing) return existing;

		const session = createProjectSession({
			path,
			api,
			onSaveError: options.onSaveError,
			writeDelay: options.writeDelay,
			saveDelay: options.saveDelay,
		});

		const controller = createGenerationController(session, {
			...options.generation,
			api,
			flushFiles: flushAll,
			route,
			onSettled: (outcome) => settled(entry, outcome),
		});

		const entry: Entry = { session, controller, holds: new Set(), unseen: null, unseenAt: 0, opened: false };
		entries.set(path, entry);
		controller.subscribe(() => sync(entry));

		return entry;
	}

	function attach(path: string) {
		const entry = entryOf(path);
		entry.holds.add("editor");
		entry.holds.delete("unseen");
		entry.unseen = null;

		if (!entry.opened) {
			entry.opened = true;
			void entry.session.load();
		}

		notify();

		return () => {
			entry.holds.delete("editor");

			if (entry.holds.size) void entry.session.flushCanvas();
			else release(entry);
			notify();
		};
	}

	function activity(path: string): Activity {
		const entry = entries.get(path);

		if (!entry) return null;

		if (entry.controller.get().pendingPlan && !entry.controller.busy()) return "plan";

		if (entry.controller.working()) return "generating";

		return entry.unseen;
	}

	async function discard(path: string) {
		const entry = entries.get(path);

		if (!entry) return;
		entries.delete(path);
		entry.controller.dispose();
		entry.session.close();

		if (entry.opened) await api.closeProject({ path }).catch(() => {});
		notify();
	}

	return {
		open: (path: string): ProjectEntry => entryOf(path),
		get: (path: string): ProjectEntry | null => entries.get(path) ?? null,
		attach,
		activity,
		othersWorking: (path: string) =>
			[...entries.values()].some((entry) => entry.session.path !== path && entry.controller.working()),
		stop: (path: string) => entries.get(path)?.controller.stop(),
		discard,
		flushAll,
		subscribe(listener: () => void) {
			listeners.add(listener);

			return () => void listeners.delete(listener);
		},
		onLanded(listener: (landed: Landed) => void) {
			landedListeners.add(listener);

			return () => void landedListeners.delete(listener);
		},
	};
}
