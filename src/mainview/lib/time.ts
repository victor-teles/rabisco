const DAY_SECONDS = 86400;

/** Relative within a week ("3 days ago"), then the date itself, with the year only when it isn't this year. */
export function formatWhen(iso: string, now = Date.now()): string {
	const time = Date.parse(iso);

	if (!Number.isFinite(time)) return "";
	const seconds = Math.round((now - time) / 1000);
	const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

	if (seconds < 60) return "just now";

	if (seconds < 3600) return relative.format(-Math.round(seconds / 60), "minute");

	if (seconds < DAY_SECONDS) return relative.format(-Math.round(seconds / 3600), "hour");

	if (seconds < 7 * DAY_SECONDS) return relative.format(-Math.round(seconds / DAY_SECONDS), "day");
	const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();

	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: sameYear ? undefined : "numeric",
	}).format(time);
}
