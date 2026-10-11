import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { DRAFT_SAVE_MS, readDraft, saveDraft } from "@/lib/composer-drafts";

export function readStoredDraft(id: string | null) {
	if (!id) return "";

	try {
		return readDraft(localStorage, id);
	} catch {
		return "";
	}
}

function storeDraft(id: string, text: string) {
	try {
		saveDraft(localStorage, id, text);
	} catch (error) {
		toast.error("Couldn't save the draft", { id: "draft-save", description: String(error) });
	}
}

type Pending = { id: string; text: string };

export function useComposerDraft(id: string | null, text: string) {
	const pending = useRef<Pending | null>(null);

	const flush = useCallback(() => {
		const next = pending.current;
		pending.current = null;

		if (next) storeDraft(next.id, next.text);
	}, []);

	useEffect(() => {
		if (!id) return;
		pending.current = { id, text };
		const timer = setTimeout(flush, DRAFT_SAVE_MS);

		return () => clearTimeout(timer);
	}, [id, text, flush]);

	useEffect(() => {
		window.addEventListener("pagehide", flush);

		return () => {
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, [id, flush]);

	return useCallback(() => {
		pending.current = null;

		if (id) storeDraft(id, "");
	}, [id]);
}
