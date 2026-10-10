import type { ElementFocus, GenerationPlan, GenerationRequest } from "../../shared/ai/contract";
import { PLAN_LIMITS } from "../../shared/ai/plan";
import { FILE_RULES } from "../../shared/ai/contract";
import { contextBody } from "../../shared/context/body";
import { FRAME_SIZE } from "../../shared/project";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { componentSignatures } from "../../shared/components/usages";
import { stagedAttachments } from "./attachments";
import { themeTokensText } from "./theme-tokens";

/** Bump when a prompt change affects output; logged with each generation. */
export const PROMPT_VERSION = 17;

export type PromptMode = "text" | "agent";

export { UI_MODULES };

const uiModuleList = () =>
	Object.entries(UI_MODULES)
		.map(([name, exports]) => `- @/components/ui/${name}: ${exports.join(", ")}`)
		.join("\n");

/** Only the props a mockup needs; the parts' names say the rest */
const UI_BLOCK_HINTS = `- MetricCard (variant card | plain | compact) > MetricCardHeader > MetricCardLabel + MetricCardTrend direction="up" | "down" | "flat"; then MetricCardValue, MetricCardComparison, MetricCardDescription.
- StatusBanner tone="info" | "success" | "warning" | "error" (variant card | tinted | bar) > StatusBannerIcon, StatusBannerContent > StatusBannerTitle + StatusBannerDescription, StatusBannerActions > StatusBannerAction, StatusBannerDismiss.
- StepIndicator (variant horizontal | vertical | compact) > StepIndicatorStep status="complete" | "current" | "upcoming" | "blocked" | "error" > StepIndicatorTitle + StepIndicatorDescription.
- SearchField (defaultValue, status idle | loading | empty | error) > SearchFieldLabel, SearchFieldControl > SearchFieldInput + SearchFieldClear, SearchFieldMessage, SearchFieldRecent > SearchFieldRecentItem value="…".
- FormField (defaultValue, required, invalid, maxLength; variant outlined | filled | compact) > FormFieldLabel, FormFieldInput or FormFieldTextarea, FormFieldDescription, FormFieldError, FormFieldCount. The value goes on FormField, not the input.
- FormErrorSummary > FormErrorSummaryTitle, FormErrorSummaryList > FormErrorSummaryLink fieldId="<input id>".
- Message from="user" | "assistant" (variant bubble | plain | compact) > MessageAvatar, MessageBody > MessageHeader > MessageAuthor + MessageTime; MessageContent; MessageActions > MessageCopy, MessageAction label="…".
- PromptComposer (defaultValue, busy) > PromptComposerAdd > PromptComposerAddItem; PromptComposerInput placeholder="…", PromptComposerActions > PromptComposerModelSelect models={[{ id, label }]} + PromptComposerSubmit.
- Thinking status="thinking" | "complete" | "error" > ThinkingTrigger duration="12s", ThinkingContent > ThinkingActivity type="progress" | "search" query="…" | "file" path="…" | "tool" tool="…".`;

const frameOf = (request: GenerationRequest) => {
	const { width, height } = FRAME_SIZE[request.device];

	return `${request.device}, ${width}×${height} px`;
};

/** Without its own layout a tablet comes out as a stretched phone, and a desktop as one full-width column */
const DEVICE_NOTES: Record<GenerationRequest["device"], string> = {
	mobile:
		" Leave about 48px at the top for the status bar and 34px at the bottom for the home indicator. A top bar (title, or back and one action), one scrolling column with 16–20px side padding, and on top-level screens a bottom tab bar of 3–5 icon and label tabs; detail screens and flows get a back button instead, and a full-width primary button at the bottom when there is a main action. Touch targets at least 44px.",
	tablet:
		" Leave about 24px at the top for the status bar. Use the width: a sidebar or a list beside its detail, two-column grids and forms, 32px page padding. Never a single phone-width column stretched across the frame.",
	desktop:
		" A 240–280px sidebar (a top nav for marketing pages) and a content area with 32px padding. Cap text at max-w-3xl and dashboards at max-w-7xl; use the width for columns: a list beside its detail, a main column with a side panel, grids of 3–4 cards.",
};

