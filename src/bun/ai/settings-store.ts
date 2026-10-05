import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { PROVIDER_TYPES, parseModelRef, type ProviderConfig, type ProviderSettings, type ProviderType } from "../../shared/ai/settings";
import { apiKeyAccount, type SecretStore } from "./keychain";

/**
 * `<userData>/providers.json`: configured providers and the default model.
 * API keys go to the keychain; the file only records `hasKey`.
 */

export const SETTINGS_FILE = "providers.json";

/** CLI binaries found on this machine, used to seed the first settings. */
export type Detected = Partial<Record<"claude" | "codex" | "gemini" | "ollama", boolean>>;

export const detectBinaries = async (): Promise<Detected> => ({
	claude: !!Bun.which("claude"),
	codex: !!Bun.which("codex"),
	gemini: !!Bun.which("gemini"),
	ollama: !!Bun.which("ollama"),
});

/** Providers added on first run when their binary is found; they need no setup. */
const SEED: { binary: keyof Detected; type: ProviderType }[] = [
	{ binary: "claude", type: "claude-code" },
	{ binary: "codex", type: "codex" },
	{ binary: "gemini", type: "gemini-cli" },
	{ binary: "ollama", type: "ollama" },
];

export type SettingsStoreOptions = {
	userDataDir: string;
	secrets: SecretStore;
	/** Defaults to looking the binaries up on PATH */
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

const KNOWN_TYPES = new Set<string>(PROVIDER_TYPES.map((t) => t.type));
const typeInfo = (type: ProviderType) => PROVIDER_TYPES.find((t) => t.type === type);

export const emptySettings = (): ProviderSettings => ({ version: 1, providers: [] });

/** `anthropic`, then `anthropic-2`, `anthropic-3`… */
export function uniqueProviderId(type: ProviderType, taken: Iterable<string>) {
	const used = new Set(taken);
	let id: string = type;
	for (let n = 2; used.has(id); n++) id = `${type}-${n}`;
	return id;
}

const optionalString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Keeps valid entries of a hand-edited or older file; drops the rest. */
export function normalizeSettings(raw: unknown): ProviderSettings {
	if (!raw || typeof raw !== "object") return emptySettings();
	const data = raw as Partial<ProviderSettings>;
	const providers: ProviderConfig[] = [];
	const ids = new Set<string>();
	for (const entry of Array.isArray(data.providers) ? data.providers : []) {
		const p = entry as Partial<ProviderConfig> | null;
		if (!p || typeof p.id !== "string" || !/^[a-z0-9-]+$/.test(p.id) || ids.has(p.id)) continue;
		if (typeof p.type !== "string" || !KNOWN_TYPES.has(p.type)) continue;
		ids.add(p.id);
		const config: ProviderConfig = {
			id: p.id,
			type: p.type,
			label: optionalString(p.label) ?? typeInfo(p.type)!.label,
			enabled: p.enabled !== false,
		};
		for (const key of ["baseUrl", "binPath", "defaultModel"] as const) {
			const value = optionalString(p[key]);
			if (value) config[key] = value;
		}
		if (p.hasKey === true) config.hasKey = true;
		providers.push(config);
	}
	const settings: ProviderSettings = { version: 1, providers };
	const defaultModel = optionalString(data.defaultModel);
	if (defaultModel && parseModelRef(defaultModel)) settings.defaultModel = defaultModel;
	return settings;
}

function newConfig(input: NewProvider, taken: Iterable<string>): ProviderConfig {
	const info = typeInfo(input.type);
	if (!info) throw new Error(`Unknown provider type: ${input.type}`);
	const baseUrl = optionalString(input.baseUrl);
	if (info.needsBaseUrl && !baseUrl) throw new Error(`${info.label} needs a base URL.`);
	const config: ProviderConfig = {
		id: uniqueProviderId(input.type, taken),
		type: input.type,
		label: optionalString(input.label) ?? info.label,
		enabled: input.enabled ?? true,
	};
	if (baseUrl) config.baseUrl = baseUrl;
	const binPath = optionalString(input.binPath);
	if (binPath) config.binPath = binPath;
	const defaultModel = optionalString(input.defaultModel);
	if (defaultModel) config.defaultModel = defaultModel;
	return config;
}

/** Provider settings on disk, with keys in `secrets`. Every method reads the file fresh, and writes are serialized. */
export function createSettingsStore(options: SettingsStoreOptions) {
	const file = join(options.userDataDir, SETTINGS_FILE);
	const detect = options.detect ?? detectBinaries;
	let queue: Promise<unknown> = Promise.resolve();

	/** Runs `fn` after every earlier call has finished. */
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

	/** The settings on disk; seeds and saves them when the file doesn't exist yet. */
	async function read(): Promise<ProviderSettings> {
		let text: string;
		try {
			text = readFileSync(file, "utf-8");
		} catch {
			const settings = emptySettings();
			const found = await detect().catch((): Detected => ({}));
			for (const { binary, type } of SEED) {
				if (found[binary]) settings.providers.push(newConfig({ type }, settings.providers.map((p) => p.id)));
			}
			write(settings);
			return settings;
		}
		try {
			return normalizeSettings(JSON.parse(text));
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
				const config = newConfig(input, settings.providers.map((p) => p.id));
				settings.providers.push(config);
				return config;
			});
		},

		update(id: string, patch: ProviderPatch): Promise<ProviderConfig> {
			return mutate((settings) => {
				const config = find(settings, id);
				if (patch.label !== undefined) config.label = optionalString(patch.label) ?? typeInfo(config.type)!.label;
				if (patch.enabled !== undefined) config.enabled = patch.enabled;
				for (const key of ["baseUrl", "binPath", "defaultModel"] as const) {
					if (!(key in patch)) continue;
					const value = optionalString(patch[key]);
					if (value) config[key] = value;
					else delete config[key];
				}
				if (typeInfo(config.type)?.needsBaseUrl && !config.baseUrl) throw new Error(`${config.label} needs a base URL.`);
				return config;
			});
		},

		/** Removes the provider and its stored key; clears the default model when it pointed to it. */
		remove(id: string): Promise<void> {
			return mutate(async (settings) => {
				find(settings, id);
				await options.secrets.delete(apiKeyAccount(id));
				settings.providers = settings.providers.filter((p) => p.id !== id);
				if (settings.defaultModel && parseModelRef(settings.defaultModel)?.providerId === id) delete settings.defaultModel;
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
