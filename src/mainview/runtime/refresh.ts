// A new module version gives every component a new function, which React would remount. Each component is
// rebound (see `refreshEpilogue` in lib/render/compile.ts) to a proxy that stays the same and calls the latest version.
import type { ReactNode } from "react";
import type { ModuleExports } from "./registry";

/** A top-level function of a project module: a component, or a helper the module calls itself. */
type Declared = (...args: object[]) => ReactNode;

type Family = { signature: string; impl: Declared; proxy: Declared };

const families = new Map<string, Family>();

const proxies = new WeakSet<Declared>();

function isDeclared<T>(value: T): value is T & Declared {
	return typeof value === "function" && !/^class[\s{]/.test(Function.prototype.toString.call(value));
}

function proxyFor(key: string, signature: string, impl: Declared): Declared {
	let family = families.get(key);

	// Hooks changed: React can't keep the old state, so the component remounts under a new proxy
	if (!family || family.signature !== signature) {
		const created: Family = { signature, impl, proxy: (...args) => created.impl(...args) };
		proxies.add(created.proxy);
		families.set(key, created);
		family = created;
	}

	family.impl = impl;
	Object.assign(family.proxy, impl);
	Object.defineProperty(family.proxy, "name", { value: impl.name, configurable: true });

	return family.proxy;
}

const replace = (exports: ModuleExports, key: string, value: Declared) =>
	Object.defineProperty(exports, key, { value, writable: true, enumerable: true, configurable: true });

export type Stabilize = {
	(exports: ModuleExports, name: string, impl: Declared): Declared;
	/** Exports the rebinding didn't reach: arrow functions, anonymous defaults. */
	exports: (exports: ModuleExports) => void;
};

export function refresh(path: string, signature: string): Stabilize {
	const stabilize = (exports: ModuleExports, name: string, impl: Declared) => {
		if (proxies.has(impl) || !isDeclared(impl)) return impl;
		const proxy = proxyFor(`${path}\0${name}`, signature, impl);

		for (const [key, value] of Object.entries(exports)) if (value === impl) replace(exports, key, proxy);

		return proxy;
	};

	stabilize.exports = (exports: ModuleExports) => {
		for (const [key, value] of Object.entries(exports)) {
			if ((key === "default" || /^[A-Z]/.test(key)) && isDeclared(value) && !proxies.has(value))
				replace(exports, key, proxyFor(`${path}\0export ${key}`, signature, value));
		}
	};

	return stabilize;
}
