import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { listLinks, resolveLink, type ElementRef, type ProjectLink } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type Side = "left" | "right" | "top" | "bottom";

/**
 * One drawn connector: every link of a source screen that goes to the same
 * place. `to` is a target frame, or a stub for "back" and missing screens.
 */
type Connector = {
	key: string;
	source: Frame;
	links: ProjectLink[];
} & ({ kind: "screen"; target: Frame } | { kind: "back" } | { kind: "broken"; to: string });

/** Screen pixels: stroke widths, arrowheads and stubs keep their size at every zoom */
const STROKE = 1.5;
const STROKE_SELECTED = 2;
const ARROW = 8;
const DOT = 3;
const STUB = 40;
/** Canvas units: how far curves bow out of a frame's edge, at most */
const MAX_BOW = 320;

/** Where a connector leaves `a` and enters `b`, from where the frames sit. `null` when they overlap. */
function sidesOf(a: Rect, b: Rect): [Side, Side] | null {
	if (b.x >= a.x + a.width) return ["right", "left"];
	if (b.x + b.width <= a.x) return ["left", "right"];
	if (b.y >= a.y + a.height) return ["bottom", "top"];
	if (b.y + b.height <= a.y) return ["top", "bottom"];
	return null;
}

/** The point at `t` (0…1) along `side` of `rect`. */
function pointOn(rect: Rect, side: Side, t: number): Point {
	if (side === "left" || side === "right") return { x: side === "left" ? rect.x : rect.x + rect.width, y: rect.y + rect.height * t };
	return { x: rect.x + rect.width * t, y: side === "top" ? rect.y : rect.y + rect.height };
}

const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

/** The frames' connectors, from the project's links. Links in components or frameless files aren't drawn. */
function connectorsOf(frames: Frame[], files: ProjectFiles): Connector[] {
	const byFile = new Map(frames.map((frame) => [frame.file, frame]));
	const connectors = new Map<string, Connector>();
	for (const link of listLinks(files)) {
		const source = byFile.get(link.file);
		if (!source) continue;
		const resolved = resolveLink(link.to, files);
		const target = resolved.kind === "screen" ? byFile.get(resolved.file) : undefined;
		// A link to the screen itself goes nowhere visible
		if (resolved.kind === "screen" && (!target || target === source)) continue;
		const key = `${source.file}→${resolved.kind === "screen" ? resolved.file : resolved.kind === "back" ? "back" : `?${resolved.to}`}`;
		const existing = connectors.get(key);
		if (existing) existing.links.push(link);
		else if (resolved.kind === "screen") connectors.set(key, { key, source, links: [link], kind: "screen", target: target! });
		else if (resolved.kind === "back") connectors.set(key, { key, source, links: [link], kind: "back" });
		else connectors.set(key, { key, source, links: [link], kind: "broken", to: resolved.to });
	}
	return [...connectors.values()];
}

type Route = { connector: Connector; from: Point; to: Point; fromSide: Side; toSide: Side | null };

/**
 * Endpoints for every connector. Connectors that share a frame side are
 * spread along it, ordered by where their other end is, so they don't cross.
 */
function routesOf(connectors: Connector[]): Route[] {
	type End = { route: number; frame: Frame; side: Side; other: Point; outgoing: boolean };
	const ends: End[] = [];
	const sides: { fromSide: Side; toSide: Side | null }[] = [];
	connectors.forEach((connector, route) => {
		const source = connector.source;
		if (connector.kind === "screen") {
			const [fromSide, toSide] = sidesOf(source, connector.target) ?? ["right", "right"];
			sides.push({ fromSide, toSide });
			const center = (frame: Frame) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
			ends.push({ route, frame: source, side: fromSide, other: center(connector.target), outgoing: true });
			ends.push({ route, frame: connector.target, side: toSide, other: center(source), outgoing: false });
		} else {
			sides.push({ fromSide: "right", toSide: null });
			// Stubs sit below the screen connectors of the side
			ends.push({ route, frame: source, side: "right", other: { x: source.x + source.width, y: Number.MAX_SAFE_INTEGER - route }, outgoing: true });
		}
	});
	const points = new Map<string, Point>();
	const groups = new Map<string, End[]>();
	for (const end of ends) {
		const key = `${end.frame.file}:${end.side}`;
		groups.set(key, [...(groups.get(key) ?? []), end]);
	}
	for (const group of groups.values()) {
		const vertical = group[0]!.side === "left" || group[0]!.side === "right";
		group.sort((a, b) => (vertical ? a.other.y - b.other.y : a.other.x - b.other.x));
		group.forEach((end, i) => points.set(`${end.route}:${end.outgoing}`, pointOn(end.frame, end.side, (i + 1) / (group.length + 1))));
	}
	return connectors.map((connector, route) => {
		const from = points.get(`${route}:true`)!;
		const { fromSide, toSide } = sides[route]!;
		return { connector, from, to: toSide ? points.get(`${route}:false`)! : from, fromSide, toSide };
	});
}

