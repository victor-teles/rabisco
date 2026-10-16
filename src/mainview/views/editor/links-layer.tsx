import { memo, type ReactNode, useMemo, useSyncExternalStore } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { type Connector, connectorsOf, linkAnchors, OUTWARD, type Point, type Route, routesOf } from "@/lib/connectors";
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

/** Screen pixels: the invisible stroke a click on a connector hits */
const HIT = 12;

/** Canvas units */
const MAX_BOW = 320;

/** Screen-pixel sizes go through `--unzoom` (set by the canvas), so zooming doesn't re-render the links */
const unzoomed = (n: number) => `calc(${n}px * var(--unzoom))`;

const atScreenScale = (at: Point, degrees = 0) =>
	`translate(${at.x}px, ${at.y}px) rotate(${degrees}deg) scale(var(--unzoom))`;

/** Points along +x, tip at the origin, in screen pixels */
const HEAD = `0,0 ${-ARROW},${-ARROW / 2} ${-ARROW},${ARROW / 2}`;

const degreesOf = (direction: Point) => (Math.atan2(direction.y, direction.x) * 180) / Math.PI;

const bowOf = (from: Point, to: Point) =>
	Math.min(MAX_BOW, Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.4));

/** `at` in canvas units; `offset` in screen pixels, along a stub */
type Middle = { at: Point; offset: Point };

function middleOf({ from, to, fromSide, toSide }: Route): Middle {
	const out = OUTWARD[fromSide];

	if (!toSide) return { at: from, offset: { x: (out.x * STUB) / 2, y: (out.y * STUB) / 2 } };
	const into = OUTWARD[toSide];
	const bow = bowOf(from, to);

	// The cubic at t = ½
	return {
		at: {
			x: (from.x + 3 * (from.x + out.x * bow) + 3 * (to.x + into.x * bow) + to.x) / 8,
			y: (from.y + 3 * (from.y + out.y * bow) + 3 * (to.y + into.y * bow) + to.y) / 8,
		},
		offset: { x: 0, y: 0 },
	};
}

function hostOf(url: string) {
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}

type StubLabel = { text: string; title: string };

function stubLabel(connector: Connector): StubLabel {
	if (connector.kind === "broken")
		return { text: `Missing: ${connector.to}`, title: `${connector.to} is not a screen of this project` };

	if (connector.kind === "anchor") return { text: `#${connector.id}`, title: `Scrolls to #${connector.id}` };

	if (connector.kind === "url")
		return connector.url.toLowerCase().startsWith("mailto:")
			? { text: connector.url.slice("mailto:".length), title: `Writes an email to ${connector.url.slice(7)}` }
			: { text: `${hostOf(connector.url)} ↗`, title: `Opens ${connector.url}` };

	return { text: "Back", title: "Goes back to the previous screen" };
}

const sameRef = (a: ElementRef, b: ElementRef) => a.file === b.file && a.start === b.start;

/**
 * Prototype links (decision 0007), in canvas coordinates. With `onSelectLink`, a click on a connector selects its link,
 * and `editor` shows in a popover at the selected link's connector.
 */
export const LinksLayer = memo(function LinksLayer({
	frames,
	files,
	selected,
	selectedLink = null,
	onSelectLink,
	editor,
}: {
	frames: Frame[];
	files: ProjectFiles;
	selected?: ElementRef | null;
	selectedLink?: ElementRef | null;
	/** `null` when the popover closes */
	onSelectLink?: (link: ElementRef | null) => void;
	editor?: ReactNode;
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

	const picked = selectedLink
		? routes.find((route) => route.connector.links.some((link) => sameRef(link, selectedLink)))
		: undefined;

	const middle = picked ? middleOf(picked) : null;

	const hit = (connector: Connector, d: string, transform?: string) =>
		onSelectLink ? (
			<path
				d={d}
				fill="none"
				stroke="transparent"
				className="cursor-pointer"
				style={{ pointerEvents: "stroke", strokeWidth: transform ? HIT : unzoomed(HIT), transform }}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.stopPropagation();
					event.preventDefault();
				}}
				onDoubleClick={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					onSelectLink(connector.links[0]!);
				}}
			/>
		) : null;

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
								{lead ? hit(connector, `M ${start.x} ${start.y} L ${from.x} ${from.y}`) : null}
								{hit(connector, `M 0 0 L ${end.x} ${end.y}`, atScreenScale(from))}
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
					const bow = bowOf(from, to);
					const c1 = { x: from.x + out.x * bow, y: from.y + out.y * bow };
					const c2 = { x: to.x + into.x * bow, y: to.y + into.y * bow };
					const curve = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

					return (
						<g key={connector.key} opacity={active ? 1 : broken ? 0.8 : 0.45}>
							{hit(connector, curve)}
							{/* Butt-capped to the tip, so the arrowhead covers its end */}
							<path
								d={curve}
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
				const broken = connector.kind === "broken";
				const { text, title } = stubLabel(connector);

				return (
					<ChromePortal key={connector.key} box={from}>
						<div
							className={cn(
								"absolute top-0 left-0 rounded-full border bg-background px-1.5 text-[11px] leading-[18px] whitespace-nowrap shadow-xs",
								broken ? "border-destructive/40 text-destructive" : "text-muted-foreground",
								isSelected(connector) && !broken && "border-primary/50 text-primary",
							)}
							style={{ transform: `translate(${out.x * (STUB + 4)}px, ${out.y * (STUB + 4)}px) translateY(-50%)` }}
							title={title}
						>
							{text}
						</div>
					</ChromePortal>
				);
			})}
			{middle && onSelectLink ? (
				<ChromePortal box={middle.at}>
					<Popover open onOpenChange={(open) => !open && onSelectLink(null)}>
						<PopoverAnchor asChild>
							<div
								className="absolute size-0"
								style={{ transform: `translate(${middle.offset.x}px, ${middle.offset.y}px)` }}
							/>
						</PopoverAnchor>
						<PopoverContent
							side="bottom"
							sideOffset={10}
							className="flex w-64 flex-col gap-1 p-3"
							// Keeps focus on the canvas, so ⌫ deletes the link
							onOpenAutoFocus={(event) => event.preventDefault()}
							onCloseAutoFocus={(event) => event.preventDefault()}
							onPointerDown={(event) => event.stopPropagation()}
							onDoubleClick={(event) => event.stopPropagation()}
						>
							{editor}
						</PopoverContent>
					</Popover>
				</ChromePortal>
			) : null}
		</>
	);
});
