import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { canRedo, canUndo } from "@/lib/history";
import { projectAssets } from "@/lib/render/assets";
import { projectCandidates } from "@/lib/render/candidates";
import { screenStyles } from "@/lib/render/styles";
import { api, onAssetsChanged } from "@/lib/rpc";
import { projectSessions } from "@/lib/sessions";
import type { ChatMessage } from "../../shared/types";

export type { ChangeOptions, ProjectState } from "@/lib/project-session";

export function useProject(path: string) {
	const { session } = useMemo(() => projectSessions.open(path), [path]);
	const { state, error } = useSyncExternalStore(session.subscribe, session.get);
	const loaded = state !== null;

	useEffect(() => projectSessions.attach(path), [path]);

	useEffect(() => {
		const files = session.state()?.files;

		if (!files) return;
		const candidates = projectCandidates(files);

		// One Tailwind build for every screen (decision 0002)
		if (projectSessions.othersWorking(path)) screenStyles.add(candidates);
		else screenStyles.reset(candidates);
		projectAssets.reset(session.assets());

		const unsubscribe = onAssetsChanged((message) => {
			if (message.path === path) projectAssets.apply(message.changes);
		});

		return () => {
			unsubscribe();
			// Covers on the home screen mustn't find this project's images
			projectAssets.reset({});
		};
	}, [session, path, loaded]);

	const flushCanvas = useCallback(async () => void (await session.flushCanvas()), [session]);

	const flushFiles = useCallback(async () => void (await session.flushFiles()), [session]);

	const addMessages = useCallback((messages: ChatMessage[]) => session.addMessages(messages), [session]);

	const reloadFromDisk = useCallback(async () => {
		const reloaded = await session.reloadFromDisk();

		if (!reloaded) return;

		const { backup } = reloaded;

		if (reloaded.hadHistory)
			toast("Reloaded the project from disk", {
				id: "reloaded-from-disk",
				description: backup
					? "Undo history starts again from here. A backup keeps the version before."
					: "Undo history starts again from here.",
				action: backup ? { label: "Show backup", onClick: () => void api.revealProject({ path: backup }) } : undefined,
			});

		screenStyles.add(projectCandidates(reloaded.files));
		projectAssets.reset(reloaded.assets);
	}, [session]);

	return {
		project: state,
		error,
		flushCanvas,
		flushFiles,
		reloadFromDisk,
		stateRef: session.ref,
		canUndo: state ? canUndo(state.history) : false,
		canRedo: state ? canRedo(state.history) : false,
		change: session.change,
		endStep: session.endStep,
		undo: session.undo,
		redo: session.redo,
		setSelection: session.setSelection,
		setMeta: session.setMeta,
		addVersion: session.addVersion,
		addMessages,
		newChat: session.newChat,
		openChat: session.openChat,
		deleteChat: session.deleteChat,
	};
}
