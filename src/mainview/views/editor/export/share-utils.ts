export function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause).replace(/^Error: /, "");
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`. */
export function timeAgo(iso: string, now = Date.now()): string {
	const seconds = Math.round((now - Date.parse(iso)) / 1000);

	if (!Number.isFinite(seconds) || seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);

	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);

	if (hours < 24) return `${hours} h ago`;

	return `${Math.round(hours / 24)} d ago`;
}

/** Falls back to a selected field and `execCommand` where the Clipboard API is blocked */
export async function copyText(text: string, field: HTMLInputElement | null) {
	try {
		await navigator.clipboard.writeText(text);

		return true;
	} catch {
		if (!field) return false;
		field.select();

		return document.execCommand("copy");
	}
}

export function copyLater(text: Promise<string>) {
	try {
		const blob = text.then((value) => new Blob([value], { type: "text/plain" }));

		return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
			() => true,
			() => false,
		);
	} catch {
		return Promise.resolve(false);
	}
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` in local time, the value of a date input */
export const localDate = (time: Date) => `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;

export const daysFrom = (time: Date, days: number) =>
	new Date(time.getFullYear(), time.getMonth(), time.getDate() + days);

/** The link stops at the start of the picked day, local time */
export const expiryFromDate = (date: string) => new Date(`${date}T00:00:00`).toISOString();
