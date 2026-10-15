// The dev handoff page of a project export: every screen with its components, UI kit modules and tokens, read from
// the source like the other component tools (decision 0006).

import { extractCandidates } from "../../mainview/lib/render/candidates";
import { tokenKind, type DesignTokens } from "../context/tokens";
import { FRAME_SIZE, isComponentFile, screenNameFromPath } from "../project";
import type { ExportFile, Frame, ProjectFiles } from "../types";
import { resolvedTokens } from "./tokens";

export type HandoffScreenInput = {
	file: string;
	id: string;
	url: string;
	/** The screen's local imports, transitively */
	dependencies: string[];
	ui: string[];
};

export type HandoffInput = {
	name: string;
	frames: Frame[];
	files: ProjectFiles;
	theme: DesignTokens;
	screens: HandoffScreenInput[];
};

const COLOR_PREFIXES = new Set(
	"bg text border border-x border-y border-t border-r border-b border-l border-s border-e ring ring-offset outline fill stroke from via to shadow divide placeholder caret accent decoration inset-shadow inset-ring".split(
		" ",
	),
);

const SPACING_PREFIXES = new Set(
	"p px py pt pr pb pl ps pe m mx my mt mr mb ml ms me gap gap-x gap-y space-x space-y w h size min-w min-h max-w max-h inset inset-x inset-y top right bottom left start end translate-x translate-y scroll-m scroll-p basis indent".split(
		" ",
	),
);

const ROUNDED = /^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-(.+)$/;

/** The tokens a class reads: `hover:bg-primary/90` → `primary`, `rounded-card` → `radius-card`, `rounded-lg` → `radius` */
function classTokens(candidate: string, names: Set<string>): string[] {
	const utility = candidate
		.split(":")
		.pop()!
		.replace(/^[!-]+/, "")
		.replace(/\/[^/]+$/, "");

	const found: string[] = [];
	const rounded = ROUNDED.exec(utility)?.[1];

	if (rounded) found.push(["sm", "md", "lg", "xl"].includes(rounded) ? "radius" : `radius-${rounded}`);

	for (let dash = utility.indexOf("-"); dash > 0; dash = utility.indexOf("-", dash + 1)) {
		const prefix = utility.slice(0, dash);
		const value = utility.slice(dash + 1);

		if (COLOR_PREFIXES.has(prefix)) found.push(value, `color-${value}`);

		if (prefix === "font") found.push(`font-${value}`);

		if (prefix === "text") found.push(`text-${value}`);

		if (SPACING_PREFIXES.has(prefix)) found.push(`spacing-${value}`);
	}

	return found.filter((name) => names.has(name));
}

export function tokensUsed(sources: string[], names: Set<string>): string[] {
	const used = new Set<string>();

	for (const source of sources)
		for (const candidate of extractCandidates(source)) for (const name of classTokens(candidate, names)) used.add(name);

	return [...used];
}

const kindOf = (name: string) => tokenKind(name) ?? "color";

function append(map: Map<string, string[]>, key: string, value: string) {
	const values = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}

function tokenRows(theme: DesignTokens, usedBy: Map<string, string[]>) {
	const light = resolvedTokens(theme, "light");
	const dark = resolvedTokens(theme, "dark");

	return [...new Set([...light.keys(), ...dark.keys()])].flatMap((name) => {
		if (name.includes("--")) return [];

		const lineHeight = light.get(`${name}--line-height`);
		const value = light.get(name) ?? null;

		return [
			{
				name,
				kind: kindOf(name),
				light: value && lineHeight ? `${value}/${lineHeight}` : value,
				dark: dark.has(name) && dark.get(name) !== light.get(name) ? dark.get(name)! : null,
				screens: usedBy.get(name) ?? [],
			},
		];
	});
}

function handoffData(input: HandoffInput) {
	const names = new Set([
		...resolvedTokens(input.theme, "light").keys(),
		...resolvedTokens(input.theme, "dark").keys(),
	]);

	const tokenScreens = new Map<string, string[]>();
	const componentScreens = new Map<string, string[]>();

	const screens = input.screens.map((screen) => {
		const frame = input.frames.find((candidate) => candidate.file === screen.file);
		const size = frame ?? FRAME_SIZE.mobile;
		const components = screen.dependencies.filter(isComponentFile);
		const sources = [screen.file, ...screen.dependencies].map((file) => input.files[file] ?? "");
		const tokens = tokensUsed(sources, names).sort();

		for (const token of tokens) append(tokenScreens, token, screen.id);

		for (const component of components) append(componentScreens, component, screen.id);

		return {
			id: screen.id,
			name: frame?.name ?? screenNameFromPath(screen.file),
			file: `src/${screen.file}`,
			url: screen.url,
			width: size.width,
			height: size.height,
			components: components.map((file) => `src/${file}`),
			ui: screen.ui,
			tokens,
		};
	});

	const components = Object.keys(input.files)
		.sort()
		.flatMap((file) =>
			isComponentFile(file) ? [{ file: `src/${file}`, screens: componentScreens.get(file) ?? [] }] : [],
		);

	return { name: input.name, screens, components, tokens: tokenRows(input.theme, tokenScreens) };
}

