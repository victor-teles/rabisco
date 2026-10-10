import type {
	ElementFocus,
	GenerationEvent,
	GenerationPlan,
	GenerationRequest,
	Provider,
} from "../../../shared/ai/contract";
import { pascalName, planBlock } from "../../../shared/ai/plan";
import { contextBody } from "../../../shared/context/body";
import { DESIGN_RULE_LABELS } from "../../../shared/design/findings";
import { tokenBlock } from "../../../shared/context/theme";
import { GENERATION_STEPS, generateMockScreens, mockThemeTokens } from "../../../shared/mock-generator";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import type { FileChange } from "../../../shared/types";
import { contextTargetOf } from "../run";
import { commandMethods, type CommandFile } from "../command-template";

/** What a command file would hold, so the chat's command menu runs without a CLI */
export const MOCK_COMMANDS: CommandFile[] = [
	{
		name: "brief",
		description: "Design screens from a one-line brief",
		argumentHint: "<what to build>",
		source: "user",
		template: "Design the main screens for: $ARGUMENTS",
		syntax: "markdown",
	},
];

export type MockProviderOptions = {
	/** ms */
	delayMs?: number;
	/** `file.delta` chunks per file */
	chunks?: number;
};

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (ms <= 0 || signal.aborted) return resolve();
		const timer = setTimeout(done, ms);

		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}

		signal.addEventListener("abort", done, { once: true });
	});

const THEME_STEPS = ["Reading DESIGN.md", "Mapping colors to theme tokens"];

const PLAN_STEPS = ["Reading your brief", "Planning screens and shared parts"];

const BRIEF_STEPS = ["Reading your prompt"];

