/** What a paste reads: `null` text means the clipboard couldn't be read */
export type PasteData = {
	text: () => Promise<string | null>;
	/** One blob per clipboard item, in the first type `accepts` */
	blobs: (accepts: (type: string) => boolean) => Promise<Blob[]>;
};

/** The part of `DataTransfer` a paste reads */
export type ClipboardEventData = { getData: (format: string) => string; files: ArrayLike<File> };

/** The async Clipboard API. WKWebView shows its Paste callout for it when another app wrote the clipboard, so only menu items use it */
export const systemPaste: PasteData = {
	text: () => navigator.clipboard.readText().catch(() => null),
	blobs: async (accepts) => {
		const items = await navigator.clipboard.read().catch(() => []);
		const blobs: Blob[] = [];

		for (const item of items) {
			const type = item.types.find(accepts);

			if (type) blobs.push(await item.getType(type));
		}

		return blobs;
	},
};

/** A native `paste` event's data, which needs no permission. Read now: the browser empties it after the event */
export function eventPaste(data: ClipboardEventData | null): PasteData {
	const text = data?.getData("text/plain") ?? "";
	const files = Array.from(data?.files ?? []);

	return {
		text: async () => text,
		blobs: async (accepts) => files.filter((file) => accepts(file.type)),
	};
}
