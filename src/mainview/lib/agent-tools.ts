import { cachedComponentApi, componentUsages } from "../../shared/components/usages";
import { propsSignature } from "../../shared/components/api";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { designSourceOf, type AppliedTheme } from "../../shared/context/theme";
import { normalizeTokenName, seedDesignTokens } from "../../shared/context/token-edit";
import { designTokensOf, setDesignToken, validateToken, validateTokenName } from "../../shared/context/tokens";
import { applyEditBlocks, parseEditBlocks } from "../../shared/edit-blocks";
import { DESIGN_RULE_LABELS, type DesignFinding } from "../../shared/design/findings";
import { lineAt } from "../../shared/design/locate";
import { imageTargets } from "../../shared/export/targets";
import type { GitStatus } from "../../shared/git";
import { isString } from "../../shared/guards";
import { findElement, parseJsx, readImports } from "../../shared/jsx";
import { resolveModule } from "../../shared/jsx/modules";
import { isJsonObject, type Json, type JsonObject } from "../../shared/json";
import {
	errorResult,
	jsonResult,
	NO_PROJECT,
	textResult,
	type ToolContent,
	type ToolResult,
} from "../../shared/mcp/tools";
import {
	appliedTheme,
	FRAME_GAP,
	FRAME_SIZE,
	isComponentFile,
	isDevice,
	isScreenFile,
	uniqueScreenPath,
} from "../../shared/project";
import { sectionOf } from "../../shared/sections";
import type { CanvasComment, CanvasDoc, Device, ElementLock, Frame, ProjectFiles } from "../../shared/types";
import { isAlternate, placeNewFrames } from "../../shared/variations";
import type { Snapshot } from "./history";
import { atPath, buildOutline, findNode, pathOf, remapStart, type OutlineNode } from "./outline";
import { compileSource } from "./render/compile";
import type { Box } from "./render/protocol";
import type { ChangeOptions } from "./project-session";

export type AgentElement = { file: string; start: number };

export type AgentPoint = { x: number; y: number };

/** One write, for the History panel and the marker on the screens it touched */
export type AgentLog = { label: string; changed: string[]; screens: string[] };

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
	/** Where the element at `start` renders in the screen, in frame pixels */
	elementBox: (frame: Frame, start: number) => Promise<Box | null>;
	/** The session's `change`: a write lands as one undo step */
	change: (recipe: (snapshot: Snapshot) => Snapshot, options: ChangeOptions) => void;
	/** The coalesce key that makes this call its own undo step */
	step: string;
	/** Called after each write lands */
	log: (entry: AgentLog) => void;
	/** A generation is running in the project */
	busy: () => boolean;
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

function requiredString(args: JsonObject, name: string): string {
	const value = stringArg(args, name);

	if (!value) throw new ToolError(`Pass \`${name}\`.`);

	return value;
}

function stringsArg(args: JsonObject, name: string): string[] {
	const value = args[name];

	if (value === undefined || value === null) return [];

	if (!Array.isArray(value) || !value.every(isString)) throw new ToolError(`\`${name}\` must be a list of strings.`);

	return value.map((each) => each.trim()).filter(Boolean);
}

const isAbsolutePath = (path: string) => path.startsWith("/") || /^[a-z]:[\\/]/i.test(path);

function codeArg(args: JsonObject, name: string): string | undefined {
	const value = args[name];

	if (value === undefined || value === null) return undefined;

	if (!isString(value)) throw new ToolError(`\`${name}\` must be a string.`);

	return value.trim() ? value : undefined;
}

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

const screenName = (context: AgentContext, file: string) =>
	context.canvas.frames.find((frame) => frame.file === file)?.name ?? file;

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

function checkWritable(context: AgentContext) {
	if (context.busy()) throw new ToolError("A generation is running in this project. Try again when it's done.");
}

function checkCompiles(file: string, code: string) {
	const { error } = compileSource(file, code);

	if (error)
		throw new ToolError(`\`${file}\` doesn't compile, so nothing changed. Line ${error.line}: ${error.message}`);

	if (isScreenFile(file) && !/^\s*export\s+default\b/m.test(code))
		throw new ToolError(`\`${file}\` needs a default export: the screen's component.`);
}

function lockedElement(lock: ElementLock, source: string) {
	const tree = parseJsx(source);
	const element = tree.ok ? atPath(tree, lock.path) : null;

	return element?.name === lock.name ? element : null;
}

