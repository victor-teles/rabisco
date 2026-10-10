import type { ContextFileName, ProjectFiles } from "../types";
import { contextBody } from "./body";
import { CONTEXT_TEMPLATES } from "./templates";
import { designSourceOf, type AppliedTheme } from "./theme";
import { designTokensOf } from "./tokens";

// Starting points for a new project's DESIGN.md (Phase 16). Generations follow DESIGN.md, and without one
// every model falls back to its own palette; with tokens they use the theme classes (bench/gen).
// Fonts are system stacks: frames load no web fonts, and macOS ships every family named first.

export const STYLE_IDS = ["minimal", "editorial", "playful", "dense", "bold"] as const;

export type StyleId = (typeof STYLE_IDS)[number];

export const isStyleId = (value: string | null | undefined): value is StyleId => STYLE_IDS.some((id) => id === value);

type Tokens = Record<string, string>;

export type DesignStyle = {
	id: StyleId;
	label: string;
	/** One line in the picker */
	description: string;
	/** The font of the picker's "Aa" sample */
	sampleFont: string;
	light: Tokens;
	dark: Tokens;
	direction: string;
	typography: string;
	layout: string;
	components: string;
	rules: string;
};

const SANS = `system-ui, "Segoe UI", Roboto, sans-serif`;

const SERIF = `"Iowan Old Style", Charter, ui-serif, Georgia, serif`;

