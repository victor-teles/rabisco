import { useSyncExternalStore } from "react";
import { api } from "@/lib/rpc";
import {
	parseModelRef,
	toModelRef,
	type ModelRef,
	type ProviderSettings,
	type ProviderStatus,
} from "../../shared/ai/settings";

export type ModelOption = {
	/** `<providerId>:<modelId>` */
	id: ModelRef;
	label: string;
	providerId: string;
	providerLabel: string;
};

type ProvidersState = {
	loading: boolean;
	settings: ProviderSettings;
	statuses: ProviderStatus[];
	models: ModelOption[];
	model: ModelRef | null;
	settingsOpen: boolean;
	focusProvider: string | null;
};

const EMPTY_SETTINGS: ProviderSettings = { version: 1, providers: [] };

let state: ProvidersState = {
	loading: true,
	settings: EMPTY_SETTINGS,
	statuses: [],
	models: [],
	model: null,
	settingsOpen: false,
	focusProvider: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<ProvidersState>) {
	state = { ...state, ...patch };
	listeners.forEach((listener) => listener());
}

function modelsOf(statuses: ProviderStatus[]): ModelOption[] {
	return statuses
		.filter((status) => status.enabled && status.health?.ok !== false)
		.flatMap((status) =>
			status.models.map((model) => ({
				id: toModelRef(status.id, model.id),
				label: model.label,
				providerId: status.id,
				providerLabel: status.label,
			})),
		);
}

function pickModel(settings: ProviderSettings, models: ModelOption[], current: ModelRef | null): ModelRef | null {
	const available = (ref: ModelRef | null | undefined) => (ref && models.some((m) => m.id === ref) ? ref : null);

	const firstDefault = settings.providers
		.filter((p) => p.enabled && p.defaultModel)
		.map((p) => toModelRef(p.id, p.defaultModel!))
		.find((ref) => available(ref));

	return available(current) ?? available(settings.defaultModel) ?? firstDefault ?? models[0]?.id ?? null;
}

function apply(settings: ProviderSettings, statuses: ProviderStatus[]) {
	const models = modelsOf(statuses);
	set({ loading: false, settings, statuses, models, model: pickModel(settings, models, state.model) });
}

let inflight: Promise<void> | null = null;

export function loadProviders(refresh = false) {
	if (inflight && !refresh) return inflight;
	inflight = api.listProviders({ refresh }).then(
		({ settings, statuses }) => apply(settings, statuses),
		(error) => {
			console.warn("Could not load providers:", error);
			set({ loading: false });
		},
	);

	return inflight;
}

export function upsertStatus(status: ProviderStatus) {
	const statuses = state.statuses.some((s) => s.id === status.id)
		? state.statuses.map((s) => (s.id === status.id ? status : s))
		: [...state.statuses, status];

	// Reload settings without re-running every health check
	void api.listProviders({}).then(({ settings }) => apply(settings, statuses));
	apply(state.settings, statuses);
}

export function removeStatus(id: string) {
	apply(
		{ ...state.settings, providers: state.settings.providers.filter((p) => p.id !== id) },
		state.statuses.filter((s) => s.id !== id),
	);
}

export function selectModel(model: ModelRef) {
	set({ model });
	void api.setDefaultModel({ model }).catch((error) => console.warn("Could not save the default model:", error));
}

export function openSettings(focusProvider: string | null = null) {
	set({ settingsOpen: true, focusProvider });
	void loadProviders(true);
}

export function closeSettings() {
	set({ settingsOpen: false, focusProvider: null });
}

export function modelLabel(ref: ModelRef | null) {
	if (!ref) return "No model";

	return state.models.find((m) => m.id === ref)?.label ?? parseModelRef(ref)?.model ?? ref;
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

export function useProviders() {
	return useSyncExternalStore(subscribe, () => state);
}
