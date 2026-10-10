import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, onGenerationEvent } from "@/lib/rpc";
import type { Device } from "../../shared/types";
import { openSettings, useProviders } from "./use-providers";

export const IMPROVE_PROMPT_KEYS = "⌘I";

export const isImprovePrompt = (event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) =>
	event.code === "KeyI" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

type Improving =
	| { status: "idle" }
	| { status: "running"; id: string; original: string }
	| { status: "done"; original: string; brief: string };

export function useImprovePrompt({
	value,
	onChange,
	device,
	projectPath,
	onDone,
}: {
	value: string;
	onChange: (value: string) => void;
	device: Device;
	projectPath?: string;
	onDone?: () => void;
}) {
	const { model } = useProviders();
	const [state, setState] = useState<Improving>({ status: "idle" });
	const streamed = useRef({ id: "", text: "" });
	const change = useRef(onChange);

	useLayoutEffect(() => {
		change.current = onChange;
	});

	useEffect(
		() =>
			onGenerationEvent(({ generationId, event }) => {
				if (generationId !== streamed.current.id || event.type !== "message.delta") return;
				streamed.current.text += event.text;
				change.current(streamed.current.text.trimStart());
			}),
		[],
	);

	const improve = useCallback(async () => {
		const prompt = value.trim();

		if (!prompt || state.status === "running") return;

		if (!model) {
			openSettings();

			return;
		}

		const id = crypto.randomUUID();
		streamed.current = { id, text: "" };
		setState({ status: "running", id, original: value });

		try {
			const result = await api.improvePrompt({ generationId: id, prompt, device, model, projectPath });

			if (result.ok) {
				change.current(result.brief);
				setState({ status: "done", original: value, brief: result.brief });

				return;
			}

			change.current(value);
			setState({ status: "idle" });

			if (result.error.code !== "aborted") {
				toast.error("Couldn't improve the prompt", {
					description: [result.error.message, result.error.fix].filter(Boolean).join(" "),
				});
			}
		} catch (error) {
			change.current(value);
			setState({ status: "idle" });
			toast.error("Couldn't improve the prompt", { description: String(error) });
		} finally {
			streamed.current = { id: "", text: "" };
			onDone?.();
		}
	}, [value, state.status, model, device, projectPath, onDone]);

	const stop = useCallback(() => {
		if (state.status === "running") void api.stopGeneration({ generationId: state.id });
	}, [state]);

	const improved = state.status === "done" && value === state.brief;

	const undo = useCallback(() => {
		if (state.status !== "done") return;
		change.current(state.original);
		setState({ status: "idle" });
	}, [state]);

	return { improving: state.status === "running", improved, improve, stop, undo };
}
