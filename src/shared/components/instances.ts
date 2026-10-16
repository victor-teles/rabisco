import { twMerge } from "tailwind-merge";
import { isString } from "../guards";
import { isComponentFile } from "../project";
import { classNameOf, setClassName } from "../tailwind/classes";
import type { FileChange } from "../types";
import { addImport, readImports, removeUnusedImports } from "../jsx/imports";
import { resolveModule, rewriteModule } from "../jsx/modules";
import { slotPropNames } from "../jsx/naming";
import { freeIdentifiers } from "../jsx/scope";
import { attrValue, childText, dedent, indentAt, reindent } from "../jsx/text";
import { setAttribute } from "../jsx/transforms";
import { findElement, flatten, parseFile, type JsxElement, type ParsedFile } from "../jsx/tree";
import { componentApi, type PropSpec } from "./api";
import { isOpen, matching, splitTop, tokenize, type Tok } from "./tokens";

export type UsageRef = { path: string; start: number };

export type Instance = { componentPath: string; exportName: string; local: string; element: JsxElement };

export type Override = { name: string; kind: "text" | "classes"; value: string };

export type InstanceResult = { ok: true; changes: FileChange[]; start: number } | { ok: false; reason: string };

type Entry = { name: string; start: number; end: number; rest: boolean; defaultStart: number | null };

type Edit = { from: number; to: number; text: string };

type Definition = {
	paramOpen: number;
	paramClose: number;
	pattern: { open: number; close: number; entries: Entry[] } | null;
	annotation: { start: number; end: number } | null;
	typeBody: { open: number; close: number } | null;
	bodyOpen: number;
	bodyClose: number;
	onlyReturn: boolean;
	root: JsxElement | null;
};

const CN_MODULE = "@/lib/utils";

const fail = (reason: string): InstanceResult => ({ ok: false, reason });

const splice = (source: string, from: number, to: number, text: string) =>
	source.slice(0, from) + text + source.slice(to);

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

export function instanceAt(files: Record<string, string>, path: string, start: number): Instance | null {
	const source = files[path];

	if (source === undefined) return null;
	const parsed = parseFile(source);
	const element = parsed.ok ? findElement(parsed, start) : null;

	if (!element?.name || element.intrinsic) return null;
	const local = element.name.split(".")[0]!;

	for (const decl of readImports(parsed)) {
		const componentPath = `${resolveModule(path, decl.module)}.tsx`;

		if (!isComponentFile(componentPath) || !(componentPath in files)) continue;
		const specifier = decl.named.find((s) => s.local === local && !s.type);

		if (specifier && specifier.local === element.name)
			return { componentPath, exportName: specifier.imported, local, element };
	}

	return null;
}

function functionTokens(toks: Tok[], exportName: string): { paramOpen: number; bodyAt: number } | null {
	for (let i = 0; i < toks.length; i++) {
		const tok = toks[i]!;

		if (tok.text === "function" && toks[i + 1]?.text === exportName && toks[i + 2]?.type === "(") {
			const close = matching(toks, i + 2);
			let k = close + 1;

			while (k < toks.length && toks[k]!.type !== "{") k = isOpen(toks[k]) ? matching(toks, k) + 1 : k + 1;

			return { paramOpen: i + 2, bodyAt: k };
		}

		if ((tok.text === "const" || tok.text === "let") && toks[i + 1]?.text === exportName && toks[i + 2]?.text === "=") {
			let k = i + 3;

			if (toks[k]?.text === "async") k++;

			if (toks[k]?.type !== "(") return null;
			const close = matching(toks, k);
			let arrow = close + 1;

			while (arrow < toks.length && toks[arrow]!.text !== "=>") arrow++;

			return { paramOpen: k, bodyAt: arrow + 1 };
		}
	}

	return null;
}

