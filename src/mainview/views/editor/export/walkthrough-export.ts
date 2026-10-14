import { toast } from "sonner";
import { api, isDesktop } from "@/lib/rpc";
import { GifWriter } from "../../../../shared/export/gif";
import { exportSlug } from "../../../../shared/export/targets";
import type { Rect, Size } from "../../../../shared/prototype/transitions";
import {
	poseAt,
	walkthroughFileName,
	walkthroughFrames,
	type Pose,
	type WalkthroughStep,
} from "../../../../shared/prototype/walkthrough";
import { base64OfBytes } from "./image-export";

const MAX_SIDE = 960;

const MAX_SCALE = 2;

const BACKDROP_OPACITY = 0.4;

const STILL: Pose = { opacity: 1, x: 0, y: 0 };

export type CapturedImage = { src: string; width: number; height: number };

export type CapturedOverlay = { rect: Rect; image: CapturedImage };

export type CapturedStep = WalkthroughStep & { size: Size; screen: CapturedImage; overlays: CapturedOverlay[] };

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

function surface(width: number, height: number, scale: number): Surface {
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(width * scale);
	canvas.height = Math.round(height * scale);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });

	if (!ctx) throw new Error("The canvas isn't available");
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	ctx.imageSmoothingQuality = "high";

	return { canvas, ctx };
}

class ImageCache {
	#images = new Map<string, HTMLImageElement>();

	async keep(steps: CapturedStep[]) {
		const wanted = new Set(steps.flatMap((step) => [step.screen.src, ...step.overlays.map((o) => o.image.src)]));

		for (const src of this.#images.keys()) if (!wanted.has(src)) this.#images.delete(src);

		await Promise.all(
			[...wanted].map(async (src) => {
				if (this.#images.has(src)) return;
				const image = new Image();
				image.src = src;
				await image.decode();
				this.#images.set(src, image);
			}),
		);
	}

	get(src: string) {
		const image = this.#images.get(src);

		if (!image) throw new Error("A recorded image didn't load");

		return image;
	}
}

function drawClipped(ctx: CanvasRenderingContext2D, image: HTMLImageElement, captured: CapturedImage, box: Rect) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(box.x, box.y, box.width, box.height);
	ctx.clip();
	ctx.drawImage(image, box.x, box.y, captured.width, captured.height);
	ctx.restore();
}

function drawOverlay(
	ctx: CanvasRenderingContext2D,
	images: ImageCache,
	overlay: CapturedOverlay,
	screen: Rect,
	backdrop: number,
	panel: Pose,
) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(screen.x, screen.y, screen.width, screen.height);
	ctx.clip();
	ctx.globalAlpha = BACKDROP_OPACITY * backdrop;
	ctx.fillStyle = "#000";
	ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
	ctx.globalAlpha = panel.opacity;
	const { rect } = overlay;

	drawClipped(ctx, images.get(overlay.image.src), overlay.image, {
		x: screen.x + rect.x + panel.x * rect.width,
		y: screen.y + rect.y + panel.y * rect.height,
		width: rect.width,
		height: rect.height,
	});

	ctx.restore();
}

class Compositor {
	readonly size: Size;
	readonly scale: number;
	readonly out: Surface;
	#layers: [Surface, Surface];
	#images = new ImageCache();

