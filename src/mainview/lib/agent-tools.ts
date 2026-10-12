import { cachedComponentApi, componentUsages } from "../../shared/components/usages";
import { propsSignature } from "../../shared/components/api";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { designSourceOf } from "../../shared/context/theme";
import { DESIGN_RULE_LABELS, type DesignFinding } from "../../shared/design/findings";
import { lineAt } from "../../shared/design/locate";
import { imageTargets } from "../../shared/export/targets";
import type { GitStatus } from "../../shared/git";
import { isString } from "../../shared/guards";
import { parseJsx, readImports } from "../../shared/jsx";
import { resolveModule } from "../../shared/jsx/modules";
import type { Json, JsonObject } from "../../shared/json";
import {
	errorResult,
	jsonResult,
	NO_PROJECT,
	textResult,
	type ToolContent,
	type ToolResult,
} from "../../shared/mcp/tools";
import { appliedTheme, isComponentFile, isScreenFile } from "../../shared/project";
import { sectionOf } from "../../shared/sections";
import type { CanvasDoc, Frame, ProjectFiles } from "../../shared/types";
import { isAlternate } from "../../shared/variations";
import { atPath, buildOutline, findNode, pathOf, type OutlineNode } from "./outline";

export type AgentElement = { file: string; start: number };

export type AgentPoint = { x: number; y: number };

export type AgentCheck = { file: string; findings: DesignFinding[]; error?: string };

/** What the editor hands the tools: the project as it shows, and the editor's own renderer */
export type AgentContext = {
	path: string;
	canvas: CanvasDoc;
	files: ProjectFiles;
	elements: readonly AgentElement[];
	gitStatus: () => Promise<GitStatus>;
	/** A base64 PNG of the screen, or of the element at `start` in it */
	screenshot: (frame: Frame, start: number | null) => Promise<string>;
	elementAt: (file: string, point: AgentPoint) => Promise<AgentElement | null>;
	checkDesign: (frames: Frame[]) => Promise<AgentCheck[]>;
	/** Writes the website into a new folder inside `dir` and returns that folder */
	exportWebsite: (dir: string) => Promise<string>;
};

class ToolError extends Error {}

const elementPath = (path: readonly number[]) => path.join(".");

function parsePath(text: string): number[] {
	if (!/^\d+(\.\d+)*$/.test(text)) throw new ToolError(`\`${text}\` isn't an element path. Paths look like \`0.1.2\`.`);

	return text.split(".").map(Number);
}

function stringArg(args: JsonObject, name: string): string | undefined {
	const value = args[name];

	if (value === undefined || value === null) return undefined;

	if (!isString(value)) throw new ToolError(`\`${name}\` must be a string.`);

	return value.trim() || undefined;
}

function stringsArg(args: JsonObject, name: string): string[] {
	const value = args[name];

	if (value === undefined || value === null) return [];

	if (!Array.isArray(value) || !value.every(isString)) throw new ToolError(`\`${name}\` must be a list of strings.`);

	return value.map((each) => each.trim()).filter(Boolean);
}

const isAbsolutePath = (path: string) => path.startsWith("/") || /^[a-z]:[\\/]/i.test(path);

const isSourceFile = (path: string) => isScreenFile(path) || isComponentFile(path);

/** A file path, a screen name, or else the selected screen */
function resolveFile(context: AgentContext, screen: string | undefined, components: boolean): string {
	const { canvas, files } = context;
	const allowed = (path: string) => (components ? isSourceFile(path) : isScreenFile(path)) && files[path] !== undefined;

	if (!screen) {
		const selected = canvas.selection.find((file) => canvas.frames.some((frame) => frame.file === file));

		if (selected && allowed(selected)) return selected;

		throw new ToolError("No screen is selected in Rabisco. Pass `screen`, or select a screen on the canvas.");
	}

	const wanted = screen.toLowerCase();

	const found =
		[screen, `screens/${screen}.tsx`, `components/${screen}.tsx`].find(allowed) ??
		canvas.frames.find((frame) => frame.name.toLowerCase() === wanted && allowed(frame.file))?.file;

	if (found) return found;

	throw new ToolError(`There is no ${components ? "screen or component" : "screen"} \`${screen}\` in the project.`);
}

