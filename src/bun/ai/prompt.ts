import type { ElementFocus, GenerationRequest } from "../../shared/ai/contract";
import { FILE_RULES } from "../../shared/ai/contract";
import { contextBody } from "../../shared/context/body";
import { FRAME_SIZE } from "../../shared/project";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { componentSignatures } from "../../shared/components/usages";
import { stagedAttachments } from "./attachments";

/** Bump when a prompt change affects output; logged with each generation. */
export const PROMPT_VERSION = 9;

export type PromptMode = "text" | "agent";

export { UI_MODULES };

const uiModuleList = () =>
	Object.entries(UI_MODULES)
		.map(([name, exports]) => `- @/components/ui/${name}: ${exports.join(", ")}`)
		.join("\n");

const frameOf = (request: GenerationRequest) => {
	const { width, height } = FRAME_SIZE[request.device];

	return `${request.device}, ${width}×${height} px`;
};

const ROLE = `You are the design engine of Rabisco, a design canvas. You design app screens as React + Tailwind CSS v4 TSX files. Each screen renders live in a fixed-size frame on the canvas, like a static mockup that is real code.`;

const DESIGN_RULES = `# Design
- Follow DESIGN.md when the project has one; it overrides the defaults below. Stay consistent with the project's existing screens.
- Use the shadcn theme tokens for neutral surfaces and text: bg-background, text-foreground, bg-muted, text-muted-foreground, bg-card, border, bg-primary, text-primary-foreground, ring. Add one accent color with Tailwind's palette when the brief calls for it.
- Anything DESIGN.md defines as a token is used through its theme class, never a hard-coded palette color: bg-primary / text-primary-foreground for the primary color, bg-secondary, bg-accent, bg-muted, text-muted-foreground, bg-card, border, ring, text-destructive, rounded-lg / rounded-md / rounded-sm for the radius, font-sans. A token change then re-themes every screen.
- Clear hierarchy, generous and consistent spacing (4px grid), real typographic scale, aligned edges. Prefer fewer, well-composed elements over clutter.
- Realistic, specific content: plausible names, numbers, dates and copy that fit the product. Never lorem ipsum, never "Item 1".
- No network images. Use lucide-react icons, AvatarFallback initials, gradients or solid shapes instead.
- Tailwind classes only; inline style just for dynamic values. No <style> tags, no CSS imports.
- Screens are mockups: light interactivity with useState is fine; no data fetching, timers, routing, window or document access.`;

const FILE_RULES_TEXT = (request: GenerationRequest) => `# Files
- Screens: screens/<kebab-name>.tsx. Components: components/<kebab-name>.tsx. Lowercase letters, digits and hyphens only. No other files, except the target of a context task.
- A screen default-exports one component: \`export default function OrderHistory() {…}\`. Its root fills the frame: \`h-full\` for app layouts with fixed bars (content area scrolls with overflow-y-auto), \`min-h-full\` for pages that grow.
- The frame is ${frameOf(request)}. Design for exactly that size; never set a root width.${request.device === "mobile" ? " Leave about 48px at the top for the status bar." : ""}
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
${uiModuleList()}`;

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
- Outside tags, write one or two short sentences for the user about what you made. No code outside tags.`;

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
- One \`- name: value\` per line. Names: background, foreground, card, card-foreground, popover, popover-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, success, warning, border, input, ring, chart-1 to chart-5, radius, font-sans, font-serif, font-mono. No other names.
- Colors are hex, rgb(), hsl() or oklch(). radius is a length. Fonts are font stacks.
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

const contextFileOf = (request: GenerationRequest) =>
	request.targets?.find((path) => FILE_RULES.paths.context.test(path));

export function systemPrompt(request: GenerationRequest, mode: PromptMode): string {
	if (request.task === "theme") return [THEME_ROLE, THEME_RULES].join("\n\n");

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
			const existing = request.files.map((file) => file.path).filter((path) => path.startsWith("screens/"));
			const taken = existing.length ? ` Existing screens (pick other paths): ${existing.join(", ")}.` : "";

			return `Task: create. Design new ${frameOf(request)} screens for the request below.${taken}`;
		}

		case "edit":
			return `Task: edit. Change these files as the request below asks${mode === "text" ? " and write each one again in full" : ""}:\n${targets || "- (the files above)"}`;
		case "repair": {
			const problems = (request.problems ?? [])
				.map((problem) => `- ${problem.path}${problem.line ? `:${problem.line}` : ""}: ${problem.message}`)
				.join("\n");

			return `Task: repair. These files failed validation. Fix every problem${mode === "text" ? " and write each fixed file again in full" : ""}:\n${problems || targets}`;
		}

		case "context":
			return contextTaskText(request, mode);
		case "theme":
			return `Task: theme. Read the theme of the DESIGN.md above and reply with its "## Tokens" block${mode === "agent" ? ", as text. Don't write any file" : ""}.`;
	}
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
- ${mode === "text" ? `Still write the whole file in its <rabisco-file> tag, as always: complete, no placeholders.` : `Edit ${focus.file} in place; leave everything outside the element as it is.`}
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

	const attachments = attachmentsText(request, mode);

	if (attachments) parts.push(attachments);

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
