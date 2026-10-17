import { isFiniteNumber } from "../guards";
import { isJsonObject, type Json } from "../json";
import type { Usage } from "./contract";

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
	if (!a) return b;

	if (!b) return a;
	const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));

	return {
		inputTokens: sum(a.inputTokens, b.inputTokens),
		outputTokens: sum(a.outputTokens, b.outputTokens),
		costUsd: sum(a.costUsd, b.costUsd),
	};
}

export const totalUsage = (usages: readonly (Usage | undefined)[]) =>
	usages.reduce<Usage | undefined>((sum, usage) => addUsage(sum, usage), undefined);

/** Keeps only non-negative numbers; `undefined` when nothing is left */
export function parseUsage(value: Json | undefined): Usage | undefined {
	if (!isJsonObject(value)) return undefined;
	const usage: Usage = {};

	for (const key of ["inputTokens", "outputTokens", "costUsd"] as const) {
		const count = value[key];

		if (isFiniteNumber(count) && count >= 0) usage[key] = count;
	}

	return Object.keys(usage).length ? usage : undefined;
}

export const usageTokens = (usage: Usage | undefined) => (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const tokensLabel = (tokens: number) => `${compact.format(tokens)} ${tokens === 1 ? "token" : "tokens"}`;

export const costLabel = (costUsd: number) => (costUsd < 0.01 ? "<$0.01" : `$${costUsd.toFixed(2)}`);

/** `12.4K tokens · $0.08`, without the parts the provider didn't report; empty when it reported nothing */
export function usageLabel(usage: Usage | undefined) {
	const tokens = usageTokens(usage);
	const cost = usage?.costUsd ?? 0;

	return [tokens ? tokensLabel(tokens) : "", cost ? costLabel(cost) : ""].filter(Boolean).join(" · ");
}