/**
 * Prototype links on the canvas (decision 0007), rendered inside the canvas's
 * transformed layer (canvas coordinates). One curved arrow per source screen
 * and target, from the side of the source frame that faces the target to the
 * facing side of the target. "Back" and links to missing screens end in a
 * short labelled stub; missing ones are dashed in the destructive color. The
 * connector of the `selected` element is highlighted. Strokes and labels keep
 * their screen size at every zoom. Never takes pointer input.
 */
export function LinksLayer({ frames, files, zoom, selected }: { frames: Frame[]; files: ProjectFiles; zoom: number; selected?: ElementRef | null }) {
	const routes = useMemo(() => routesOf(connectorsOf(frames, files)), [frames, files]);
	if (!routes.length) return null;
	const px = (n: number) => n / zoom;
	const isSelected = (connector: Connector) =>
		!!selected && connector.links.some((link) => link.file === selected.file && link.start === selected.start);
	// The selected connector draws last, on top
	const ordered = [...routes].sort((a, b) => Number(isSelected(a.connector)) - Number(isSelected(b.connector)));

	return (
		<>
			<svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
				{ordered.map(({ connector, from, to, fromSide, toSide }) => {
					const active = isSelected(connector);
					const broken = connector.kind === "broken";
					const color = broken ? "var(--destructive)" : "var(--primary)";
					const out = OUTWARD[fromSide];
					let path: string;
					let end: Point;
					let direction: Point;
					if (toSide) {
						const into = OUTWARD[toSide];
						const distance = Math.hypot(to.x - from.x, to.y - from.y);
						const bow = Math.min(MAX_BOW, Math.max(px(40), distance * 0.4));
						const c1 = { x: from.x + out.x * bow, y: from.y + out.y * bow };
						const c2 = { x: to.x + into.x * bow, y: to.y + into.y * bow };
						// Stop at the arrowhead's base, so the stroke doesn't poke through its tip
						end = to;
						direction = { x: -into.x, y: -into.y };
						const base = { x: to.x + into.x * px(ARROW), y: to.y + into.y * px(ARROW) };
						path = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${base.x} ${base.y}`;
					} else {
						end = { x: from.x + out.x * px(STUB), y: from.y + out.y * px(STUB) };
						direction = out;
						path = `M ${from.x} ${from.y} L ${end.x - out.x * px(ARROW)} ${end.y - out.y * px(ARROW)}`;
					}
					const normal = { x: -direction.y, y: direction.x };
					const tail = { x: end.x - direction.x * px(ARROW), y: end.y - direction.y * px(ARROW) };
					const half = px(ARROW) / 2;
					const head = `${end.x},${end.y} ${tail.x + normal.x * half},${tail.y + normal.y * half} ${tail.x - normal.x * half},${tail.y - normal.y * half}`;
					return (
						<g key={connector.key} opacity={active ? 1 : broken ? 0.8 : 0.45}>
							<path
								d={path}
								fill="none"
								stroke={color}
								strokeWidth={px(active ? STROKE_SELECTED : STROKE)}
								strokeLinecap="round"
								strokeDasharray={broken ? `${px(4)} ${px(3)}` : undefined}
							/>
							<circle cx={from.x} cy={from.y} r={px(DOT)} fill={color} />
							<polygon points={head} fill={color} />
						</g>
					);
				})}
			</svg>
			{ordered.map(({ connector, from, fromSide, toSide }) => {
				if (toSide || connector.kind === "screen") return null;
				const out = OUTWARD[fromSide];
				const at = { x: from.x + out.x * px(STUB + 4), y: from.y };
				const missing = connector.kind === "broken" ? connector.to : null;
				const broken = missing !== null;
				return (
					<div key={connector.key} className="pointer-events-none absolute" style={{ left: at.x, top: at.y, width: 0, height: 0 }}>
						<div
							className={cn(
								"absolute top-0 left-0 rounded-full border bg-background px-1.5 text-[11px] leading-[18px] whitespace-nowrap shadow-xs",
								broken ? "border-destructive/40 text-destructive" : "text-muted-foreground",
								isSelected(connector) && !broken && "border-primary/50 text-primary",
							)}
							style={{ transform: `scale(${1 / zoom}) translateY(-50%)`, transformOrigin: "0 0" }}
							title={broken ? `${missing} is not a screen of this project` : "Goes back to the previous screen"}
						>
							{broken ? `Missing: ${missing}` : "Back"}
						</div>
					</div>
				);
			})}
		</>
	);
}