const ROLE = `You are the design engine of Rabisco, a design canvas. You design app screens as React + Tailwind CSS v4 TSX files. Each screen renders live in a fixed-size frame on the canvas, like a static mockup that is real code.`;

const DESIGN_RULES = `# Design
- Follow DESIGN.md when the project has one; it overrides the defaults below. Stay consistent with the project's existing screens.
- Use the shadcn theme tokens for neutral surfaces and text: bg-background, text-foreground, bg-muted, text-muted-foreground, bg-card, border, bg-primary, text-primary-foreground, ring. Add one accent color with Tailwind's palette when the brief calls for it.
- Anything DESIGN.md defines as a token is used through its theme class, never a hard-coded palette color: bg-primary / text-primary-foreground for the primary color, bg-secondary, bg-accent, bg-muted, text-muted-foreground, bg-card, border, ring, text-destructive, rounded-lg / rounded-md / rounded-sm for the radius, font-sans, and the custom classes under "# Theme tokens" in the request. A token change then re-themes every screen.
- One focal point per screen: the thing the user came for (a balance, the next step, a hero) is the largest, highest-contrast element. One primary button (bg-primary); other actions are secondary, outline or ghost.
- Hierarchy through size, weight and color, not boxes: group with spacing and a heading first, a divider second, a card last. Never nest cards.
- Type scale: text-xs captions, text-sm UI and body text, text-base reading text, text-lg–xl section titles, text-2xl–3xl page titles, larger only for the focal number. At most 4 sizes a screen. font-medium and font-semibold for emphasis; tracking-tight from text-2xl up; tabular-nums on numbers in columns or that change.
- Spacing on the 4px grid, in a rhythm: gap-1–2 inside a control, gap-3–4 between items, gap-6–8 between sections; the same page padding on every screen. Align to a few edges.
- Realistic, specific content, as dense as the real app: plausible names, numbers, dates and copy; 5–8 rows in a list, not 2. Never lorem ipsum, never "Item 1".
- Text contrast at least 4.5:1 (3:1 from 24px): text-muted-foreground is the lightest text; text on a photo needs a scrim.
- States only when the request names them: empty (a title, one line of help, the action), loading (bg-muted animate-pulse skeletons in the shape of the content), error (what happened and how to fix it: StatusBanner, FormFieldError).
- No network images. Draw images with Placeholder: <Placeholder kind="photo" subject="food" seed="brunch" className="aspect-[4/3] w-full rounded-lg" />. kind photo (subject landscape, food, interior, product, people, abstract), avatar, map (pin), chart (subject area, line, bar) or illustration (subject tiles, empty, success, error); size it with className, and a different seed gives a different image. Icons come from lucide-react.
- Tailwind classes only; inline style just for dynamic values. No <style> tags, no CSS imports.
- Screens are mockups: light interactivity with useState is fine; no data fetching, timers, routing, window or document access.`;

const FILE_RULES_TEXT = (request: GenerationRequest) => `# Files
- Screens: screens/<kebab-name>.tsx. Components: components/<kebab-name>.tsx. Lowercase letters, digits and hyphens only. No other files, except the target of a context task.
- A screen default-exports one component: \`export default function OrderHistory() {…}\`. Its root fills the frame: \`h-full\` for app layouts with fixed bars (content area scrolls with overflow-y-auto), \`min-h-full\` for pages that grow.
- The frame is ${frameOf(request)}. Design for exactly that size; never set a root width.${DEVICE_NOTES[request.device]}
- Components use named exports only (\`export function StatCard…\`), never default exports.
- Imports allowed: react, lucide-react, @/lib/utils (\`cn\`), the @/components/ui modules below, and project components as \`../components/<kebab-name>\` (same form from screens and components, no extension). Nothing else: no other packages.
- Keep every \`data-link-to\` attribute when you edit a file: it is a prototype link (\`data-link-to="screens/<name>.tsx"\` or \`"back"\`). To add navigation, put \`data-link-to\` with the target screen's path on the clickable element.
- Every file you write is complete: never a diff, never "// rest unchanged" or "..." placeholders. Under ${FILE_RULES.maxFileLength.toLocaleString("en-US")} characters.

# Components
- Project components come first. Before writing any JSX, check the "# Project components" list in the request, and import a component for any UI it covers instead of re-implementing its markup, even in part.
- Create a new component only when the same UI appears in 2 or more places (in the files you write, or across screens) or is clearly reusable, and no existing component fits.
- Never create a near-duplicate of an existing component under a new name, and never export a name another component file already exports.
- When a component almost fits, extend it instead of forking it: add an optional prop or variant whose default keeps its current look, and update every file that uses it if you change its props.
- Build components from the UI modules below (Button, Card, Badge…) rather than raw elements with copied classes.

# Available UI modules
${uiModuleList()}

# UI blocks
The @/components/ui/uai modules are composed blocks: the parts go inside the root part, which sets the variant and state. Prefer a block over rebuilding the same UI from primitives.
${UI_BLOCK_HINTS}`;

