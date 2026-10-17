import type { DesignFinding } from "./findings";

/** `path` and `start` come from `data-rabisco-loc`, as in other findings */
export type SamplePlace = { path?: string; start?: number };

export type ControlKind = "button" | "input";

export type ControlFill = "filled" | "outline" | "plain";

/** A text button or a text field as it renders */
export type ControlSample = SamplePlace & {
	kind: ControlKind;
	fill: ControlFill;
	text: string;
	height: number;
	radius: number;
	fontSize: number;
	/** shadcn's `data-slot`: the component that drew it, or `null` for a hand-made element */
	slot: string | null;
};

export type BarKind = "nav" | "header";

export type BarPlacement = "top" | "bottom" | "left" | "right" | "inline";

/** A navigation bar or a page header */
export type BarSample = SamplePlace & {
	kind: BarKind;
	placement: BarPlacement;
	/** Height for top and bottom bars, width for side ones */
	size: number;
	/** The labels of its links and buttons, in order */
	items: string[];
};

/** What one rendered screen tells the consistency check */
export type ScreenSample = {
	width: number;
	/** Where most of the content's text starts from the left edge; `null` without text */
	inset: number | null;
	controls: ControlSample[];
	bars: BarSample[];
};

export type SampledScreen = { file: string; name: string; sample: ScreenSample };

/** Sub-pixel rounding and borders make sizes off by a pixel */
const TOLERANCE_PX = 2;

/** Screens this many pixels apart in width are the same device */
const WIDTH_TOLERANCE_PX = 1;

/** A screen without a bar most screens have is flagged from this many screens up */
const MIN_SCREENS_FOR_MISSING = 3;

const MISSING_SHARE = 2 / 3;

/** Hand-made controls are flagged once other screens use the component this often */
const MIN_COMPONENT_USES = 2;

const MAX_FINDINGS_PER_SCREEN = 12;

const round = (value: number) => Math.round(value);

const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE_PX;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const quote = (text: string) => (text.length > 30 ? `"${text.slice(0, 29)}…"` : `"${text}"`);

/** Pill corners all read as round, whatever radius makes them */
const radiusOf = (control: ControlSample) => (control.radius >= control.height / 2 - 1 ? Infinity : control.radius);

const corners = (radius: number) => (radius === Infinity ? "round ends" : `${round(radius)}px corners`);

const FILL_WORDS: Record<ControlFill, string> = { filled: "filled", outline: "outlined", plain: "plain" };

const KIND_WORDS: Record<ControlKind, string> = { button: "button", input: "field" };

const PLACEMENT_WORDS: Record<BarPlacement, string> = {
	top: "top",
	bottom: "bottom",
	left: "side",
	right: "side",
	inline: "inline",
};

/** The value most screens share; ties go to the earliest screen in canvas order */
function mostCommon<T>(values: { key: string; value: T; screen: string }[]) {
	const counts = new Map<string, { value: T; count: number; screens: Set<string> }>();

	for (const { key, value, screen } of values) {
		const entry = counts.get(key) ?? { value, count: 0, screens: new Set<string>() };
		entry.count++;
		entry.screens.add(screen);
		counts.set(key, entry);
	}

	let best: { key: string; value: T; count: number; screens: Set<string> } | null = null;

	for (const [key, entry] of counts) if (!best || entry.count > best.count) best = { key, ...entry };

	return best;
}

/** Screens of about the same width, in canvas order */
function byWidth(screens: SampledScreen[]) {
	const groups: SampledScreen[][] = [];

	for (const screen of screens) {
		const group = groups.find(
			(candidate) => Math.abs(candidate[0]!.sample.width - screen.sample.width) <= WIDTH_TOLERANCE_PX,
		);

		if (group) group.push(screen);
		else groups.push([screen]);
	}

	return groups;
}

class Report {
	readonly byFile = new Map<string, DesignFinding[]>();

