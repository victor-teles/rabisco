import { isFiniteNumber, isString } from "../../shared/guards";
import { isJsonObject, type Json } from "../../shared/json";

export const DRAFTS_KEY = "rabisco:composer-drafts";

export const DRAFT_SAVE_MS = 400;

export const MAX_DRAFTS = 50;

export type DraftStorage = Pick<Storage, "getItem" | "setItem">;

type SavedDraft = { text: string; savedAt: number };

export type ComposerDrafts = Record<string, SavedDraft>;

export const draftIdOf = (projectPath: string, chatId: string) => `${projectPath}\n${chatId}`;

export function parseDrafts(raw: string | null): ComposerDrafts {
	if (!raw) return {};
	let parsed: Json;

	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		parsed = JSON.parse(raw) as Json;
	} catch {
		return {};
	}

	if (!isJsonObject(parsed)) return {};

	return Object.fromEntries(
		Object.entries(parsed).flatMap(([id, value]) =>
			isJsonObject(value) && isString(value.text) && isFiniteNumber(value.savedAt)
				? [[id, { text: value.text, savedAt: value.savedAt }]]
				: [],
		),
	);
}

export function withDraft(drafts: ComposerDrafts, id: string, text: string, now: number): ComposerDrafts {
	const others = Object.entries(drafts).filter(([key]) => key !== id);

	if (text.trim()) others.push([id, { text, savedAt: now }]);

	return Object.fromEntries(others.sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(0, MAX_DRAFTS));
}

export const readDraft = (storage: DraftStorage, id: string) =>
	parseDrafts(storage.getItem(DRAFTS_KEY))[id]?.text ?? "";

export function saveDraft(storage: DraftStorage, id: string, text: string, now = Date.now()) {
	const drafts = parseDrafts(storage.getItem(DRAFTS_KEY));

	if ((drafts[id]?.text ?? "") === (text.trim() ? text : "")) return;
	storage.setItem(DRAFTS_KEY, JSON.stringify(withDraft(drafts, id, text, now)));
}