/** Development only. */
export function createMockProvider(options: MockProviderOptions = {}): Provider {
	const delay = options.delayMs ?? 300;
	const chunks = Math.max(1, options.chunks ?? 3);

	async function* generate(request: GenerationRequest, signal: AbortSignal): AsyncGenerator<GenerationEvent> {
		const aborted: GenerationEvent = {
			type: "error",
			code: "aborted",
			message: "Generation stopped.",
			retryable: true,
		};

		if (request.task === "theme") {
			for (const label of THEME_STEPS) {
				if (signal.aborted) return yield aborted;
				yield { type: "status", label };
				await sleep(delay * 2, signal);
			}

			if (signal.aborted) return yield aborted;
			yield { type: "message.delta", text: tokenBlock(mockThemeTokens(request.context.design ?? "")) };
			yield { type: "done", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };

			return;
		}

		if (request.task === "plan") {
			for (const label of PLAN_STEPS) {
				if (signal.aborted) return yield aborted;
				yield { type: "status", label };
				await sleep(delay * 2, signal);
			}

			if (signal.aborted) return yield aborted;
			yield { type: "message.delta", text: planBlock(mockPlan(request)) };
			yield { type: "done", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };

			return;
		}

		if (request.task === "brief") {
			for (const label of BRIEF_STEPS) {
				if (signal.aborted) return yield aborted;
				yield { type: "status", label };
				await sleep(delay, signal);
			}

			for (const line of mockBrief(request).split(/(?<=\n)/)) {
				if (signal.aborted) return yield aborted;
				yield { type: "message.delta", text: line };
				await sleep(delay / 4, signal);
			}

			yield { type: "done", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };

			return;
		}

		const images = request.attachments?.length ?? 0;

		if (images) yield { type: "status", label: `Looking at ${images === 1 ? "the image" : `${images} images`}` };

		for (const step of request.task === "repair" ? [] : GENERATION_STEPS) {
			if (signal.aborted) return yield aborted;
			yield { type: "status", label: step.label };
			await sleep(delay, signal);
		}

		if (request.task === "repair") await sleep(delay * 2, signal);

		if (signal.aborted) return yield aborted;

		const target = contextTargetOf(request);

		const edits =
			request.task === "edit"
				? request.files.filter((f) => request.targets?.includes(f.path) && isScreenFile(f.path))
				: [];

		const result: { changes: FileChange[]; frames: { file: string; name: string }[]; reply: string } = target
			? mockContextFile(request, target)
			: request.task === "repair"
				? mockRepair(request)
				: request.plan && request.writes
					? mockPlanned(request, request.plan, request.writes)
					: edits.length
						? mockEdit(request, edits)
						: mockCreate(request);

		const seen =
			images && request.task !== "repair"
				? `I used the attached ${images === 1 ? "image" : "images"} as a reference. `
				: "";

		yield { type: "message.delta", text: seen + result.reply };

		for (const change of result.changes) {
			if (change.content === null) continue;
			const { path, content } = change;
			const frame = result.frames.find((f) => f.file === path);

			if (target) yield { type: "file.start", path, kind: "context" };
			else if (isScreenFile(path)) {
				yield {
					type: "file.start",
					path,
					kind: "screen",
					screen: { name: frame?.name ?? path, device: request.device },
				};
			} else yield { type: "file.start", path, kind: "component" };
			const size = Math.ceil(content.length / chunks);

			for (let at = 0; at < content.length; at += size) {
				if (signal.aborted) return yield aborted;
				yield { type: "file.delta", path, text: content.slice(at, at + size) };
				await sleep(delay / chunks, signal);
			}

			if (signal.aborted) return yield aborted;
			yield { type: "file.end", path, content };
		}

		yield { type: "done", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
	}

	return {
		id: "mock",
		kind: "api",
		label: "Mock (dev)",
		capabilities: { streaming: true, images: true, agentic: false, maxContextTokens: 200_000 },
		...commandMethods(() => MOCK_COMMANDS),
		health: async () => ({ ok: true, version: "dev" }),
		listModels: async () => [{ id: "mock", label: "Mock (dev)" }],
		generate,
	};
}

const VARIANT_ACCENTS = ["blue", "violet", "emerald", "orange", "rose", "teal", "amber", "fuchsia"];

/** Big swaps (corners, weight, spacing, alignment) so variations differ at a glance */
const VARIANT_STYLES: Record<string, string>[] = [
	{
		"rounded-lg": "rounded-2xl",
		"rounded-xl": "rounded-3xl",
		"rounded-2xl": "rounded-[2rem]",
		"font-semibold": "font-bold",
		"gap-3": "gap-5",
	},
	{
		"rounded-lg": "rounded-none",
		"rounded-xl": "rounded-none",
		"rounded-2xl": "rounded-none",
		"font-semibold": "font-black",
		"items-start": "items-center",
		"text-left": "text-center",
	},
	{
		"rounded-lg": "rounded-full",
		"rounded-xl": "rounded-md",
		"px-4": "px-6",
		"px-6": "px-8",
		"text-2xl": "text-4xl",
		"tracking-tight": "tracking-tighter",
	},
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `shift` 0 leaves the content as it is. */
export function restyleForVariation(content: string, shift: number): string {
	if (!shift) return content;
	let out = content;
	const family = primaryFamilyOf([{ path: "screen.tsx", content }]);

	if (family) {
		const at = Math.max(0, VARIANT_ACCENTS.indexOf(family));
		const next = VARIANT_ACCENTS[(at + shift * 3) % VARIANT_ACCENTS.length]!;
		out = out.replace(
			new RegExp(`\\b(bg|text|border|ring|from|via|to|fill|stroke)-${family}-(\\d{2,3})\\b`, "g"),
			`$1-${next}-$2`,
		);
	}

	const swaps = VARIANT_STYLES[(shift - 1) % VARIANT_STYLES.length]!;
	const pattern = new RegExp(`(?<![\\w-])(${Object.keys(swaps).map(escapeRegExp).join("|")})(?![\\w-])`, "g");

	return out.replace(pattern, (match) => swaps[match] ?? match);
}

function mockCreate(request: GenerationRequest) {
	const result = generateMockScreens({
		prompt: request.prompt,
		device: request.device,
		existingFiles: request.files.map((f) => f.path),
	});

	const shift = request.variation?.index ?? 0;

	const changes = result.changes.map((c) =>
		c.content !== null && isScreenFile(c.path) ? { ...c, content: restyleForVariation(c.content, shift) } : c,
	);

	return { ...result, changes };
}

/** The mock's own screens for the prompt, as a plan: its drafts, the components they import, and a forward flow */
export function mockPlan(request: GenerationRequest): GenerationPlan {
	const result = generateMockScreens({
		prompt: request.prompt,
		device: request.device,
		existingFiles: [...(request.projectScreens ?? []), ...(request.components ?? []).map((c) => c.path)],
	});

	const screens = result.frames.map((frame) => ({
		path: frame.file,
		name: frame.name,
		purpose: `The ${frame.name.toLowerCase()} step of the flow.`,
		content: request.prompt.trim().slice(0, 80) || frame.name,
	}));

	const sources = result.changes.flatMap((change) =>
		change.content !== null && isScreenFile(change.path) ? [{ path: change.path, content: change.content }] : [],
	);

	const components = result.changes.flatMap((change) => {
		if (change.content === null || isScreenFile(change.path)) return [];
		const module = `../${change.path.replace(/\.tsx$/, "")}"`;
		const usedBy = sources.flatMap((source) => (source.content.includes(module) ? [source.path] : []));

		return [
			{ path: change.path, name: pascalName(change.path), purpose: "Shared by the screens that use it.", usedBy },
		];
	});

	const links = screens
		.slice(1)
		.map((screen, index) => ({ from: screens[index]!.path, to: screen.path, label: "Continue" }));

	return { screens, components, links };
}

/** A run of an accepted plan: only the files in `writes`, each from the mock's drafts or a plain stand-in */
function mockPlanned(request: GenerationRequest, plan: GenerationPlan, writes: string[]) {
	const drafts = generateMockScreens({ prompt: request.prompt, device: request.device });

	const draftScreens = drafts.frames.map((frame) => ({
		name: frame.name.toLowerCase(),
		source: drafts.changes.find((c) => c.path === frame.file)?.content ?? "",
	}));

	const available = new Set([...request.files.map((f) => f.path), ...(request.components ?? []).map((c) => c.path)]);

	const changes = writes.map((path) => {
		const at = plan.screens.findIndex((screen) => screen.path === path);

		if (at === -1) {
			const draft = drafts.changes.find((change) => change.path === path)?.content;
			const name = plan.components.find((component) => component.path === path)?.name ?? pascalName(path);

			return { path, content: draft ?? standInComponent(name || "Part") };
		}

		// The draft of the same name, so a screen keeps its look when others are unticked; else by position
		const name = plan.screens[at]!.name.toLowerCase();
		const source = (draftScreens.find((d) => d.name === name) ?? draftScreens[at % draftScreens.length])?.source ?? "";
		const link = plan.links.find((l) => l.from === path);

		return { path, content: linkFirstButton(withoutMissingComponents(source, available), link?.to) };
	});

	const frames = plan.screens.flatMap((screen) =>
		writes.includes(screen.path) ? [{ file: screen.path, name: screen.name }] : [],
	);

	return { changes, frames, reply: `Wrote ${writes.join(", ")}.` };
}

function standInComponent(name: string) {
	return `export function ${name}({ title = "${name}" }: { title?: string }) {
	return <div className="rounded-lg border bg-card p-4 text-sm font-medium">{title}</div>;
}
`;
}

/** Drops imports of project components that weren't written, and their (self-closing) elements */
export function withoutMissingComponents(source: string, available: ReadonlySet<string>) {
	let out = source;

	for (const match of source.matchAll(/^import \{ ([A-Za-z, ]+) \} from "\.\.\/(components\/[a-z0-9-]+)";\n/gm)) {
		if (available.has(`${match[2]}.tsx`)) continue;
		out = out.replace(match[0], "");

		for (const name of match[1]!.split(",").map((n) => n.trim())) {
			out = out.replace(new RegExp(`\\s*<${name}\\b[^>]*/>`, "g"), "");
		}
	}

	return out;
}

/** The planned link goes on the first button, else the first card */
function linkFirstButton(source: string, to: string | undefined) {
	if (!to) return source;
	const tag = /<Button\b/.test(source) ? "Button" : "Card";

	return source.replace(new RegExp(`<${tag}\\b`), `<${tag} data-link-to="${to}"`);
}

/** Added when restyling changes nothing, so the edit still shows */
const FOCUS_MARK = "ring-2 ring-primary ring-offset-2";

/** `null` when the element isn't where the focus says. */
export function restyleElement(content: string, focus: ElementFocus, shift: number): string | null {
	const element = content.slice(focus.start, focus.end);

	if (element !== focus.snippet) return null;
	let next = restyleForVariation(element, shift);

	if (next === element) {
		next = /className="/.test(element)
			? element.replace(
					/className="([^"]*)"/,
					(_, classes: string) => `className="${`${classes} ${FOCUS_MARK}`.trim()}"`,
				)
			: element.replace(/^<([A-Za-z][\w.]*)/, `<$1 className="${FOCUS_MARK}"`);
	}

	return content.slice(0, focus.start) + next + content.slice(focus.end);
}

