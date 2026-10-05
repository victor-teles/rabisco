import type { Provider } from "../../shared/ai/contract";
import type { VariantRenamer } from "../../shared/ai/variants";

/**
 * Wraps a provider so its events come out under the names Rabisco assigns to
 * one variation (`createVariantRenamer`). `runGeneration` then validates and
 * repairs the final names.
 */
export function variantProvider(provider: Provider, renamer: VariantRenamer): Provider {
	return {
		id: provider.id,
		kind: provider.kind,
		label: provider.label,
		capabilities: provider.capabilities,
		health: () => provider.health(),
		listModels: () => provider.listModels(),
		async *generate(request, signal) {
			for await (const event of provider.generate(request, signal)) yield* renamer.transform(event);
		},
	};
}
