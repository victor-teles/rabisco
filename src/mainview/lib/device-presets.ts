import { FRAME_SIZE } from "../../shared/project";
import type { Device } from "../../shared/types";

export type PresetKind = "phone" | "tablet" | "desktop";

export type Size = { width: number; height: number };

export type DevicePreset = Size & { id: string; label: string; kind: PresetKind };

/** In CSS pixels, as Figma's frame presets */
export const DEVICE_PRESETS: DevicePreset[] = [
	{ id: "iphone-16", label: "iPhone 16", kind: "phone", width: 393, height: 852 },
	{ id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", kind: "phone", width: 440, height: 956 },
	{ id: "iphone-14", label: "iPhone 14", kind: "phone", ...FRAME_SIZE.mobile },
	{ id: "iphone-se", label: "iPhone SE", kind: "phone", width: 375, height: 667 },
	{ id: "android", label: "Android", kind: "phone", width: 412, height: 917 },
	{ id: "ipad-mini", label: "iPad mini", kind: "tablet", width: 744, height: 1133 },
	{ id: "ipad-pro-11", label: "iPad Pro 11″", kind: "tablet", ...FRAME_SIZE.tablet },
	{ id: "ipad-pro-13", label: "iPad Pro 13″", kind: "tablet", width: 1032, height: 1376 },
	{ id: "desktop", label: "Desktop", kind: "desktop", ...FRAME_SIZE.desktop },
	{ id: "macbook-air", label: "MacBook Air", kind: "desktop", width: 1280, height: 832 },
	{ id: "desktop-hd", label: "Desktop HD", kind: "desktop", width: 1440, height: 1024 },
	{ id: "full-hd", label: "Full HD", kind: "desktop", width: 1920, height: 1080 },
];

export const PRESET_KINDS: { kind: PresetKind; label: string }[] = [
	{ kind: "phone", label: "Phone" },
	{ kind: "tablet", label: "Tablet" },
	{ kind: "desktop", label: "Desktop" },
];

/** Between the widest phone (440) and the smallest tablet (744) */
const PHONE_MAX_WIDTH = 600;

/** Up to the iPad Pro 13″ (1032); the smallest laptop is 1280 */
const TABLET_MAX_WIDTH = 1100;

export function deviceForSize(size: Size): Device {
	if (size.width <= PHONE_MAX_WIDTH) return "mobile";

	return size.width <= TABLET_MAX_WIDTH ? "tablet" : "desktop";
}

/** The largest size a frame can take, so a typo can't mount a huge iframe */
export const MAX_FRAME_SIZE = 8000;

export const MIN_FRAME_SIZE = 40;

/** Whole pixels within the frame limits; `null` when either side isn't a number */
export function parseSize(width: string, height: string): Size | null {
	const w = Number(width);
	const h = Number(height);

	if (!width.trim() || !height.trim() || !Number.isFinite(w) || !Number.isFinite(h)) return null;
	const clamp = (value: number) => Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, Math.round(value)));

	return { width: clamp(w), height: clamp(h) };
}