function mockEdit(request: GenerationRequest, targets: { path: string; content: string }[]) {
	const shift = (request.variation?.index ?? 0) + 1;
	const focus = request.focus;

	const changes = targets.map(({ path, content }) => ({
		path,
		content:
			(focus?.file === path ? restyleElement(content, focus, shift) : null) ?? restyleForVariation(content, shift),
	}));

	const frames = targets.map(({ path }) => ({ file: path, name: screenNameFromPath(path) }));
	const names = frames.map((f) => f.name).join(", ");

	return { changes, frames, reply: focus ? `Restyled ${focus.label} in ${names}.` : `Restyled ${names}.` };
}

const CONTRAST_FIXES: [RegExp, string][] = [
	[/(?<![\w-])text-(white|black)\/\d+(?![\w-])/, "text-$1"],
	[/(?<![\w-])text-muted-foreground(?![\w-])/, "text-foreground"],
	[/(?<![\w-])text-[a-z]+-\d{2,3}(?![\w-])/, "text-foreground"],
];

const fixesFor = (message: string): [RegExp, string][] => {
	if (message.startsWith(`${DESIGN_RULE_LABELS.contrast}:`)) return CONTRAST_FIXES;

	const added = message.startsWith(`${DESIGN_RULE_LABELS["text-clipped"]}:`) ? "break-words" : "min-w-0";

	return [[/className="([^"]*)"/, `className="$1 ${added}"`]];
};

