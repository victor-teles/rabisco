import { expect, test } from "bun:test";
import type { ProviderConfig, ProviderStatus, ProviderType } from "../../shared/ai/settings";
import { preselectProvider } from "./onboarding";

const config = (id: string, type: ProviderType, enabled = true): ProviderConfig => ({ id, type, label: id, enabled });

const status = (id: string, kind: ProviderStatus["kind"], ok: boolean, models = 1): ProviderStatus => ({
	id,
	type: "anthropic",
	kind,
	label: id,
	enabled: true,
	capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
	health: ok ? { ok: true } : { ok: false, code: "not_authenticated", message: "Not logged in" },
	models: Array.from({ length: models }, (_, i) => ({ id: `m${i}`, label: `M${i}` })),
});

test("prefers a ready CLI over a ready API provider", () => {
	const providers = [config("anthropic", "anthropic"), config("claude-code", "claude-code")];
	const statuses = [status("anthropic", "api", true), status("claude-code", "cli", true)];
	expect(preselectProvider(providers, statuses)).toBe("claude-code");
});

test("a ready provider beats a found CLI that isn't ready", () => {
	const providers = [config("codex", "codex"), config("ollama", "ollama")];
	const statuses = [status("codex", "cli", false), status("ollama", "api", true)];
	expect(preselectProvider(providers, statuses)).toBe("ollama");
});

test("falls back to a found CLI while nothing is ready", () => {
	const providers = [config("ollama", "ollama"), config("codex", "codex")];
	const statuses = [status("ollama", "api", false), status("codex", "cli", false)];
	expect(preselectProvider(providers, statuses)).toBe("codex");
});

test("skips disabled providers, and has nothing to pick without any", () => {
	expect(preselectProvider([config("codex", "codex", false)], [status("codex", "cli", true)])).toBeNull();
	expect(preselectProvider([], [])).toBeNull();
});