const ROUNDED = `ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;

const GROTESK = `"Avenir Next", "Helvetica Neue", system-ui, sans-serif`;

const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const STYLES: readonly DesignStyle[] = [
	{
		id: "minimal",
		label: "Minimal",
		description: "Neutral, precise, one dark accent",
		sampleFont: SANS,
		light: {
			background: "#ffffff",
			foreground: "#0a0a0a",
			card: "#ffffff",
			"card-foreground": "#0a0a0a",
			primary: "#171717",
			"primary-foreground": "#fafafa",
			secondary: "#f4f4f4",
			"secondary-foreground": "#171717",
			muted: "#f4f4f4",
			"muted-foreground": "#636363",
			accent: "#f4f4f4",
			"accent-foreground": "#171717",
			border: "#e6e6e6",
			input: "#e0e0e0",
			ring: "#a3a3a3",
			radius: "0.5rem",
			"font-sans": SANS,
		},
		dark: {
			background: "#0a0a0a",
			foreground: "#fafafa",
			card: "#141414",
			"card-foreground": "#fafafa",
			primary: "#fafafa",
			"primary-foreground": "#171717",
			secondary: "#262626",
			"secondary-foreground": "#fafafa",
			muted: "#262626",
			"muted-foreground": "#a3a3a3",
			accent: "#262626",
			"accent-foreground": "#fafafa",
			border: "#2a2a2a",
			input: "#333333",
			ring: "#737373",
		},
		direction:
			"Quiet and precise. White space does the work: few elements, aligned edges, no decoration. Color is almost absent, so the one dark primary button is always the next step.",
		typography:
			"Titles text-2xl font-semibold tracking-tight. Section labels text-sm font-medium. Body text-sm, secondary text text-muted-foreground. Numbers tabular-nums. Two weights per screen: regular and semibold.",
		layout:
			"4px grid. Mobile pages px-5, desktop content max-w-5xl. Sections 32px apart, items in a group 12px apart. Group with spacing and hairline dividers before reaching for boxes.",
		components:
			"Cards are bg-card with a border and no shadow. Buttons: one primary per screen, the rest outline or ghost. Lists use dividers, not one card per row. Icons are lucide at size-4, in text-muted-foreground.",
		rules:
			"Do: let one element lead each screen. Do: use text-muted-foreground for anything secondary.\nDon't: add shadows, gradients or colored backgrounds. Don't use more than one accent color.",
	},
	{
		id: "editorial",
		label: "Editorial",
		description: "Warm paper and serif headlines",
		sampleFont: SERIF,
		light: {
			background: "#faf7f2",
			foreground: "#1c1917",
			card: "#fffdf9",
			"card-foreground": "#1c1917",
			primary: "#9a3412",
			"primary-foreground": "#fffaf5",
			secondary: "#f0e9de",
			"secondary-foreground": "#1c1917",
			muted: "#f0e9de",
			"muted-foreground": "#655c53",
			accent: "#efe5d6",
			"accent-foreground": "#1c1917",
			border: "#e3dacb",
			input: "#d6cbb9",
			ring: "#9a3412",
			radius: "0.25rem",
			"font-sans": SANS,
			"font-serif": SERIF,
			"font-display": SERIF,
			"text-display": "2.75rem/1.05",
		},
		dark: {
			background: "#171412",
			foreground: "#f3ede4",
			card: "#1f1b18",
			"card-foreground": "#f3ede4",
			primary: "#f0a27a",
			"primary-foreground": "#1c1917",
			secondary: "#2a2420",
			"secondary-foreground": "#f3ede4",
			muted: "#2a2420",
			"muted-foreground": "#b3a899",
			accent: "#2f2823",
			"accent-foreground": "#f3ede4",
			border: "#332c27",
			input: "#3d3530",
			ring: "#f0a27a",
		},
		direction:
			"Like a well-made magazine: warm off-white paper, deep ink text, serif headlines and generous margins. One rust accent for links and the main action. Calm, unhurried, made for reading.",
		typography:
			"Headlines font-display, large titles text-display, page titles text-3xl, both tracking-tight. Body text-base/7 in font-sans, at most 65 characters a line. Small caps style labels: text-xs uppercase tracking-widest text-muted-foreground. Pull quotes in font-serif italic.",
		layout:
			"A single column with wide margins: mobile px-6, desktop max-w-3xl centered. Sections 48px apart. Images and quotes may break out of the column. Prefer rules (border-t) over boxes.",
		components:
			"Cards are flat: bg-card, a border, rounded-sm, no shadow. Buttons rounded-sm; the primary is solid, secondary actions are text links with an underline on hover. Lists read as articles: title in font-display, a one-line summary, a muted byline.",
		rules:
			"Do: lead every screen with a headline in font-display. Do: keep the accent for links and the one main action.\nDon't: use pill shapes, heavy shadows or bright fills. Don't set body text in the serif.",
	},
	{
		id: "playful",
		label: "Playful",
		description: "Rounded, soft color, friendly",
		sampleFont: ROUNDED,
		light: {
			background: "#fdfbff",
			foreground: "#1e1b2e",
			card: "#ffffff",
			"card-foreground": "#1e1b2e",
			primary: "#6d28d9",
			"primary-foreground": "#ffffff",
			secondary: "#fde7ef",
			"secondary-foreground": "#831843",
			muted: "#f3effa",
			"muted-foreground": "#5f5873",
			accent: "#ede5ff",
			"accent-foreground": "#4c1d95",
			border: "#e8e1f4",
			input: "#dcd3ec",
			ring: "#8b5cf6",
			success: "#15803d",
			warning: "#b45309",
			radius: "1.25rem",
			"font-sans": ROUNDED,
			"color-pop": "#ff7a59",
			"color-sun": "#ffd166",
		},
		dark: {
			background: "#15121f",
			foreground: "#f4f0ff",
			card: "#1e1a2b",
			"card-foreground": "#f4f0ff",
			primary: "#a78bfa",
			"primary-foreground": "#1e1b2e",
			secondary: "#3b1f2e",
			"secondary-foreground": "#fbcfe0",
			muted: "#262036",
			"muted-foreground": "#b3aac8",
			accent: "#2e2547",
			"accent-foreground": "#e4dbff",
			border: "#2e2840",
			input: "#3a3350",
			ring: "#a78bfa",
		},
		direction:
			"Friendly and encouraging. Big rounded corners, soft tinted surfaces and one violet primary. Coral (bg-pop) and yellow (bg-sun) are small moments of delight: badges, streaks, illustration shapes, never text.",
		typography:
			"Rounded type throughout (font-sans). Titles text-3xl font-bold tracking-tight. Body text-base. Numbers that matter are big: text-4xl font-bold tabular-nums. Short, warm copy.",
		layout:
			"Roomy: mobile px-5, cards p-5 with gap-4 between them. Sections 28px apart. Key actions are large (h-12) and full width on mobile, at the bottom of the screen.",
		components:
			"Cards rounded-lg with bg-card and a soft border; highlight cards use bg-accent. Buttons rounded-full. Icons sit in rounded-full tinted circles (bg-accent text-accent-foreground). Progress and streaks use bg-pop and bg-sun fills.",
		rules:
			"Do: celebrate progress with color and a short line of copy. Do: keep one primary action per screen.\nDon't: use bg-pop or bg-sun behind text. Don't use sharp corners or dense tables.",
	},
	{
		id: "dense",
		label: "Dense data",
		description: "Compact tables and charts",
		sampleFont: MONO,
		light: {
			background: "#ffffff",
			foreground: "#0f172a",
			card: "#ffffff",
			"card-foreground": "#0f172a",
			primary: "#2563eb",
			"primary-foreground": "#ffffff",
			secondary: "#f1f5f9",
			"secondary-foreground": "#0f172a",
			muted: "#f6f8fb",
			"muted-foreground": "#556072",
			accent: "#eef3ff",
			"accent-foreground": "#1e3a8a",
			border: "#e2e8f0",
			input: "#cbd5e1",
			ring: "#2563eb",
			destructive: "#dc2626",
			success: "#15803d",
			warning: "#b45309",
			"chart-1": "#2563eb",
			"chart-2": "#0d9488",
			"chart-3": "#f59e0b",
			"chart-4": "#8b5cf6",
			"chart-5": "#ec4899",
			radius: "0.375rem",
			"font-sans": SANS,
			"font-mono": MONO,
		},
		dark: {
			background: "#0b1120",
			foreground: "#e2e8f0",
			card: "#111a2e",
			"card-foreground": "#e2e8f0",
			primary: "#2563eb",
			"primary-foreground": "#ffffff",
			secondary: "#1e293b",
			"secondary-foreground": "#e2e8f0",
			muted: "#162036",
			"muted-foreground": "#94a3b8",
			accent: "#172554",
			"accent-foreground": "#dbeafe",
			border: "#1e293b",
			input: "#334155",
			ring: "#3b82f6",
		},
		direction:
			"A working tool for people who look at numbers all day. Compact and scannable: tables, small charts and status at a glance. Blue marks what is interactive or selected; status colors only mean status.",
		typography:
			"UI text text-sm, table cells and labels text-xs. Page titles text-lg font-semibold. Every number tabular-nums; IDs, codes and timestamps in font-mono. Metric values text-2xl font-semibold.",
		layout:
			"Desktop first: a sidebar, a toolbar, then the content at full width. Dense spacing: cards p-4, table rows h-9, gap-3 between panels. Put filters and actions in the toolbar, not in the content.",
		components:
			"Tables with a muted header row (bg-muted text-xs text-muted-foreground) and border-b rows, right-aligned numbers. Charts use chart-1 to chart-5 in order. Badges for status (success, warning, destructive). Cards have a border, rounded-md, no shadow.",
		rules:
			"Do: show trends next to numbers (arrow and percent). Do: align numbers on the right.\nDon't: use large illustrations or hero sections. Don't use the primary blue for status.",
	},
	{
		id: "bold",
		label: "Bold",
		description: "Big type, black and lime",
		sampleFont: GROTESK,
		light: {
			background: "#ffffff",
			foreground: "#0b0b0f",
			card: "#f5f5f2",
			"card-foreground": "#0b0b0f",
			primary: "#0b0b0f",
			"primary-foreground": "#ffffff",
			secondary: "#ececea",
			"secondary-foreground": "#0b0b0f",
			muted: "#f2f2ef",
			"muted-foreground": "#5c5c57",
			accent: "#ececea",
			"accent-foreground": "#0b0b0f",
			border: "#e4e4e0",
			input: "#d6d6d1",
			ring: "#0b0b0f",
			radius: "0.875rem",
			"font-sans": GROTESK,
			"font-display": GROTESK,
			"text-display": "3.5rem/1",
			"color-brand": "#d4ff3a",
			"color-brand-foreground": "#0b0b0f",
		},
		dark: {
			background: "#0b0b0f",
			foreground: "#ffffff",
			card: "#17171c",
			"card-foreground": "#ffffff",
			primary: "#ffffff",
			"primary-foreground": "#0b0b0f",
			secondary: "#232329",
			"secondary-foreground": "#ffffff",
			muted: "#1c1c22",
			"muted-foreground": "#a1a1a8",
			accent: "#232329",
			"accent-foreground": "#ffffff",
			border: "#2a2a31",
			input: "#34343c",
			ring: "#d4ff3a",
		},
		direction:
			"Confident and graphic. Black and white with one electric lime (bg-brand). Huge headlines, strong contrast, big blocks of color. Hero areas and key numbers may sit on black (bg-primary text-primary-foreground) or lime (bg-brand text-brand-foreground).",
		typography:
			"Headlines font-display font-bold tracking-tighter: text-display for heroes, text-4xl for page titles. Body text-base font-medium. Labels text-xs font-semibold uppercase tracking-wide.",
		layout:
			"Big blocks: full-width sections with py-10, cards p-6. Mobile px-5. One idea per section. Let a headline or a number fill the width.",
		components:
			"Cards are filled (bg-card) with no border, rounded-lg. Buttons rounded-full, h-12, font-semibold; the main one is bg-brand text-brand-foreground or black. Badges are small black or lime pills.",
		rules:
			"Do: use lime for one thing per screen. Do: make the headline the biggest thing on the screen.\nDon't: use lime for text on white, or gray body text that fights the contrast. Don't add gradients or soft shadows.",
	},
];

export const styleById = (id: StyleId) => STYLES.find((style) => style.id === id)!;

const tokenLines = (tokens: Tokens) =>
	Object.entries(tokens)
		.map(([name, value]) => `- ${name}: ${value}`)
		.join("\n");

/** In the order of the prompt's DESIGN.md format, so a later "Write my DESIGN.md" keeps the shape */
export function styleDesign(id: StyleId): string {
	const style = styleById(id);

	return `# Design

