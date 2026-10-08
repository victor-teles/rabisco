import type { CSSProperties } from "react";
import { assetKey, rewriteCssUrls } from "../../shared/assets";
import { isString } from "../../shared/guards";
import type { AssetPayload } from "../lib/render/protocol";

const hasSrc = <P>(props: P): props is P & { src: string } =>
	typeof props === "object" && props !== null && "src" in props && typeof props.src === "string";

const hasStyle = <P>(props: P): props is P & { style: CSSProperties } =>
	typeof props === "object" && props !== null && "style" in props && typeof props.style === "object";

/**
 * Project images inside a frame (decision 0010). The host posts their bytes, the frame makes its own object URLs,
 * and `src="/images/a.png"` and `url(/images/a.png)` are pointed at them, since `/` here is the app bundle.
 */
export class FrameAssets {
	/** By asset key (`/images/a.png`) */
	#urls = new Map<string, string>();
	/** By the object URLs this frame made, for snapshots */
	#blobs = new Map<string, Blob>();

	/** Whether anything changed */
	apply(assets: Record<string, AssetPayload | null>, reset = false): boolean {
		let changed = false;

		if (reset && this.#urls.size) {
			for (const key of this.#urls.keys()) this.#drop(key);
			changed = true;
		}

		for (const [src, payload] of Object.entries(assets)) {
			const key = assetKey(src);

			if (!key) continue;
			this.#drop(key);
			changed = true;

			if (isString(payload)) this.#urls.set(key, payload);
			else if (payload) {
				const url = URL.createObjectURL(payload);
				this.#urls.set(key, url);
				this.#blobs.set(url, payload);
			}
		}

		return changed;
	}

	/** The URL to load for a `src` a screen wrote, or `undefined` when it isn't a project image */
	url(src: string): string | undefined {
		if (!this.#urls.size) return undefined;
		const key = assetKey(src);

		return key ? this.#urls.get(key) : undefined;
	}

	/** The bytes behind an object URL from `url`, so snapshots don't fetch them */
	blob(url: string): Blob | undefined {
		return this.#blobs.get(url);
	}

	css(css: string): string {
		return this.#urls.size ? rewriteCssUrls(css, (key) => this.#urls.get(key)) : css;
	}

	/** Element props with `src` and background `url()`s pointed at the images; the same object when nothing changes */
	props<P>(props: P): P {
		if (!this.#urls.size) return props;
		let next = props;

		if (hasSrc(next)) {
			const url = this.url(next.src);

			if (url) next = { ...next, src: url };
		}

		if (hasStyle(next) && next.style) {
			const style = { ...next.style };

			if (isString(style.backgroundImage)) style.backgroundImage = this.css(style.backgroundImage);

			if (isString(style.background)) style.background = this.css(style.background);

			if (style.backgroundImage !== next.style.backgroundImage || style.background !== next.style.background)
				next = { ...next, style };
		}

		return next;
	}

	#drop(key: string) {
		const url = this.#urls.get(key);

		if (url === undefined) return;
		this.#urls.delete(key);

		if (this.#blobs.delete(url)) URL.revokeObjectURL(url);
	}
}

export const frameAssets = new FrameAssets();
