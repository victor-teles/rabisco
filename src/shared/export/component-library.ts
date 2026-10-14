// Every project component with a preview page, as a Vite app. The previews are the ones the Components tab shows.

import { componentApi, propsSignature } from "../components/api";
import { previewLayout, previewModule, previewPath, sampleProps, variantGridModule } from "../components/preview";
import { screensUsing } from "../components/usages";
import { isComponentFile } from "../project";
import { buildProject, type AppProject, type AppProjectInput, type Framework } from "./app-project";
import { VITE } from "./vite-project";

export type LibraryEntry = {
	/** `stat-card`, the page at `#/stat-card` and the module `previews/stat-card` */
	id: string;
	name: string;
	file: string;
	signature: string;
	/** Screen ids that use it, directly or through other components */
	screens: string[];
	variants: boolean;
};

const identifier = (id: string, suffix: string) =>
	`${id.replace(/(?:^|-)([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[0-9]/, "_$&")}${suffix}`;

function galleryApp(entries: LibraryEntry[]) {
	const imports = entries.flatMap((entry) => [
		`import ${identifier(entry.id, "Preview")} from "./previews/${entry.id}";`,
		...(entry.variants ? [`import ${identifier(entry.id, "Variants")} from "./previews/${entry.id}-variants";`] : []),
	]);

	const rows = entries.map(
		(entry) =>
			`\t{ id: ${JSON.stringify(entry.id)}, name: ${JSON.stringify(entry.name)}, file: ${JSON.stringify(`src/${entry.file}`)}, signature: ${JSON.stringify(entry.signature)}, screens: ${JSON.stringify(entry.screens)}, Preview: ${identifier(entry.id, "Preview")}, Variants: ${entry.variants ? identifier(entry.id, "Variants") : "null"} },`,
	);

	return `import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
${imports.join("\n")}

type Entry = {
	id: string;
	name: string;
	file: string;
	signature: string;
	/** The screens that use it in the Rabisco project */
	screens: string[];
	Preview: ComponentType;
	Variants: ComponentType | null;
};

/** Every component export, with the sample props Rabisco previews it with. */
const components: Entry[] = [
${rows.join("\n")}
];

function currentId() {
	return decodeURIComponent(window.location.hash.replace(/^#\\/?/, ""));
}

/** One broken preview doesn't take the page down */
class PreviewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		if (!this.state.error) return this.props.children;
		return <p className="p-4 text-sm text-destructive">This preview failed: {this.state.error.message}</p>;
	}
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-8">
			<h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
			<div className="h-80 overflow-auto rounded-lg border">{children}</div>
		</section>
	);
}

export default function App() {
	const [id, setId] = useState(currentId);

	useEffect(() => {
		const onHashChange = () => setId(currentId());
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	const entry = components.find((component) => component.id === id) ?? components[0]!;

	return (
		<div className="flex h-full bg-background text-foreground">
			<nav className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-3">
				<p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Components</p>
				{components.map((component) => (
					<a
						key={component.id}
						href={\`#/\${component.id}\`}
						aria-current={component.id === entry.id ? "page" : undefined}
						className="rounded-md px-2 py-1.5 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium"
					>
						{component.name}
					</a>
				))}
			</nav>
			<main className="min-w-0 flex-1 overflow-y-auto p-8">
				<h1 className="text-2xl font-semibold">{entry.name}</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					<code>{entry.file}</code>
					{entry.screens.length ? \` · used in \${entry.screens.join(", ")}\` : " · not used by a screen yet"}
				</p>
				<pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 text-xs">
					<code>{entry.signature}</code>
				</pre>
				<Section title="Preview">
					<PreviewBoundary key={entry.id}>
						<entry.Preview />
					</PreviewBoundary>
				</Section>
				{entry.Variants ? (
					<Section title="Variants">
						<PreviewBoundary key={\`\${entry.id}-variants\`}>
							<entry.Variants />
						</PreviewBoundary>
					</Section>
				) : null}
			</main>
		</div>
	);
}
`;
}

function library(entries: LibraryEntry[]): Framework {
	return {
		...VITE,
		name: "component library (Vite + React)",
		files: (context) => [
			...VITE.files(context).filter((file) => file.path !== "src/App.tsx"),
			{ path: "src/App.tsx", content: galleryApp(entries) },
		],
		readme: {
			intro:
				"Every project component has a page with its props, a preview and its variants. The components are the same code the canvas renders.",
			pages:
				"`src/previews/`: the preview of each component export, with the sample props the Components tab uses. `src/App.tsx` lists them (`#/stat-card`).",
			list: "Previews",
		},
	};
}

/** Throws when the project has no component Rabisco can preview */
export function componentLibrary(input: AppProjectInput): AppProject {
	const components = Object.keys(input.files).filter(isComponentFile).sort();
	const usedBy = new Map<string, string[]>();

	for (const [screen, used] of screensUsing(input.files, components)) {
		for (const component of used) {
			const screens = usedBy.get(component) ?? [];
			screens.push(screen);
			usedBy.set(component, screens);
		}
	}

	const previews = new Map<string, string>();
	const entries: LibraryEntry[] = [];

	for (const file of components) {
		for (const component of componentApi(file, input.files[file]!).exports) {
			const base = previewPath(component.name)
				.replace(/^preview\//, "")
				.replace(/\.tsx$/, "");

			let id = base;

			const taken = (candidate: string) =>
				previews.has(`previews/${candidate}.tsx`) || previews.has(`previews/${candidate}-variants.tsx`);

			for (let n = 2; taken(id); n++) id = `${base}-${n}`;

			const variants = variantGridModule({ componentPath: file, component });

			previews.set(
				`previews/${id}.tsx`,
				previewModule({
					componentPath: file,
					exportName: component.name,
					props: sampleProps(component),
					layout: previewLayout(component.name),
				}),
			);

			if (variants) previews.set(`previews/${id}-variants.tsx`, variants);

			entries.push({
				id,
				name: component.name,
				file,
				signature: propsSignature(component),
				screens: (usedBy.get(file) ?? []).map((screen) => screen.replace(/^screens\//, "").replace(/\.tsx$/, "")),
				variants: variants !== null,
			});
		}
	}

	if (!entries.length) throw new Error("There are no components to export");

	return buildProject({ ...input, files: { ...input.files, ...Object.fromEntries(previews) } }, library(entries), [
		...previews.keys(),
	]);
}
