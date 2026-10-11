import { listLinks, resolveLink, type ProjectLink } from "../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../shared/types";
import type { LinkBoxes } from "./render/link-boxes";
import { sourceVersion } from "./render/protocol";

export type Point = { x: number; y: number };

type Rect = { x: number; y: number; width: number; height: number };

export type Side = "left" | "right" | "top" | "bottom";

/** Links of a source screen that go to the same place; `to` is a stub for "back" and missing screens */
export type Connector = {
	key: string;
	source: Frame;
	links: ProjectLink[];
	anchor: Rect | null;
} & ({ kind: "screen"; target: Frame } | { kind: "back" } | { kind: "broken"; to: string });

export type Route = { connector: Connector; start: Point; from: Point; to: Point; fromSide: Side; toSide: Side | null };

/** `null` when the frames overlap */
function sidesOf(a: Rect, b: Rect): [Side, Side] | null {
	if (b.x >= a.x + a.width) return ["right", "left"];

	if (b.x + b.width <= a.x) return ["left", "right"];

	if (b.y >= a.y + a.height) return ["bottom", "top"];

	if (b.y + b.height <= a.y) return ["top", "bottom"];

	return null;
}

function pointOn(rect: Rect, side: Side, t: number): Point {
	if (side === "left" || side === "right")
		return { x: side === "left" ? rect.x : rect.x + rect.width, y: rect.y + rect.height * t };

	return { x: rect.x + rect.width * t, y: side === "top" ? rect.y : rect.y + rect.height };
}

export const OUTWARD: Record<Side, Point> = {
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	top: { x: 0, y: -1 },
	bottom: { x: 0, y: 1 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const inside = (point: Point, frame: Frame): Point => ({
	x: clamp(point.x, frame.x, frame.x + frame.width),
	y: clamp(point.y, frame.y, frame.y + frame.height),
});

function anchorPoint(frame: Frame, anchor: Rect, side: Side): Point {
	return inside(pointOn({ ...anchor, x: frame.x + anchor.x, y: frame.y + anchor.y }, side, 0.5), frame);
}

export function linkAnchors(
	frames: Frame[],
	files: ProjectFiles,
	boxes: ReadonlyMap<string, LinkBoxes>,
): (link: ProjectLink) => Rect | null {
	const byFile = new Map(frames.map((frame) => [frame.file, frame]));
	const versions = new Map<string, string>();

	const versionOf = (file: string, source: string) => {
		const known = versions.get(file);

		if (known !== undefined) return known;
		const version = sourceVersion(source);
		versions.set(file, version);

		return version;
	};

	return (link) => {
		const known = boxes.get(link.file);
		const frame = byFile.get(link.file);
		const source = files[link.file];

		if (!known || !frame || source === undefined || known.width !== Math.round(frame.width)) return null;

		return versionOf(link.file, source) === known.version ? (known.boxes.get(link.start) ?? null) : null;
	};
}

/** Links in components or frameless files aren't drawn */
export function connectorsOf(
	frames: Frame[],
	files: ProjectFiles,
	anchorOf: (link: ProjectLink) => Rect | null = () => null,
): Connector[] {
	const byFile = new Map(frames.map((frame) => [frame.file, frame]));
	const connectors = new Map<string, Connector>();

	for (const link of listLinks(files)) {
		const source = byFile.get(link.file);

		if (!source) continue;
		const resolved = resolveLink(link.to, files);
		const target = resolved.kind === "screen" ? byFile.get(resolved.file) : undefined;

		// A link to the screen itself goes nowhere visible
		if (resolved.kind === "screen" && (!target || target === source)) continue;
		const anchor = anchorOf(link);
		const to = resolved.kind === "screen" ? resolved.file : resolved.kind === "back" ? "back" : `?${resolved.to}`;
		const key = anchor ? `${source.file}:${link.start}→${to}` : `${source.file}→${to}`;
		const existing = connectors.get(key);

		if (existing) existing.links.push(link);
		else if (resolved.kind === "screen")
			connectors.set(key, { key, source, links: [link], anchor, kind: "screen", target: target! });
		else if (resolved.kind === "back") connectors.set(key, { key, source, links: [link], anchor, kind: "back" });
		else connectors.set(key, { key, source, links: [link], anchor, kind: "broken", to: resolved.to });
	}

	return [...connectors.values()];
}

const center = (frame: Frame) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });

/** Connectors sharing a frame side are spread along it, ordered by their other end, so they don't cross */
export function routesOf(connectors: Connector[]): Route[] {
	type End = { route: number; frame: Frame; side: Side; other: Point; outgoing: boolean };

	const ends: End[] = [];
	const sides: { fromSide: Side; toSide: Side | null }[] = [];
	const anchored = new Map<number, Point>();
	connectors.forEach((connector, route) => {
		const { source, anchor } = connector;

		if (connector.kind === "screen") {
			const [fromSide, toSide] = sidesOf(source, connector.target) ?? ["right", "right"];
			sides.push({ fromSide, toSide });
			const start = anchor ? anchorPoint(source, anchor, fromSide) : null;

			if (start) anchored.set(route, start);
			else ends.push({ route, frame: source, side: fromSide, other: center(connector.target), outgoing: true });
			ends.push({ route, frame: connector.target, side: toSide, other: start ?? center(source), outgoing: false });
		} else {
			sides.push({ fromSide: "right", toSide: null });

			if (anchor) anchored.set(route, anchorPoint(source, anchor, "right"));
			else {
				// Stubs sit below the screen connectors of the side
				ends.push({
					route,
					frame: source,
					side: "right",
					other: { x: source.x + source.width, y: Number.MAX_SAFE_INTEGER - route },
					outgoing: true,
				});
			}
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
		group.forEach((end, i) =>
			points.set(`${end.route}:${end.outgoing}`, pointOn(end.frame, end.side, (i + 1) / (group.length + 1))),
		);
	}

	return connectors.map((connector, route) => {
		const { fromSide, toSide } = sides[route]!;
		const start = anchored.get(route) ?? points.get(`${route}:true`)!;
		const from = toSide ? start : { x: connector.source.x + connector.source.width, y: start.y };

		return { connector, start, from, to: toSide ? points.get(`${route}:false`)! : from, fromSide, toSide };
	});
}
