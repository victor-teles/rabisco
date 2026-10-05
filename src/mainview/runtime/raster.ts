/**
 * Paints a `Scene` to a canvas, for PNG and the flow PDF's JPEGs. Every image
 * in a scene is a data URL and nothing else is drawn from outside, so the
 * canvas stays clean and `toDataURL` works in WKWebView too (an SVG
 * `<foreignObject>` would taint it there).
 */
import { toCss } from "../../shared/export/color";
import { inset, rectPath, type Paint, type Scene, type SceneOp } from "../../shared/export/scene";
import { canvasFont } from "./snapshot";

/** Canvas limits that hold in WebKit and Chromium */
const MAX_AREA = 16_777_216;
const MAX_SIDE = 16_384;

/** `wanted`, lowered so a `width`×`height` scene fits the canvas limits. */
export function rasterScale(width: number, height: number, wanted: number) {
	return Math.max(0.1, Math.min(wanted, Math.sqrt(MAX_AREA / Math.max(1, width * height)), MAX_SIDE / Math.max(1, width), MAX_SIDE / Math.max(1, height)));
}

function fillStyle(ctx: CanvasRenderingContext2D, paint: Paint): string | CanvasGradient {
	if (paint.kind === "color") return toCss(paint.color);
	const gradient = ctx.createLinearGradient(paint.x1, paint.y1, paint.x2, paint.y2);
	for (const stop of paint.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), toCss(stop.color));
	return gradient;
}

async function loadImages(ops: SceneOp[], into = new Map<string, HTMLImageElement>()) {
	const pending: Promise<unknown>[] = [];
	for (const op of ops) {
		if (op.type === "group") pending.push(loadImages(op.ops, into));
		else if (op.type === "image" && !into.has(op.src)) {
			const image = new Image();
			image.src = op.src;
			into.set(op.src, image);
			pending.push(image.decode().catch(() => into.delete(op.src)));
		}
	}
	await Promise.all(pending);
	return into;
}

/**
 * The scene as a PNG or JPEG data URL, `scale` device pixels per CSS pixel
 * (lowered for very tall screens). JPEG has no transparency: it gets a white
 * page under the screen's background.
 */
export async function rasterize(scene: Scene, { type, scale: wanted, quality }: { type: "image/png" | "image/jpeg"; scale: number; quality?: number }) {
	const scale = rasterScale(scene.width, scene.height, wanted);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(scene.width * scale));
	canvas.height = Math.max(1, Math.round(scene.height * scale));
	const ctx = canvas.getContext("2d")!;
	const images = await loadImages(scene.ops);
	ctx.scale(scale, scale);
	if (type === "image/jpeg") {
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, scene.width, scene.height);
	}
	if (scene.background) {
		ctx.fillStyle = toCss(scene.background);
		ctx.fillRect(0, 0, scene.width, scene.height);
	}
	// Shadows are drawn this far to the left of their shape and offset back, so only the shadow lands
	const shift = scene.width + 10_000;

	const draw = (op: SceneOp) => {
		switch (op.type) {
			case "fill":
				ctx.fillStyle = fillStyle(ctx, op.paint);
				ctx.fill(new Path2D(rectPath(op.shape)));
				break;
			case "shadow": {
				ctx.save();
				const margin = op.blur * 2 + Math.abs(op.spread) + Math.abs(op.offsetX) + Math.abs(op.offsetY) + 2;
				const outside = new Path2D();
				outside.rect(op.shape.x - margin, op.shape.y - margin, op.shape.width + margin * 2, op.shape.height + margin * 2);
				outside.addPath(new Path2D(rectPath(op.shape)));
				ctx.clip(outside, "evenodd");
				const grown = inset({ ...op.shape, x: op.shape.x + op.offsetX, y: op.shape.y + op.offsetY }, -op.spread);
				if (op.blur > 0) {
					ctx.shadowColor = toCss(op.color);
					// Shadow parameters are in device pixels, outside the transform
					ctx.shadowBlur = op.blur * scale;
					ctx.shadowOffsetX = shift * scale;
					ctx.fillStyle = "#000";
					ctx.fill(new Path2D(rectPath({ ...grown, x: grown.x - shift })));
				} else {
					ctx.fillStyle = toCss(op.color);
					ctx.fill(new Path2D(rectPath(grown)));
				}
				ctx.restore();
				break;
			}
			case "border": {
				const [top, right, bottom, left] = op.widths;
				const first = toCss(op.colors[0]);
				if (op.widths.every((w) => w === top) && op.colors.every((c) => toCss(c) === first)) {
					ctx.save();
					ctx.strokeStyle = first;
					ctx.lineWidth = top;
					if (op.style === "dashed") ctx.setLineDash([top * 3, top * 3]);
					else if (op.style === "dotted") ctx.setLineDash([top, top]);
					ctx.stroke(new Path2D(rectPath(inset(op.shape, top / 2))));
					ctx.restore();
				} else {
					const { x, y, width, height } = op.shape;
					const sides: [number, number, number, number, number][] = [
						[top, x, y, width, top],
						[right, x + width - right, y, right, height],
						[bottom, x, y + height - bottom, width, bottom],
						[left, x, y, left, height],
					];
					sides.forEach(([w, sx, sy, sw, sh], i) => {
						if (w <= 0) return;
						ctx.fillStyle = toCss(op.colors[i]!);
						ctx.fillRect(sx, sy, sw, sh);
					});
				}
				break;
			}
			case "text": {
				ctx.save();
				ctx.font = canvasFont(op.font);
				ctx.fillStyle = fillStyle(ctx, op.paint);
				ctx.textBaseline = "alphabetic";
				ctx.textAlign = "left";
				if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${op.letterSpacing}px`;
				ctx.fillText(op.text, op.x, op.y);
				if (op.decoration) {
					const { line, thickness } = op.decoration;
					const y = line === "underline" ? op.y + Math.max(1, op.font.size * 0.1) : line === "line-through" ? op.y - op.font.size * 0.3 : op.y - op.font.size * 0.85;
					ctx.fillStyle = toCss(op.decoration.color);
					ctx.fillRect(op.x, y, op.width, thickness);
				}
				ctx.restore();
				break;
			}
			case "image": {
				const image = images.get(op.src);
				if (image) ctx.drawImage(image, op.x, op.y, op.width, op.height);
				break;
			}
			case "path": {
				ctx.save();
				ctx.transform(...op.transform);
				const path = new Path2D(op.d);
				if (op.fill) {
					ctx.fillStyle = toCss(op.fill.color);
					ctx.fill(path, op.fill.rule);
				}
				if (op.stroke) {
					ctx.strokeStyle = toCss(op.stroke.color);
					ctx.lineWidth = op.stroke.width;
					ctx.lineCap = op.stroke.cap as CanvasLineCap;
					ctx.lineJoin = op.stroke.join as CanvasLineJoin;
					ctx.miterLimit = op.stroke.miterLimit;
					ctx.setLineDash(op.stroke.dash);
					ctx.stroke(path);
				}
				ctx.restore();
				break;
			}
			case "group": {
				ctx.save();
				ctx.globalAlpha *= op.opacity;
				if (op.clip) ctx.clip(new Path2D(rectPath(op.clip)));
				op.ops.forEach(draw);
				ctx.restore();
				break;
			}
		}
	};
	scene.ops.forEach(draw);
	return { dataUrl: canvas.toDataURL(type, quality), scale, width: canvas.width, height: canvas.height };
}