const TASKS = `# Tasks
- create: design new screens for the request (usually 1–3; the key screens of the flow unless the request says how many). New paths must not overwrite existing files.
- edit: change the target files as asked. Keep everything the request doesn't mention as it is. Keep their paths.
- repair: the listed files failed validation. Fix every problem with the smallest change and keep the design. Keep their paths.
- context: write the project's PRODUCT.md or DESIGN.md (the one target), and no other file.`;

const TEXT_PROTOCOL_RULES = `# Output format
Write each file inside a tag, with the complete file and nothing else between the tags (no markdown fences):

<rabisco-file path="screens/order-history.tsx" kind="screen" name="Order history" device="DEVICE">
import { Package } from "lucide-react";
…
</rabisco-file>

- kind is "screen" or "component" ("context" for PRODUCT.md and DESIGN.md, in the context task only). name (a short human title) and device go on screens only.
- To remove a file: <rabisco-delete path="screens/old.tsx" />
- Outside tags, write one or two short sentences for the user about what you made. No code outside tags.

In the edit and repair tasks, change a file you were given with search/replace blocks instead of writing it again:

<rabisco-edit path="screens/order-history.tsx">
<<<<<<< SEARCH
			<h1 className="text-2xl font-semibold">Orders</h1>
=======
			<h1 className="text-3xl font-bold">Order history</h1>
>>>>>>> REPLACE
</rabisco-edit>

- SEARCH copies whole lines of the current file exactly, indentation included, and enough of them to match one place only. Use one small block per place, in file order.
- When most of a file changes, write it whole in a <rabisco-file> tag instead. New files always use <rabisco-file>.`;

const AGENT_RULES = `# How to work
- Write files with your tools in the current directory. Only write screens/<kebab-name>.tsx and components/<kebab-name>.tsx (in the context task, only its target: PRODUCT.md or DESIGN.md); delete a file to remove it.
- The project's relevant files are already there. Read them before changing them.
- Don't install packages, run builds, start servers or create any other file. Rabisco compiles and renders the files itself.
- End with one or two short sentences for the user about what you made.`;

const DESIGN_MD_FORMAT = `# DESIGN.md format
Sections, in this order: Tokens, Visual direction, Typography, Layout & spacing, Components, Do / Don't. Short and concrete: rules a designer could check a screen against, not adjectives.

The Tokens section is read by Rabisco and becomes the theme every screen renders with. Write it exactly like this:

## Tokens

- primary: oklch(0.55 0.2 264)
- primary-foreground: #ffffff
- radius: 0.75rem
- font-sans: "Inter", system-ui, sans-serif

### Dark

- primary: oklch(0.7 0.15 264)

Rules for the Tokens section:
- One \`- name: value\` per line. Names: background, foreground, card, card-foreground, popover, popover-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, success, warning, border, input, ring, chart-1 to chart-5, radius, spacing, font-sans, font-serif, font-mono.
- Custom tokens name their Tailwind class: color-brand (bg-brand), radius-card (rounded-card), font-display, text-display: 3rem/1.1 (font size and line height), spacing-gutter (p-gutter). Add one only for a value the design repeats and the built-in names don't cover. No other names.
- Colors are hex, rgb(), hsl() or oklch(). radius and spacing are lengths. Fonts are font stacks.
- Only list tokens the design actually sets; the rest keep their defaults. The "### Dark" sub-section holds dark-theme values and may be left out.`;

