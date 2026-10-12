export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

type Press = { button: number; ctrlKey: boolean };

export const isControlClick = (event: Press, mac = isMac) => mac && event.button === 0 && event.ctrlKey;

export const isDeepModifier = (event: { metaKey: boolean; ctrlKey: boolean }, mac = isMac) =>
	event.metaKey || (!mac && event.ctrlKey);
