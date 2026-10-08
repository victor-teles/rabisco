// Each icon is its own classic script (`icons/<name>.js`, see vite.runtime.config.ts), so the runtime doesn't carry all of lucide.
import { createElement, useEffect, useState, type ComponentType } from "react";
import {
	createLucideIcon,
	Icon,
	LucideProvider,
	useLucideContext,
	type LucideIcon,
	type LucideIconData,
	type LucideProps,
} from "lucide-react";
import { isString } from "../../shared/guards";

declare global {
	interface Window {
		__rabiscoIcon?: (file: string, data: LucideIconData) => void;
	}
}

const loaded = new Map<string, LucideIcon>();

/** `null` once the script failed: the name isn't an icon. */
const loading = new Map<string, Promise<LucideIcon | null>>();

const missing = new Set<string>();

const lazy = new Map<string, ComponentType<LucideProps>>();

const FILE = /^[a-z0-9-]+$/;

/** Mirrors lucide's `toKebabCase`; the build writes a script for every alias whose kebab name differs. */
export function iconFile(name: string): string | null {
	const base = name.replace(/^Lucide(?=[A-Z0-9])/, "").replace(/(?<=.)Icon$/, "");

	if (!/^[A-Z]/.test(base)) return null;
	const file = base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

	return FILE.test(file) ? file : null;
}

if (typeof window !== "undefined")
	window.__rabiscoIcon = (file, data) => {
		if (!loaded.has(file)) loaded.set(file, createLucideIcon(data));
	};

function load(file: string): Promise<LucideIcon | null> {
	const known = loaded.get(file);

	if (known) return Promise.resolve(known);
	let pending = loading.get(file);

	if (!pending) {
		pending = new Promise((resolve) => {
			const script = document.createElement("script");

			const done = () => {
				script.remove();
				loading.delete(file);
				const icon = loaded.get(file) ?? null;

				if (!icon) missing.add(file);
				resolve(icon);
			};

			script.onload = done;
			script.onerror = done;
			script.src = `icons/${file}.js`;
			document.head.appendChild(script);
		});
		loading.set(file, pending);
	}

	return pending;
}

/** `null` when every icon is already loaded, so callers can render synchronously. */
export function preloadIcons(names: Iterable<string>): Promise<void> | null {
	const pending: Promise<unknown>[] = [];

	for (const name of names) {
		const file = iconFile(name);

		if (file && !loaded.has(file) && !missing.has(file)) pending.push(load(file));
	}

	return pending.length ? Promise.all(pending).then(() => {}) : null;
}

/** For icons a screen reaches without a named import (`icons[name]`); renders an empty box of the same size until loaded. */
function lazyIcon(file: string): ComponentType<LucideProps> {
	let component = lazy.get(file);

	if (!component) {
		component = function LazyIcon(props: LucideProps) {
			const [Loaded, setLoaded] = useState(() => loaded.get(file));

			useEffect(() => {
				if (Loaded) return;
				let live = true;
				void load(file).then((icon) => {
					if (live && icon) setLoaded(() => icon);
				});

				return () => void (live = false);
			}, [Loaded]);

			if (Loaded) return createElement(Loaded, props);
			const size = props.size ?? 24;

			return createElement("svg", { width: size, height: size, className: props.className, "aria-hidden": true });
		};

		lazy.set(file, component);
	}

	return component;
}

function iconFor(name: string): ComponentType<LucideProps> | undefined {
	const file = iconFile(name);

	if (!file || missing.has(file)) return undefined;

	return loaded.get(file) ?? lazyIcon(file);
}

const icons = new Proxy({}, { get: (_, name) => (isString(name) ? iconFor(name) : undefined) });

const named = { __esModule: true, createLucideIcon, Icon, LucideProvider, useLucideContext, icons };

const isNamed = (name: string | symbol): name is keyof typeof named => Object.hasOwn(named, name);

/** Stands in for `lucide-react`: icon exports resolve by name to the loaded icon. */
export const lucide = new Proxy(named, {
	get: (target, name) => (isNamed(name) ? target[name] : isString(name) ? iconFor(name) : undefined),
	has: (_, name) => isNamed(name) || (isString(name) && iconFor(name) !== undefined),
});
