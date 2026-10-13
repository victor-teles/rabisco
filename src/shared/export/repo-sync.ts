import { isRelative, resolveRelative } from "../../mainview/lib/render/resolve";
import type { ExportFile, ProjectFiles } from "../types";
import { localDependencies, rewriteSpecifiers } from "./code";

const UI_PREFIX = "@/components/ui/";

const UTILS = "@/lib/utils";

/** What Rabisco learned about the repository; `null` fields mean it couldn't tell */
export type RepoInfo = {
	/** Of the paths asked about */
	existing: string[];
	/** shadcn's `aliases.ui` and `aliases.utils` from `components.json` */
	uiAlias: string | null;
	utilsAlias: string | null;
	/** Modules in the ui folder: `button` for `button.tsx` */
	uiModules: string[] | null;
	/** `dependencies`, `devDependencies` and `peerDependencies` of `package.json` */
	packages: string[] | null;
	/** Where the repository keeps components, for the default paths */
	componentsDir: string;
};

export type RepoSyncInput = {
	files: ProjectFiles;
	screen: string;
	/** Repository-relative, ending in `.tsx` */
	target: string;
	/** Repository-relative folder for the components the screen imports */
	componentsDir: string;
	uiAlias?: string | null;
	utilsAlias?: string | null;
};

export type RepoSync = {
	files: ExportFile[];
	/** shadcn and uai module names the code imports: `button`, `uai/message` */
	ui: string[];
	/** npm packages the code imports */
	packages: string[];
};

const trimSlashes = (path: string) =>
	path
		.trim()
		.replace(/^\.\/+/, "")
		.replace(/\/+$/, "");

/** `null` when it's a usable repository-relative path, else why not */
export function repoPathProblem(path: string, kind: "file" | "folder"): string | null {
	const trimmed = trimSlashes(path);

	if (kind === "file" && !trimmed) return "Enter a path for the screen";

	if (trimmed.startsWith("/") || /^[a-z]:/i.test(trimmed)) return "Use a path inside the repository";

	if (trimmed.split("/").some((part) => part === ".." || (kind === "file" && part === ""))) {
		return "Use a path inside the repository";
	}

	if (kind === "file" && !trimmed.endsWith(".tsx")) return "The screen is a .tsx file";

	return null;
}

/** `src/screens/home.tsx` → `../components/card` from `src/screens/home.tsx` to `src/components/card.tsx` */
export function relativeSpecifier(from: string, to: string): string {
	const fromParts = from.split("/").slice(0, -1);
	const toParts = to.replace(/\.tsx?$/, "").split("/");
	let shared = 0;

	while (shared < fromParts.length && shared < toParts.length - 1 && fromParts[shared] === toParts[shared]) shared++;
	const up = fromParts.length - shared;
	const rest = toParts.slice(shared).join("/");

	return up === 0 ? `./${rest}` : `${"../".repeat(up)}${rest}`;
}

/** `@/components/ui/button` → `button`; `null` for other modules */
const uiModuleOf = (specifier: string) => (specifier.startsWith(UI_PREFIX) ? specifier.slice(UI_PREFIX.length) : null);

/** `@scope/pkg/x` → `@scope/pkg`; `null` for relative and alias imports */
function packageOf(specifier: string) {
	if (isRelative(specifier) || specifier.startsWith("@/") || specifier.startsWith("/")) return null;
	const parts = specifier.split("/");

	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

const repoPathOf = (file: string, componentsDir: string) => {
	const dir = trimSlashes(componentsDir);
	const rest = file.replace(/^components\//, "");

	return dir ? `${dir}/${rest}` : rest;
};

/**
 * The screen at `target` and the components it imports in `componentsDir`, with relative imports pointing at their new
 * places and `@/components/ui` and `@/lib/utils` rewritten to the repository's shadcn aliases.
 */
export function repoSync(input: RepoSyncInput): RepoSync {
	const { files, screen } = input;
	const exists = (file: string) => Object.hasOwn(files, file);

	if (!exists(screen)) throw new Error(`${screen} doesn't exist`);
	const target = trimSlashes(input.target);
	const sources = [screen, ...localDependencies(files, screen)];

	const places = new Map(
		sources.map((file) => [file, file === screen ? target : repoPathOf(file, input.componentsDir)]),
	);

	const ui = new Set<string>();
	const packages = new Set<string>();

	const written = sources.map((file): ExportFile => {
		const place = places.get(file)!;

		const content = rewriteSpecifiers(files[file]!, (specifier) => {
			const module = uiModuleOf(specifier);

			if (module) {
				ui.add(module);

				return input.uiAlias ? `${input.uiAlias.replace(/\/+$/, "")}/${module}` : specifier;
			}

			if (specifier === UTILS) return input.utilsAlias ?? specifier;
			const pkg = packageOf(specifier);

			if (pkg) packages.add(pkg);

			if (!isRelative(specifier)) return specifier;
			const resolved = resolveRelative(file, specifier, exists);
			const moved = resolved ? places.get(resolved) : undefined;

			return moved ? relativeSpecifier(place, moved) : specifier;
		});

		return { path: place, content };
	});

	return { files: written, ui: [...ui].sort(), packages: [...packages].sort() };
}

/** The paths `repoSync` writes, for asking the repository which already exist */
export function repoSyncPaths(files: ProjectFiles, screen: string, target: string, componentsDir: string): string[] {
	return [trimSlashes(target), ...localDependencies(files, screen).map((file) => repoPathOf(file, componentsDir))];
}

export function defaultTarget(screen: string, componentsDir: string) {
	const dir = trimSlashes(componentsDir);
	const name = screen.replace(/^screens\//, "");

	return dir ? `${dir}/${name}` : name;
}
