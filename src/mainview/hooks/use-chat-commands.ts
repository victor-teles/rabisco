import { useEffect, useMemo, useState } from "react";
import { useProviders } from "@/hooks/use-providers";
import { BUILTIN_COMMANDS, chatCommands } from "@/lib/chat-commands";
import { api } from "@/lib/rpc";
import type { ProviderCommand } from "../../shared/ai/contract";

/** The built-ins, then the active model's provider commands; read again when the model or the window focus changes, so new command files show up */
export function useChatCommands(projectPath: string) {
	const { model, models } = useProviders();
	const [loaded, setLoaded] = useState<{ model: string; commands: ProviderCommand[] } | null>(null);
	const providerLabel = models.find((option) => option.id === model)?.providerLabel ?? "Provider";

	useEffect(() => {
		if (!model) return;
		let cancelled = false;

		const load = () =>
			api.listCommands({ model, projectPath }).then(
				(commands) => {
					if (!cancelled) setLoaded({ model, commands });
				},
				(reason) => console.warn("[rabisco] could not list commands", reason),
			);

		void load();
		window.addEventListener("focus", load);

		return () => {
			cancelled = true;
			window.removeEventListener("focus", load);
		};
	}, [model, projectPath]);

	const provider = loaded && loaded.model === model ? loaded.commands : null;

	return useMemo(
		() => (provider ? chatCommands(provider, providerLabel) : BUILTIN_COMMANDS),
		[provider, providerLabel],
	);
}
