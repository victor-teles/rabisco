/** The message of an error from a request, without the `Error: ` prefix. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error).replace(/^Error: /, "");
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
