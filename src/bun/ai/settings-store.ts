import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
	PROVIDER_TYPES,
	parseModelRef,
	type ProviderConfig,
	type ProviderSettings,
	type ProviderType,
} from "../../shared/ai/settings";
import type { Json } from "../../shared/json";
import { arrayOr, objectOr, optionalString, parseJson } from "../json";
import { apiKeyAccount, type SecretStore } from "./keychain";

export const SETTINGS_FILE = "providers.json";

export type Detected = Partial<Record<"claude" | "codex" | "gemini" | "ollama", boolean>>;

export const detectBinaries = async (): Promise<Detected> => ({
	claude: !!Bun.which("claude"),
	codex: !!Bun.which("codex"),
	gemini: !!Bun.which("gemini"),
	ollama: !!Bun.which("ollama"),
});

/** Added on first run when their binary is found. */
const SEED: { binary: keyof Detected; type: ProviderType }[] = [
	{ binary: "claude", type: "claude-code" },
	{ binary: "codex", type: "codex" },
	{ binary: "gemini", type: "gemini-cli" },
	{ binary: "ollama", type: "ollama" },
];

export type SettingsStoreOptions = {
	userDataDir: string;
	secrets: SecretStore;
	detect?: () => Promise<Detected>;
};

export type NewProvider = {
	type: ProviderType;
	label?: string;
	enabled?: boolean;
	baseUrl?: string;
	binPath?: string;
	defaultModel?: string;
};

export type ProviderPatch = Partial<Pick<ProviderConfig, "label" | "enabled" | "baseUrl" | "binPath" | "defaultModel">>;

const typeInfo = (type: ProviderType) => PROVIDER_TYPES.find((t) => t.type === type);

export const emptySettings = (): ProviderSettings => ({ version: 1, providers: [] });

/** `anthropic`, then `anthropic-2`, `anthropic-3`… */
export function uniqueProviderId(type: ProviderType, taken: Iterable<string>) {
	const used = new Set(taken);
	let id: string = type;

	for (let n = 2; used.has(id); n++) id = `${type}-${n}`;

	return id;
}

const nonBlank = (value: Json | undefined) => optionalString(value)?.trim() || undefined;

export function normalizeSettings(raw: Json): ProviderSettings {
	const data = objectOr(raw);
	const providers: ProviderConfig[] = [];
	const ids = new Set<string>();

	for (const entry of arrayOr(data.providers)) {
		const p = objectOr(entry);
		const id = optionalString(p.id);

		if (!id || !/^[a-z0-9-]+$/.test(id) || ids.has(id)) continue;
		const info = PROVIDER_TYPES.find((t) => t.type === p.type);

		if (!info) continue;
		ids.add(id);

		const config: ProviderConfig = {
			id,
			type: info.type,
			label: nonBlank(p.label) ?? info.label,
			enabled: p.enabled !== false,
		};

		for (const key of ["baseUrl", "binPath", "defaultModel"] as const) {
			const value = nonBlank(p[key]);

			if (value) config[key] = value;
		}

		if (p.hasKey === true) config.hasKey = true;
		providers.push(config);
	}

	const settings: ProviderSettings = { version: 1, providers };
	const defaultModel = nonBlank(data.defaultModel);

	if (defaultModel && parseModelRef(defaultModel)) settings.defaultModel = defaultModel;

	return settings;
}

function newConfig(input: NewProvider, taken: Iterable<string>): ProviderConfig {
	const info = typeInfo(input.type);

	if (!info) throw new Error(`Unknown provider type: ${input.type}`);
	const baseUrl = nonBlank(input.baseUrl);

	if (info.needsBaseUrl && !baseUrl) throw new Error(`${info.label} needs a base URL.`);

	const config: ProviderConfig = {
		id: uniqueProviderId(input.type, taken),
		type: input.type,
		label: nonBlank(input.label) ?? info.label,
		enabled: input.enabled ?? true,
	};

	if (baseUrl) config.baseUrl = baseUrl;
	const binPath = nonBlank(input.binPath);

	if (binPath) config.binPath = binPath;
	const defaultModel = nonBlank(input.defaultModel);

	if (defaultModel) config.defaultModel = defaultModel;

	return config;
}