const PRODUCT_MD_FORMAT = `# PRODUCT.md format
Sections, in this order: Product (what it is and the problem it solves, in a few sentences), Audience (who uses it, their situation and what they need), Voice (how the product speaks: tone, words to use and avoid, with an example line), Constraints (platforms, accessibility, legal, content or brand limits). Use "## " headings. Plain, specific sentences in the user's own terms; don't invent facts they didn't give.`;

const THEME_ROLE = `You read design documents for Rabisco, a design canvas whose screens are styled with the shadcn/ui theme variables. You turn a DESIGN.md, written in any format (prose, tables, YAML, token references), into Rabisco's theme tokens.`;

const THEME_RULES = `# Output
Reply with only this block, in this format, and nothing else:

## Tokens

- background: #ffffff
- foreground: #0a0b0d
- primary: #0052ff
- primary-foreground: #ffffff
- radius: 0.75rem
- font-sans: "Inter", system-ui, sans-serif

### Dark

- background: #0a0b0d

# Token names
Map the document's own names onto these by meaning. No other names.
- background: the page; foreground: the main text on it.
- card, popover (each with -foreground): raised surfaces and their text, only when the document sets them apart from the page.
- primary, primary-foreground: the main action or brand color, and the text on it.
- secondary, secondary-foreground: the fill and text of secondary buttons.
- muted: a subtle background (soft bands, tags, input fills). muted-foreground: secondary text (captions, hints, gray body text).
- accent, accent-foreground: hover and selected fills in menus and lists.
- destructive, success, warning: status colors.
- border: dividers and outlines. input: input borders. ring: the focus ring.
- chart-1 to chart-5: data visualization colors.
- radius: the base corner radius that cards and inputs use (not pills or circles).
- font-sans (body and UI text), font-serif, font-mono: CSS font stacks. For licensed or custom fonts, use the substitute the document names, else a close widely available font, then system fallbacks.

# Rules
- Only include tokens the document states or clearly implies. Leave the rest out: they keep Rabisco's defaults. Don't invent colors.
- Values are plain CSS: colors as hex, rgb(), hsl() or oklch(); radius as a length (0.75rem, 12px); fonts as a font stack, quoting names with spaces ("SF Pro Text", system-ui, sans-serif). Resolve references like {colors.primary} to their values.
- Light values go under "## Tokens". Add "### Dark" only if the document describes a dark theme or dark mode for the whole interface, not just a dark section or hero; then give the dark values of the same roles.
- Keep each text color readable on its fill (foreground on background, primary-foreground on primary, every -foreground pair): at least 4.5:1 contrast. When the document gives no text color for a fill, use white or near-black, whichever reads better.
- Don't write, edit or delete any file: DESIGN.md stays as it is. Everything you need is in the request.`;

const PLAN_ROLE = `You plan app flows for Rabisco, a design canvas. Before any screen is designed, you decide which screens a request needs, the parts they share, and how they link. Each screen is then written separately, in parallel, from your plan.`;

