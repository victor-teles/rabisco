import { useEffect, useState } from "react";
import { selectableParent } from "@/lib/element-nav";
import { measure, measureLabel, type MeasureLine, type MeasureSegment } from "@/lib/measure";
import type { FrameHost } from "@/lib/render/frame-host";
import { sourceVersion, type Box } from "@/lib/render/protocol";
import { cn } from "@/lib/utils";
import { ChromePortal, chromeBox, zoomed } from "./chrome-layer";
import { findElement, parseJsx } from "../../../shared/jsx";
import type { Frame } from "../../../shared/types";

const MEASURE_COLOR = "var(--color-red-500)";

export function useAltHeld() {
	const [held, setHeld] = useState(false);

	useEffect(() => {
		const key = (event: KeyboardEvent) => setHeld(event.altKey);
		const release = () => setHeld(false);
		window.addEventListener("keydown", key);
		window.addEventListener("keyup", key);
		window.addEventListener("blur", release);

		return () => {
			window.removeEventListener("keydown", key);
			window.removeEventListener("keyup", key);
			window.removeEventListener("blur", release);
		};
	}, []);

	return held;
}

function parentStart(source: string | undefined, start: number | null) {
	if (source === undefined || start === null) return null;
	const element = findElement(parseJsx(source), start);

	return element ? (selectableParent(element)?.start ?? null) : null;
}

export function MeasureLayer({
	frame,
	source,
	host,
	selected,
	hover,
}: {
	frame: Frame;
	source: string | undefined;
	host: (file: string) => FrameHost | undefined;
	selected: number | null;
	hover: { start: number; box: Box } | null;
}) {
	const version = source === undefined ? "" : sourceVersion(source);
	const parent = parentStart(source, selected);
	const key = `${frame.file}\n${selected}\n${parent}\n${version}`;
	const [found, setFound] = useState<{ key: string; selected: Box | null; parent: Box | null } | null>(null);

	useEffect(() => {
		const target = host(frame.file);

		if (!target || !version || selected === null) return;
		let current = true;

		void Promise.all([
			target.elementBoxes(selected, version),
			parent === null ? null : target.elementBoxes(parent, version),
		]).then(([own, around]) => current && setFound({ key, selected: own?.[0] ?? null, parent: around?.[0] ?? null }));

		return () => {
			current = false;
		};
	}, [host, frame.file, selected, parent, version, key]);

	const screen = { x: 0, y: 0, width: frame.width, height: frame.height };
	const fetched = found?.key === key ? found : null;
	const from = selected === null ? screen : fetched?.selected;
	const around = parent === null ? screen : fetched?.parent;
	const to = hover && hover.start !== selected ? hover.box : selected === null ? null : around;

	if (!from || !to) return null;
	const { lines, guides } = measure(from, to);

	return (
		<ChromePortal box={frame}>
			<div className="absolute" style={{ ...chromeBox(to), outline: `1px solid ${MEASURE_COLOR}` }} />
			{guides.map((guide, i) => (
				<Guide key={`guide-${i}`} guide={guide} />
			))}
			{lines.map((line, i) => (
				<Line key={i} line={line} frame={frame} />
			))}
		</ChromePortal>
	);
}

function Guide({ guide }: { guide: MeasureSegment }) {
	const border = `1px dashed ${MEASURE_COLOR}`;

	return (
		<div
			className="absolute"
			style={
				guide.axis === "x"
					? { left: zoomed(guide.from), top: zoomed(guide.at), width: zoomed(guide.to - guide.from), borderTop: border }
					: {
							left: zoomed(guide.at),
							top: zoomed(guide.from),
							height: zoomed(guide.to - guide.from),
							borderLeft: border,
						}
			}
		/>
	);
}

function Line({ line, frame }: { line: MeasureLine; frame: Frame }) {
	const middle = (line.from + line.to) / 2;

	return (
		<>
			<div
				className={cn("absolute", line.axis === "x" ? "-mt-[0.5px] h-px" : "-ml-[0.5px] w-px")}
				style={
					line.axis === "x"
						? {
								left: zoomed(line.from),
								top: zoomed(line.at),
								width: zoomed(line.to - line.from),
								background: MEASURE_COLOR,
							}
						: {
								left: zoomed(line.at),
								top: zoomed(line.from),
								height: zoomed(line.to - line.from),
								background: MEASURE_COLOR,
							}
				}
			/>
			<ChromePortal
				box={{
					x: frame.x + (line.axis === "x" ? middle : line.at),
					y: frame.y + (line.axis === "x" ? line.at : middle),
				}}
			>
				<div
					className={cn(
						"absolute rounded-[4px] px-1 font-mono text-[11px]/4 whitespace-nowrap text-white tabular-nums",
						line.axis === "x" ? "-translate-x-1/2 translate-y-1" : "translate-x-1 -translate-y-1/2",
					)}
					style={{ background: MEASURE_COLOR }}
				>
					{measureLabel(line.value)}
				</div>
			</ChromePortal>
		</>
	);
}