const HANDOFF_TSX = `import type { CSSProperties, ReactNode } from "react";
import { handoff } from "./data";

/** Screen previews are this wide */
const PREVIEW_WIDTH = 300;

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
	return (
		<section className="mt-12">
			<h2 className="flex items-baseline gap-2 text-lg font-semibold">
				{title}
				<span className="text-sm font-normal text-muted-foreground">{count}</span>
			</h2>
			<div className="mt-4">{children}</div>
		</section>
	);
}

function Chips({ label, items }: { label: string; items: string[] }) {
	if (!items.length) return null;

	return (
		<div className="mt-3">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<ul className="mt-1 flex flex-wrap gap-1">
				{items.map((item) => (
					<li key={item} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
						{item}
					</li>
				))}
			</ul>
		</div>
	);
}

/** A live, scaled-down copy of the screen's own route */
function ScreenPreview({ url, width, height, name }: { url: string; width: number; height: number; name: string }) {
	const scale = PREVIEW_WIDTH / width;
	const frame: CSSProperties = { width, height, transform: \`scale(\${scale})\`, transformOrigin: "0 0" };

	return (
		<div className="overflow-hidden rounded-lg border bg-background" style={{ width: PREVIEW_WIDTH, height: height * scale }}>
			<iframe src={url} title={name} style={frame} className="pointer-events-none border-0" loading="lazy" />
		</div>
	);
}

function Swatch({ name, dark }: { name: string; dark?: boolean }) {
	return (
		<span className={dark ? "dark" : undefined}>
			<span className="inline-block size-4 shrink-0 rounded border align-middle" style={{ background: \`var(--\${name})\` }} />
		</span>
	);
}

/** Every screen with the components, UI kit modules and tokens it uses, then every token. */
export function Handoff() {
	return (
		<main className="mx-auto min-h-full max-w-6xl bg-background p-10 text-foreground">
			<p className="text-sm text-muted-foreground">Dev handoff</p>
			<h1 className="text-3xl font-semibold tracking-tight">{handoff.name}</h1>
			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				Exported from Rabisco. Each screen is the same code the canvas renders. Open one to use it, or read its
				components and tokens here.
			</p>

			<Section title="Screens" count={handoff.screens.length}>
				<ul className="grid gap-8 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
					{handoff.screens.map((screen) => (
						<li key={screen.id}>
							<ScreenPreview url={screen.url} width={screen.width} height={screen.height} name={screen.name} />
							<div className="mt-3 flex items-baseline justify-between gap-2">
								<h3 className="font-medium">{screen.name}</h3>
								<a href={screen.url} className="text-sm text-primary underline-offset-4 hover:underline">
									Open
								</a>
							</div>
							<p className="font-mono text-xs text-muted-foreground">
								{screen.file} · {screen.width}×{screen.height}
							</p>
							<Chips label="Components" items={screen.components} />
							<Chips label="UI kit" items={screen.ui} />
							<Chips label="Tokens" items={screen.tokens} />
						</li>
					))}
				</ul>
			</Section>

			<Section title="Components" count={handoff.components.length}>
				<ul className="divide-y rounded-lg border">
					{handoff.components.map((component) => (
						<li key={component.file} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
							<span className="font-mono">{component.file}</span>
							<span className="text-muted-foreground">
								{component.screens.length ? component.screens.join(", ") : "not used by a screen"}
							</span>
						</li>
					))}
				</ul>
			</Section>

			<Section title="Tokens" count={handoff.tokens.length}>
				<p className="mb-3 text-sm text-muted-foreground">
					CSS variables in <code className="font-mono">tokens/tokens.css</code>, Tailwind classes through{" "}
					<code className="font-mono">tokens/tailwind.css</code>, and DTCG in <code className="font-mono">tokens/tokens.json</code>.
				</p>
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted text-xs text-muted-foreground">
							<tr>
								<th className="px-4 py-2 font-medium">Token</th>
								<th className="px-4 py-2 font-medium">Light</th>
								<th className="px-4 py-2 font-medium">Dark</th>
								<th className="px-4 py-2 font-medium">Used in (screen and component classes)</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{handoff.tokens.map((token) => (
								<tr key={token.name}>
									<td className="px-4 py-2 font-mono text-xs">--{token.name}</td>
									<td className="px-4 py-2">
										<span className="flex items-center gap-2 font-mono text-xs">
											{token.kind === "color" ? <Swatch name={token.name} /> : null}
											{token.light ?? "—"}
										</span>
									</td>
									<td className="px-4 py-2">
										<span className="flex items-center gap-2 font-mono text-xs">
											{token.kind === "color" && token.dark ? <Swatch name={token.name} dark /> : null}
											{token.dark ?? "same"}
										</span>
									</td>
									<td className="px-4 py-2 text-xs text-muted-foreground">{token.screens.join(", ") || "—"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>
		</main>
	);
}
`;

export const HANDOFF_MODULE = "handoff/handoff";

export function handoffFiles(input: HandoffInput): ExportFile[] {
	const data = JSON.stringify(handoffData(input), null, "\t");

	return [
		{ path: "src/handoff/handoff.tsx", content: HANDOFF_TSX },
		{
			path: "src/handoff/data.ts",
			content: `/** What the handoff page shows, read from the project when it was exported from Rabisco */\nexport const handoff = ${data};\n`,
		},
	];
}