const PLAN_RULES = `# Output
Reply with only one JSON block in a \`\`\`json fence, in this shape, and nothing else:

\`\`\`json
{
	"screens": [
		{ "path": "screens/home.tsx", "name": "Home", "purpose": "Today's habits and the streak.", "content": "greeting, streak card, 4 habit rows, tab bar" },
		{ "path": "screens/habit-detail.tsx", "name": "Habit detail", "purpose": "One habit's history.", "content": "header with back, 30-day grid, notes" }
	],
	"components": [
		{ "path": "components/tab-bar.tsx", "name": "TabBar", "purpose": "Bottom navigation with Today, Stats and Profile; takes the active tab.", "usedBy": ["screens/home.tsx"] },
		{ "path": "components/habit-row.tsx", "name": "HabitRow", "purpose": "A habit's icon, name, streak and check button.", "usedBy": ["screens/home.tsx", "screens/habit-detail.tsx"] }
	],
	"links": [
		{ "from": "screens/home.tsx", "to": "screens/habit-detail.tsx", "label": "A habit row" }
	]
}
\`\`\`

# Rules
- screens: the screens the request needs, in the order of the flow. Usually 2 to 4, at most ${PLAN_LIMITS.screens}; exactly 1 when the request asks for one screen. path is screens/<kebab-name>.tsx and must not be an existing screen. name is a short title. purpose is one line. content lists the key content in a few words.
- components: the parts that 2 or more screens share and that must look the same on each: navigation (tab bar, sidebar, top bar), a screen header, a list row, a summary card. At most ${PLAN_LIMITS.components}, and none for a single screen. path is components/<kebab-name>.tsx; name is its PascalCase export. Never plan a part the project components already cover: the screens import those. usedBy lists the paths of the screens that use it.
- links: how the user moves between the screens. from is a planned screen; to is a planned or existing screen; label names the control (a button, a row, a tab).
- Plain words in purpose and content; no code. Don't write, edit or delete any file: everything you need is in the request.`;

const BRIEF_ROLE = `You help people brief Rabisco, a design canvas that turns a prompt into editable app screens. You turn a short prompt into a clear design brief that the person reads, edits and then sends.`;

const BRIEF_RULES = `# Output
Reply with only the brief, as plain text the person can edit: no heading, no preamble, no closing remark, no code fence.

# The brief
- Open with one sentence: what to design and for whom.
- Then short lines starting with "- ": the screens or sections, the key content of each (real-sounding names, numbers and copy), the main action, and the states worth showing (empty, loading, error) only when they matter.
- End with one line on the look and feel: the mood, color, type and density.
- 60 to 140 words. Plain, concrete words; no marketing language.

# Rules
- Keep everything the prompt asks for, in its own terms. Add only what a designer would need to start, and nothing that contradicts it.
- Follow PRODUCT.md (the product, audience, voice and constraints) and DESIGN.md's direction when they are given; then the look line follows DESIGN.md instead of inventing one.
- Write in the language of the prompt.
- Don't write, edit or delete any file. Everything you need is in the request.`;

const contextFileOf = (request: GenerationRequest) =>
	request.targets?.find((path) => FILE_RULES.paths.context.test(path));

export function systemPrompt(request: GenerationRequest, mode: PromptMode): string {
	if (request.task === "theme") return [THEME_ROLE, THEME_RULES].join("\n\n");

	if (request.task === "plan") return [PLAN_ROLE, PLAN_RULES].join("\n\n");

	if (request.task === "brief") return [BRIEF_ROLE, BRIEF_RULES].join("\n\n");

	const output = mode === "text" ? TEXT_PROTOCOL_RULES.replace("DEVICE", request.device) : AGENT_RULES;
	const target = contextFileOf(request);
	const format = target === "DESIGN.md" ? [DESIGN_MD_FORMAT] : target === "PRODUCT.md" ? [PRODUCT_MD_FORMAT] : [];

	return [ROLE, DESIGN_RULES, FILE_RULES_TEXT(request), TASKS, ...format, output].join("\n\n");
}

const section = (tag: string, body: string) => `<${tag}>\n${body.trim()}\n</${tag}>`;

