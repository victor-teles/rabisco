/** Design checks run on a rendered screen (layout, accessibility) or its source (classes), or across screens (consistency), with no AI. Phases 16 and 27. */
export const DESIGN_RULES = [
	"frame-overflow",
	"text-clipped",
	"overlap",
	"contrast",
	"raw-color",
	"empty-container",
	"font-sizes",
	"label",
	"focus-order",
	"tap-target",
	"landmarks",
	"component-drift",
	"spacing-drift",
	"nav-drift",
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

export const DESIGN_RULE_LABELS: Record<DesignRule, string> = {
	"frame-overflow": "Wider than the screen",
	"text-clipped": "Clipped text",
	overlap: "Overlap",
	contrast: "Low contrast",
	"raw-color": "Color without a token",
	"empty-container": "Empty container",
	"font-sizes": "Too many font sizes",
	label: "Missing label",
	"focus-order": "Focus order",
	"tap-target": "Small tap target",
	landmarks: "Landmarks",
	"component-drift": "Component differs",
	"spacing-drift": "Spacing differs",
	"nav-drift": "Navigation differs",
};