Started from the ${style.label} style. Edit anything: generations follow this file.

## Tokens

${tokenLines(style.light)}

### Dark

${tokenLines(style.dark)}

## Visual direction

${style.direction}

## Typography

${style.typography}

## Layout & spacing

${style.layout}

## Components

${style.components}

## Do / Don't

${style.rules}
`;
}

/** The context files of a new project; without a style DESIGN.md stays the template */
export function starterFiles(style: StyleId | null | undefined): Record<ContextFileName, string> {
	return style ? { ...CONTEXT_TEMPLATES, "DESIGN.md": styleDesign(style) } : { ...CONTEXT_TEMPLATES };
}

/** DESIGN.md is missing or still the template, so a style can start it without replacing anyone's words */
export const lacksDesignDirection = (design: string | undefined) => contextBody(design) === undefined;

/**
 * Writes the style's DESIGN.md and applies its tokens in the same step: picking a style asks for the new look, so no
 * "Apply to screens" prompt follows. A DESIGN.md that gained a direction in the meantime is kept.
 */
export function withStyle<T extends { files: ProjectFiles; theme?: AppliedTheme }>(snapshot: T, id: StyleId): T {
	if (!lacksDesignDirection(snapshot.files["DESIGN.md"])) return snapshot;

	const design = styleDesign(id);
	const theme: AppliedTheme = { ...designTokensOf(design), source: designSourceOf(design) };

	return { ...snapshot, files: { ...snapshot.files, "DESIGN.md": design }, theme };
}