	add(file: string, place: SamplePlace | null, rule: DesignFinding["rule"], message: string) {
		const list = this.byFile.get(file) ?? [];

		if (list.length >= MAX_FINDINGS_PER_SCREEN || list.some((finding) => finding.message === message)) return;
		const finding: DesignFinding = { rule, severity: "warning", message };

		if (place?.path !== undefined) finding.path = place.path;

		if (place?.start !== undefined) finding.start = place.start;
		list.push(finding);
		this.byFile.set(file, list);
	}
}

/** The sizes where `control` and `usual` differ, as "44px tall, 6px corners" for each */
function controlDifference(control: ControlSample, usual: ControlSample) {
	const ours: string[] = [];
	const theirs: string[] = [];

	if (differs(control.height, usual.height)) {
		ours.push(`${round(control.height)}px tall`);
		theirs.push(`${round(usual.height)}px tall`);
	}

	const radius = radiusOf(control);
	const usualRadius = radiusOf(usual);

	if (radius !== usualRadius && (radius === Infinity || usualRadius === Infinity || differs(radius, usualRadius))) {
		ours.push(corners(radius));
		theirs.push(corners(usualRadius));
	}

	if (differs(control.fontSize, usual.fontSize)) {
		ours.push(`${round(control.fontSize)}px text`);
		theirs.push(`${round(usual.fontSize)}px text`);
	}

	return ours.length ? { ours: ours.join(", "), theirs: theirs.join(", ") } : null;
}

const signature = (control: ControlSample) =>
	`${round(control.height / TOLERANCE_PX)}|${radiusOf(control) === Infinity ? "pill" : round(radiusOf(control) / TOLERANCE_PX)}|${round(control.fontSize)}`;

function checkControls(group: SampledScreen[], report: Report) {
	for (const kind of ["button", "input"] as const) {
		for (const fill of ["filled", "outline", "plain"] as const) {
			const all = group.flatMap((screen) =>
				screen.sample.controls.flatMap((control) =>
					control.kind === kind && control.fill === fill ? [{ screen, control }] : [],
				),
			);

			const usual = mostCommon(
				all.map(({ screen, control }) => ({ key: signature(control), value: control, screen: screen.file })),
			);

			if (!usual || usual.count < 2 || usual.screens.size < 2) continue;
			const what = `${FILL_WORDS[fill]} ${KIND_WORDS[kind]}`;

			for (const { screen, control } of all) {
				const difference = controlDifference(control, usual.value);

				if (!difference) continue;
				const label = control.text ? ` ${quote(control.text)}` : "";

				report.add(
					screen.file,
					control,
					"component-drift",
					`This ${what}${label}: ${difference.ours}. Most ${what}s (${usual.count} on ${plural(usual.screens.size, "screen")}): ${difference.theirs}`,
				);
			}
		}
	}

	checkHandMade(group, report);
}

/** A hand-made `<button>` on one screen while others use the project's Button component */
function checkHandMade(group: SampledScreen[], report: Report) {
	for (const kind of ["button", "input"] as const) {
		const slots = group.flatMap((screen) =>
			screen.sample.controls.flatMap((control) =>
				control.kind === kind && control.slot ? [{ key: control.slot, value: control.slot, screen: screen.file }] : [],
			),
		);

		const usual = mostCommon(slots);

		if (!usual || usual.count < MIN_COMPONENT_USES) continue;

		const component = usual.value
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join("");

		for (const screen of group)
			for (const control of screen.sample.controls) {
				if (control.kind !== kind || control.slot) continue;
				const label = control.text ? ` ${quote(control.text)}` : "";

				report.add(
					screen.file,
					control,
					"component-drift",
					`This ${KIND_WORDS[kind]}${label} is a hand-made <${kind}>, while ${usual.count} on ${plural(usual.screens.size, "screen")} use <${component}>. Use <${component}> so it looks and behaves the same`,
				);
			}
	}
}

