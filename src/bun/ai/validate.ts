import { transform } from "sucrase";
import { FILE_RULES, type Problem, type ProjectFile } from "../../shared/ai/contract";
import type { ProjectFiles } from "../../shared/types";
import { extractRequires, isRelative, joinPath } from "../../mainview/lib/render/resolve";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { cachedComponentApi } from "../../shared/components/usages";

/**
 * Checks 1–4 of decision 0003 (path, compile, imports, exports) for files a
 * provider wrote, plus one for components: no export that another component
 * file already has. Check 5 (render) happens in the frame.
 */

/** `@/components/ui/*` modules the frame runtime provides; the list lives with the prompt */
const UI_NAMES = Object.keys(UI_MODULES);
const UI_SET = new Set(UI_NAMES);
const UI_PREFIX = "@/components/ui/";
/** Inserted by Sucrase's automatic JSX runtime, never written by the provider */
const JSX_RUNTIME = "react/jsx-runtime";

export type FileKindOf = "screen" | "component" | null;

export function fileKindOf(path: string): FileKindOf {
	if (path.startsWith("screens/")) return "screen";
	if (path.startsWith("components/")) return "component";
	return null;
}

/** Problem with the path itself, or `null` when the path is writable. `alternates` are names Rabisco assigned, which pass. */
export function checkPath(path: string, alternates?: ReadonlySet<string>): string | null {
	if (FILE_RULES.paths.screen.test(path) || FILE_RULES.paths.component.test(path)) return null;
	if (/^screens\/[a-z0-9-]+\.alt-\d+\.tsx$/.test(path)) {
		if (alternates?.has(path)) return null;
		return `Alternates are named by Rabisco. Write the screen as ${path.replace(/\.alt-\d+\.tsx$/, ".tsx")} instead.`;
	}
	const rule = "Files must be screens/<kebab-name>.tsx or components/<kebab-name>.tsx (lowercase letters, digits and dashes).";
	return FILE_RULES.paths.context.test(path) ? `${path} is the user's file: follow it, don't write it. ${rule}` : rule;
}

/** Same Sucrase options as the webview (src/mainview/lib/render/compile.ts). */
function compile(path: string, content: string): { code: string } | { message: string; line?: number } {
	try {
		const { code } = transform(content, {
			transforms: ["typescript", "jsx", "imports"],
			jsxRuntime: "automatic",
			production: true,
			filePath: path,
		});
		return { code };
	} catch (error) {
		const loc = (error as { loc?: { line: number } }).loc;
		const message = String((error as Error)?.message ?? error)
			.replace(/^Error transforming [^:]*: /, "")
			.replace(/\s*\(\d+:\d+\)$/, "");
		return { message, line: loc?.line };
	}
}

/** 1-based line of the first `import`/`export … from` that mentions `specifier`. */
function importLine(source: string, specifier: string) {
	const lines = source.split("\n");
	const quoted = [`"${specifier}"`, `'${specifier}'`];
	const index = lines.findIndex((line) => quoted.some((q) => line.includes(q)));
	return index === -1 ? undefined : index + 1;
}

