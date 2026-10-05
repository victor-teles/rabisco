import type { ElementFocus, GenerationEvent, GenerationRequest, Provider } from "../../../shared/ai/contract";
import { GENERATION_STEPS, generateMockScreens } from "../../../shared/mock-generator";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import type { FileChange } from "../../../shared/types";
import { contextTargetOf } from "../run";

export type MockProviderOptions = {
	/** Pause between steps and chunks, in ms */
	delayMs?: number;
	/** How many `file.delta` chunks per file */
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

/** Development provider: the canned Phase 0 generator, streamed as provider events. */
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

		for (const step of GENERATION_STEPS) {
			if (signal.aborted) return yield aborted;
			yield { type: "status", label: step.label };
			await sleep(delay, signal);
		}

		if (signal.aborted) return yield aborted;

		const target = contextTargetOf(request);

		const edits =
			request.task === "edit"
				? request.files.filter((f) => request.targets?.includes(f.path) && isScreenFile(f.path))
				: [];

		const result: { changes: FileChange[]; frames: { file: string; name: string }[]; reply: string } = target
			? mockContextFile(request, target)
			: edits.length
				? mockEdit(request, edits)
				: mockCreate(request);

		yield { type: "message.delta", text: result.reply };

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
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 200_000 },
		health: async () => ({ ok: true, version: "dev" }),
		listModels: async () => [{ id: "mock", label: "Mock (dev)" }],
		generate,
	};
}

// ---------------------------------------------------------------- variations

/** Accent families a variation can switch to */
const VARIANT_ACCENTS = ["blue", "violet", "emerald", "orange", "rose", "teal", "amber", "fuchsia"];

/** Class swaps per variation: corners, weight, spacing and alignment, so variations differ at a glance */
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

/**
 * Restyles a screen for variation `shift` (0 leaves it as it is): another
 * accent family and another set of class swaps. Development only.
 */
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

/** New screens; a variation (`request.variation`) restyles them so each one looks different */
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

/** Classes the mock adds to a focused element when restyling it changes nothing, so the edit still shows */
const FOCUS_MARK = "ring-2 ring-primary ring-offset-2";

/**
 * Point and prompt, development only: restyles the focused element and leaves
 * the rest of the file as it is. `null` when the element isn't where the focus says.
 */
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

/** An edit (or a "vary" run) restyles its target screens in place; a focused edit restyles its element only */
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

// ---------------------------------------------------------------- context task

/** Tailwind v4's 600 shade per chromatic family; the mock maps `primary` to the first family the screens use. */
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

/** The first chromatic Tailwind family the project's screens and components use, if any. */
export function primaryFamilyOf(files: { path: string; content: string }[]): string | undefined {
	for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
		if (!file.path.endsWith(".tsx")) continue;
		const match = PALETTE_CLASS.exec(file.content);

		if (match) return match[1];
	}

	return undefined;
}

function mockDesignMd(request: GenerationRequest): string {
	const family = primaryFamilyOf(request.files);
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

/**
 * Sorts interview answers into PRODUCT.md sections: a line ending in "?" is a
 * question, and the lines after it answer it. Unmatched answers are the product.
 */
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
