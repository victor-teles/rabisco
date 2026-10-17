// Decision 0047. Where screens and components use the project's images, icons and fonts, read from their source.

import { assetKey } from "./assets";
import { isCodeFile, tokenUsages, type TokenUsage } from "./context/token-usage";
import { tokenKind, type DesignTokens } from "./context/tokens";
import { leadingFamily, type FontFamily } from "./fonts";
import { iconBase, iconPackOf, type IconPack } from "./icons";
import { readImports } from "./jsx/imports";
import { flatten, parseFile } from "./jsx/tree";
import type { ProjectFiles } from "./types";

const ASSET_REFERENCE = /(?<=["'`(\s,]|^)(?:\.\/|\/)?[\w./-]+\.[a-z0-9]+(?=[?#\s"'`),]|$)/gim;

const addUse = (usages: Map<string, TokenUsage>, name: string, path: string, count = 1) => {
	const usage = usages.get(name) ?? { count: 0, paths: [] };
	usage.count += count;

	if (!usage.paths.includes(path)) usage.paths.push(path);
	usages.set(name, usage);
};

export function assetUsages(files: ProjectFiles, srcs: Iterable<string>): Map<string, TokenUsage> {
	const known = new Set(srcs);
	const usages = new Map<string, TokenUsage>();

	for (const [path, source] of Object.entries(files)) {
		if (!isCodeFile(path)) continue;

		for (const [reference] of source.matchAll(ASSET_REFERENCE)) {
			const key = assetKey(reference);

			if (key && known.has(key)) addUse(usages, key, path);
		}
	}

	return usages;
}

/** `name` is the icon's base name in its pack (`Star`, `StarFilled`) */
export type IconUse = TokenUsage & { pack: IconPack; name: string };

export function iconUsages(files: ProjectFiles): IconUse[] {
	const usages = new Map<string, TokenUsage>();
	const icons = new Map<string, { pack: IconPack; name: string }>();

	for (const [path, source] of Object.entries(files)) {
		if (!isCodeFile(path)) continue;
		const parsed = parseFile(source);
		const locals = new Map<string, string>();

		for (const decl of readImports(parsed)) {
			const pack = iconPackOf(decl.module);

			if (!pack || decl.typeOnly) continue;

			for (const specifier of decl.named) {
				if (specifier.type) continue;
				const name = iconBase(pack, specifier.imported);
				const key = `${pack}:${name}`;
				icons.set(key, { pack, name });
				locals.set(specifier.local, key);
			}
		}

		if (!locals.size) continue;

		for (const element of flatten(parsed)) {
			const key = element.name ? locals.get(element.name) : undefined;

			if (key) addUse(usages, key, path);
		}
	}

	return [...usages]
		.map(([key, usage]) => ({ ...icons.get(key)!, ...usage }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.pack.localeCompare(b.pack));
}

export function fontUsages(
	files: ProjectFiles,
	tokens: DesignTokens,
	families: FontFamily[],
): Map<string, TokenUsage & { tokens: string[] }> {
	const byToken = tokenUsages(files, tokens);
	const usages = new Map<string, TokenUsage & { tokens: string[] }>();

	for (const family of families) {
		const name = family.family.toLowerCase();
		const usage = { count: 0, paths: new Array<string>(), tokens: new Array<string>() };

		for (const [token, value] of Object.entries({ ...tokens.dark, ...tokens.light })) {
			if (tokenKind(token) !== "font" || leadingFamily(value) !== name) continue;
			usage.tokens.push(token);
			const used = byToken.get(token);

			if (!used) continue;
			usage.count += used.count;

			for (const path of used.paths) if (!usage.paths.includes(path)) usage.paths.push(path);
		}

		usages.set(family.slug, usage);
	}

	return usages;
}