function typeBodyOf(toks: Tok[], name: string): { open: number; close: number } | null {
	for (let i = 0; i < toks.length; i++) {
		if (
			toks[i]!.text === "type" &&
			toks[i + 1]?.text === name &&
			toks[i + 2]?.text === "=" &&
			toks[i + 3]?.type === "{"
		)
			return { open: toks[i + 3]!.start, close: toks[matching(toks, i + 3)]!.start };

		if (toks[i]!.text === "interface" && toks[i + 1]?.text === name) {
			let k = i + 2;

			while (k < toks.length && toks[k]!.type !== "{") k++;

			if (k < toks.length) return { open: toks[k]!.start, close: toks[matching(toks, k)]!.start };
		}
	}

	return null;
}

function returnedRoot(file: ParsedFile, from: number, to: number): JsxElement | null {
	const roots = file.roots.filter((root) => root.start > from && root.end <= to && root.container === null);

	for (const root of [...roots].reverse()) {
		const before = file.source
			.slice(from, root.start)
			.replace(/[\s(]+$/, "")
			.trimEnd();

		if (/(?:return|=>)$/.test(before)) return root;
	}

	return null;
}

function definitionOf(source: string, exportName: string): Definition | null {
	const toks = tokenize(source);
	const file = parseFile(source);

	if (!toks || !file.ok) return null;
	const found = functionTokens(toks, exportName);

	if (!found) return null;
	const closeIndex = matching(toks, found.paramOpen);
	const paramOpen = toks[found.paramOpen]!.start;
	const paramClose = toks[closeIndex]!.start;
	let pattern: Definition["pattern"] = null;
	let annotation: Definition["annotation"] = null;
	let typeBody: Definition["typeBody"] = null;
	let k = found.paramOpen + 1;

	if (toks[k]?.type === "{") {
		const close = matching(toks, k);
		const entries: Entry[] = [];

		for (const part of splitTop(toks, k + 1, close, [","], false)) {
			if (!part.length) continue;
			const rest = part[0]!.text === "...";
			const name = rest ? (part[1]?.text ?? "") : part[0]!.text;
			const eq = part.findIndex((t) => t.text === "=");

			entries.push({
				name,
				start: part[0]!.start,
				end: part[part.length - 1]!.end,
				rest,
				defaultStart: eq > 0 && part[eq + 1] ? part[eq + 1]!.start : null,
			});
		}

		pattern = { open: toks[k]!.start, close: toks[close]!.start, entries };
		k = close + 1;
	}

	if (pattern && toks[k]?.text === ":") {
		let end = k + 1;

		while (end < closeIndex && toks[end]!.text !== "=") end = isOpen(toks[end]) ? matching(toks, end) + 1 : end + 1;
		const first = toks[k + 1]!;
		const last = toks[end - 1]!;
		annotation = { start: first.start, end: last.end };

		if (first.type === "{" && matching(toks, k + 1) === end - 1) typeBody = { open: first.start, close: last.start };
		else if (end === k + 2 && first.type === "name") typeBody = typeBodyOf(toks, first.text);
	}

	const bodyTok = toks[found.bodyAt];

	if (!bodyTok) return null;
	const block = bodyTok.type === "{";
	const bodyOpen = bodyTok.start;
	const bodyClose = block ? toks[matching(toks, found.bodyAt)]!.end : source.length;
	const root = returnedRoot(file, block ? bodyOpen : bodyOpen - 1, bodyClose);
	const onlyReturn = !block || toks[found.bodyAt + 1]?.text === "return";

	return { paramOpen, paramClose, pattern, annotation, typeBody, bodyOpen, bodyClose, onlyReturn, root };
}

function addProp(source: string, exportName: string, name: string, type: string, fallback: string | null) {
	const definition = definitionOf(source, exportName);

	if (!definition) return null;

	if (definition.pattern?.entries.some((e) => e.name === name)) return source;
	const entry = fallback === null ? name : `${name} = ${fallback}`;
	const member = `${name}?: ${type};`;

	if (!definition.pattern) {
		if (source.slice(definition.paramOpen + 1, definition.paramClose).trim()) return null;

		return splice(source, definition.paramOpen + 1, definition.paramClose, `{ ${entry} }: { ${member} }`);
	}

	const { entries, open, close } = definition.pattern;
	const rest = entries.find((e) => e.rest);
	const last = [...entries].reverse().find((e) => !e.rest);

	const pattern: Edit = rest
		? { from: rest.start, to: rest.start, text: `${entry}, ` }
		: last
			? { from: last.end, to: last.end, text: `, ${entry}` }
			: { from: open + 1, to: close, text: ` ${entry} ` };

	const typeEdit: Edit | null = definition.typeBody
		? memberEdit(source, definition.typeBody, member)
		: definition.annotation
			? { from: definition.annotation.end, to: definition.annotation.end, text: ` & { ${member} }` }
			: null;

	let out = source;

	for (const edit of [pattern, typeEdit].sort((a, b) => (b?.from ?? 0) - (a?.from ?? 0)))
		if (edit) out = splice(out, edit.from, edit.to, edit.text);

	return out;
}

function memberEdit(source: string, body: { open: number; close: number }, member: string): Edit {
	const inner = source.slice(body.open + 1, body.close);

	if (!inner.trim()) return { from: body.open + 1, to: body.close, text: ` ${member} ` };

	if (inner.includes("\n")) {
		let end = body.close;

		while (end > body.open && /\s/.test(source[end - 1]!)) end--;
		const lastLine = source.slice(source.lastIndexOf("\n", end - 1) + 1, end);
		const indent = /^\s*/.exec(lastLine)![0];
		const sep = /[;,]$/.test(source.slice(0, end)) ? "" : ";";

		return { from: end, to: end, text: `${sep}\n${indent}${member}` };
	}

	const trimmed = inner.trimEnd();
	const sep = /[;,]$/.test(trimmed) ? "" : ";";

	return { from: body.open + 1, to: body.close, text: `${trimmed}${sep} ${member} ` };
}

function propsOf(source: string, exportName: string): PropSpec[] {
	return componentApi("", source).exports.find((e) => e.name === exportName)?.props ?? [];
}

function stringAttribute(element: JsxElement, name: string): string | null {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === name);

	return attribute?.kind === "attribute" && attribute.value?.kind === "string" ? attribute.value.value : null;
}

