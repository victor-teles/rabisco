import type { CapturedNode } from "../../import/captured-tree";
import { parseColor, type Rgba } from "../color";

type Point = { x: number; y: number };

type Curve = { c1: Point; c2: Point; end: Point };

type Subpath = { start: Point; curves: Curve[]; closed: boolean };

export type VectorStyle = {
	fill: Rgba | null;
	stroke: Rgba | null;
	strokeWidth: number;
	cap: string;
	join: string;
	evenOdd: boolean;
};

export type IconVector = {
	style: VectorStyle;
	network: Uint8Array;
	geometry: Uint8Array | null;
};

type Paint = { fill: string; stroke: string; strokeWidth: number; cap: string; join: string; fillRule: string };

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

const KAPPA = 0.5522847498;

const line = (from: Point, to: Point): Curve => ({ c1: from, c2: to, end: to });

const numbersOf = (value: string | undefined) => (value?.match(NUMBER) ?? []).map(Number);

function quadratic(from: Point, control: Point, to: Point): Curve {
	return {
		c1: { x: from.x + ((control.x - from.x) * 2) / 3, y: from.y + ((control.y - from.y) * 2) / 3 },
		c2: { x: to.x + ((control.x - to.x) * 2) / 3, y: to.y + ((control.y - to.y) * 2) / 3 },
		end: to,
	};
}

function arc(from: Point, radii: Point, rotation: number, large: boolean, sweep: boolean, to: Point): Curve[] {
	let rx = Math.abs(radii.x);
	let ry = Math.abs(radii.y);

	if (!rx || !ry || (from.x === to.x && from.y === to.y)) return [line(from, to)];
	const phi = (rotation * Math.PI) / 180;
	const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
	const dx = (from.x - to.x) / 2;
	const dy = (from.y - to.y) / 2;
	const x1 = cos * dx + sin * dy;
	const y1 = -sin * dx + cos * dy;
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);

	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}

	const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
	const cx1 = (factor * rx * y1) / ry;
	const cy1 = (-factor * ry * x1) / rx;
	const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
	const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);

	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	else if (sweep && delta < 0) delta += 2 * Math.PI;
	const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
	const step = delta / parts;
	const handle = (4 / 3) * Math.tan(step / 4);

	const at = (theta: number, scale: number, tangent: boolean): Point => {
		const ex = tangent ? -Math.sin(theta) * rx * scale : Math.cos(theta) * rx;
		const ey = tangent ? Math.cos(theta) * ry * scale : Math.sin(theta) * ry;

		return tangent
			? { x: cos * ex - sin * ey, y: sin * ex + cos * ey }
			: { x: cx + cos * ex - sin * ey, y: cy + sin * ex + cos * ey };
	};

	const curves: Curve[] = [];

	for (let i = 0; i < parts; i++) {
		const a = start + step * i;
		const b = a + step;
		const p0 = i === 0 ? from : at(a, 1, false);
		const p3 = i === parts - 1 ? to : at(b, 1, false);
		const t0 = at(a, handle, true);
		const t1 = at(b, handle, true);

		curves.push({ c1: { x: p0.x + t0.x, y: p0.y + t0.y }, c2: { x: p3.x - t1.x, y: p3.y - t1.y }, end: p3 });
	}

	return curves;
}

