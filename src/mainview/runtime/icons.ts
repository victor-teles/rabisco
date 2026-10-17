// Each icon is its own classic script (`icons/<file>.js`, see vite.runtime.config.ts), so the runtime doesn't carry
// whole icon packs. Lucide, Tabler and Phosphor icons load the same way (decision 0050).
import {
	createContext,
	createElement,
	useContext,
	useEffect,
	useState,
	type ComponentType,
	type SVGProps,
} from "react";
import {
	createLucideIcon,
	Icon,
	LucideProvider,
	useLucideContext,
	type IconNode,
	type LucideIconData,
} from "lucide-react";
import { isString } from "../../shared/guards";
import { ICON_PACKS, iconFile, iconSpec, isFilledTabler, parseIconSpec, type IconPack } from "../../shared/icons";
import { cn } from "@/lib/utils";

type TablerIconData = { name: string; outline?: IconNode; filled?: IconNode };

const PHOSPHOR_WEIGHTS = ["regular", "thin", "light", "bold", "fill", "duotone"] as const;

type PhosphorWeight = (typeof PHOSPHOR_WEIGHTS)[number];

type PhosphorIconData = Record<PhosphorWeight, IconNode>;

type IconData = LucideIconData | TablerIconData | PhosphorIconData;

declare global {
	interface Window {
		__rabiscoIcon?: (file: string, data: IconData) => void;
	}
}

/** React 19 passes `ref` as a prop, so it reaches the `<svg>` with the rest */
type SvgProps = SVGProps<SVGSVGElement>;

/** `stroke` is the stroke width, as in @tabler/icons-react; screens may pass a number */
type TablerProps = SvgProps & { size?: number | string; title?: string };

type PhosphorProps = SvgProps & {
	size?: number | string;
	weight?: PhosphorWeight;
	mirrored?: boolean;
	alt?: string;
};

type AnyIconProps = SvgProps & { size?: number | string };

const isTablerData = (data: IconData): data is TablerIconData => "outline" in data || "filled" in data;

const isPhosphorData = (data: IconData): data is PhosphorIconData => "regular" in data;

const isLucideData = (data: IconData): data is LucideIconData => "node" in data;

const nodes = (node: IconNode | undefined) =>
	(node ?? []).map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }));

function tablerIcon(name: string, data: TablerIconData): ComponentType<TablerProps> {
	const filled = isFilledTabler(name);

	const component = function TablerIcon({
		size = 24,
		color = "currentColor",
		stroke,
		title,
		className,
		children,
		...rest
	}: TablerProps) {
		const paint = filled
			? { fill: color, stroke: "none" }
			: {
					fill: "none",
					stroke: color,
					strokeWidth: stroke ?? 2,
					strokeLinecap: "round" as const,
					strokeLinejoin: "round" as const,
				};

		return createElement(
			"svg",
			{
				xmlns: "http://www.w3.org/2000/svg",
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				...paint,
				className: cn("tabler-icon", `tabler-icon-${data.name}`, className),
				...rest,
			},
			title ? createElement("title", { key: "title" }, title) : null,
			...nodes(filled ? data.filled : data.outline),
			children,
		);
	};

	component.displayName = name;

	return component;
}

/** Like @phosphor-icons/react: props win over the context, which sets defaults for a subtree */
const IconContext = createContext<Omit<PhosphorProps, "alt">>({
	color: "currentColor",
	size: "1em",
	weight: "regular",
	mirrored: false,
});

function phosphorIcon(name: string, data: PhosphorIconData): ComponentType<PhosphorProps> {
	const component = function PhosphorIcon({ alt, color, size, weight, mirrored, children, ...rest }: PhosphorProps) {
		const {
			color: contextColor = "currentColor",
			size: contextSize,
			weight: contextWeight = "regular",
			mirrored: contextMirrored = false,
			...contextRest
		} = useContext(IconContext);

		return createElement(
			"svg",
			{
				xmlns: "http://www.w3.org/2000/svg",
				width: size ?? contextSize,
				height: size ?? contextSize,
				fill: color ?? contextColor,
				viewBox: "0 0 256 256",
				transform: (mirrored ?? contextMirrored) ? "scale(-1, 1)" : undefined,
				...contextRest,
				...rest,
			},
			alt ? createElement("title", { key: "alt" }, alt) : null,
			children,
			...nodes(data[weight ?? contextWeight] ?? data.regular),
		);
	};

	component.displayName = name;

	return component;
}

/** Raw script data by file */
const loaded = new Map<string, IconData>();

/** `null` once the script failed: the name isn't an icon. */
const loading = new Map<string, Promise<IconData | null>>();

