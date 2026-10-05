import type { Provider, ProviderHealth, ProviderModel } from "../../../shared/ai/contract";
import { PROVIDER_TYPES, parseModelRef, type ModelRef, type ProviderConfig, type ProviderStatus } from "../../../shared/ai/settings";
import type { SpawnFn } from "../cli";
import { apiKeyAccount, type SecretStore } from "../keychain";
import { createAnthropicProvider } from "./anthropic";
import { createClaudeAgentSdkProvider } from "./claude-agent-sdk";
import { createClaudeCodeProvider } from "./claude-code";
import { createCodexProvider } from "./codex";
import { createGeminiCliProvider } from "./gemini-cli";
import { createMockProvider } from "./mock";
import { createOpenAICompatibleProvider } from "./openai-compatible";

export type ProviderDeps = {
	secrets: SecretStore;
	fetch?: typeof fetch;
	spawn?: SpawnFn;
	/** Parent folder for agent staging directories */
	stagingRoot?: string;
};

/** Builds the provider for one configuration. */
export function createProvider(config: ProviderConfig, deps: ProviderDeps): Provider {
	const getApiKey = () => deps.secrets.get(apiKeyAccount(config.id));
	const api = { config, getApiKey, fetch: deps.fetch };
	const cli = { config, spawn: deps.spawn, stagingRoot: deps.stagingRoot };
	switch (config.type) {
		case "anthropic":
			return createAnthropicProvider(api);
		case "openai":
		case "openrouter":
		case "ollama":
		case "openai-compatible":
			return createOpenAICompatibleProvider(api);
		case "claude-code":
			return createClaudeCodeProvider(cli);
		case "codex":
			return createCodexProvider(cli);
		case "gemini-cli":
			return createGeminiCliProvider(cli);
		case "claude-agent-sdk":
			return createClaudeAgentSdkProvider({ config, getApiKey, stagingRoot: deps.stagingRoot });
		case "mock":
			return { ...createMockProvider(), id: config.id, label: config.label };
	}
}

/** The development-only mock, listed when the registry is created with `includeMock`. */
export const MOCK_CONFIG: ProviderConfig = { id: "mock", type: "mock", label: "Mock (dev)", enabled: true, defaultModel: "mock" };

export type RegistryOptions = ProviderDeps & {
	includeMock?: boolean;
	/** Per call to `health()` and `listModels()` when computing statuses */
	statusTimeoutMs?: number;
	/** Injectable for tests */
	create?: (config: ProviderConfig, deps: ProviderDeps) => Provider;
};

export type ResolvedModel = { provider: Provider; config: ProviderConfig; model: string };

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new TimeoutError(`No answer after ${Math.round(ms / 1000)} s`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The configured providers, built on demand and cached until their config
 * changes. Resolves `ModelRef`s and reports statuses for Settings and the model picker.
 */
export class ProviderRegistry {
	#options: RegistryOptions;
	#configs: ProviderConfig[] = [];
	#cache = new Map<string, { key: string; provider: Provider }>();

	constructor(options: RegistryOptions, configs: ProviderConfig[] = []) {
		this.#options = options;
		this.setConfigs(configs);
	}

	/** Replaces the configured providers (from the settings store). Instances of unchanged configs are kept. */
	setConfigs(configs: ProviderConfig[]) {
		this.#configs = this.#options.includeMock && !configs.some((c) => c.id === MOCK_CONFIG.id) ? [...configs, MOCK_CONFIG] : [...configs];
		const ids = new Set(this.#configs.map((c) => c.id));
		for (const id of this.#cache.keys()) if (!ids.has(id)) this.#cache.delete(id);
	}

	configs(): ProviderConfig[] {
		return [...this.#configs];
	}

	config(id: string): ProviderConfig | undefined {
		return this.#configs.find((c) => c.id === id);
	}

	/** The provider for `id`, enabled or not; `null` when no such provider is configured. */
	get(id: string): Provider | null {
		const config = this.config(id);
		if (!config) return null;
		const key = JSON.stringify(config);
		const cached = this.#cache.get(id);
		if (cached?.key === key) return cached.provider;
		const provider = (this.#options.create ?? createProvider)(config, this.#options);
		this.#cache.set(id, { key, provider });
		return provider;
	}

	/**
	 * `anthropic:claude-sonnet-5-5` → the provider and model id. A bare provider
	 * id (`anthropic`) uses the provider's `defaultModel`. `null` when the provider
	 * is missing or disabled, or no model can be picked.
	 */
	resolve(ref: ModelRef): ResolvedModel | null {
		const parsed = parseModelRef(ref);
		const providerId = parsed?.providerId ?? ref;
		const config = this.config(providerId);
		if (!config?.enabled) return null;
		const model = parsed?.model ?? config.defaultModel;
		if (!model) return null;
		const provider = this.get(providerId);
		return provider ? { provider, config, model } : null;
	}

	/** Health and models of every provider, checked in parallel. Never throws; disabled providers aren't checked. */
	async statuses(): Promise<ProviderStatus[]> {
		const timeoutMs = this.#options.statusTimeoutMs ?? 8000;
		return Promise.all(
			this.#configs.map(async (config): Promise<ProviderStatus> => {
				let provider: Provider | null = null;
				let health: ProviderStatus["health"] = null;
				let models: ProviderModel[] = [];
				try {
					provider = this.get(config.id);
				} catch (error) {
					health = { ok: false, code: "unknown", message: messageOf(error) };
				}
				if (provider && config.enabled) {
					const p = provider;
					[health, models] = await Promise.all([
						withTimeout(p.health(), timeoutMs).catch((error): ProviderHealth => healthFailure(error)),
						withTimeout(p.listModels(), timeoutMs).catch((): ProviderModel[] => []),
					]);
				}
				return {
					id: config.id,
					type: config.type,
					kind: provider?.kind ?? PROVIDER_TYPES.find((t) => t.type === config.type)?.kind ?? "api",
					label: config.label,
					enabled: config.enabled,
					capabilities: provider?.capabilities ?? { streaming: false, images: false, agentic: false, maxContextTokens: 0 },
					health,
					models: Array.isArray(models) ? models : [],
				};
			}),
		);
	}
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function healthFailure(error: unknown): ProviderHealth {
	if (error instanceof TimeoutError) return { ok: false, code: "network", message: error.message, fix: "Check that the provider is running and reachable." };
	return { ok: false, code: "unknown", message: messageOf(error) };
}