function taskText(request: GenerationRequest, mode: PromptMode): string {
	const targets = request.targets?.length ? request.targets.map((path) => `- ${path}`).join("\n") : "";

	switch (request.task) {
		case "create": {
			if (request.plan && request.writes?.length) return plannedTaskText(request, request.plan, request.writes, mode);
			const existing = request.files.map((file) => file.path).filter((path) => path.startsWith("screens/"));
			const taken = existing.length ? ` Existing screens (pick other paths): ${existing.join(", ")}.` : "";

			return `Task: create. Design new ${frameOf(request)} screens for the request below.${taken}`;
		}

		case "edit":
			return `Task: edit. Change these files as the request below asks${mode === "text" ? ", with <rabisco-edit> blocks (or the whole file when most of it changes)" : ""}:\n${targets || "- (the files above)"}`;
		case "repair": {
			const problems = (request.problems ?? [])
				.map((problem) => `- ${problem.path}${problem.line ? `:${problem.line}` : ""}: ${problem.message}`)
				.join("\n");

			if (!problems)
				return `Task: repair. Review these files as the request below asks${mode === "text" ? ", and change only what needs it, with <rabisco-edit> blocks" : ""}:\n${targets}`;

			return `Task: repair. These files failed validation. Fix every problem${mode === "text" ? " with <rabisco-edit> blocks, or write the whole file when a problem asks for it" : ""}:\n${problems || targets}`;
		}

		case "context":
			return contextTaskText(request, mode);
		case "theme":
			return `Task: theme. Read the theme of the DESIGN.md above and reply with its "## Tokens" block${mode === "agent" ? ", as text. Don't write any file" : ""}.`;
		case "plan": {
			const screens = request.projectScreens?.length
				? ` Existing screens (pick other paths; links may point at them): ${request.projectScreens.join(", ")}.`
				: "";

			return `Task: plan. Plan the ${frameOf(request)} screens for the request below, their shared components and the links between them.${screens} Reply with the JSON block${mode === "agent" ? " as text. Don't write any file" : ""}.`;
		}

		case "brief":
			return `Task: brief. Expand the request below into a brief for ${frameOf(request)} screens${mode === "agent" ? ". Reply with it as text. Don't write any file" : ""}.`;
	}
}

/** The accepted plan, in every run that follows it */
export function planText(plan: GenerationPlan): string {
	const screens = plan.screens.map(
		(screen) =>
			`- ${screen.path} · "${screen.name}": ${screen.purpose}${screen.content ? ` Content: ${screen.content}.` : ""}`,
	);

	const components = plan.components.map(
		(component) =>
			`- ${component.path} · ${component.name}: ${component.purpose}${component.usedBy.length ? ` Used by ${component.usedBy.join(", ")}.` : ""}`,
	);

	const links = plan.links.map((link) => `- ${link.from} → ${link.to}${link.label ? ` (${link.label})` : ""}`);

	return [
		"# Plan\nThe user accepted this plan for the flow. Follow it: the same screens, names, shared parts and links.",
		`Screens:\n${screens.join("\n")}`,
		components.length ? `Shared components:\n${components.join("\n")}` : "",
		links.length ? `Links:\n${links.join("\n")}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Shared components first, in one run; then one run per screen, in parallel, importing them */
function plannedTaskText(request: GenerationRequest, plan: GenerationPlan, writes: string[], mode: PromptMode) {
	const screen = plan.screens.find((s) => writes.includes(s.path));

	if (!screen) {
		return `Task: create. Write the plan's shared components, and only these files:
${writes.map((path) => `- ${path}`).join("\n")}
No screens: they are written next, in parallel, and each one imports these. Give every component the props its screens need (the active tab, a title, actions), with defaults, so each screen can use it as it is. Named exports only.`;
	}

	const shared = plan.components.length
		? ` Import the shared components (${plan.components.map((c) => c.name).join(", ")}, under "# Project components") for the parts they cover, and never rebuild their markup: they must look the same on every screen.`
		: "";

	const links = plan.links.filter((link) => link.from === screen.path);

	const linkText = links.length
		? `\nAdd these links with data-link-to on the clickable element:\n${links.map((link) => `- ${link.label || "a control"} → data-link-to="${link.to}"`).join("\n")}`
		: "";

	const meta = mode === "text" ? ` with name="${screen.name}"` : "";

	return `Task: create. Write exactly one file: ${screen.path}${meta}, the "${screen.name}" screen of the plan (${frameOf(request)}). The plan's other screens are written at the same time by separate runs.${shared} Don't write or change any other file; keep small helpers inside the screen file.${linkText}`;
}

function contextTaskText(request: GenerationRequest, mode: PromptMode): string {
	const target = contextFileOf(request) ?? "DESIGN.md";
	const exists = request.files.some((file) => file.path === target);

	const output =
		mode === "text"
			? `Write it as <rabisco-file path="${target}" kind="context">…</rabisco-file>, complete, and no other file.`
			: `Write ${target} in the current directory, and no other file.`;

	const current = exists
		? ` The current ${target} is above: keep what it says that still holds, and replace its HTML comments (template guidance) with real content.`
		: "";

	if (target === "DESIGN.md" && !request.files.some((file) => file.path.startsWith("screens/"))) {
		return `Task: context. Write DESIGN.md for a new project from the request below: the look it describes (mood, color, type, density) and, when PRODUCT.md is given, who the product is for. Choose concrete tokens that express that look, with light and dark values, and readable text on every fill (4.5:1).${current} ${output}`;
	}

	if (target === "DESIGN.md") {
		return `Task: context. Write DESIGN.md: infer the design language from the project's existing screens and components above (colors, radius, type, spacing, recurring components) and describe it so new screens match. Use the colors the screens actually use for the tokens.${current} ${output}`;
	}

	return `Task: context. Write PRODUCT.md from the answers in the request below: what the product is, who it's for, its voice and its constraints.${current} ${output}`;
}

