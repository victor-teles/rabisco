// Plan, then screens: decision 0015. The model's plan is parsed and fitted to the project here, before anything is written.

import { projectComponents } from "../components/usages";
import { isString } from "../guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../json";
import { isScreenFile, toKebab, uniqueScreenPath } from "../project";
import type { ProjectFiles } from "../types";
import {
	FILE_RULES,
	type GenerationPlan,
	type PlannedComponent,
	type PlannedLink,
	type PlannedScreen,
} from "./contract";

export const PLAN_LIMITS = { screens: 6, components: 4, links: 24, name: 60, text: 240 } as const;

const text = (value: Json | undefined, max: number = PLAN_LIMITS.text) =>
	isString(value) ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const list = (value: Json | undefined): readonly Json[] => (isJsonArray(value) ? value : []);

const objects = (value: Json | undefined): JsonObject[] =>
	list(value).flatMap((item) => (isJsonObject(item) ? [item] : []));

/** `tab bar`, `tab-bar` or `components/tab-bar.tsx` → `TabBar` */
export function pascalName(name: string) {
	const base = name.replace(/^components\//, "").replace(/\.tsx$/, "");

	const words = base
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);

	const joined = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");

	return /^[A-Z]/.test(joined) ? joined : "";
}

/** The fenced ```json block, else the outermost braces; `null` when there is no JSON object in the text. */
export function planJsonOf(reply: string): JsonObject | null {
	const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(reply)?.[1];
	const start = reply.indexOf("{");
	const end = reply.lastIndexOf("}");
	const candidates = [fenced, start >= 0 && end > start ? reply.slice(start, end + 1) : undefined];

	for (const candidate of candidates) {
		if (!candidate?.trim()) continue;

		try {
			// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
			const parsed = JSON.parse(candidate) as Json;

			if (isJsonObject(parsed)) return parsed;
		} catch {
			// Not JSON; try the next candidate
		}
	}

	return null;
}

/** Reads the model's JSON as written; `fitPlan` makes it safe for the project. */
function planFromJson(json: JsonObject): GenerationPlan {
	const screens = objects(json.screens).map((screen) => ({
		path: text(screen.path),
		name: text(screen.name, PLAN_LIMITS.name),
		purpose: text(screen.purpose),
		content: text(screen.content),
	}));

	const components = objects(json.components).map((component) => ({
		path: text(component.path),
		name: text(component.name, PLAN_LIMITS.name),
		purpose: text(component.purpose),
		usedBy: list(component.usedBy).flatMap((path) => (isString(path) ? [path.trim()] : [])),
	}));

	const links = objects(json.links).map((link) => ({
		from: text(link.from),
		to: text(link.to),
		label: text(link.label, PLAN_LIMITS.name),
	}));

	return { screens, components, links };
}

/** A plan from a reply, fitted to the project; `null` when it has no usable screen. */
export function parsePlanReply(reply: string, files: ProjectFiles): GenerationPlan | null {
	const json = planJsonOf(reply);

	if (!json) return null;
	const plan = fitPlan(planFromJson(json), files);

	return plan.screens.length ? plan : null;
}

/** Component names the project's components already export */
function exportedNames(files: ProjectFiles) {
	return new Set(projectComponents(files).flatMap((component) => component.exports.map((e) => e.name)));
}

/**
 * Makes any plan safe to run on `files`: valid new paths, no duplicates, no component the project already has,
 * links and users only between planned screens, and capped counts. Also run on a plan the webview sends back.
 */
