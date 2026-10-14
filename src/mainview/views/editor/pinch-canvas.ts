import type { Viewport } from "@/lib/viewport";
import type { Frame } from "../../../shared/types";

type Rect = { x: number; y: number; width: number; height: number };

type Ring = { color: string; alpha: number; width: number };

type Drawn = {
	frame: Frame;
	element: HTMLElement;
	chrome: HTMLElement;
	image: HTMLImageElement | null;
	radius: number;
	color: string;
	ring: Ring;
};

type LabelFont = { font: string; lineHeight: number; gap: number };

const LABEL_GAP = 4;

const SELECTED_RING_WIDTH = 2;

const RING_ALPHA = 0.1;

export function coverTop(image: { width: number; height: number }, box: Rect): Rect {
	const scale = Math.max(box.width / image.width, box.height / image.height);
	const width = image.width * scale;

	return { x: box.x + (box.width - width) / 2, y: box.y, width, height: image.height * scale };
}

export function fitText(text: string, maxWidth: number, measure: (text: string) => number) {
	if (measure(text) <= maxWidth) return text;
	let low = 0;
	let high = text.length;

	while (low < high) {
		const middle = Math.ceil((low + high) / 2);

		if (measure(`${text.slice(0, middle)}…`) <= maxWidth) low = middle;
		else high = middle - 1;
	}

	return `${text.slice(0, low)}…`;
}

export class PinchCanvas {
	#canvas: HTMLCanvasElement | null = null;
	#drawn: Drawn[] = [];
	#label: LabelFont = { font: "", lineHeight: 0, gap: 0 };

	get active() {
		return this.#canvas !== null;
	}

	start(
		canvas: HTMLCanvasElement,
		layer: HTMLElement,
		chromeLayer: HTMLElement,
		frames: readonly Frame[],
		selected: readonly string[],
	) {
		const context = canvas.getContext("2d");

		if (!context) return;
		const byFile = new Map(frames.map((frame) => [frame.file, frame]));
		const root = getComputedStyle(canvas);
		const primary = root.getPropertyValue("--primary");
		const foreground = root.getPropertyValue("--foreground");

		const chromeByFile = new Map(
			Array.from(chromeLayer.querySelectorAll<HTMLElement>("[data-frame-file]"), (chrome) => [
				chrome.dataset.frameFile,
				chrome,
			]),
		);

		this.#drawn = [];

		for (const element of layer.querySelectorAll<HTMLElement>("[data-frame-file]")) {
			const frame = byFile.get(element.dataset.frameFile ?? "");
			const body = element.querySelector<HTMLElement>("[data-frame-body]");
			const chrome = chromeByFile.get(element.dataset.frameFile ?? "");
			const label = chrome?.querySelector<HTMLElement>("[data-frame-label]");

			if (!frame || !body || !chrome || !label || body.querySelector("iframe")) continue;
			const isSelected = selected.includes(frame.file);

			this.#drawn.push({
				frame,
				element,
				chrome,
				image: body.querySelector("img"),
				radius: Number.parseFloat(getComputedStyle(body).borderTopLeftRadius) || 0,
				color: getComputedStyle(label).color,
				ring: isSelected
					? { color: primary, alpha: 1, width: SELECTED_RING_WIDTH }
					: { color: foreground, alpha: RING_ALPHA, width: 1 },
			});
		}

		const first = this.#drawn[0];

		if (!first) return;
		const label = getComputedStyle(first.chrome.querySelector("[data-frame-label]") ?? first.chrome);
		context.font = `${label.fontWeight} ${label.fontSize} ${label.fontFamily}`;
		const metrics = context.measureText(first.frame.name);
		const lineHeight = Number.parseFloat(label.lineHeight) || Number.parseFloat(label.fontSize);
		const textHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
		this.#label = {
			font: context.font,
			lineHeight,
			gap: lineHeight - (lineHeight - textHeight) / 2 - metrics.fontBoundingBoxAscent,
		};

		canvas.hidden = false;
		canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
		canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
		this.#canvas = canvas;

		for (const drawn of this.#drawn) {
			drawn.element.style.visibility = "hidden";
			drawn.chrome.style.visibility = "hidden";
		}
	}

	draw({ x, y, zoom }: Viewport) {
		const canvas = this.#canvas;
		const context = canvas?.getContext("2d");

		if (!canvas || !context) return;
		const ratio = canvas.width / canvas.clientWidth;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const label = this.#label;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		context.font = label.font;

		for (const { frame, image, radius: frameRadius, color, ring } of this.#drawn) {
			const box = {
				x: x + frame.x * zoom,
				y: y + frame.y * zoom,
				width: frame.width * zoom,
				height: frame.height * zoom,
			};

			if (box.x > width || box.y - label.lineHeight > height || box.x + box.width < 0 || box.y + box.height < 0)
				continue;
			const radius = frameRadius * zoom;

			context.save();
			context.beginPath();
			context.roundRect(box.x, box.y, box.width, box.height, radius);
			context.fillStyle = "#fff";
			context.fill();
			context.clip();

			if (image?.naturalWidth) {
				const cover = coverTop({ width: image.naturalWidth, height: image.naturalHeight }, box);
				context.drawImage(image, cover.x, cover.y, cover.width, cover.height);
			}

			context.restore();

			context.globalAlpha = ring.alpha;
			context.strokeStyle = ring.color;
			context.lineWidth = ring.width;
			context.beginPath();
			context.roundRect(
				box.x - ring.width / 2,
				box.y - ring.width / 2,
				box.width + ring.width,
				box.height + ring.width,
				radius + ring.width / 2,
			);
			context.stroke();
			context.globalAlpha = 1;

			context.fillStyle = color;
			context.fillText(
				fitText(frame.name, box.width, (text) => context.measureText(text).width),
				box.x,
				box.y - LABEL_GAP - label.gap,
			);
		}
	}

	stop() {
		for (const drawn of this.#drawn) {
			drawn.element.style.visibility = "";
			drawn.chrome.style.visibility = "";
		}

		if (this.#canvas) this.#canvas.hidden = true;
		this.#canvas = null;
		this.#drawn = [];
	}
}
