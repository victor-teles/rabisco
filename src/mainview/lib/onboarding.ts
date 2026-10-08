import type { ProviderConfig, ProviderStatus } from "../../shared/ai/settings";

const KIND_ORDER = { cli: 0, sdk: 1, api: 2 } as const;

/** A ready CLI first (it reuses a login the user already has), then any ready provider, then a found CLI that needs a fix. */
export function preselectProvider(providers: ProviderConfig[], statuses: ProviderStatus[]): string | null {
	const candidates = providers.flatMap((config) => {
		const status = statuses.find((s) => s.id === config.id);

		return config.enabled && status ? [status] : [];
	});

	const ready = candidates
		.filter((status) => status.health?.ok === true && status.models.length > 0)
		.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

	return ready[0]?.id ?? candidates.find((status) => status.kind === "cli")?.id ?? null;
}