const missing = new Set<string>();

/** By spec (`Star`, `@tabler/icons-react:IconStar`) */
const components = new Map<string, ComponentType<AnyIconProps>>();

const lazy = new Map<string, ComponentType<AnyIconProps>>();

/** What each icon script calls, through `window.__rabiscoIcon` */
export function registerIcon(file: string, data: IconData) {
	if (!loaded.has(file)) loaded.set(file, data);
}

if (typeof window !== "undefined") window.__rabiscoIcon = registerIcon;

function load(file: string): Promise<IconData | null> {
	const known = loaded.get(file);

	if (known) return Promise.resolve(known);
	let pending = loading.get(file);

	if (!pending) {
		pending = new Promise((resolve) => {
			const script = document.createElement("script");

			const done = () => {
				script.remove();
				loading.delete(file);
				const data = loaded.get(file) ?? null;

				if (!data) missing.add(file);
				resolve(data);
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

/** The component for a loaded icon, made once per export name */
function componentFor(
	spec: string,
	pack: IconPack,
	name: string,
	data: IconData,
): ComponentType<AnyIconProps> | undefined {
	const known = components.get(spec);

	if (known) return known;
	let component: ComponentType<AnyIconProps> | undefined;

	if (pack === "tabler" && isTablerData(data)) component = tablerIcon(name, data);
	else if (pack === "phosphor" && isPhosphorData(data)) component = phosphorIcon(name, data);
	else if (pack === "lucide" && isLucideData(data)) component = createLucideIcon(data);

	if (component) components.set(spec, component);

	return component;
}

/** `null` when every icon is already loaded, so callers can render synchronously. */
export function preloadIcons(specs: Iterable<string>): Promise<void> | null {
	const pending: Promise<unknown>[] = [];

	for (const spec of specs) {
		const file = iconFile(spec);

		if (file && !loaded.has(file) && !missing.has(file)) pending.push(load(file));
	}

	return pending.length ? Promise.all(pending).then(() => {}) : null;
}

/** For icons a screen reaches without a named import (`icons[name]`); renders an empty box of the same size until loaded. */
function lazyIcon(spec: string, pack: IconPack, name: string, file: string): ComponentType<AnyIconProps> {
	let component = lazy.get(spec);

	if (!component) {
		component = function LazyIcon(props: AnyIconProps) {
			const [Loaded, setLoaded] = useState(() => {
				const data = loaded.get(file);

				return data ? componentFor(spec, pack, name, data) : undefined;
			});

			useEffect(() => {
				if (Loaded) return;
				let live = true;
				void load(file).then((data) => {
					const icon = data ? componentFor(spec, pack, name, data) : undefined;

					if (live && icon) setLoaded(() => icon);
				});

				return () => void (live = false);
			}, [Loaded]);

			if (Loaded) return createElement(Loaded, props);
			const size = props.size ?? (pack === "phosphor" ? "1em" : 24);

			return createElement("svg", { width: size, height: size, className: props.className, "aria-hidden": true });
		};

		lazy.set(spec, component);
	}

	return component;
}

function iconFor(module: string, name: string): ComponentType<AnyIconProps> | undefined {
	const spec = iconSpec(module, name);
	const icon = spec ? parseIconSpec(spec) : null;
	const file = spec ? iconFile(spec) : null;

	if (!spec || !icon || !file || missing.has(file)) return undefined;
	const data = loaded.get(file);

	return (data && componentFor(spec, icon.pack, name, data)) || lazyIcon(spec, icon.pack, name, file);
}

/** Stands in for an icon module: icon exports resolve by name to the loaded icon. */
function iconModule<Named extends object>(module: string, named: Named) {
	const icons = new Proxy({}, { get: (_, name) => (isString(name) ? iconFor(module, name) : undefined) });
	const target = { __esModule: true, icons, ...named };

	const isOwn = (name: string | symbol): name is Extract<keyof typeof target, string | symbol> =>
		Object.hasOwn(target, name);

	return new Proxy(target, {
		get: (base, name) => (isOwn(name) ? base[name] : isString(name) ? iconFor(module, name) : undefined),
		has: (_, name) => isOwn(name) || (isString(name) && iconFor(module, name) !== undefined),
	});
}

export const lucide = iconModule(ICON_PACKS.lucide.module, {
	createLucideIcon,
	Icon,
	LucideProvider,
	useLucideContext,
});

export const tabler = iconModule(ICON_PACKS.tabler.module, {});

export const phosphor = iconModule(ICON_PACKS.phosphor.module, { IconContext });