/** Most screens start their content at the same distance from the edge */
function checkInset(group: SampledScreen[], report: Report) {
	const insets = group.flatMap((screen) =>
		screen.sample.inset === null
			? []
			: [{ key: String(round(screen.sample.inset)), value: screen.sample.inset, screen: screen.file }],
	);

	const usual = mostCommon(insets);

	if (!usual || usual.count < 2) return;

	for (const screen of group) {
		const inset = screen.sample.inset;

		if (inset === null || !differs(inset, usual.value)) continue;
		report.add(
			screen.file,
			null,
			"spacing-drift",
			`The content starts ${round(inset)}px from the left edge; on ${plural(usual.count, "screen")} it starts at ${round(usual.value)}px. Use the same page padding`,
		);
	}
}

const sameItems = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

function itemDifference(items: string[], usual: string[]) {
	const missing = usual.filter((item) => !items.includes(item));
	const extra = items.filter((item) => !usual.includes(item));
	const parts: string[] = [];

	if (missing.length) parts.push(`lacks ${missing.map(quote).join(", ")}`);

	if (extra.length) parts.push(`adds ${extra.map(quote).join(", ")}`);

	if (!parts.length) parts.push(`lists the same items in another order (${items.map(quote).join(", ")})`);

	return parts.join(" and ");
}

function checkBars(group: SampledScreen[], report: Report) {
	const placements: { kind: BarSample["kind"]; placement: BarPlacement }[] = [
		{ kind: "nav", placement: "top" },
		{ kind: "nav", placement: "bottom" },
		{ kind: "nav", placement: "left" },
		{ kind: "nav", placement: "right" },
		{ kind: "header", placement: "top" },
	];

	for (const { kind, placement } of placements) {
		const found = group.flatMap((screen) => {
			const bar = screen.sample.bars.find((candidate) => candidate.kind === kind && candidate.placement === placement);

			return bar ? [{ screen, bar }] : [];
		});

		if (!found.length) continue;
		const what = kind === "nav" ? `${PLACEMENT_WORDS[placement]} nav` : "header";
		const share = found.length / group.length;

		if (group.length >= MIN_SCREENS_FOR_MISSING && share >= MISSING_SHARE && found.length < group.length)
			for (const screen of group)
				if (!found.some((entry) => entry.screen === screen))
					report.add(
						screen.file,
						null,
						"nav-drift",
						`This screen has no ${what}, while ${found.length} of ${group.length} screens do. Add it, unless this screen leaves the flow on purpose`,
					);

		if (found.length < 2) continue;

		if (kind === "nav") {
			const usual = mostCommon(
				found.map(({ screen, bar }) => ({ key: bar.items.join("\n"), value: bar.items, screen: screen.file })),
			);

			if (usual && usual.count >= 2)
				for (const { screen, bar } of found)
					if (!sameItems(bar.items, usual.value))
						report.add(
							screen.file,
							bar,
							"nav-drift",
							`The ${what} ${itemDifference(bar.items, usual.value)}, unlike ${plural(usual.count, "screen")} with ${usual.value.map(quote).join(", ")}`,
						);
		}

		const sizes = mostCommon(
			found.map(({ screen, bar }) => ({
				key: String(round(bar.size / TOLERANCE_PX)),
				value: bar.size,
				screen: screen.file,
			})),
		);

		if (sizes && sizes.count >= 2)
			for (const { screen, bar } of found)
				if (differs(bar.size, sizes.value)) {
					const dimension = placement === "left" || placement === "right" ? "wide" : "tall";

					report.add(
						screen.file,
						bar,
						"nav-drift",
						`The ${what} is ${round(bar.size)}px ${dimension}; on ${plural(sizes.count, "screen")} it is ${round(sizes.value)}px`,
					);
				}
	}
}

/** Compares screens of the same width: controls, page padding and navigation. Findings by screen file */
export function consistencyFindings(screens: SampledScreen[]): Map<string, DesignFinding[]> {
	const report = new Report();

	for (const group of byWidth(screens)) {
		if (group.length < 2) continue;
		checkControls(group, report);
		checkInset(group, report);
		checkBars(group, report);
	}

	return report.byFile;
}