function touchedLock(locks: readonly ElementLock[] | undefined, file: string, before: string, after: string) {
	return (locks ?? []).find((lock) => {
		const old = lock.file === file ? lockedElement(lock, before) : null;

		if (!old) return false;
		const start = remapStart(before, after, old.start);
		const now = start === null ? null : findElement(parseJsx(after), start);

		return !now || after.slice(now.start, now.end) !== before.slice(old.start, old.end);
	});
}

function checkLocks(context: AgentContext, file: string, code: string) {
	const before = context.files[file];
	const lock = before === undefined ? undefined : touchedLock(context.canvas.locks, file, before, code);

	if (lock)
		throw new ToolError(`The change touches the locked <${lock.name}> in \`${file}\`. Unlock it in Rabisco first.`);
}

const writeFile = (context: AgentContext, file: string, code: string, options: ChangeOptions = {}) =>
	context.change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: code } }), {
		...options,
		coalesce: context.step,
	});

const overlaps = (a: Frame, b: Frame) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function rightOf(frames: readonly Frame[], anchor: Frame, frame: Frame): Frame {
	const placed = { ...frame, x: anchor.x + anchor.width + FRAME_GAP, y: anchor.y };
	let blocker = frames.find((each) => overlaps(each, placed));

	while (blocker) {
		placed.x = blocker.x + blocker.width + FRAME_GAP;
		blocker = frames.find((each) => overlaps(each, placed));
	}

	return placed;
}

function deviceArg(context: AgentContext, args: JsonObject): Device {
	const device = args["device"];

	if (device === undefined || device === null) return context.canvas.device;

	if (!isDevice(device)) throw new ToolError("`device` must be mobile, tablet or desktop.");

	return device;
}

function createScreen(context: AgentContext, args: JsonObject): Json {
	const name = requiredString(args, "name");
	const code = codeArg(args, "code");
	const nextTo = stringArg(args, "next_to");
	const device = deviceArg(context, args);
	const { canvas, files } = context;
	const anchor = nextTo ? frameOf(context, resolveFile(context, nextTo, false)) : null;

	if (!code) throw new ToolError("Pass `code`.");
	checkWritable(context);
	const file = uniqueScreenPath(name, Object.keys(files));
	checkCompiles(file, code);

	const top = canvas.frames.length ? Math.min(...canvas.frames.map((each) => each.y)) : 0;
	const frame: Frame = { file, name, device, x: 0, y: top, ...FRAME_SIZE[device] };
	const placed = anchor ? rightOf(canvas.frames, anchor, frame) : placeNewFrames(canvas.frames, [frame])[0]!;

	context.change(
		(snapshot) => ({ ...snapshot, files: { ...snapshot.files, [file]: code }, frames: [...snapshot.frames, placed] }),
		{ coalesce: context.step, select: [file] },
	);
	context.log({ label: `Created ${name}`, changed: [file], screens: [file] });

	return { file, name, device, x: placed.x, y: placed.y, width: placed.width, height: placed.height };
}

function editScreen(context: AgentContext, args: JsonObject): Json {
	const file = resolveFile(context, stringArg(args, "screen"), false);
	const edits = codeArg(args, "edits");
	const whole = codeArg(args, "code");

	if (!edits === !whole) throw new ToolError("Pass either `edits` or `code`.");
	checkWritable(context);
	const before = context.files[file]!;
	let code = whole ?? before;

	if (edits) {
		const blocks = parseEditBlocks(edits);

		if (!blocks) throw new ToolError("`edits` has no complete SEARCH/REPLACE block.");
		const applied = applyEditBlocks(before, blocks);

		if (!applied.ok) throw new ToolError(`${applied.reason} in \`${file}\`, so nothing changed.`);
		code = applied.content;
	}

	if (code === before) return { file, changed: false };
	checkCompiles(file, code);
	checkLocks(context, file, code);
	writeFile(context, file, code);
	context.log({ label: `Edited ${screenName(context, file)}`, changed: [file], screens: [file] });

	return { file, changed: true };
}

function componentFile(name: string): string {
	const file = name.startsWith("components/") ? name : `components/${name.replace(/\.tsx$/, "")}.tsx`;

	if (!isComponentFile(file))
		throw new ToolError(
			`\`${name}\` isn't a component file. Use a kebab-case name such as \`components/stat-card.tsx\`.`,
		);

	return file;
}

