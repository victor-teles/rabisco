import { useCallback, useSyncExternalStore } from "react";
import { projectAssets } from "@/lib/render/assets";

const subscribe = (listener: () => void) => projectAssets.subscribe(listener);

export function useAssetImage(src: string) {
	const blob = useSyncExternalStore(subscribe, () => projectAssets.get(src));

	// The URL lives as long as the image element
	const show = useCallback(
		(image: HTMLImageElement | null) => {
			if (!image || !blob) return;
			const url = URL.createObjectURL(blob);
			image.src = url;

			return () => URL.revokeObjectURL(url);
		},
		[blob],
	);

	return { found: blob !== undefined, show };
}