const isOverrideProp = (spec: PropSpec) =>
	spec.name === "className" ||
	spec.name.endsWith("ClassName") ||
	(spec.type.kind === "string" && isString(spec.default));

export function usageOverrides(files: Record<string, string>, usage: UsageRef): Override[] {
	const instance = instanceAt(files, usage.path, usage.start);

	if (!instance) return [];
	const props = propsOf(files[instance.componentPath]!, instance.exportName);

	return props.flatMap((spec) => {
		if (!isOverrideProp(spec)) return [];
		const value = stringAttribute(instance.element, spec.name);

		if (value === null || value === spec.default) return [];

		return [
			{ name: spec.name, kind: spec.type.kind === "string" && spec.default !== undefined ? "text" : "classes", value },
		];
	});
}

type Context = { instance: Instance; component: string; target: JsxElement; screen: string };

function contextOf(files: Record<string, string>, usage: UsageRef, elementStart: number): Context | string {
	const instance = instanceAt(files, usage.path, usage.start);

	if (!instance) return "Select a usage of a project component.";
	const component = files[instance.componentPath]!;
	const parsed = parseFile(component);
	const target = parsed.ok ? findElement(parsed, elementStart) : null;

	if (!target?.name) return `That element isn't in ${instance.componentPath} anymore.`;

	return { instance, component, target, screen: files[usage.path]! };
}