function writeComponent(context: AgentContext, args: JsonObject): Json {
	const file = componentFile(requiredString(args, "component"));
	const code = codeArg(args, "code");
	const before = context.files[file];

	if (!code) throw new ToolError("Pass `code`.");
	checkWritable(context);

	if (code === before) return { file, created: false, changed: false };
	checkCompiles(file, code);
	checkLocks(context, file, code);
	writeFile(context, file, code);
	const users = componentUsages({ ...context.files, [file]: code }).get(file) ?? [];

	context.log({
		label: `${before === undefined ? "Created" : "Edited"} ${file.slice("components/".length, -".tsx".length)}`,
		changed: [file],
		screens: users.flatMap((usage) => (isScreenFile(usage.path) ? [usage.path] : [])),
	});

	return { file, created: before === undefined, changed: true };
}

type TokenValue = { name: string; mode: "light" | "dark"; value: string | null };

function tokenValues(args: JsonObject, mode: "light" | "dark"): TokenValue[] {
	const given = args[mode];

	if (given === undefined || given === null) return [];

	if (!isJsonObject(given)) throw new ToolError(`\`${mode}\` must map token names to values.`);

	return Object.entries(given).map(([raw, value]) => {
		const name = normalizeTokenName(raw);

		if (!isString(value)) throw new ToolError(`The ${mode} value of \`${name}\` must be a string.`);
		const trimmed = value.trim();
		const reason = trimmed ? validateToken(name, trimmed) : validateTokenName(name);

		if (reason) throw new ToolError(`${mode === "dark" ? "Dark" : "Light"} ${name}: ${reason}`);

		return { name, mode, value: trimmed || null };
	});
}

const themeOf = (design: string): AppliedTheme => {
	const { light, dark } = designTokensOf(design);
	const source = designSourceOf(design);

	return source ? { light, dark, source } : { light, dark };
};

function setDesignTokens(context: AgentContext, args: JsonObject): Json {
	const values = [...tokenValues(args, "light"), ...tokenValues(args, "dark")];

	if (!values.length) throw new ToolError("Pass `light` or `dark` with at least one token.");
	checkWritable(context);
	const seeded = seedDesignTokens(context.files["DESIGN.md"] ?? "", context.canvas.theme);
	const design = values.reduce((text, { name, mode, value }) => setDesignToken(text, name, mode, value), seeded);

	context.change(
		(snapshot) => ({ ...snapshot, files: { ...snapshot.files, "DESIGN.md": design }, theme: themeOf(design) }),
		{ coalesce: context.step },
	);
	context.log({
		label: `Set ${values.length} design token${values.length === 1 ? "" : "s"}`,
		changed: ["DESIGN.md"],
		screens: [],
	});

	return { set: values.length, tokens: designTokensOf(design) };
}

const PIN_INSET = 16;

async function addComment(context: AgentContext, args: JsonObject): Promise<Json> {
	const text = requiredString(args, "text");
	const file = resolveFile(context, stringArg(args, "screen"), false);
	const frame = frameOf(context, file);
	const element = stringArg(args, "element");
	let pin = { x: PIN_INSET, y: PIN_INSET };

	checkWritable(context);

	if (element) {
		const found = atPath(parseJsx(context.files[file]!), parsePath(element));

		if (!found) throw new ToolError(`\`${file}\` has no element at \`${element}\`.`);
		const box = await context.elementBox(frame, found.start);

		if (!box || box.width <= 0 || box.height <= 0)
			throw new ToolError(`Element ${element} isn't visible on the screen.`);

		pin = {
			x: Math.round(Math.min(box.x + box.width / 2, frame.width - PIN_INSET)),
			y: Math.round(Math.min(box.y + box.height / 2, frame.height - PIN_INSET)),
		};
	}

	const comment: CanvasComment = { id: crypto.randomUUID(), file, ...pin, text, createdAt: new Date().toISOString() };

	context.change((snapshot) => ({ ...snapshot, comments: [...(snapshot.comments ?? []), comment] }), {
		coalesce: context.step,
	});
	context.log({ label: `Commented on ${frame.name}`, changed: [], screens: [] });

	return { id: comment.id, screen: { file, name: frame.name }, element: element ?? null };
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
		case "create_screen":
			return jsonResult(createScreen(context, args));
		case "edit_screen":
			return jsonResult(editScreen(context, args));
		case "write_component":
			return jsonResult(writeComponent(context, args));
		case "set_design_tokens":
			return jsonResult(setDesignTokens(context, args));
		case "add_comment":
			return jsonResult(await addComment(context, args));
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