/** `direction` is the user's (e.g. "bolder"), or empty. */
export function varyPrompt(direction: string) {
	return [
		"Make a new variation of this screen. Keep its purpose and content (the same information, actions and copy), and explore a different layout and visual treatment.",
		`Direction: ${direction.trim() || "a distinct alternative"}.`,
		"Write it to the same path. Rabisco saves it as a new alternate and keeps the original as it is.",
	].join("\n");
}

function componentsText(request: GenerationRequest, mode: PromptMode): string | null {
	if (request.task === "context" || request.task === "theme") return null;

	const catalog =
		request.components ??
		componentSignatures(Object.fromEntries(request.files.map((file) => [file.path, file.content])));

	if (!catalog.length) return null;
	const included = new Set(request.files.map((file) => file.path));

	const entries = catalog.map(({ path, signature, usedBy }) => {
		const users = usedBy?.length ? ` (used by ${usedBy.join(", ")})` : "";
		const lines = signature.length ? signature.map((line) => `  ${line}`) : ["  (no exported components found)"];

		return [`- ${path}${users}`, ...lines].join("\n");
	});

	const missing = catalog.some(({ path }) => !included.has(path));

	const note = missing
		? `\nSome components aren't ${mode === "text" ? "in the project files above" : "in the current directory"}; import them anyway, their signature is all you need.`
		: "";

	return `# Project components
Reuse these for any matching UI: import them (\`import { Name } from "../components/<kebab-name>"\`) instead of writing that markup again. If one almost fits, extend it with an optional prop or variant rather than creating a similar component.${note}

${entries.join("\n")}`;
}

/** Longer elements are cut; the file has the rest */
const FOCUS_LINES = 120;

/** Whole lines from the file when it is in `files`, else the snippet. */
export function numberedSnippet(focus: ElementFocus, content?: string): string {
	const whole = content !== undefined && content.slice(focus.start, focus.end) === focus.snippet;
	const lines = whole ? content.split("\n").slice(focus.startLine - 1, focus.endLine) : focus.snippet.split("\n");
	const shown = lines.slice(0, FOCUS_LINES);
	const width = String(focus.startLine + shown.length - 1).length;
	const numbered = shown.map((line, i) => `${String(focus.startLine + i).padStart(width)} | ${line}`.trimEnd());

	if (lines.length > shown.length)
		numbered.push(`… ${lines.length - shown.length} more lines, to line ${focus.endLine}`);

	return numbered.join("\n");
}