function propIdentifier(element: JsxElement, props: Set<string>): string | null {
	const children = element.children.filter((c) => c.kind !== "text" || c.value.trim());

	if (children.length !== 1 || children[0]!.kind !== "expression") return null;
	const name = children[0]!.text.trim();

	return props.has(name) ? name : null;
}

function finish(context: Context, usage: UsageRef, component: string, screen: string | null): InstanceResult {
	const changes: FileChange[] = [];

	if (component !== context.component) changes.push({ path: context.instance.componentPath, content: component });

	if (screen === null) return fail("Couldn't write the override.");

	if (screen !== context.screen) changes.push({ path: usage.path, content: screen });

	return { ok: true, changes, start: usage.start };
}

const destructured = (source: string, exportName: string) =>
	new Set(definitionOf(source, exportName)?.pattern?.entries.map((e) => e.name) ?? []);

export function overrideText(
	files: Record<string, string>,
	usage: UsageRef,
	elementStart: number,
	text: string,
): InstanceResult {
	const context = contextOf(files, usage, elementStart);

	if (isString(context)) return fail(context);
	const { instance, target } = context;
	let component = context.component;
	let name = propIdentifier(target, destructured(component, instance.exportName));

	if (name === "children") return fail("This text comes from the usage. Edit it in the screen.");

	if (!name) {
		if (target.children.some((c) => c.kind !== "text"))
			return fail("Only an element with plain text can be overridden.");
		const first = target.children[0];
		const last = target.children[target.children.length - 1];

		if (!first || !last || target.closingStart === null) return fail("This element has no text to override.");

		const value = target.children
			.map((c) => (c.kind === "text" ? c.value : ""))
			.join("")
			.trim();

		const definition = definitionOf(component, instance.exportName);
		const taken = [...(definition?.pattern?.entries.map((e) => e.name) ?? []), instance.exportName];
		name = slotPropNames(
			[{ slot: { kind: "text", element: target, value, start: 0, end: 0 }, values: [value, text] }],
			taken,
		)[0]!;
		const raw = component.slice(first.start, last.end);
		const lead = /^\s*/.exec(raw)![0];
		const trail = /\s*$/.exec(raw)![0];
		const edited = splice(component, first.start + lead.length, last.end - trail.length, `{${name}}`);
		const added = addProp(edited, instance.exportName, name, "string", JSON.stringify(value));

		if (added === null) return fail(`Couldn't add a ${name} prop to ${instance.exportName}.`);
		component = added;
	}

	const fallback = propsOf(component, instance.exportName).find((p) => p.name === name)?.default;

	return finish(
		context,
		usage,
		component,
		setAttribute(context.screen, usage.start, name, text === fallback ? null : text),
	);
}

export function overrideAttribute(
	files: Record<string, string>,
	usage: UsageRef,
	elementStart: number,
	attribute: string,
	value: string,
): InstanceResult {
	if (attribute === "className") return overrideClasses(files, usage, elementStart, value);
	const context = contextOf(files, usage, elementStart);

	if (isString(context)) return fail(context);
	const { instance, target } = context;
	let component = context.component;
	const found = [...target.attributes].reverse().find((a) => a.kind === "attribute" && a.name === attribute);
	const props = destructured(component, instance.exportName);
	let name: string | null = null;

	if (found?.kind === "attribute" && found.value?.kind === "expression" && props.has(found.value.text.trim()))
		name = found.value.text.trim();
	else if (found?.kind === "attribute" && found.value?.kind === "string") {
		const current = found.value.value;

		const slot = {
			kind: "attribute" as const,
			element: target,
			name: attribute,
			value: current,
			raw: found.value.raw,
			start: 0,
			end: 0,
		};

		name = slotPropNames([{ slot, values: [current, value] }], [...props, instance.exportName])[0]!;
		const edited = splice(component, found.value.start, found.value.end, `{${name}}`);
		const added = addProp(edited, instance.exportName, name, "string", JSON.stringify(current));

		if (added === null) return fail(`Couldn't add a ${name} prop to ${instance.exportName}.`);
		component = added;
	}

	if (!name) return fail(`${attribute} isn't a plain string here, so it can't be overridden.`);
	const fallback = propsOf(component, instance.exportName).find((p) => p.name === name)?.default;

	return finish(
		context,
		usage,
		component,
		setAttribute(context.screen, usage.start, name, value === fallback ? null : value),
	);
}