function frameOf(context: AgentContext, file: string): Frame {
	const frame = context.canvas.frames.find((each) => each.file === file);

	if (!frame) throw new ToolError(`\`${file}\` isn't on the canvas.`);

	return frame;
}

function describeElement(files: ProjectFiles, element: AgentElement) {
	const source = files[element.file];

	if (source === undefined) return null;
	const tree = parseJsx(source);
	const path = pathOf(tree, element.start);

	if (!path) return null;
	const node = findNode(buildOutline(element.file, source).roots, element.start)?.node;

	return {
		file: element.file,
		path: elementPath(path),
		line: lineAt(source, element.start),
		label: node?.label ?? null,
		hint: node?.hint ?? null,
	};
}

function projectImports(files: ProjectFiles, entry: string): string[] {
	const seen = new Set([entry]);
	const queue = [entry];

	while (queue.length) {
		const from = queue.shift()!;

		for (const { module } of readImports(files[from] ?? "")) {
			if (!module.startsWith(".")) continue;
			const base = resolveModule(from, module);
			const target = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((path) => files[path] !== undefined);

			if (!target || seen.has(target)) continue;
			seen.add(target);
			queue.push(target);
		}
	}

	seen.delete(entry);

	return [...seen].sort();
}

type TreeNode = { path: string; line: number; label: string; kind: string; hint: string; children: TreeNode[] };

const treeOf = (source: string, node: OutlineNode): TreeNode => ({
	path: node.key,
	line: lineAt(source, node.start),
	label: node.label,
	kind: node.kind,
	hint: node.hint,
	children: node.children.map((child) => treeOf(source, child)),
});

async function getProject(context: AgentContext): Promise<Json> {
	const { canvas, files } = context;
	const sections = canvas.sections ?? [];
	const git = await context.gitStatus().catch(() => null);

	return {
		name: canvas.name,
		path: context.path,
		device: canvas.device,
		devices: [...new Set(canvas.frames.map((frame) => frame.device))],
		git: git?.state === "repo",
		screens: canvas.frames.map((frame) => ({
			file: frame.file,
			name: frame.name,
			device: frame.device,
			width: frame.width,
			height: frame.height,
			section: sectionOf(frame, sections)?.name ?? null,
			alternate: isAlternate(frame.file),
		})),
		components: Object.keys(files).filter(isComponentFile).sort(),
		sections: sections.map((section) => section.name),
		contextFiles: ["PRODUCT.md", "DESIGN.md"].filter((name) => files[name] !== undefined),
	};
}

function getSelection(context: AgentContext): Json {
	const { canvas, files } = context;

	const screens = canvas.selection.flatMap((file) => {
		const frame = canvas.frames.find((each) => each.file === file);

		return frame ? [{ file, name: frame.name }] : [];
	});

	return { screens, elements: context.elements.flatMap((element) => describeElement(files, element) ?? []) };
}

function getScreen(context: AgentContext, args: JsonObject): Json {
	const file = resolveFile(context, stringArg(args, "screen"), true);

	return {
		file,
		source: context.files[file]!,
		imports: projectImports(context.files, file).map((path) => ({ file: path, source: context.files[path]! })),
	};
}

function getElementTree(context: AgentContext, args: JsonObject): Json {
	const file = resolveFile(context, stringArg(args, "screen"), true);
	const source = context.files[file]!;
	const outline = buildOutline(file, source);

	if (!outline.ok) throw new ToolError(`\`${file}\` doesn't parse: ${outline.error ?? "unknown error"}`);

	return { file, elements: outline.roots.map((root) => treeOf(source, root)) };
}

async function getScreenshot(context: AgentContext, args: JsonObject): Promise<ToolResult> {
	const file = resolveFile(context, stringArg(args, "screen"), false);
	const frame = frameOf(context, file);
	const element = stringArg(args, "element");
	let start: number | null = null;

	if (element) {
		const found = atPath(parseJsx(context.files[file]!), parsePath(element));

		if (!found) throw new ToolError(`\`${file}\` has no element at \`${element}\`.`);
		start = found.start;
	}

	const data = await context.screenshot(frame, start);
	const caption = element ? `Element ${element} of ${frame.name} (${file})` : `${frame.name} (${file})`;

	const content: ToolContent[] = [
		{ type: "image", data, mimeType: "image/png" },
		{ type: "text", text: caption },
	];

	return { content };
}