	constructor(steps: CapturedStep[]) {
		this.size = {
			width: Math.max(...steps.map((s) => s.size.width)),
			height: Math.max(...steps.map((s) => s.size.height)),
		};

		this.scale = Math.min(MAX_SCALE, MAX_SIDE / Math.max(this.size.width, this.size.height));
		this.out = surface(this.size.width, this.size.height, this.scale);

		this.#layers = [
			surface(this.size.width, this.size.height, this.scale),
			surface(this.size.width, this.size.height, this.scale),
		];
	}

	keep(steps: CapturedStep[]) {
		return this.#images.keep(steps);
	}

	#screenRect(step: CapturedStep): Rect {
		return {
			x: (this.size.width - step.size.width) / 2,
			y: (this.size.height - step.size.height) / 2,
			...step.size,
		};
	}

	#paint(target: Surface, step: CapturedStep, overlays: number) {
		const { ctx } = target;
		const screen = this.#screenRect(step);

		ctx.clearRect(0, 0, this.size.width, this.size.height);
		ctx.fillStyle = "#fff";
		ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
		drawClipped(ctx, this.#images.get(step.screen.src), step.screen, screen);

		for (const overlay of step.overlays.slice(0, overlays)) drawOverlay(ctx, this.#images, overlay, screen, 1, STILL);

		return target.canvas;
	}

	#place(layer: HTMLCanvasElement, pose: Pose) {
		const { ctx } = this.out;

		ctx.globalAlpha = pose.opacity;
		ctx.drawImage(layer, pose.x * this.size.width, pose.y * this.size.height, this.size.width, this.size.height);
		ctx.globalAlpha = 1;
	}

	draw(steps: CapturedStep[], index: number, progress: number | null) {
		const step = steps[index]!;
		const previous = steps[index - 1];
		const { ctx } = this.out;
		const [a, b] = this.#layers;

		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, this.size.width, this.size.height);

		if (progress === null || !step.motion || !previous) {
			this.#place(this.#paint(a, step, step.overlays.length), STILL);

			return ctx.getImageData(0, 0, this.out.canvas.width, this.out.canvas.height).data;
		}

		const { motion } = step;

		if (motion.kind === "screen") {
			const { plan } = motion;

			const outgoing = {
				layer: this.#paint(a, previous, previous.overlays.length),
				pose: poseAt(plan.outgoing, progress),
			};

			const incoming = { layer: this.#paint(b, step, step.overlays.length), pose: poseAt(plan.incoming, progress) };

			const order = plan.top === "incoming" ? [outgoing, incoming] : [incoming, outgoing];

			for (const { layer, pose } of order) this.#place(layer, pose);
		} else {
			const moving = motion.opening ? step.overlays.at(-1) : previous.overlays.at(-1);
			const settled = motion.opening ? step.overlays.length - 1 : step.overlays.length;

			this.#place(this.#paint(a, step, settled), STILL);

			if (moving)
				drawOverlay(
					ctx,
					this.#images,
					moving,
					this.#screenRect(step),
					poseAt(motion.motion.backdrop, progress).opacity,
					poseAt(motion.motion.panel, progress),
				);
		}

		return ctx.getImageData(0, 0, this.out.canvas.width, this.out.canvas.height).data;
	}
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

export async function encodeWalkthrough(steps: CapturedStep[], onProgress: (share: number) => void) {
	const compositor = new Compositor(steps);
	const frames = walkthroughFrames(steps);
	const writer = new GifWriter(compositor.out.canvas.width, compositor.out.canvas.height);
	let loaded = -1;

	for (const [i, frame] of frames.entries()) {
		if (frame.step !== loaded) {
			await compositor.keep(steps.slice(Math.max(0, frame.step - 1), frame.step + 1));
			loaded = frame.step;
		}

		writer.add(compositor.draw(steps, frame.step, frame.progress), frame.delay);
		onProgress((i + 1) / frames.length);
		await nextTask();
	}

	return writer.finish();
}

const sizeLabel = (bytes: number) =>
	bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export async function saveWalkthrough(projectName: string, steps: CapturedStep[]) {
	if (!steps.length) return void toast("Nothing was recorded");
	const dir = await api.pickExportFolder({});

	if (!dir)
		return void toast("The walkthrough isn't saved", {
			action: { label: "Save…", onClick: () => void saveWalkthrough(projectName, steps) },
		});

	const path = walkthroughFileName(exportSlug(projectName));
	const id = toast.loading("Making the GIF…");

	try {
		const gif = await encodeWalkthrough(steps, (share) =>
			toast.loading(`Making the GIF… ${Math.round(share * 100)}%`, { id }),
		);

		const file = { path, content: base64OfBytes(gif), encoding: "base64" as const };

		const { dir: written } = await api.writeExport(
			isDesktop ? { dir, files: [file], reveal: true } : { dir, files: [file] },
		);

		toast.success(`Saved ${path}`, {
			id,
			description: `${steps.length} ${steps.length === 1 ? "step" : "steps"}, ${sizeLabel(gif.length)}${isDesktop ? ` in ${written}` : ""}`,
		});
	} catch (error) {
		toast.error("Couldn't make the GIF", {
			id,
			description: error instanceof Error ? error.message : String(error),
			action: { label: "Try again", onClick: () => void saveWalkthrough(projectName, steps) },
		});
	}
}