function classPropName(component: string, exportName: string, target: JsxElement, root: boolean) {
	if (root) return "className";
	const tag = target.name!;

	const base = target.intrinsic
		? /^h[1-6]$/.test(tag)
			? "title"
			: tag === "svg"
				? "icon"
				: tag
		: lowerFirst(tag.replace(/\W/g, ""));

	const taken = destructured(component, exportName);
	let name = `${base}ClassName`;

	for (let n = 2; taken.has(name); n++) name = `${base}${n}ClassName`;

	return name;
}

function mergedProp(element: JsxElement): string | null {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === "className");

	if (attribute?.kind !== "attribute" || attribute.value?.kind !== "expression") return null;
	const text = attribute.value.text;
	const names = [...text.matchAll(/\b(\w*[cC]lassName)\b(?!\s*[:=(])/g)].map((m) => m[1]!);

	return names[names.length - 1] ?? null;
}

function mergeClassProp(source: string, element: JsxElement, name: string): string | null {
	const info = classNameOf(source, element);
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === "className");

	if (info.kind === "none") return setAttributeExpression(source, element, `className={${name}}`);

	if (info.kind === "string" || info.kind === "literal")
		return withCn(setAttributeExpression(source, element, `className={cn(${JSON.stringify(info.classes)}, ${name})}`));

	if (info.kind === "call" && attribute?.kind === "attribute" && attribute.value) {
		const close = source.lastIndexOf(")", attribute.value.end);

		return close > attribute.value.start ? withCn(splice(source, close, close, `, ${name}`)) : null;
	}

	return null;
}

function setAttributeExpression(source: string, element: JsxElement, text: string) {
	const attribute = [...element.attributes].reverse().find((a) => a.kind === "attribute" && a.name === "className");

	if (attribute) return splice(source, attribute.start, attribute.end, text);

	return splice(source, element.nameEnd, element.nameEnd, ` ${text}`);
}

function withCn(source: string) {
	const bound = readImports(parseFile(source)).some(
		(d) => d.named.some((s) => s.local === "cn") || d.defaultName === "cn",
	);

	return bound ? source : addImport(source, CN_MODULE, ["cn"]);
}

export function usageClasses(files: Record<string, string>, usage: UsageRef, elementStart: number): string | null {
	const context = contextOf(files, usage, elementStart);

	if (isString(context)) return null;
	const base = classNameOf(context.component, context.target).classes;
	const name = mergedProp(context.target);
	const override = name ? stringAttribute(context.instance.element, name) : null;

	return override ? twMerge(base, override) : base;
}

export function overrideClasses(
	files: Record<string, string>,
	usage: UsageRef,
	elementStart: number,
	classes: string,
): InstanceResult {
	const context = contextOf(files, usage, elementStart);

	if (isString(context)) return fail(context);
	const { instance, target } = context;
	let component = context.component;
	let name = mergedProp(target);

	if (!name) {
		const definition = definitionOf(component, instance.exportName);
		name = classPropName(component, instance.exportName, target, definition?.root?.start === target.start);
		const merged = mergeClassProp(component, target, name);

		if (merged === null) return fail("Its classes are computed in code, so they can't be overridden here.");
		const added = addProp(merged, instance.exportName, name, "string", null);

		if (added === null) return fail(`Couldn't add a ${name} prop to ${instance.exportName}.`);
		component = added;
	}

	const base = new Set(classNameOf(context.component, target).classes.split(/\s+/).filter(Boolean));
	const extra = classes.split(/\s+/).filter((c) => c && !base.has(c));

	return finish(
		context,
		usage,
		component,
		setAttribute(context.screen, usage.start, name, extra.length ? extra.join(" ") : null),
	);
}

