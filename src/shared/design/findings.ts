/** Design checks run on a rendered screen (layout) or its source (classes), with no AI. Phase 16. */
export const DESIGN_RULES = [
	"frame-overflow",
	"text-clipped",
	"overlap",
	"contrast",
	"raw-color",
	"empty-container",
	"font-sizes",
] as const;

export type DesignRule = (typeof DESIGN_RULES)[number];

/** `error` goes to the repair loop later; `warning` is only reported */
export type DesignSeverity = "error" | "warning";

/** `path` and `start` come from `data-rabisco-loc`, so a finding maps back to its JSX */
export type DesignFinding = {
	rule: DesignRule;
	severity: DesignSeverity;
	message: string;
	path?: string;
	start?: number;
	line?: number;
};