export function fitPlan(plan: GenerationPlan, files: ProjectFiles): GenerationPlan {
	const taken = new Set(Object.keys(files));
	/** What the model called a screen → its final path, so links and users follow a renamed path */
	const moved = new Map<string, string>();
	const screens: PlannedScreen[] = [];

	for (const screen of plan.screens) {
		if (screens.length >= PLAN_LIMITS.screens) break;
		const wanted = screen.path.trim();

		// The same path twice is the same screen, planned again
		if (moved.has(wanted)) continue;

		const valid = FILE_RULES.paths.screen.test(wanted);

		const label =
			screen.name.trim() ||
			wanted
				.replace(/^screens\//, "")
				.replace(/\.tsx$/, "")
				.replace(/-/g, " ")
				.trim();

		if (!label) continue;
		const path = valid && !taken.has(wanted) ? wanted : uniqueScreenPath(label, taken);
		taken.add(path);

		if (wanted) moved.set(wanted, path);
		moved.set(path, path);
		screens.push({
			path,
			name: label[0]!.toUpperCase() + label.slice(1),
			purpose: screen.purpose.trim(),
			content: screen.content.trim(),
		});
	}

	const planned = new Set(screens.map((screen) => screen.path));
	const existingScreens = new Set(Object.keys(files).filter(isScreenFile));
	const exported = exportedNames(files);
	const components: PlannedComponent[] = [];

	for (const component of plan.components) {
		if (components.length >= PLAN_LIMITS.components) break;
		const name = pascalName(component.name) || pascalName(component.path);

		const path = FILE_RULES.paths.component.test(component.path)
			? component.path
			: `components/${toKebab(name.replace(/([a-z0-9])([A-Z])/g, "$1-$2"))}.tsx`;

		// The project has it already: the screens import that one
		if (!name || path in files || exported.has(name) || taken.has(path)) continue;
		taken.add(path);
		exported.add(name);

		const usedBy = [
			...new Set(component.usedBy.flatMap((user) => (planned.has(moved.get(user) ?? "") ? [moved.get(user)!] : []))),
		];

		components.push({ path, name, purpose: component.purpose.trim(), usedBy });
	}

	const links: PlannedLink[] = [];
	const linked = new Set<string>();

	for (const link of plan.links) {
		if (links.length >= PLAN_LIMITS.links) break;
		const from = moved.get(link.from) ?? "";
		const to = moved.get(link.to) ?? (existingScreens.has(link.to) ? link.to : "");
		const key = `${from}\0${to}\0${link.label}`;

		if (!planned.has(from) || !to || from === to || linked.has(key)) continue;
		linked.add(key);
		links.push({ from, to, label: link.label.trim() });
	}

	return { screens, components, links };
}

export const plansFirst = (request: { planMode: boolean; task: string; variations: number; plan?: GenerationPlan }) =>
	request.planMode && request.task === "create" && request.variations === 1 && !request.plan;

export const revisedPrompt = (prompt: string, feedback: string) => `${prompt.trim()}\n\n${feedback.trim()}`;

export const planRevisionPrompt = (prompt: string, plan: GenerationPlan, feedback: string) =>
	[
		prompt.trim(),
		`This plan was proposed for it:\n${planBlock(plan)}`,
		`Revise the plan as this feedback asks, and keep what it doesn't mention:\n${feedback.trim()}`,
	].join("\n\n");

/** Keeps the ticked screens and components; links and users of a dropped screen go with it */
export function selectPlan(plan: GenerationPlan, keep: { screens: Iterable<string>; components: Iterable<string> }) {
	const screens = new Set(keep.screens);
	const components = new Set(keep.components);
	const kept = plan.screens.filter((screen) => screens.has(screen.path));
	const paths = new Set(kept.map((screen) => screen.path));

	return {
		screens: kept,
		components: plan.components.flatMap((component) =>
			components.has(component.path)
				? [{ ...component, usedBy: component.usedBy.filter((user) => paths.has(user)) }]
				: [],
		),
		links: plan.links.filter((link) => paths.has(link.from) && (paths.has(link.to) || !planHas(plan, link.to))),
	} satisfies GenerationPlan;
}

const planHas = (plan: GenerationPlan, path: string) => plan.screens.some((screen) => screen.path === path);

/** A new name gets a matching path, unless the name is empty; links and users follow it */
export function renamePlanScreen(
	plan: GenerationPlan,
	path: string,
	name: string,
	files: ProjectFiles,
): GenerationPlan {
	const clean = name.replace(/\s+/g, " ").trim().slice(0, PLAN_LIMITS.name);
	const screen = plan.screens.find((s) => s.path === path);

	if (!screen || !clean || clean === screen.name) return plan;
	const taken = new Set([...Object.keys(files), ...plan.screens.flatMap((s) => (s.path === path ? [] : [s.path]))]);
	const next = uniqueScreenPath(clean, taken);
	const swap = (p: string) => (p === path ? next : p);

	return {
		screens: plan.screens.map((s) => (s.path === path ? { ...s, path: next, name: clean } : s)),
		components: plan.components.map((c) => ({ ...c, usedBy: c.usedBy.map(swap) })),
		links: plan.links.map((link) => ({ ...link, from: swap(link.from), to: swap(link.to) })),
	};
}

/** The reply a model gives for a plan task; the mock writes it, and tests read it back */
export function planBlock(plan: GenerationPlan) {
	return `\`\`\`json\n${JSON.stringify(plan, null, "\t")}\n\`\`\``;
}