const classList = (classes: string) => classes.split(/\s+/).filter(Boolean);

export function overrideClassChange(
	files: Record<string, string>,
	usage: UsageRef,
	elementStart: number,
	before: string,
	after: string,
): InstanceResult {
	const current = usageClasses(files, usage, elementStart);

	if (current === null) return fail("That element isn't in the component anymore.");
	const old = new Set(classList(before));
	const next = classList(after);
	const removed = new Set([...old].filter((name) => !next.includes(name)));
	const kept = classList(current).filter((name) => !removed.has(name));

	return overrideClasses(
		files,
		usage,
		elementStart,
		twMerge(kept.join(" "), next.filter((name) => !old.has(name)).join(" ")),
	);
}

export function resetOverrides(files: Record<string, string>, usage: UsageRef): InstanceResult {
	const overrides = usageOverrides(files, usage);
	let screen: string | null = files[usage.path] ?? null;

	if (!overrides.length) return fail("This usage has no overrides.");

	for (const { name } of overrides) screen = screen === null ? null : setAttribute(screen, usage.start, name, null);

	if (screen === null) return fail("Couldn't reset the overrides.");

	return { ok: true, changes: [{ path: usage.path, content: screen }], start: usage.start };
}

export function applyOverrides(files: Record<string, string>, usage: UsageRef): InstanceResult {
	const instance = instanceAt(files, usage.path, usage.start);
	const overrides = usageOverrides(files, usage);

	if (!instance) return fail("Select a usage of a project component.");

	if (!overrides.length) return fail("This usage has no overrides.");
	let component = files[instance.componentPath]!;
	let screen: string | null = files[usage.path]!;

	for (const override of overrides) {
		const next =
			override.kind === "text"
				? applyDefault(component, instance.exportName, override)
				: applyClasses(component, override);

		if (next === null) continue;
		component = next;
		screen = screen === null ? null : setAttribute(screen, usage.start, override.name, null);
	}

	if (screen === null) return fail("Couldn't apply the overrides.");

	return {
		ok: true,
		changes: [
			{ path: instance.componentPath, content: component },
			{ path: usage.path, content: screen },
		],
		start: usage.start,
	};
}

function applyDefault(component: string, exportName: string, override: Override) {
	const entry = definitionOf(component, exportName)?.pattern?.entries.find((e) => e.name === override.name);

	if (!entry || entry.defaultStart === null) return null;

	return splice(component, entry.defaultStart, entry.end, JSON.stringify(override.value));
}

function applyClasses(component: string, override: Override) {
	const parsed = parseFile(component);
	const element = parsed.ok ? flatten(parsed).find((e) => e.name && mergedProp(e) === override.name) : null;

	if (!element) return null;
	const info = classNameOf(component, element);

	if (info.kind === "call") return setClassName(component, element.start, twMerge(info.classes, override.value));

	return withCn(
		setAttributeExpression(component, element, `className={cn(${JSON.stringify(override.value)}, ${override.name})}`),
	);
}

type Value = { kind: "string"; text: string } | { kind: "code"; text: string } | { kind: "none" };

function usageValues(screen: string, element: JsxElement): Map<string, Value> {
	const values = new Map<string, Value>();

	for (const attribute of element.attributes) {
		if (attribute.kind !== "attribute") continue;

		if (!attribute.value) values.set(attribute.name, { kind: "code", text: "true" });
		else if (attribute.value.kind === "string")
			values.set(attribute.name, { kind: "string", text: attribute.value.value });
		else values.set(attribute.name, { kind: "code", text: attribute.value.text.trim() });
	}

	if (element.closingStart !== null) {
		const inner = screen.slice(element.openingEnd, element.closingStart);

		if (inner.trim()) values.set("children", { kind: "code", text: `<>${inner}</>` });
	}

	return values;
}

