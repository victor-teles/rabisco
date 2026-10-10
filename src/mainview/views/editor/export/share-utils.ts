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