/** A repair only gets a reminder: the element's lines moved with the first attempt. */
function focusText(request: GenerationRequest, mode: PromptMode): string | null {
	const focus = request.focus;

	if (!focus || !request.targets?.includes(focus.file)) return null;

	const lines =
		focus.startLine === focus.endLine ? `line ${focus.startLine}` : `lines ${focus.startLine}–${focus.endLine}`;

	if (request.task === "repair") {
		return `The request was about one element of ${focus.file}: ${focus.label}. Fix the problems without changing anything else in that file.`;
	}

	if (request.task !== "edit") return null;
	const content = request.files.find((file) => file.path === focus.file)?.content;

	return `# Focus
The user selected one element in ${focus.file}: ${focus.label}, ${lines}. Apply the request to that element only.
- Change that element and what it contains. You may also add what it needs: imports, or a small helper component (in the same file, or in components/ when it is reusable).
- Keep the rest of ${focus.file} exactly as it is: the markup, classes, copy and order outside ${lines} don't change.
- ${mode === "text" ? `Send the change as <rabisco-edit> blocks. Copy SEARCH lines from the file itself, without the line numbers shown below.` : `Edit ${focus.file} in place; leave everything outside the element as it is.`}
- If the request can't be done inside the element, make the smallest change outside it and say so in your reply.

${numberedSnippet(focus, content)}`;
}

function variationText(variation: NonNullable<GenerationRequest["variation"]>) {
	return `This is variation ${variation.index + 1} of ${variation.count}. The others answer the same request separately, so take a visibly distinct direction: a different layout, composition and emphasis, while keeping the project's tokens and DESIGN.md. Use the file paths you would use anyway.`;
}

/** API models get the images in the message; agents open the copies in their staging directory. */
function attachmentsText(request: GenerationRequest, mode: PromptMode) {
	if (!request.attachments?.length) return null;

	if (mode === "text") {
		return `Attached images, sent with this message: ${request.attachments.map((a) => a.name).join(", ")}. Use them as reference for the request.`;
	}

	const paths = stagedAttachments(request).map((staged) => `- ${staged.path} (${staged.attachment.name})`);

	return `Attached images, in the current directory. Open each one with your file tools before you start, and use them as reference for the request. Don't change, move or copy them:\n${paths.join("\n")}`;
}

export function userPrompt(request: GenerationRequest, mode: PromptMode): string {
	const parts: string[] = [];
	const product = contextBody(request.context.product);
	const design = contextBody(request.context.design);

	if (product) parts.push(section("product", product));

	if (design) parts.push(section("design", design));

	if (request.files.length) {
		if (mode === "text") {
			const files = request.files.map(
				(file) => `<project-file path="${file.path}">\n${file.content.replace(/\n$/, "")}\n</project-file>`,
			);

			parts.push(`Project files:\n\n${files.join("\n\n")}`);
		} else {
			parts.push(
				`Project files already in the current directory:\n${request.files.map((file) => `- ${file.path}`).join("\n")}`,
			);
		}
	}

	const components = componentsText(request, mode);

	if (components) parts.push(components);

	const tokens =
		request.task === "context" || request.task === "theme" || request.task === "plan" || !request.theme
			? null
			: themeTokensText(request.theme);

	if (tokens) parts.push(tokens);

	const attachments = attachmentsText(request, mode);

	if (attachments) parts.push(attachments);

	if (request.plan && request.task !== "plan") parts.push(planText(request.plan));

	parts.push(taskText(request, mode));
	const focus = focusText(request, mode);

	if (focus) parts.push(focus);

	if (request.references?.length) {
		parts.push(
			`Reference only (read them, don't change or write them):\n${request.references.map((path) => `- ${path}`).join("\n")}`,
		);
	}

	if (request.variation && request.variation.count > 1) parts.push(variationText(request.variation));

	const conversation = mode === "agent" ? conversationText(request) : "";

	if (conversation) parts.push(conversation);

	if (request.task !== "theme" || request.prompt)
		parts.push(section("request", request.prompt || "(no extra instructions)"));

	return parts.join("\n\n");
}

/** Longer turns are cut: the files on disk already hold what was made */
const TURN_LENGTH = 800;

/** API providers send history as messages; an agent run is one prompt, so the chat so far goes into it */
function conversationText(request: GenerationRequest) {
	const turns = (request.history ?? []).flatMap(({ role, content }) => {
		const text = content.trim();

		if (!text) return [];

		const cut = text.length > TURN_LENGTH ? `${text.slice(0, TURN_LENGTH).trimEnd()}…` : text;

		return [`${role === "user" ? "User" : "You"}: ${cut}`];
	});

	return turns.length ? section("conversation", `This chat so far, oldest first:\n\n${turns.join("\n\n")}`) : "";
}