function defaultValue(component: string, entry: Entry): Value {
	if (entry.defaultStart === null) return { kind: "none" };
	const text = component.slice(entry.defaultStart, entry.end).trim();
	const quoted = /^(["'])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(text);

	return quoted ? { kind: "string", text: quoted[2]!.replace(/\\(.)/g, "$1") } : { kind: "code", text };
}

const asCode = (value: Value) =>
	value.kind === "string" ? JSON.stringify(value.text) : value.kind === "code" ? value.text : "undefined";

function substitutions(
	component: string,
	root: JsxElement,
	values: Map<string, Value>,
	screenChildren: string | null,
): Edit[] | string {
	const file = parseFile(component);
	const edits: Edit[] = [];
	const names = new Set(values.keys());

	for (const element of flatten(root)) {
		for (const attribute of element.attributes) {
			if (attribute.kind === "spread") {
				if (names.has(attribute.text.replace(/^\.\.\./, "").trim())) return "It spreads its props onto an element.";
				continue;
			}

			if (attribute.value?.kind !== "expression") continue;
			const text = attribute.value.text.trim();
			const value = values.get(text);

			if (value) {
				edits.push({
					from: attribute.start,
					to: attribute.end,
					text:
						value.kind === "none"
							? ""
							: value.kind === "string"
								? `${attribute.name}=${attrValue(value.text)}`
								: `${attribute.name}={${value.text}}`,
				});
				continue;
			}

			if (attribute.name === "className" && text.startsWith("cn(")) {
				edits.push({ from: attribute.start, to: attribute.end, text: inlineCn(text, values) });
				continue;
			}

			edits.push(...identifierEdits(file, attribute.value, values));
		}

		for (const child of element.children) {
			if (child.kind !== "expression") continue;
			const name = child.text.trim();
			const value = values.get(name);

			if (name === "children" && screenChildren !== null)
				edits.push({ from: child.start, to: child.end, text: screenChildren });
			else if (value)
				edits.push({
					from: child.start,
					to: child.end,
					text: value.kind === "none" ? "" : value.kind === "string" ? childText(value.text) : `{${value.text}}`,
				});
			else edits.push(...identifierEdits(file, child, values));
		}

		if (element.name && values.has(element.name)) {
			const value = values.get(element.name)!;

			if (value.kind !== "code" || !/^[A-Z][\w.]*$/.test(value.text))
				return `It renders the ${element.name} prop as a tag.`;
			edits.push({ from: element.start + 1, to: element.start + 1 + element.name.length, text: value.text });

			if (element.closingStart !== null)
				edits.push({
					from: element.closingStart + 2,
					to: element.closingStart + 2 + element.name.length,
					text: value.text,
				});
		}
	}

	return edits;
}

function identifierEdits(file: ParsedFile, span: { start: number; end: number }, values: Map<string, Value>): Edit[] {
	const edits: Edit[] = [];

	for (const token of file.tokens) {
		if (token.start < span.start || token.end > span.end) continue;
		const text = file.source.slice(token.start, token.end);
		const value = values.get(text);

		if (!value || file.source[token.start - 1] === "." || token.isType) continue;

		if (/^\s*:/.test(file.source.slice(token.end))) continue;
		edits.push({ from: token.start, to: token.end, text: value.kind === "code" ? `(${value.text})` : asCode(value) });
	}

	return edits;
}

function inlineCn(text: string, values: Map<string, Value>) {
	const args = text
		.slice(3, text.lastIndexOf(")"))
		.split(",")
		.map((a) => a.trim())
		.filter(Boolean);

	const parts: string[] = [];

	for (const arg of args) {
		const value = values.get(arg);

		if (value?.kind === "none") continue;
		parts.push(value ? asCode(value) : arg);
	}

	const literals = parts.flatMap((part) => {
		const value: string | number | null = /^"(?:[^"\\]|\\.)*"$/.test(part) ? JSON.parse(part) : null;

		return isString(value) ? [value] : [];
	});

	if (literals.length === parts.length) {
		const merged = twMerge(...literals);

		return merged ? `className=${attrValue(merged)}` : "";
	}

	return `className={cn(${parts.join(", ")})}`;
}

