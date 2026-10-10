// Secrets never live here: API keys go to the OS keychain, CLI providers use their own login.

import type { ProviderCapabilities, ProviderErrorCode, ProviderKind, ProviderModel } from "./contract";

export type ProviderType =
	| "anthropic"
	| "openai"
	| "openrouter"
	| "ollama"
	| "openai-compatible"
	| "claude-code"
	| "codex"
	| "gemini-cli"
	| "claude-agent-sdk"
	/** Development only */
	| "mock";

/** One type can be added more than once (two OpenAI-compatible endpoints). */
export type ProviderConfig = {
	/** e.g. `anthropic` or `openai-compatible-2` */
	id: string;
	type: ProviderType;
	label: string;
	enabled: boolean;
	/** Required for `openai-compatible` */
	baseUrl?: string;
	/** CLI binary path when it isn't on PATH */
	binPath?: string;
	defaultModel?: string;
	/** An API key is in the keychain */
	hasKey?: boolean;
};

export type ProviderSettings = {
	version: 1;
	providers: ProviderConfig[];
	defaultModel?: string;
	fastModel?: string;
};

export type ProviderTypeInfo = {
	type: ProviderType;
	kind: ProviderKind;
	label: string;
	description: string;
	needsKey: boolean;
	needsBaseUrl: boolean;
	defaultBaseUrl?: string;
	helpUrl?: string;
};

export const PROVIDER_TYPES: readonly ProviderTypeInfo[] = [
	{
		type: "anthropic",
		kind: "api",
		label: "Anthropic",
		description: "Claude models with your API key",
		needsKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.anthropic.com",
		helpUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		type: "openai",
		kind: "api",
		label: "OpenAI",
		description: "GPT models with your API key",
		needsKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.openai.com/v1",
		helpUrl: "https://platform.openai.com/api-keys",
	},
	{
		type: "openrouter",
		kind: "api",
		label: "OpenRouter",
		description: "Hundreds of models through one key",
		needsKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		helpUrl: "https://openrouter.ai/keys",
	},
	{
		type: "ollama",
		kind: "api",
		label: "Ollama",
		description: "Local models, no key needed",
		needsKey: false,
		needsBaseUrl: false,
		defaultBaseUrl: "http://localhost:11434/v1",
		helpUrl: "https://ollama.com/download",
	},
	{
		type: "openai-compatible",
		kind: "api",
		label: "OpenAI-compatible",
		description: "Any endpoint that speaks the OpenAI chat API",
		needsKey: false,
		needsBaseUrl: true,
	},
	{
		type: "claude-code",
		kind: "cli",
		label: "Claude Code",
		description: "Uses your Claude Code login",
		needsKey: false,
		needsBaseUrl: false,
		helpUrl: "https://docs.claude.com/en/docs/claude-code/setup",
	},
	{
		type: "codex",
		kind: "cli",
		label: "Codex CLI",
		description: "Uses your Codex login",
		needsKey: false,
		needsBaseUrl: false,
		helpUrl: "https://github.com/openai/codex",
	},
	{
		type: "gemini-cli",
		kind: "cli",
		label: "Gemini CLI",
		description: "Uses your Gemini CLI login",
		needsKey: false,
		needsBaseUrl: false,
		helpUrl: "https://github.com/google-gemini/gemini-cli",
	},
	{
		type: "claude-agent-sdk",
		kind: "sdk",
		label: "Claude Agent SDK",
		description: "An agent that reads and writes project files with tools",
		needsKey: true,
		needsBaseUrl: false,
		helpUrl: "https://console.anthropic.com/settings/keys",
	},
];

export type ProviderStatus = {
	id: string;
	type: ProviderType;
	kind: ProviderKind;
	label: string;
	enabled: boolean;
	capabilities: ProviderCapabilities;
	health: { ok: true; version?: string } | { ok: false; code: ProviderErrorCode; message: string; fix?: string } | null;
	models: ProviderModel[];
};

/** `<providerId>:<modelId>`; only the first colon separates (`ollama:qwen3-coder:30b`). */
export type ModelRef = string;

export function parseModelRef(ref: ModelRef): { providerId: string; model: string } | null {
	const at = ref.indexOf(":");

	if (at <= 0 || at === ref.length - 1) return null;

	return { providerId: ref.slice(0, at), model: ref.slice(at + 1) };
}

export const toModelRef = (providerId: string, model: string): ModelRef => `${providerId}:${model}`;

export const FAST_TASKS = ["edit", "repair", "context", "theme", "plan", "brief"] as const;

export type FastTask = (typeof FAST_TASKS)[number];

const isFastTask = (task: string): task is FastTask => FAST_TASKS.some((fast) => fast === task);

export function modelForTask(task: string, picked: ModelRef, fastModel: ModelRef | undefined): ModelRef {
	return fastModel && isFastTask(task) ? fastModel : picked;
}