function fixLine(line: string, message: string) {
	for (const [pattern, replacement] of fixesFor(message)) {
		const fixed = line.replace(pattern, replacement);

		if (fixed !== line) return fixed;
	}

	return line;
}

export function mockRepair(request: GenerationRequest) {
	const changes: FileChange[] = [];
	let fixed = 0;

	for (const file of request.files) {
		if (!request.targets?.includes(file.path)) continue;
		const lines = file.content.split("\n");

		for (const problem of request.problems ?? []) {
			const at = (problem.line ?? 0) - 1;
			const line = lines[at];

			if (problem.path !== file.path || line === undefined) continue;
			const next = fixLine(line, problem.message);

			if (next === line) continue;
			lines[at] = next;
			fixed++;
		}

		const content = lines.join("\n");

		if (content !== file.content) changes.push({ path: file.path, content });
	}

	const frames = changes.map(({ path }) => ({ file: path, name: screenNameFromPath(path) }));
	const names = frames.map((frame) => frame.name).join(", ");

	const reply = fixed
		? `Fixed ${fixed === 1 ? "1 problem" : `${fixed} problems`} in ${names}.`
		: request.attachments?.length
			? "Nothing to fix."
			: "I couldn't find anything to change for these problems.";

	return { changes, frames, reply };
}

/** Tailwind v4's 600 shade per chromatic family */
const PALETTE_600 = new Map(
	Object.entries({
		red: "oklch(0.577 0.245 27.325)",
		orange: "oklch(0.646 0.222 41.116)",
		amber: "oklch(0.666 0.179 58.318)",
		yellow: "oklch(0.681 0.162 75.834)",
		lime: "oklch(0.648 0.2 131.684)",
		green: "oklch(0.627 0.194 149.214)",
		emerald: "oklch(0.596 0.145 163.225)",
		teal: "oklch(0.6 0.118 184.704)",
		cyan: "oklch(0.609 0.126 221.723)",
		sky: "oklch(0.588 0.158 241.966)",
		blue: "oklch(0.546 0.245 262.881)",
		indigo: "oklch(0.511 0.262 276.966)",
		violet: "oklch(0.541 0.281 293.009)",
		purple: "oklch(0.558 0.288 302.321)",
		fuchsia: "oklch(0.591 0.293 322.896)",
		pink: "oklch(0.592 0.249 0.584)",
		rose: "oklch(0.586 0.253 17.585)",
	}),
);