/** API keys live in `secrets`, never in the file. Every method reads the file fresh; writes are serialized. */
export function createSettingsStore(options: SettingsStoreOptions) {
	const file = join(options.userDataDir, SETTINGS_FILE);
	const detect = options.detect ?? detectBinaries;
	let queue: Promise<unknown> = Promise.resolve();

	function serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = queue.then(fn, fn);
		queue = next.catch(() => {});

		return next;
	}

	function write(settings: ProviderSettings) {
		mkdirSync(dirname(file), { recursive: true });
		const temp = `${file}.tmp`;
		writeFileSync(temp, `${JSON.stringify(settings, null, "\t")}\n`);
		renameSync(temp, file);
	}

	async function read(): Promise<ProviderSettings> {
		let text: string;

		try {
			text = readFileSync(file, "utf-8");
		} catch {
			const settings = emptySettings();
			const found = await detect().catch((): Detected => ({}));

			for (const { binary, type } of SEED) {
				if (found[binary])
					settings.providers.push(
						newConfig(
							{ type },
							settings.providers.map((p) => p.id),
						),
					);
			}

			write(settings);

			return settings;
		}

		try {
			return normalizeSettings(parseJson(text));
		} catch {
			return emptySettings();
		}
	}

	async function mutate<T>(fn: (settings: ProviderSettings) => Promise<T> | T): Promise<T> {
		return serial(async () => {
			const settings = await read();
			const result = await fn(settings);
			write(settings);

			return result;
		});
	}

	function find(settings: ProviderSettings, id: string) {
		const config = settings.providers.find((p) => p.id === id);

		if (!config) throw new Error(`No provider with id "${id}"`);

		return config;
	}

	return {
		file,

		get: (): Promise<ProviderSettings> => serial(read),

		async list(): Promise<ProviderConfig[]> {
			return (await serial(read)).providers;
		},

		add(input: NewProvider): Promise<ProviderConfig> {
			return mutate((settings) => {
				const config = newConfig(
					input,
					settings.providers.map((p) => p.id),
				);

				settings.providers.push(config);

				return config;
			});
		},

		update(id: string, patch: ProviderPatch): Promise<ProviderConfig> {
			return mutate((settings) => {
				const config = find(settings, id);

				if (patch.label !== undefined) config.label = nonBlank(patch.label) ?? typeInfo(config.type)!.label;

				if (patch.enabled !== undefined) config.enabled = patch.enabled;

				for (const key of ["baseUrl", "binPath", "defaultModel"] as const) {
					if (!(key in patch)) continue;
					const value = nonBlank(patch[key]);

					if (value) config[key] = value;
					else delete config[key];
				}

				if (typeInfo(config.type)?.needsBaseUrl && !config.baseUrl)
					throw new Error(`${config.label} needs a base URL.`);

				return config;
			});
		},

		/** Also deletes its key and clears the default model when it pointed to it. */
		remove(id: string): Promise<void> {
			return mutate(async (settings) => {
				find(settings, id);
				await options.secrets.delete(apiKeyAccount(id));
				settings.providers = settings.providers.filter((p) => p.id !== id);

				if (settings.defaultModel && parseModelRef(settings.defaultModel)?.providerId === id)
					delete settings.defaultModel;
			});
		},

		setApiKey(id: string, key: string): Promise<ProviderConfig> {
			return mutate(async (settings) => {
				const config = find(settings, id);
				await options.secrets.set(apiKeyAccount(id), key.trim());
				config.hasKey = true;

				return config;
			});
		},

		clearApiKey(id: string): Promise<ProviderConfig> {
			return mutate(async (settings) => {
				const config = find(settings, id);
				await options.secrets.delete(apiKeyAccount(id));
				delete config.hasKey;

				return config;
			});
		},

		getApiKey: (id: string) => options.secrets.get(apiKeyAccount(id)),

		setDefaultModel(ref: string | null): Promise<void> {
			return mutate((settings) => {
				if (ref === null) delete settings.defaultModel;
				else if (!parseModelRef(ref)) throw new Error(`Invalid model: ${ref}`);
				else settings.defaultModel = ref;
			});
		},
	};
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
