import { memo, useMemo, useSyncExternalStore } from "react";
import { type Connector, connectorsOf, linkAnchors, OUTWARD, type Point, routesOf } from "@/lib/connectors";
import { linkBoxes, subscribeLinkBoxes } from "@/lib/render/link-boxes";
import { cn } from "@/lib/utils";
import { ChromePortal } from "./chrome-layer";
import type { ElementRef } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";

/** Screen pixels: keep their size at every zoom */
const STROKE = 1.5;

const STROKE_SELECTED = 2;

const ARROW = 8;

const DOT = 3;

const STUB = 40;

/** Canvas units */
const MAX_BOW = 320;

/** Screen-pixel sizes go through `--unzoom` (set by the canvas), so zooming doesn't re-render the links */
const unzoomed = (n: number) => `calc(${n}px * var(--unzoom))`;

const atScreenScale = (at: Point, degrees = 0) =>
	`translate(${at.x}px, ${at.y}px) rotate(${degrees}deg) scale(var(--unzoom))`;

/** Points along +x, tip at the origin, in screen pixels */
const HEAD = `0,0 ${-ARROW},${-ARROW / 2} ${-ARROW},${ARROW / 2}`;

const degreesOf = (direction: Point) => (Math.atan2(direction.y, direction.x) * 180) / Math.PI;

/** Prototype links (decision 0007), in canvas coordinates. Never takes pointer input. */
export const LinksLayer = memo(function LinksLayer({
	frames,
	files,
	selected,
}: {
	frames: Frame[];
	files: ProjectFiles;
	selected?: ElementRef | null;
}) {
	const boxes = useSyncExternalStore(subscribeLinkBoxes, linkBoxes);

	const routes = useMemo(
		() => routesOf(connectorsOf(frames, files, linkAnchors(frames, files, boxes))),
		[frames, files, boxes],
	);

	if (!routes.length) return null;

	const isSelected = (connector: Connector) =>
		!!selected && connector.links.some((link) => link.file === selected.file && link.start === selected.start);

	// The selected connector draws last, on top
	const ordered = [...routes].sort((a, b) => Number(isSelected(a.connector)) - Number(isSelected(b.connector)));

	return (
		<>
			<svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
				{ordered.map(({ connector, start, from, to, fromSide, toSide }) => {
					const active = isSelected(connector);
					const broken = connector.kind === "broken";
					const color = broken ? "var(--destructive)" : "var(--primary)";
					const out = OUTWARD[fromSide];
					const stroke = active ? STROKE_SELECTED : STROKE;

					if (!toSide) {
						// A stub keeps its screen length, so it's drawn in screen pixels
						const end = { x: out.x * STUB, y: out.y * STUB };
						const lead = start.x !== from.x || start.y !== from.y;

						return (
							<g key={connector.key} opacity={active ? 1 : broken ? 0.8 : 0.45}>
								{lead ? (
									<path
										d={`M ${start.x} ${start.y} L ${from.x} ${from.y}`}
										fill="none"
										stroke={color}
										style={{
											strokeWidth: unzoomed(stroke),
											strokeDasharray: broken ? `${unzoomed(4)} ${unzoomed(3)}` : undefined,
										}}
									/>
								) : null}
								<circle r={DOT} fill={color} style={{ transform: atScreenScale(start) }} />
								<g style={{ transform: atScreenScale(from) }}>
									<path
										d={`M 0 0 L ${end.x - out.x * ARROW} ${end.y - out.y * ARROW}`}
										fill="none"
										stroke={color}
										strokeWidth={stroke}
										strokeLinecap="round"
										strokeDasharray={broken ? "4 3" : undefined}
									/>
									<polygon
										points={HEAD}
										fill={color}
										style={{ transform: `translate(${end.x}px, ${end.y}px) rotate(${degreesOf(out)}deg)` }}
									/>
								</g>
							</g>
						);
					}

					const into = OUTWARD[toSide];
					const distance = Math.hypot(to.x - from.x, to.y - from.y);
					const bow = Math.min(MAX_BOW, Math.max(40, distance * 0.4));
					const c1 = { x: from.x + out.x * bow, y: from.y + out.y * bow };
					const c2 = { x: to.x + into.x * bow, y: to.y + into.y * bow };

					return (
						<g key={connector.key} opacity={active ? 1 : broken ? 0.8 : 0.45}>
							{/* Butt-capped to the tip, so the arrowhead covers its end */}
							<path
								d={`M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`}
								fill="none"
								stroke={color}
								style={{
									strokeWidth: unzoomed(stroke),
									strokeDasharray: broken ? `${unzoomed(4)} ${unzoomed(3)}` : undefined,
								}}
							/>
							<circle r={DOT} fill={color} style={{ transform: atScreenScale(from) }} />
							<polygon
								points={HEAD}
								fill={color}
								style={{ transform: atScreenScale(to, degreesOf({ x: -into.x, y: -into.y })) }}
							/>
						</g>
					);
				})}
			</svg>
			{ordered.map(({ connector, from, fromSide, toSide }) => {
				if (toSide || connector.kind === "screen") return null;
				const out = OUTWARD[fromSide];
				const missing = connector.kind === "broken" ? connector.to : null;
				const broken = missing !== null;

				return (
					<ChromePortal key={connector.key} box={from}>
						<div
							className={cn(
								"absolute top-0 left-0 rounded-full border bg-background px-1.5 text-[11px] leading-[18px] whitespace-nowrap shadow-xs",
								broken ? "border-destructive/40 text-destructive" : "text-muted-foreground",
								isSelected(connector) && !broken && "border-primary/50 text-primary",
							)}
							style={{ transform: `translate(${out.x * (STUB + 4)}px, ${out.y * (STUB + 4)}px) translateY(-50%)` }}
							title={broken ? `${missing} is not a screen of this project` : "Goes back to the previous screen"}
						>
							{broken ? `Missing: ${missing}` : "Back"}
						</div>
					</ChromePortal>
				);
			})}
		</>
	);
});