const PALETTE_CLASS = new RegExp(
	`\\b(?:bg|text|border|ring|from|via|to|fill|stroke)-(${[...PALETTE_600.keys()].join("|")})-\\d{2,3}\\b`,
);

export function primaryFamilyOf(files: { path: string; content: string }[]): string | undefined {
	for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
		if (!file.path.endsWith(".tsx")) continue;
		const match = PALETTE_CLASS.exec(file.content);

		if (match) return match[1];
	}

	return undefined;
}

function familyInText(text: string) {
	return [...PALETTE_600.keys()].find((family) => new RegExp(`\\b${family}\\b`, "i").test(text));
}

function mockDesignMd(request: GenerationRequest): string {
	const family = primaryFamilyOf(request.files) ?? familyInText(request.prompt);
	const primary = (family && PALETTE_600.get(family)) || "oklch(0.205 0 0)";

	const direction = family
		? `Calm neutral surfaces with ${family} as the one accent.`
		: "Calm, neutral surfaces with a near-black accent.";

	return `# Design

## Tokens

- primary: ${primary}
- primary-foreground: #ffffff
- radius: 0.75rem
- font-sans: "Inter", system-ui, sans-serif

## Visual direction

${direction}

## Typography

Inter throughout. Titles semibold, body regular, captions in muted foreground.

## Layout & spacing

4px grid. 16px screen padding on mobile, 24px on desktop.

## Components

Cards with a 1px border and rounded-lg corners. One primary button per screen.

## Do / Don't

- Do use bg-primary for the main action.
- Don't hard-code palette colors for anything the tokens define.
`;
}

const PRODUCT_SECTIONS = [
	{ title: "Audience", words: /\b(who|audience|users?|for whom|customers?)\b/i },
	{ title: "Voice", words: /\b(voice|tone|sound|speak|words?)\b/i },
	{ title: "Constraints", words: /\b(constraints?|limits?|must|avoid|rules?|platforms?|accessibility)\b/i },
] as const;

type ProductSection = "Product" | (typeof PRODUCT_SECTIONS)[number]["title"];

/** A line ending in "?" is a question; the lines after it answer it. Unmatched answers go under Product. */
export function mockProductMd(prompt: string): string {
	const sections: Record<ProductSection, string[]> = { Product: [], Audience: [], Voice: [], Constraints: [] };
	let section: ProductSection = "Product";

	for (const raw of prompt.split("\n")) {
		const line = raw.trim().replace(/^(?:[QA]:|[-*])\s*/i, "");

		if (!line) continue;

		if (line.endsWith("?")) {
			section = PRODUCT_SECTIONS.find((s) => s.words.test(line))?.title ?? "Product";
			continue;
		}

		sections[section].push(line);
	}

	const body = Object.entries(sections).map(
		([title, lines]) => `## ${title}\n\n${lines.join("\n\n") || "To be decided."}`,
	);

	return `# Product\n\n${body.join("\n\n")}\n`;
}

function mockContextFile(request: GenerationRequest, target: string) {
	const content = target === "DESIGN.md" ? mockDesignMd(request) : mockProductMd(request.prompt);

	return { changes: [{ path: target, content }], frames: [], reply: `Wrote ${target}.` };
}

export function mockBrief(request: GenerationRequest): string {
	const ask = request.prompt.trim().replace(/[.\s]+$/, "");
	const what = ask ? ask.charAt(0).toLowerCase() + ask.slice(1) : "the main screens";

	const product = contextBody(request.context.product)
		?.split("\n")
		.find((line) => line.trim() && !line.startsWith("#"))
		?.trim();

	const look = contextBody(request.context.design)
		? "follow DESIGN.md: its tokens, type and spacing."
		: "calm and clear, neutral surfaces with one accent color, generous spacing and a clear type scale.";

	return [
		`Design ${what}, as ${request.device} screens.`,
		product ? `- Product: ${product}` : "",
		"- Home: a greeting, the one number that matters today, and the main action as the primary button.",
		"- List: 6 to 8 realistic rows with names, dates and amounts; a row opens its details.",
		"- Details: a header with back, the item's key facts and one secondary action.",
		"- An empty state on the list for a first-time user.",
		`Look and feel: ${look}`,
	]
		.filter(Boolean)
		.join("\n");
}