function getDesignTokens(context: AgentContext): Json {
	const theme = appliedTheme(context.canvas, context.files);
	const design = context.files["DESIGN.md"];

	return {
		applied: { light: theme.light, dark: theme.dark },
		appliedFromCurrentDesign: theme.source === undefined || theme.source === designSourceOf(design),
		designMd: design ?? null,
	};
}

function listComponents(context: AgentContext): Json {
	const { files } = context;
	const usages = componentUsages(files);

	const project = [...usages].map(([path, users]) => ({
		file: path,
		exports: cachedComponentApi(path, files[path]!).exports.map((exp) => ({
			name: exp.name,
			signature: propsSignature(exp),
			acceptsChildren: exp.acceptsChildren,
		})),
		usedBy: users.map((usage) => usage.path),
	}));

	const library = Object.entries(UI_MODULES).map(([module, names]) => ({
		import: `@/components/ui/${module}`,
		exports: [...names],
	}));

	return { project, library, icons: "Any icon from lucide-react" };
}

async function listComments(context: AgentContext): Promise<Json> {
	const { canvas, files } = context;
	const open = (canvas.comments ?? []).filter((comment) => !comment.resolved);

	return Promise.all(
		open.map(async (comment) => {
			const frame = comment.file ? canvas.frames.find((each) => each.file === comment.file) : undefined;
			const hit = frame ? await context.elementAt(frame.file, comment).catch(() => null) : null;

			return {
				id: comment.id,
				text: comment.text,
				createdAt: comment.createdAt,
				screen: frame ? { file: frame.file, name: frame.name } : null,
				element: hit ? describeElement(files, hit) : null,
				replies: (comment.replies ?? []).map((reply) => ({ text: reply.text, createdAt: reply.createdAt })),
			};
		}),
	);
}

async function checkDesign(context: AgentContext, args: JsonObject): Promise<Json> {
	const { canvas, files } = context;
	const named = stringsArg(args, "screens").map((screen) => frameOf(context, resolveFile(context, screen, false)));
	const targets = named.length ? [...new Set(named)] : imageTargets(canvas.frames, [], files);

	if (!targets.length) throw new ToolError("The project has no screens to check.");
	const results = await context.checkDesign(targets);
	const all = results.flatMap((result) => result.findings);

	return {
		errors: all.filter((finding) => finding.severity === "error").length,
		warnings: all.filter((finding) => finding.severity === "warning").length,
		screens: results.map((result) => ({
			file: result.file,
			name: frameOf(context, result.file).name,
			error: result.error ?? null,
			findings: result.findings.map((finding) => ({
				severity: finding.severity,
				rule: finding.rule,
				title: DESIGN_RULE_LABELS[finding.rule],
				message: finding.message,
				file: finding.path ?? result.file,
				line: finding.line ?? null,
			})),
		})),
	};
}

async function exportWebsite(context: AgentContext, args: JsonObject): Promise<ToolResult> {
	const dir = stringArg(args, "path");

	if (!dir || !isAbsolutePath(dir)) throw new ToolError("`path` must be an absolute folder path.");

	return textResult(await context.exportWebsite(dir));
}

async function run(tool: string, args: JsonObject, context: AgentContext): Promise<ToolResult> {
	switch (tool) {
		case "get_project":
			return jsonResult(await getProject(context));
		case "get_selection":
			return jsonResult(getSelection(context));
		case "get_screen":
			return jsonResult(getScreen(context, args));
		case "get_element_tree":
			return jsonResult(getElementTree(context, args));
		case "get_screenshot":
			return getScreenshot(context, args);
		case "get_design_tokens":
			return jsonResult(getDesignTokens(context));
		case "list_components":
			return jsonResult(listComponents(context));
		case "list_comments":
			return jsonResult(await listComments(context));
		case "check_design":
			return jsonResult(await checkDesign(context, args));
		case "export_website":
			return exportWebsite(context, args);
		default:
			return errorResult(`Rabisco has no tool \`${tool}\`.`);
	}
}

/** Errors a caller can fix come back as `isError` results with a sentence */
export async function runAgentTool(tool: string, args: JsonObject, context: AgentContext | null): Promise<ToolResult> {
	if (!context) return errorResult(NO_PROJECT);

	try {
		return await run(tool, args, context);
	} catch (error) {
		if (error instanceof ToolError) return errorResult(error.message);

		return errorResult(`${tool} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