export function parsePath(d: string): Subpath[] {
	const tokens = d.match(COMMAND) ?? [];
	const paths: Subpath[] = [];
	let current: Subpath | null = null;
	let point: Point = { x: 0, y: 0 };
	let control: Point | null = null;
	let command = "";
	let i = 0;

	const next = () => Number(tokens[i++]);

	const hasNumber = () => i < tokens.length && !/^[a-z]$/i.test(tokens[i] ?? "");

	const add = (curves: Curve[]) => {
		if (!current) {
			current = { start: point, curves: [], closed: false };
			paths.push(current);
		}

		current.curves.push(...curves);
	};

	while (i < tokens.length) {
		if (/^[a-z]$/i.test(tokens[i] ?? "")) command = tokens[i++] ?? "";
		else if (!command) return paths;
		const relative = command === command.toLowerCase();
		const upper = command.toUpperCase();
		const base = relative ? point : { x: 0, y: 0 };
		const at = (x: number, y: number) => ({ x: base.x + x, y: base.y + y });

		if (upper === "Z") {
			if (current) {
				const closing: Subpath = current;

				if (point.x !== closing.start.x || point.y !== closing.start.y) closing.curves.push(line(point, closing.start));
				closing.closed = true;
				point = closing.start;
			}

			current = null;
			control = null;
			continue;
		}

		if (!hasNumber()) return paths;
		let reflected: Point | null = null;

		if (upper === "M") {
			point = at(next(), next());
			current = { start: point, curves: [], closed: false };
			paths.push(current);
			command = relative ? "l" : "L";
		} else if (upper === "L" || upper === "H" || upper === "V") {
			const to =
				upper === "L"
					? at(next(), next())
					: upper === "H"
						? { x: relative ? point.x + next() : next(), y: point.y }
						: { x: point.x, y: relative ? point.y + next() : next() };

			add([line(point, to)]);
			point = to;
		} else if (upper === "C" || upper === "S") {
			const c1 =
				upper === "C"
					? at(next(), next())
					: control
						? { x: 2 * point.x - control.x, y: 2 * point.y - control.y }
						: point;

			const c2 = at(next(), next());
			const to = at(next(), next());

			add([{ c1, c2, end: to }]);
			point = to;
			reflected = c2;
		} else if (upper === "Q" || upper === "T") {
			const q: Point =
				upper === "Q"
					? at(next(), next())
					: control
						? { x: 2 * point.x - control.x, y: 2 * point.y - control.y }
						: point;

			const to = at(next(), next());

			add([quadratic(point, q, to)]);
			point = to;
			reflected = q;
		} else if (upper === "A") {
			const radii = { x: next(), y: next() };
			const rotation = next();
			const large = next() !== 0;
			const sweep = next() !== 0;
			const to = at(next(), next());

			add(arc(point, radii, rotation, large, sweep, to));
			point = to;
		}

		control = reflected;

		if ([point.x, point.y].some(Number.isNaN)) return [];
	}

	return paths;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Subpath[] {
	if (rx <= 0 || ry <= 0) return [];
	const [kx, ky] = [rx * KAPPA, ry * KAPPA];
	const top = { x: cx, y: cy - ry };
	const right = { x: cx + rx, y: cy };
	const bottom = { x: cx, y: cy + ry };
	const left = { x: cx - rx, y: cy };

	return [
		{
			start: top,
			closed: true,
			curves: [
				{ c1: { x: cx + kx, y: top.y }, c2: { x: right.x, y: cy - ky }, end: right },
				{ c1: { x: right.x, y: cy + ky }, c2: { x: cx + kx, y: bottom.y }, end: bottom },
				{ c1: { x: cx - kx, y: bottom.y }, c2: { x: left.x, y: cy + ky }, end: left },
				{ c1: { x: left.x, y: cy - ky }, c2: { x: cx - kx, y: top.y }, end: top },
			],
		},
	];
}

function polyline(points: number[], closed: boolean): Subpath[] {
	if (points.length < 4) return [];
	const at = (i: number): Point => ({ x: points[i * 2] ?? 0, y: points[i * 2 + 1] ?? 0 });
	const start = at(0);
	const curves: Curve[] = [];

	for (let i = 1; i < points.length / 2; i++) curves.push(line(at(i - 1), at(i)));

	if (closed) curves.push(line(at(Math.floor(points.length / 2) - 1), start));

	return [{ start, curves, closed }];
}

function rect(attrs: Record<string, string>): Subpath[] {
	const [x = 0, y = 0, width = 0, height = 0] = ["x", "y", "width", "height"].map((name) => numbersOf(attrs[name])[0]);

	if (width <= 0 || height <= 0) return [];
	let rx = numbersOf(attrs.rx)[0] ?? numbersOf(attrs.ry)[0] ?? 0;
	let ry = numbersOf(attrs.ry)[0] ?? rx;

	rx = Math.min(rx, width / 2);
	ry = Math.min(ry, height / 2);

	if (!rx || !ry) return polyline([x, y, x + width, y, x + width, y + height, x, y + height], true);

	return parsePath(
		`M${x + rx} ${y}H${x + width - rx}A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}V${y + height - ry}` +
			`A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}` +
			`V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
	);
}

function outlineOf(node: CapturedNode): Subpath[] {
	const attrs = node.attrs ?? {};
	const n = (name: string) => numbersOf(attrs[name])[0] ?? 0;

	switch (node.tag) {
		case "path":
			return parsePath(attrs.d ?? "");
		case "circle":
			return ellipse(n("cx"), n("cy"), n("r"), n("r"));
		case "ellipse":
			return ellipse(n("cx"), n("cy"), n("rx"), n("ry"));
		case "rect":
			return rect(attrs);
		case "line":
			return polyline([n("x1"), n("y1"), n("x2"), n("y2")], false);
		case "polyline":
			return polyline(numbersOf(attrs.points), false);
		case "polygon":
			return polyline(numbersOf(attrs.points), true);
		default:
			return [];
	}
}

function paintOf(node: CapturedNode, parent: Paint): Paint {
	const attrs = node.attrs ?? {};

	return {
		fill: attrs.fill ?? parent.fill,
		stroke: attrs.stroke ?? parent.stroke,
		strokeWidth: numbersOf(attrs["stroke-width"])[0] ?? parent.strokeWidth,
		cap: attrs["stroke-linecap"] ?? parent.cap,
		join: attrs["stroke-linejoin"] ?? parent.join,
		fillRule: attrs["fill-rule"] ?? parent.fillRule,
	};
}

function colorOf(value: string, current: Rgba | null): Rgba | null {
	if (value === "none" || value === "transparent") return null;

	if (value === "currentColor") return current;

	return parseColor(value);
}

type Placed = { paint: Paint; paths: Subpath[] };

function collect(node: CapturedNode, paint: Paint, out: Placed[]) {
	for (const child of node.children) {
		const childPaint = paintOf(child, paint);

		if (child.tag === "g") collect(child, childPaint, out);
		else {
			const paths = outlineOf(child);

			if (paths.length) out.push({ paint: childPaint, paths });
		}
	}
}

class BlobWriter {
	private readonly view: DataView;

	private offset = 0;

	constructor(readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer);
	}

	u32(value: number) {
		this.view.setUint32(this.offset, value, true);
		this.offset += 4;
	}

	f32(value: number) {
		this.view.setFloat32(this.offset, value, true);
		this.offset += 4;
	}

	u8(value: number) {
		this.view.setUint8(this.offset, value);
		this.offset += 1;
	}
}

function networkOf(paths: Subpath[], filled: boolean, evenOdd: boolean) {
	const vertices: Point[] = [];
	const segments: { from: number; to: number; curve: Curve; start: Point }[] = [];
	const loops: number[][] = [];

	for (const path of paths) {
		const first = vertices.length;
		const loop: number[] = [];

		vertices.push(path.start);
		let from = first;
		let start = path.start;

		path.curves.forEach((curve, i) => {
			const last = path.closed && i === path.curves.length - 1;
			const to = last ? first : vertices.push(curve.end) - 1;

			loop.push(segments.push({ from, to, curve, start }) - 1);
			from = to;
			start = curve.end;
		});

		if (path.closed) loops.push(loop);
	}

	const regionLoops = filled ? loops : [];
	const regionSize = regionLoops.length ? 8 + regionLoops.reduce((sum, loop) => sum + 4 + loop.length * 4, 0) : 0;
	const blob = new BlobWriter(new Uint8Array(12 + vertices.length * 12 + segments.length * 28 + regionSize));

	blob.u32(vertices.length);
	blob.u32(segments.length);
	blob.u32(regionLoops.length ? 1 : 0);

	for (const vertex of vertices) {
		blob.u32(0);
		blob.f32(vertex.x);
		blob.f32(vertex.y);
	}

	for (const { from, to, curve, start } of segments) {
		const end = curve.end;

		blob.u32(0);
		blob.u32(from);
		blob.f32(curve.c1.x - start.x);
		blob.f32(curve.c1.y - start.y);
		blob.u32(to);
		blob.f32(curve.c2.x - end.x);
		blob.f32(curve.c2.y - end.y);
	}

	if (regionLoops.length) {
		blob.u32(evenOdd ? 0 : 1);
		blob.u32(regionLoops.length);

		for (const loop of regionLoops) {
			blob.u32(loop.length);

			for (const index of loop) blob.u32(index);
		}
	}

	return blob.bytes;
}

function commandsOf(paths: Subpath[]) {
	const closed = paths.filter((path) => path.closed);
	const size = closed.reduce((sum, path) => sum + 9 + path.curves.length * 25 + 1, 0);
	const blob = new BlobWriter(new Uint8Array(size));

	for (const path of closed) {
		blob.u8(1);
		blob.f32(path.start.x);
		blob.f32(path.start.y);

		for (const { c1, c2, end } of path.curves) {
			blob.u8(4);

			for (const value of [c1.x, c1.y, c2.x, c2.y, end.x, end.y]) blob.f32(value);
		}

		blob.u8(0);
	}

	return blob.bytes;
}

type ViewBox = { x: number; y: number; scale: number; dx: number; dy: number };

function viewBoxOf(svg: CapturedNode): ViewBox {
	const [x = 0, y = 0, width = svg.box.width, height = svg.box.height] = numbersOf(
		svg.attrs?.viewBox ?? svg.attrs?.viewbox,
	);

	if (width <= 0 || height <= 0) return { x: 0, y: 0, scale: 1, dx: 0, dy: 0 };
	const scale = Math.min(svg.box.width / width, svg.box.height / height);

	return { x, y, scale, dx: (svg.box.width - width * scale) / 2, dy: (svg.box.height - height * scale) / 2 };
}

function place(paths: Subpath[], view: ViewBox): Subpath[] {
	const map = (p: Point): Point => ({
		x: (p.x - view.x) * view.scale + view.dx,
		y: (p.y - view.y) * view.scale + view.dy,
	});

	return paths.map((path) => ({
		start: map(path.start),
		closed: path.closed,
		curves: path.curves.map((curve) => ({ c1: map(curve.c1), c2: map(curve.c2), end: map(curve.end) })),
	}));
}

const styleKey = (style: VectorStyle) => JSON.stringify(style);

export function svgVectors(svg: CapturedNode, color: string): IconVector[] {
	const current = parseColor(color);
	const view = viewBoxOf(svg);
	const placed: Placed[] = [];

	const root = paintOf(svg, {
		fill: "black",
		stroke: "none",
		strokeWidth: 1,
		cap: "butt",
		join: "miter",
		fillRule: "nonzero",
	});

	collect(svg, root, placed);
	const groups = new Map<string, { style: VectorStyle; paths: Subpath[] }>();

	for (const { paint, paths } of placed) {
		const style: VectorStyle = {
			fill: colorOf(paint.fill, current),
			stroke: colorOf(paint.stroke, current),
			strokeWidth: paint.strokeWidth * view.scale,
			cap: paint.cap,
			join: paint.join,
			evenOdd: paint.fillRule === "evenodd",
		};

		if (!style.fill && !style.stroke) continue;
		const key = styleKey(style);
		const group = groups.get(key) ?? { style, paths: [] };

		group.paths.push(...place(paths, view));
		groups.set(key, group);
	}

	return [...groups.values()].map(({ style, paths }) => ({
		style,
		network: networkOf(paths, !!style.fill, style.evenOdd),
		geometry: style.fill ? commandsOf(paths) : null,
	}));
}