function applyEdits(source: string, from: number, to: number, edits: Edit[]) {
	let out = source.slice(from, to);

	for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
		const at = edit.from - from;
		const end = edit.to - from;
		let start = at;

		if (!edit.text && /\s/.test(out[start - 1] ?? "") && out[start - 1] !== "\n") {
			while (start > 0 && out[start - 1] === " ") start--;
		}

		out = out.slice(0, start) + edit.text + out.slice(end);
	}

	return out;
}

export function detachUsage(files: Record<string, string>, usage: UsageRef): InstanceResult {
	const instance = instanceAt(files, usage.path, usage.start);

	if (!instance) return fail("Select a usage of a project component to detach.");
	const component = files[instance.componentPath]!;
	const definition = definitionOf(component, instance.exportName);

	if (!definition?.root) return fail(`Couldn't find what ${instance.exportName} returns.`);

	if (!definition.onlyReturn)
		return fail(`${instance.exportName} runs code before it returns, so it can't be detached.`);
	const screen = files[usage.path]!;
	const given = usageValues(screen, instance.element);
	const values = new Map<string, Value>();

	for (const entry of definition.pattern?.entries ?? []) {
		if (entry.rest) return fail(`${instance.exportName} passes the rest of its props on, so it can't be detached.`);
		values.set(entry.name, given.get(entry.name) ?? defaultValue(component, entry));
	}

	const children = given.get("children");

	const screenChildren =
		children?.kind === "code" ? screen.slice(instance.element.openingEnd, instance.element.closingStart!).trim() : null;

	values.delete("children");

	if (!definition.pattern?.entries.some((e) => e.name === "children") && screenChildren) {
		return fail(`${instance.exportName} doesn't render its children, so detaching would lose them.`);
	}

	const edits = substitutions(
		component,
		definition.root,
		values,
		definition.pattern?.entries.some((e) => e.name === "children") ? (screenChildren ?? "") : null,
	);

	if (isString(edits)) return fail(`${edits} Detach can't inline it.`);
	let jsx = applyEdits(component, definition.root.start, definition.root.end, edits);
	const key = [...instance.element.attributes].find((a) => a.kind === "attribute" && a.name === "key");

	if (key) jsx = jsx.replace(/^<[\w.]+/, (open) => `${open} ${screen.slice(key.start, key.end)}`);
	jsx = reindent(
		dedent(jsx, indentAt(component, definition.root.start)),
		indentAt(screen, instance.element.start),
	).trimStart();
	const inlined = splice(screen, instance.element.start, instance.element.end, jsx);
	let out = addImports(inlined, usage.path, component, instance.componentPath, definition.root);
	out = removeUnusedImports(out, [instance.local]);

	return {
		ok: true,
		changes: [{ path: usage.path, content: out }],
		start: instance.element.start + out.length - inlined.length,
	};
}

function addImports(screen: string, screenPath: string, component: string, componentPath: string, root: JsxElement) {
	const file = parseFile(component);
	const used = new Set(freeIdentifiers(file, root).map((f) => f.name));
	let out = screen;

	for (const decl of readImports(file)) {
		const names = decl.named.filter((s) => used.has(s.local) && !s.type).map((s) => s.local);

		if (decl.defaultName && used.has(decl.defaultName)) continue;

		if (names.length) out = addImport(out, rewriteModule(componentPath, decl.module, screenPath), names);
	}

	return out;
}

export function componentRoot(source: string, exportName: string): number | null {
	return definitionOf(source, exportName)?.root?.start ?? null;
}
