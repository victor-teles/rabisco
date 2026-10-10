import type { GenerationEvent, GenerationRequest, Provider, Usage } from "../../shared/ai/contract";
import { contextBody } from "../../shared/context/body";
import type { Device } from "../../shared/types";
import { GenerationError } from "./run";

export function buildBriefRequest(params: {
	id: string;
	model: string;
	prompt: string;
	device: Device;
	product?: string;
	design?: string;
}): GenerationRequest {
	const request: GenerationRequest = {
		id: params.id,
		task: "brief",
		model: params.model,
		prompt: params.prompt,
		device: params.device,
		context: {},
		files: [],
	};

	if (contextBody(params.product)) request.context.product = params.product;

	if (contextBody(params.design)) request.context.design = params.design;

	return request;
}

export function cleanBrief(text: string): string {
	let brief = text.trim();
	const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(brief);

	if (fenced) brief = fenced[1]!.trim();

	return brief.replace(/^(?:#+\s*)?(?:design\s+)?brief:?\s*\n+/i, "").trim();
}

export type BriefResult = { brief: string; usage?: Usage };

export async function runBrief(options: {
	provider: Provider;
	request: GenerationRequest;
	signal: AbortSignal;
	onEvent: (event: GenerationEvent) => void;
}): Promise<BriefResult> {
	const { provider, request, signal, onEvent } = options;
	let reply = "";
	let usage: Usage | undefined;

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);

	for await (const event of provider.generate(request, signal)) {
		if (signal.aborted) break;

		if (event.type === "message.delta") reply += event.text;
		else if (event.type === "done") usage = event.usage;
		else if (event.type === "error") throw new GenerationError(event.code, event.message, event.retryable, event.fix);

		if (event.type === "message.delta" || event.type === "status") onEvent(event);

		if (event.type === "done") break;
	}

	if (signal.aborted) throw new GenerationError("aborted", "Generation stopped.", true);
	const brief = cleanBrief(reply);

	if (!brief) throw new GenerationError("invalid_output", "The model didn't return a brief.", true);

	return { brief, usage };
}