/** Value imports as written in the source (type-only imports are erased, so they don't count). */
function sourceImports(source: string) {
	const found = new Set<string>();
	for (const match of source.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?(['"])([^'"\n]+)\3/gm)) {
		if (!match[2]) found.add(match[4]!);
	}
	return found;
}

type ImportContext = {
	/** Component paths that exist after this change */
	components: Set<string>;
};

function checkImport(from: string, specifier: string, ctx: ImportContext): string | null {
	if (specifier === JSX_RUNTIME) return null;
	if (isRelative(specifier)) {
		const kind = fileKindOf(from);
		const resolved = joinPath(from, specifier);
		const target = resolved.endsWith(".tsx") ? resolved : `${resolved}.tsx`;
		if (!FILE_RULES.paths.component.test(target)) {
			const hint = kind === "component" ? `"./<name>"` : `"../components/<name>"`;
			return `"${specifier}" is not a project component. Import components with ${hint}.`;
		}
		if (!ctx.components.has(target)) return `"${specifier}" imports ${target}, which doesn't exist. Write it too, or use another component.`;
		return null;
	}
	if (specifier.startsWith(UI_PREFIX)) {
		const name = specifier.slice(UI_PREFIX.length);
		if (UI_SET.has(name)) return null;
		return `"${specifier}" is not available. UI components: ${UI_NAMES.join(", ")}.`;
	}
	if (FILE_RULES.imports.some((rule) => rule.test(specifier))) return null;
	return `"${specifier}" can't be imported. Allowed: react, lucide-react, @/components/ui/*, @/lib/utils and project components.`;
}

/** Literal default exports (`export default "x"`, `export default {}`) aren't components. */
const LITERAL_DEFAULT = /\bexports\.\s*default\s*=\s*(?:["'`\d[{]|null\b|true\b|false\b|undefined\b)/;

function checkExports(path: string, kind: "screen" | "component", code: string, source: string): Problem[] {
	const hasDefault = /\bexports\.\s*default\s*=/.test(code);
	const named = [...code.matchAll(/\bexports\.\s*([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]).filter((n) => n !== "default");
	const reexports = /_createNamedExportFrom\(|_createStarExport\(/.test(code);
	const line = (pattern: RegExp) => {
		const index = source.split("\n").findIndex((l) => pattern.test(l));
		return index === -1 ? undefined : index + 1;
	};
	if (kind === "screen") {
		if (!hasDefault) return [{ path, message: "A screen must default-export its React component: export default function Name() { … }" }];
		if (LITERAL_DEFAULT.test(code)) {
			return [{ path, message: "The default export must be a React component.", line: line(/export\s+default/) }];
		}
		return [];
	}
	const problems: Problem[] = [];
	if (hasDefault) {
		problems.push({
			path,
			message: "Components use named exports only: export function Name() { … }, with no default export.",
			line: line(/export\s+default|as\s+default/),
		});
	}
	if (!named.length && !reexports) {
		problems.push({ path, message: "A component file must have at least one named export: export function Name() { … }" });
	}
	return problems;
}

const componentNames = (path: string, source: string | undefined) =>
	source === undefined ? [] : cachedComponentApi(path, source).exports.map((exp) => exp.name);

/**
 * A written component file must not export a component another component file
 * already exports: the model should import that one (or extend it) instead.
 * Names the file already exported before this change are fine. Of two new
 * files with the same export, the later one is flagged.
 */
function checkDuplicateExports(written: ProjectFile[], project: ProjectFiles, gone: Set<string>): Problem[] {
	const after = new Map<string, string>();
	for (const [path, content] of Object.entries(project)) if (FILE_RULES.paths.component.test(path) && !gone.has(path)) after.set(path, content);
	const components = written.filter((file) => FILE_RULES.paths.component.test(file.path));
	for (const file of components) if (after.has(file.path)) after.set(file.path, file.content);

	const problems: Problem[] = [];
	for (const { path, content } of components) {
		const before = new Set(componentNames(path, project[path]));
		for (const name of componentNames(path, content)) {
			if (before.has(name)) continue;
			const other = [...after].find(([otherPath, source]) => otherPath !== path && componentNames(otherPath, source).includes(name))?.[0];
			if (!other) continue;
			const index = content.split("\n").findIndex((line) => new RegExp(`\\b(?:function|const|let|class)\\s+${name}\\b`).test(line));
			problems.push({
				path,
				message: `${name} is already exported by ${other}. Import it from "../components/${other.slice("components/".length, -".tsx".length)}" instead of re-creating it; if it needs to change, edit ${other} (add an optional prop or variant) and update the files that use it.`,
				...(index === -1 ? {} : { line: index + 1 }),
			});
		}
		after.set(path, content);
	}
	return problems;
}

export type ValidateOptions = {
	/** The file a `context` task writes (`PRODUCT.md` or `DESIGN.md`); it is then the only writable path */
	contextTarget?: string;
	/** Alternate names Rabisco assigned to a variation run (`*.alt-N.tsx`); any other alternate path is rejected */
	alternates?: ReadonlySet<string>;
};

/** A `context` task writes its one Markdown file: no screens, no components, no deletes. */
function validateContextTask(written: ProjectFile[], deleted: string[], target: string): Problem[] {
	const problems: Problem[] = [];
	const only = `This task writes only ${target}. Don't write or delete anything else.`;
	for (const path of deleted) problems.push({ path, message: only });
	for (const { path, content } of written) {
		if (path !== target || !FILE_RULES.paths.context.test(path)) problems.push({ path, message: only });
		else if (!content.trim()) problems.push({ path, message: `${path} is empty. Write the complete file.` });
		else if (content.length > FILE_RULES.maxFileLength) {
			problems.push({ path, message: `${path} is ${content.length} characters; the limit is ${FILE_RULES.maxFileLength}. Make it shorter.` });
		}
	}
	return problems;
}

/**
 * Validates provider writes against the project they apply to. `deleted` are
 * paths the same generation removes. Returns every problem found, in file order.
 */
export function validateFiles(written: ProjectFile[], project: ProjectFiles, deleted: string[] = [], options: ValidateOptions = {}): Problem[] {
	if (options.contextTarget) return validateContextTask(written, deleted, options.contextTarget);
	const problems: Problem[] = [];
	const gone = new Set(deleted);
	const components = new Set<string>();
	for (const path of Object.keys(project)) if (FILE_RULES.paths.component.test(path) && !gone.has(path)) components.add(path);
	for (const file of written) if (FILE_RULES.paths.component.test(file.path)) components.add(file.path);

	for (const path of deleted) {
		const problem = checkPath(path, options.alternates);
		if (problem) problems.push({ path, message: `Can't delete ${path}. ${problem}` });
	}

	for (const { path, content } of written) {
		const pathProblem = checkPath(path, options.alternates);
		if (pathProblem) problems.push({ path, message: pathProblem });
		if (FILE_RULES.paths.context.test(path)) continue; // Markdown: nothing to compile

		if (content.length > FILE_RULES.maxFileLength) {
			problems.push({
				path,
				message: `File is ${content.length} characters; the limit is ${FILE_RULES.maxFileLength}. Split it into smaller components.`,
			});
			continue;
		}

		const compiled = compile(path, content);
		if (!("code" in compiled)) {
			problems.push({ path, message: `Syntax error: ${compiled.message}`, line: compiled.line });
			continue;
		}

		const specifiers = new Set([...sourceImports(content), ...extractRequires(compiled.code)]);
		for (const specifier of specifiers) {
			const message = checkImport(path, specifier, { components });
			if (message) problems.push({ path, message, line: importLine(content, specifier) });
		}

		const kind = fileKindOf(path);
		if (kind) problems.push(...checkExports(path, kind, compiled.code, content));
	}
	problems.push(...checkDuplicateExports(written, project, gone));
	return problems;
}
