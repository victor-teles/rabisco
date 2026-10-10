import * as React from "react";
import { cn } from "@/lib/utils";

type PlaceholderKind = "photo" | "avatar" | "illustration" | "map" | "chart";

type Point = [number, number];

type Random = {
	next: () => number;
	range: (min: number, max: number) => number;
	pick: <T>(items: readonly T[]) => T;
};

type Scene = (random: Random, id: (name: string) => string) => React.ReactNode;

const W = 400;

const H = 300;

function seeded(seed: string): Random {
	let state = 2166136261;

	for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);

	state = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
	state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
	state ^= state >>> 16;

	const next = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	return {
		next,
		range: (min, max) => min + next() * (max - min),
		pick: (items) => items[Math.floor(next() * items.length)]!,
	};
}

const n = (value: number) => Math.round(value * 10) / 10;

const ok = (l: number, c: number, h: number) => `oklch(${n(l * 1000) / 1000} ${n(c * 1000) / 1000} ${Math.round(h)})`;

const mix = (color: string, percent: number, other = "var(--background)") =>
	`color-mix(in oklab, ${color} ${percent}%, ${other})`;

function smooth(points: Point[]) {
	let d = `M${n(points[0]![0])} ${n(points[0]![1])}`;

	for (let i = 0; i < points.length - 1; i++) {
		const [x0, y0] = points[i - 1] ?? points[i]!;
		const [x1, y1] = points[i]!;
		const [x2, y2] = points[i + 1]!;
		const [x3, y3] = points[i + 2] ?? points[i + 1]!;
		d += `C${n(x1 + (x2 - x0) / 6)} ${n(y1 + (y2 - y0) / 6)} ${n(x2 - (x3 - x1) / 6)} ${n(y2 - (y3 - y1) / 6)} ${n(x2)} ${n(y2)}`;
	}

	return d;
}

const paint = (url: string, flat: string) => ({ fill: `url(#${url})`, style: { color: flat } });

const overlay = (url: string) => ({ fill: `url(#${url})`, style: { color: "transparent" } });

function Linear({
	id,
	stops,
	vertical = true,
}: {
	id: string;
	stops: [number, string, number?][];
	vertical?: boolean;
}) {
	return (
		<linearGradient id={id} x1="0" y1="0" x2={vertical ? "0" : "1"} y2={vertical ? "1" : "0"}>
			{stops.map(([offset, color, opacity]) => (
				<stop key={offset} offset={offset} style={{ stopColor: color, stopOpacity: opacity ?? 1 }} />
			))}
		</linearGradient>
	);
}

function Radial({ id, stops }: { id: string; stops: [number, string, number?][] }) {
	return (
		<radialGradient id={id}>
			{stops.map(([offset, color, opacity]) => (
				<stop key={offset} offset={offset} style={{ stopColor: color, stopOpacity: opacity ?? 1 }} />
			))}
		</radialGradient>
	);
}

function photoFinish(id: (name: string) => string) {
	return (
		<>
			<defs>
				<filter id={id("grain")} x="0" y="0" width="100%" height="100%">
					<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
					<feColorMatrix type="saturate" values="0" />
				</filter>
				<radialGradient id={id("vignette")} cx="0.5" cy="0.45" r="0.75">
					<stop offset="0.55" style={{ stopColor: "#000", stopOpacity: 0 }} />
					<stop offset="1" style={{ stopColor: "#000", stopOpacity: 0.28 }} />
				</radialGradient>
			</defs>
			<rect width={W} height={H} {...overlay(id("vignette"))} />
			<rect
				width={W}
				height={H}
				fill="transparent"
				filter={`url(#${id("grain")})`}
				opacity="0.14"
				style={{ mixBlendMode: "overlay" }}
			/>
		</>
	);
}

const soften = (id: (name: string) => string, deviation: number) => (
	<filter id={id(`blur-${deviation}`)} x="-50%" y="-50%" width="200%" height="200%">
		<feGaussianBlur stdDeviation={deviation} />
	</filter>
);

const LANDSCAPE_LIGHT = {
	day: { top: ok(0.7, 0.1, 245), low: ok(0.93, 0.035, 215), sun: ok(0.99, 0.03, 95), hue: 205, near: 0.3, c: 0.05 },
	dawn: { top: ok(0.72, 0.07, 290), low: ok(0.9, 0.07, 55), sun: ok(0.97, 0.07, 75), hue: 300, near: 0.3, c: 0.05 },
	dusk: { top: ok(0.4, 0.1, 275), low: ok(0.78, 0.13, 45), sun: ok(0.94, 0.11, 70), hue: 290, near: 0.18, c: 0.05 },
	mist: { top: ok(0.8, 0.02, 220), low: ok(0.95, 0.01, 200), sun: ok(0.99, 0.01, 90), hue: 165, near: 0.27, c: 0.04 },
};

const landscape: Scene = (random, id) => {
	const light = LANDSCAPE_LIGHT[random.pick(["day", "dawn", "dusk", "mist"] as const)];
	const horizon = random.range(150, 175);
	const sun: Point = [random.range(70, 330), horizon - random.range(20, 70)];
	const water = random.next() < 0.45;
	const layers = water ? 3 : 4;

	const ridges = Array.from({ length: layers }, (_, i) => {
		const t = i / 3;
		const base = horizon - 30 + i * (water ? 30 : 34);
		const amplitude = 50 - t * 38;
		const step = 30 + t * 30;
		const points: Point[] = [];

		for (let x = -40; x <= W + 40; x += step) points.push([x, base - random.range(0.15, 1) * amplitude]);

		const color = ok(0.86 - (0.86 - light.near) * t, 0.015 + light.c * t, light.hue + t * 20);
		const fog = mix(light.low, 55 - t * 40, color);

		return { d: `${smooth(points)}L${W + 40} ${H}L-40 ${H}Z`, color, fog };
	});

	const shore = horizon - 30 + (layers - 1) * 30 + 22;

	return (
		<>
			<defs>
				<Linear
					id={id("sky")}
					stops={[
						[0, light.top],
						[1, light.low],
					]}
				/>
				<Radial
					id={id("sun")}
					stops={[
						[0, light.sun, 0.95],
						[0.25, light.sun, 0.35],
						[1, light.sun, 0],
					]}
				/>
				{ridges.map((ridge, i) => (
					<Linear
						key={i}
						id={id(`ridge-${i}`)}
						stops={[
							[0, ridge.color],
							[1, ridge.fog],
						]}
					/>
				))}
				<Linear
					id={id("water")}
					stops={[
						[0, light.low],
						[1, mix(light.top, 70, "#000")],
					]}
				/>
			</defs>
			<rect width={W} height={H} {...paint(id("sky"), light.low)} />
			<circle cx={n(sun[0])} cy={n(sun[1])} r="130" {...overlay(id("sun"))} />
			<circle cx={n(sun[0])} cy={n(sun[1])} r="15" style={{ fill: light.sun }} />
			{ridges.map((ridge, i) => (
				<path key={i} d={ridge.d} {...paint(id(`ridge-${i}`), ridge.color)} />
			))}
			{water && (
				<>
					<rect y={n(shore)} width={W} height={n(H - shore)} {...paint(id("water"), light.top)} />
					{Array.from({ length: 7 }, (_, i) => (
						<rect
							key={i}
							x={n(random.range(20, 300))}
							y={n(shore + 8 + i * random.range(6, 10))}
							width={n(random.range(40, 140))}
							height="1"
							style={{ fill: "#fff", opacity: 0.35 - i * 0.04 }}
						/>
					))}
				</>
			)}
		</>
	);
};

const TABLES = [
	{ top: ok(0.9, 0.02, 80), bottom: ok(0.84, 0.025, 75) },
	{ top: ok(0.32, 0.01, 250), bottom: ok(0.26, 0.01, 250) },
	{ top: ok(0.62, 0.07, 60), bottom: ok(0.52, 0.07, 55) },
];

const GREENS = [ok(0.62, 0.15, 135), ok(0.52, 0.13, 140), ok(0.72, 0.15, 125), ok(0.45, 0.1, 150)];

const SAUCES = [ok(0.55, 0.16, 35), ok(0.45, 0.08, 60), ok(0.72, 0.14, 125)];

const food: Scene = (random, id) => {
	const table = random.pick(TABLES);
	const dish = random.pick(["salad", "breakfast", "bowl"] as const);
	const [cx, cy] = [random.range(180, 220), random.range(140, 160)];
	const items: React.ReactNode[] = [];

	const around = (spread: number): Point => {
		const angle = random.range(0, Math.PI * 2);
		const distance = Math.sqrt(random.next()) * spread;

		return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
	};

	if (dish === "salad") {
		for (let i = 0; i < 26; i++) {
			const [x, y] = around(62);
			items.push(
				<ellipse
					key={`leaf-${i}`}
					cx={n(x)}
					cy={n(y)}
					rx={n(random.range(12, 22))}
					ry={n(random.range(6, 11))}
					transform={`rotate(${Math.round(random.range(0, 180))} ${n(x)} ${n(y)})`}
					style={{ fill: random.pick(GREENS) }}
				/>,
			);
		}

		for (let i = 0; i < 6; i++) {
			const [x, y] = around(50);
			items.push(
				<g key={`tomato-${i}`}>
					<circle cx={n(x)} cy={n(y)} r="9" style={{ fill: ok(0.6, 0.2, 28) }} />
					<circle cx={n(x - 3)} cy={n(y - 3)} r="2.5" style={{ fill: "#fff", opacity: 0.5 }} />
				</g>,
			);
		}

		for (let i = 0; i < 3; i++) {
			const [x, y] = around(45);
			items.push(
				<g key={`egg-${i}`}>
					<ellipse cx={n(x)} cy={n(y)} rx="13" ry="10" style={{ fill: ok(0.97, 0.01, 90) }} />
					<circle cx={n(x)} cy={n(y)} r="5.5" style={{ fill: ok(0.82, 0.16, 80) }} />
				</g>,
			);
		}
	}

	if (dish === "breakfast") {
		items.push(
			<g key="toast" transform={`rotate(${Math.round(random.range(-20, 20))} ${n(cx - 30)} ${n(cy)})`}>
				<rect x={n(cx - 78)} y={n(cy - 40)} width="84" height="78" rx="18" style={{ fill: ok(0.6, 0.1, 60) }} />
				<rect x={n(cx - 72)} y={n(cy - 34)} width="72" height="66" rx="14" style={{ fill: ok(0.83, 0.08, 80) }} />
				<ellipse cx={n(cx - 36)} cy={n(cy)} rx="26" ry="22" style={{ fill: ok(0.68, 0.13, 135) }} />
			</g>,
			<g key="egg">
				<path
					d={smooth([
						[cx + 20, cy - 30],
						[cx + 62, cy - 42],
						[cx + 82, cy - 6],
						[cx + 60, cy + 30],
						[cx + 22, cy + 20],
						[cx + 20, cy - 30],
					])}
					style={{ fill: ok(0.98, 0.01, 90) }}
				/>
				<circle cx={n(cx + 50)} cy={n(cy - 5)} r="15" style={{ fill: ok(0.78, 0.17, 70) }} />
				<circle cx={n(cx + 45)} cy={n(cy - 10)} r="4" style={{ fill: "#fff", opacity: 0.55 }} />
			</g>,
		);

		for (let i = 0; i < 9; i++) {
			const [x, y] = [cx + random.range(-20, 50), cy + random.range(40, 62)];
			items.push(
				<circle
					key={`berry-${i}`}
					cx={n(x)}
					cy={n(y)}
					r={n(random.range(5, 7))}
					style={{ fill: random.pick([ok(0.42, 0.12, 280), ok(0.5, 0.2, 15)]) }}
				/>,
			);
		}
	}

	if (dish === "bowl") {
		items.push(<circle key="broth" cx={n(cx)} cy={n(cy)} r="72" style={{ fill: ok(0.62, 0.11, 60) }} />);

		for (let i = 0; i < 14; i++) {
			const y = cy - 45 + i * 6.5;
			const points: Point[] = [];

			for (let x = cx - 50; x <= cx + 50; x += 14) points.push([x, y + random.range(-4, 4)]);

			items.push(
				<path
					key={`noodle-${i}`}
					d={smooth(points)}
					fill="none"
					strokeWidth="3.5"
					strokeLinecap="round"
					style={{ stroke: ok(0.88, 0.09, 88) }}
				/>,
			);
		}

		items.push(
			<g key="egg">
				<ellipse cx={n(cx + 32)} cy={n(cy - 28)} rx="20" ry="16" style={{ fill: ok(0.97, 0.01, 90) }} />
				<circle cx={n(cx + 32)} cy={n(cy - 28)} r="9" style={{ fill: ok(0.72, 0.17, 60) }} />
			</g>,
			<path
				key="greens"
				d={`M${n(cx - 50)} ${n(cy + 20)}q20 -18 40 0q-20 18 -40 0Z`}
				style={{ fill: ok(0.55, 0.14, 140) }}
			/>,
		);

		for (let i = 0; i < 16; i++) {
			const [x, y] = around(60);
			items.push(<circle key={`onion-${i}`} cx={n(x)} cy={n(y)} r="2.5" style={{ fill: ok(0.72, 0.17, 135) }} />);
		}
	}

	const side: Point = [random.range(44, 70), random.range(44, 80)];
	const plate = dish === "bowl" ? ok(0.3, 0.02, 250) : ok(0.97, 0.005, 90);

	return (
		<>
			<defs>
				<Linear
					id={id("table")}
					stops={[
						[0, table.top],
						[1, table.bottom],
					]}
				/>
				<Radial
					id={id("plate")}
					stops={[
						[0, plate],
						[0.85, plate],
						[1, mix(plate, 85, "#000")],
					]}
				/>
				{soften(id, 8)}
			</defs>
			<rect width={W} height={H} {...paint(id("table"), table.top)} />
			<ellipse
				cx={n(cx + 10)}
				cy={n(cy + 14)}
				rx="112"
				ry="108"
				filter={`url(#${id("blur-8")})`}
				style={{ fill: "#000", opacity: 0.22 }}
			/>
			<circle cx={n(cx)} cy={n(cy)} r="110" {...paint(id("plate"), plate)} />
			<circle cx={n(cx)} cy={n(cy)} r="82" fill="none" strokeWidth="1.5" style={{ stroke: "#000", opacity: 0.06 }} />
			{items}
			<g transform={`rotate(${Math.round(random.range(-12, 12))} 340 150)`}>
				<rect x="336" y="40" width="8" height="220" rx="4" style={{ fill: ok(0.82, 0.01, 250) }} />
				<rect x="352" y="40" width="10" height="220" rx="5" style={{ fill: ok(0.8, 0.01, 250) }} />
			</g>
			<circle cx={n(side[0] + 4)} cy={n(side[1] + 5)} r="34" style={{ fill: "#000", opacity: 0.12 }} />
			<circle cx={n(side[0])} cy={n(side[1])} r="34" style={{ fill: ok(0.95, 0.01, 90) }} />
			<circle cx={n(side[0])} cy={n(side[1])} r="22" style={{ fill: random.pick(SAUCES) }} />
		</>
	);
};

const SOFAS = [ok(0.62, 0.11, 45), ok(0.62, 0.06, 150), ok(0.42, 0.06, 255), ok(0.76, 0.11, 85), ok(0.88, 0.02, 80)];

const WALLS = [ok(0.93, 0.02, 80), ok(0.88, 0.03, 150), ok(0.9, 0.025, 50), ok(0.86, 0.015, 240)];

const interior: Scene = (random, id) => {
	const wall = random.pick(WALLS);
	const sofa = random.pick(SOFAS);
	const floor = random.pick([ok(0.66, 0.07, 65), ok(0.55, 0.06, 55), ok(0.8, 0.04, 75)]);
	const left = random.next() < 0.5;
	const windowX = left ? 40 : 270;
	const sofaX = left ? 170 : 40;
	const plantX = left ? 360 : 230;

	return (
		<>
			<defs>
				<Linear
					id={id("wall")}
					stops={[
						[0, mix(wall, 92, "#000")],
						[1, wall],
					]}
				/>
				<Linear
					id={id("floor")}
					stops={[
						[0, floor],
						[1, mix(floor, 80, "#000")],
					]}
				/>
				<Linear
					id={id("sky")}
					stops={[
						[0, ok(0.82, 0.06, 230)],
						[1, ok(0.95, 0.03, 200)],
					]}
				/>
				<Linear
					id={id("light")}
					stops={[
						[0, "#fff", 0.35],
						[1, "#fff", 0],
					]}
				/>
				{soften(id, 6)}
			</defs>
			<rect width={W} height={H} {...paint(id("wall"), wall)} />
			<rect y="228" width={W} height="72" {...paint(id("floor"), floor)} />
			<rect y="224" width={W} height="5" style={{ fill: mix(wall, 85, "#fff") }} />
			<rect x={windowX} y="44" width="90" height="140" rx="45" style={{ fill: mix(wall, 80, "#fff") }} />
			<rect x={windowX + 6} y="50" width="78" height="128" rx="39" {...paint(id("sky"), ok(0.88, 0.05, 220))} />
			<rect x={windowX + 44} y="50" width="2" height="128" style={{ fill: mix(wall, 80, "#fff") }} />
			<path
				d={`M${windowX - 10} 228L${windowX + 100} 228L${windowX + (left ? 190 : -20)} 300L${windowX + (left ? 40 : -150)} 300Z`}
				{...overlay(id("light"))}
			/>
			<ellipse cx={sofaX + 100} cy="276" rx="130" ry="16" style={{ fill: mix(wall, 70, sofa), opacity: 0.6 }} />
			<rect
				x={sofaX + 54}
				y={n(random.range(70, 90))}
				width="92"
				height="66"
				rx="2"
				style={{ fill: mix(wall, 70, "#fff") }}
			/>
			<rect
				x={sofaX + 60}
				y={n(random.range(76, 86))}
				width="80"
				height="54"
				style={{ fill: mix(random.pick(SOFAS), 60, wall) }}
			/>
			<ellipse
				cx={sofaX + 100}
				cy="264"
				rx="104"
				ry="8"
				filter={`url(#${id("blur-6")})`}
				style={{ fill: "#000", opacity: 0.25 }}
			/>
			<rect x={sofaX} y="170" width="200" height="56" rx="14" style={{ fill: mix(sofa, 85, "#000") }} />
			<rect x={sofaX + 14} y="200" width="172" height="52" rx="10" style={{ fill: sofa }} />
			<rect x={sofaX - 6} y="196" width="26" height="62" rx="12" style={{ fill: mix(sofa, 90, "#000") }} />
			<rect x={sofaX + 180} y="196" width="26" height="62" rx="12" style={{ fill: mix(sofa, 90, "#000") }} />
			<rect x={sofaX + 28} y="180" width="44" height="34" rx="10" style={{ fill: mix(sofa, 70, "#fff") }} />
			<rect x={sofaX + 18} y="258" width="6" height="12" style={{ fill: mix(floor, 50, "#000") }} />
			<rect x={sofaX + 176} y="258" width="6" height="12" style={{ fill: mix(floor, 50, "#000") }} />
			<path
				d={`M${plantX - 16} 236L${plantX + 16} 236L${plantX + 12} 270L${plantX - 12} 270Z`}
				style={{ fill: ok(0.62, 0.09, 45) }}
			/>
			{Array.from({ length: 9 }, (_, i) => {
				const angle = -150 + i * 15 + random.range(-6, 6);
				const length = random.range(40, 70);

				const tip: Point = [
					plantX + Math.cos((angle * Math.PI) / 180) * length,
					236 + Math.sin((angle * Math.PI) / 180) * length,
				];

				return (
					<path
						key={i}
						d={`M${plantX} 236Q${n((plantX + tip[0]) / 2 + 10)} ${n((236 + tip[1]) / 2)} ${n(tip[0])} ${n(tip[1])}Q${n((plantX + tip[0]) / 2 - 10)} ${n((236 + tip[1]) / 2)} ${plantX} 236Z`}
						style={{ fill: random.pick(GREENS) }}
					/>
				);
			})}
		</>
	);
};

const PRODUCTS = [ok(0.92, 0.03, 85), ok(0.62, 0.06, 150), ok(0.6, 0.12, 40), ok(0.25, 0.02, 260), ok(0.84, 0.05, 15)];

const product: Scene = (random, id) => {
	const body = random.pick(PRODUCTS);
	const vessel = random.pick(["bottle", "jar", "box"] as const);
	const studio = mix("var(--primary)", 14, "var(--muted)");
	const cx = 200;
	const floorY = 228;
	const edge = mix(body, 70, "#000");
	const shine = mix(body, 70, "#fff");

	return (
		<>
			<defs>
				<Linear
					id={id("studio")}
					stops={[
						[0, mix(studio, 80, "var(--background)")],
						[1, studio],
					]}
				/>
				<Linear
					id={id("body")}
					vertical={false}
					stops={[
						[0, edge],
						[0.3, body],
						[0.42, shine],
						[0.55, body],
						[1, edge],
					]}
				/>
				<Radial
					id={id("spot")}
					stops={[
						[0, "#fff", 0.45],
						[1, "#fff", 0],
					]}
				/>
				{soften(id, 7)}
			</defs>
			<rect width={W} height={H} {...paint(id("studio"), studio)} />
			<rect y={floorY} width={W} height={H - floorY} style={{ fill: mix(studio, 92, "#000") }} />
			<ellipse cx={cx} cy="110" rx="170" ry="120" {...overlay(id("spot"))} />
			<ellipse
				cx={cx}
				cy={floorY + 4}
				rx={vessel === "box" ? 76 : 50}
				ry="9"
				filter={`url(#${id("blur-7")})`}
				style={{ fill: "#000", opacity: 0.35 }}
			/>
			{vessel === "bottle" && (
				<>
					<path
						d={`M${cx - 42} ${floorY}V120Q${cx - 42} 96 ${cx - 16} 88V66H${cx + 16}V88Q${cx + 42} 96 ${cx + 42} 120V${floorY}Z`}
						{...paint(id("body"), body)}
					/>
					<rect x={cx - 19} y="44" width="38" height="26" rx="4" style={{ fill: mix(body, 40, "#000") }} />
					<rect x={cx - 42} y="146" width="84" height="48" style={{ fill: mix(body, 25, "#fff"), opacity: 0.9 }} />
					<rect x={cx - 24} y="162" width="48" height="4" rx="2" style={{ fill: edge, opacity: 0.6 }} />
					<rect x={cx - 16} y="172" width="32" height="3" rx="1.5" style={{ fill: edge, opacity: 0.4 }} />
				</>
			)}
			{vessel === "jar" && (
				<>
					<rect x={cx - 60} y="128" width="120" height={floorY - 128} rx="16" {...paint(id("body"), body)} />
					<rect x={cx - 56} y="104" width="112" height="30" rx="8" style={{ fill: mix(body, 35, "#000") }} />
					<rect x={cx - 60} y="160" width="120" height="40" style={{ fill: mix(body, 30, "#fff"), opacity: 0.85 }} />
					<rect x={cx - 26} y="176" width="52" height="4" rx="2" style={{ fill: edge, opacity: 0.6 }} />
				</>
			)}
			{vessel === "box" && (
				<>
					<path d={`M${cx - 70} 118L${cx} 96L${cx + 70} 118L${cx} 140Z`} style={{ fill: shine }} />
					<path d={`M${cx - 70} 118L${cx} 140V${floorY + 8}L${cx - 70} ${floorY - 14}Z`} style={{ fill: body }} />
					<path d={`M${cx + 70} 118L${cx} 140V${floorY + 8}L${cx + 70} ${floorY - 14}Z`} style={{ fill: edge }} />
					<path d={`M${cx - 50} 160L${cx - 14} 172V180L${cx - 50} 168Z`} style={{ fill: shine, opacity: 0.8 }} />
				</>
			)}
		</>
	);
};

const SKIN = [ok(0.88, 0.04, 60), ok(0.78, 0.07, 55), ok(0.66, 0.08, 50), ok(0.5, 0.07, 45), ok(0.4, 0.05, 40)];

const HAIR = [ok(0.22, 0.02, 50), ok(0.35, 0.05, 50), ok(0.62, 0.1, 75), ok(0.48, 0.12, 40), ok(0.75, 0.01, 80)];

const CLOTHES = [ok(0.55, 0.08, 250), ok(0.9, 0.02, 85), ok(0.6, 0.11, 40), ok(0.45, 0.05, 150), ok(0.3, 0.02, 260)];

const people: Scene = (random, id) => {
	const skin = random.pick(SKIN);
	const hair = random.pick(HAIR);
	const clothes = random.pick(CLOTHES);
	const backdrop = random.pick([ok(0.72, 0.05, 60), ok(0.6, 0.05, 160), ok(0.7, 0.04, 240), ok(0.5, 0.05, 30)]);
	const cx = random.range(170, 240);
	const long = random.next() < 0.5;

	return (
		<>
			<defs>
				<Linear
					id={id("backdrop")}
					vertical={false}
					stops={[
						[0, mix(backdrop, 80, "#fff")],
						[1, mix(backdrop, 85, "#000")],
					]}
				/>
				<Radial
					id={id("face")}
					stops={[
						[0, mix(skin, 85, "#fff")],
						[1, skin],
					]}
				/>
				{soften(id, 10)}
			</defs>
			<rect width={W} height={H} {...paint(id("backdrop"), backdrop)} />
			<g filter={`url(#${id("blur-10")})`}>
				{Array.from({ length: 7 }, (_, i) => (
					<circle
						key={i}
						cx={n(random.range(0, W))}
						cy={n(random.range(0, 180))}
						r={n(random.range(14, 36))}
						style={{ fill: random.pick([ok(0.95, 0.06, 85), "#fff", mix(backdrop, 50, "#fff")]), opacity: 0.45 }}
					/>
				))}
			</g>
			{long && (
				<path
					d={`M${n(cx - 52)} 250Q${n(cx - 62)} 120 ${n(cx)} 74Q${n(cx + 62)} 120 ${n(cx + 52)} 250Z`}
					style={{ fill: hair }}
				/>
			)}
			<path
				d={`M${n(cx - 120)} ${H}Q${n(cx - 112)} 226 ${n(cx - 40)} 214Q${n(cx)} 236 ${n(cx + 40)} 214Q${n(cx + 112)} 226 ${n(cx + 120)} ${H}Z`}
				style={{ fill: clothes }}
			/>
			<path d={`M${n(cx - 16)} 170V220Q${n(cx)} 232 ${n(cx + 16)} 220V170Z`} style={{ fill: mix(skin, 85, "#000") }} />
			<ellipse cx={n(cx)} cy="140" rx="38" ry="47" {...paint(id("face"), skin)} />
			<path
				d={`M${n(cx - 40)} 146Q${n(cx - 44)} 88 ${n(cx)} 88Q${n(cx + 46)} 88 ${n(cx + 40)} 140Q${n(cx + 26)} 108 ${n(cx - 8)} 106Q${n(cx - 30)} 112 ${n(cx - 40)} 146Z`}
				style={{ fill: hair }}
			/>
		</>
	);
};

const CHARTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const abstract: Scene = (random, id) => (
	<>
		<defs>{soften(id, 40)}</defs>
		<rect width={W} height={H} style={{ fill: mix(random.pick(CHARTS), 18, "var(--muted)") }} />
		<g filter={`url(#${id("blur-40")})`}>
			{Array.from({ length: 5 }, (_, i) => (
				<circle
					key={i}
					cx={n(random.range(0, W))}
					cy={n(random.range(0, H))}
					r={n(random.range(70, 140))}
					style={{ fill: mix(CHARTS[i]!, 75, "var(--background)"), opacity: 0.85 }}
				/>
			))}
		</g>
	</>
);

const PHOTOS = { landscape, food, interior, product, people, abstract } satisfies Record<string, Scene>;

const tiles: Scene = (random) => {
	const colors = ["var(--primary)", ...CHARTS.slice(0, 3)];
	const cells: React.ReactNode[] = [];

	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 4; col++) {
			const [x, y] = [col * 100, row * 100];
			const back = random.next() < 0.5 ? "var(--muted)" : mix(random.pick(colors), 22, "var(--background)");
			const front = mix(random.pick(colors), 85, "var(--background)");
			const corner = random.pick([0, 1, 2, 3]);
			const [ox, oy] = [x + (corner % 2) * 100, y + Math.floor(corner / 2) * 100];
			const motif = random.pick(["quarter", "circle", "half", "triangle", "none"] as const);

			cells.push(
				<g key={`${row}-${col}`}>
					<rect x={x} y={y} width="100" height="100" style={{ fill: back }} />
					{motif === "quarter" && (
						<path
							d={`M${ox} ${oy}L${ox === x ? x + 100 : x} ${oy}A100 100 0 0 ${corner === 1 || corner === 2 ? 0 : 1} ${ox} ${oy === y ? y + 100 : y}Z`}
							style={{ fill: front }}
						/>
					)}
					{motif === "circle" && <circle cx={x + 50} cy={y + 50} r="34" style={{ fill: front }} />}
					{motif === "half" && <path d={`M${x} ${y + 50}A50 50 0 0 1 ${x + 100} ${y + 50}Z`} style={{ fill: front }} />}
					{motif === "triangle" && (
						<path d={`M${ox} ${oy}L${x + 100 - (ox - x)} ${oy}L${ox} ${y + 100 - (oy - y)}Z`} style={{ fill: front }} />
					)}
				</g>,
			);
		}
	}

	return cells;
};

const empty: Scene = (random) => {
	const cards = [-8, 6, 0];

	return (
		<>
			<rect width={W} height={H} style={{ fill: "var(--muted)" }} />
			<circle cx="200" cy="150" r="110" style={{ fill: mix("var(--primary)", 6, "var(--muted)") }} />
			{cards.map((angle, i) => (
				<g key={i} transform={`rotate(${angle + Math.round(random.range(-3, 3))} 200 160)`}>
					<rect
						x="120"
						y={110 + i * 14}
						width="160"
						height="84"
						rx="12"
						strokeWidth="1.5"
						style={{ fill: "var(--card)", stroke: "var(--border)" }}
					/>
					<circle cx="146" cy={136 + i * 14} r="10" style={{ fill: mix(CHARTS[i]!, 35, "var(--card)") }} />
					<rect x="164" y={130 + i * 14} width="80" height="6" rx="3" style={{ fill: "var(--muted)" }} />
					<rect x="164" y={142 + i * 14} width="52" height="5" rx="2.5" style={{ fill: "var(--muted)" }} />
					<rect x="136" y={164 + i * 14} width="128" height="5" rx="2.5" style={{ fill: "var(--muted)" }} />
				</g>
			))}
			{Array.from({ length: 5 }, (_, i) => (
				<circle
					key={i}
					cx={n(random.pick([random.range(70, 120), random.range(280, 330)]))}
					cy={n(random.range(60, 240))}
					r={n(random.range(3, 6))}
					style={{ fill: mix(CHARTS[i]!, 60, "var(--muted)") }}
				/>
			))}
		</>
	);
};

const success: Scene = (random) => (
	<>
		<rect width={W} height={H} style={{ fill: "var(--muted)" }} />
		<circle cx="200" cy="150" r="84" style={{ fill: mix("var(--success)", 14, "var(--muted)") }} />
		<circle cx="200" cy="150" r="52" style={{ fill: "var(--success)" }} />
		<path
			d="M178 151l15 15 30-32"
			fill="none"
			strokeWidth="9"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ stroke: "var(--background)" }}
		/>
		{Array.from({ length: 14 }, (_, i) => {
			const angle = (i / 14) * Math.PI * 2 + random.range(-0.15, 0.15);
			const distance = random.range(104, 140);
			const [x, y] = [200 + Math.cos(angle) * distance, 150 + Math.sin(angle) * distance * 0.8];
			const color = mix(CHARTS[i % 5]!, 80, "var(--muted)");

			return i % 2 ? (
				<circle key={i} cx={n(x)} cy={n(y)} r={n(random.range(3, 5))} style={{ fill: color }} />
			) : (
				<rect
					key={i}
					x={n(x - 3)}
					y={n(y - 7)}
					width="6"
					height="14"
					rx="2"
					transform={`rotate(${Math.round(random.range(0, 180))} ${n(x)} ${n(y)})`}
					style={{ fill: color }}
				/>
			);
		})}
	</>
);

const error: Scene = (random) => {
	const tilt = Math.round(random.range(-4, 4));

	return (
		<>
			<rect width={W} height={H} style={{ fill: "var(--muted)" }} />
			<g transform={`rotate(${tilt} 200 150)`}>
				<rect
					x="110"
					y="72"
					width="180"
					height="156"
					rx="14"
					strokeWidth="1.5"
					style={{ fill: "var(--card)", stroke: "var(--border)" }}
				/>
				<path d="M110 100H290" strokeWidth="1.5" style={{ stroke: "var(--border)" }} />
				{[128, 142, 156].map((x) => (
					<circle key={x} cx={x} cy="86" r="4" style={{ fill: "var(--muted)" }} />
				))}
				<circle cx="200" cy="162" r="36" style={{ fill: mix("var(--destructive)", 14, "var(--card)") }} />
				<rect x="195" y="140" width="10" height="28" rx="5" style={{ fill: "var(--destructive)" }} />
				<circle cx="200" cy="181" r="5.5" style={{ fill: "var(--destructive)" }} />
			</g>
			<path
				d={`M300 ${n(random.range(60, 90))}l18 -10M306 ${n(random.range(110, 130))}l22 4M96 ${n(random.range(190, 220))}l-20 8`}
				strokeWidth="4"
				strokeLinecap="round"
				style={{ stroke: mix("var(--destructive)", 40, "var(--muted)") }}
			/>
		</>
	);
};

const ILLUSTRATIONS = { tiles, empty, success, error } satisfies Record<string, Scene>;

const map: Scene = (random) => {
	const land = mix("var(--muted)", 70, "var(--background)");
	const street = "var(--background)";
	const park = mix("var(--success)", 22, "var(--muted)");
	const water = mix(ok(0.7, 0.1, 235), 32, "var(--muted)");
	const angle = Math.round(random.range(-24, 24));
	const minor: React.ReactNode[] = [];

	const lines = (from: number, to: number, horizontal: boolean, width: number, key: string, step: () => number) => {
		for (let at = from; at < to; at += step()) {
			minor.push(
				<path
					key={`${key}-${Math.round(at)}`}
					d={horizontal ? `M-300 ${n(at)}H700` : `M${n(at)} -300V600`}
					strokeWidth={width}
					style={{ stroke: street }}
				/>,
			);
		}
	};

	lines(-300, 600, true, 3, "h", () => random.range(26, 42));
	lines(-300, 700, false, 3, "v", () => random.range(30, 54));

	const river: Point[] = [];
	const riverY = random.range(60, 240);

	for (let x = -60; x <= W + 60; x += 70) river.push([x, riverY + random.range(-40, 40)]);

	return (
		<>
			<rect width={W} height={H} style={{ fill: land }} />
			<g transform={`rotate(${angle} 200 150)`}>
				<rect
					x={n(random.range(40, 260))}
					y={n(random.range(20, 200))}
					width={n(random.range(60, 110))}
					height={n(random.range(40, 80))}
					rx="6"
					style={{ fill: park }}
				/>
				<rect
					x={n(random.range(-40, 300))}
					y={n(random.range(0, 220))}
					width={n(random.range(40, 70))}
					height={n(random.range(30, 60))}
					rx="6"
					style={{ fill: park }}
				/>
				{minor}
				<path d={`M-300 ${n(random.range(80, 220))}H700`} strokeWidth="9" style={{ stroke: street }} />
				<path d={`M${n(random.range(100, 300))} -300V600`} strokeWidth="9" style={{ stroke: street }} />
			</g>
			<path
				d={smooth(river)}
				fill="none"
				strokeWidth={n(random.range(18, 30))}
				strokeLinecap="round"
				style={{ stroke: water }}
			/>
			<path
				d={`M-20 ${n(random.range(200, 320))}L${W + 20} ${n(random.range(-20, 120))}`}
				strokeWidth="6"
				style={{ stroke: mix("var(--warning)", 45, "var(--background)") }}
			/>
		</>
	);
};

const Pin = () => (
	<svg
		viewBox="0 0 32 40"
		aria-hidden
		className="absolute top-1/2 left-1/2 h-10 w-8 -translate-x-1/2 -translate-y-full"
	>
		<ellipse cx="16" cy="38" rx="6" ry="2" className="fill-foreground/25" />
		<path d="M16 37C16 37 3 23.5 3 15a13 13 0 0 1 26 0c0 8.5-13 22-13 22Z" className="fill-primary" />
		<circle cx="16" cy="15" r="5" className="fill-primary-foreground" />
	</svg>
);

const CHART_SUBJECTS = ["area", "line", "bar"] as const;

type ChartSubject = (typeof CHART_SUBJECTS)[number];

const isChartSubject = (subject: string): subject is ChartSubject => CHART_SUBJECTS.some((name) => name === subject);

function series(random: Random, count: number) {
	const values: number[] = [];
	const trend = random.range(-0.01, 0.04);
	let value = random.range(0.3, 0.5);

	for (let i = 0; i < count; i++) {
		value = Math.min(0.92, Math.max(0.08, value + trend + random.range(-0.09, 0.09)));
		values.push(value);
	}

	return values;
}

function Chart({ random, subject, id }: { random: Random; subject: ChartSubject; id: (name: string) => string }) {
	const [width, height] = [300, 100];
	const count = subject === "bar" ? 12 : 24;
	const values = series(random, count);
	const points = values.map((value, i): Point => [(i / (count - 1)) * width, height - value * height]);
	const last = points[points.length - 1]!;

	return (
		<>
			<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
				<defs>
					<Linear
						id={id("area")}
						stops={[
							[0, "var(--chart-1)", 0.28],
							[1, "var(--chart-1)", 0],
						]}
					/>
				</defs>
				{[0.25, 0.5, 0.75].map((at) => (
					<path
						key={at}
						d={`M0 ${at * height}H${width}`}
						strokeDasharray="3 4"
						vectorEffect="non-scaling-stroke"
						style={{ stroke: "var(--border)" }}
					/>
				))}
				{subject === "bar" &&
					values.map((value, i) => {
						const slot = width / count;

						return (
							<rect
								key={i}
								x={n(i * slot + slot * 0.18)}
								y={n(height - value * height)}
								width={n(slot * 0.64)}
								height={n(value * height)}
								rx="2"
								style={{ fill: i === count - 1 ? "var(--chart-1)" : mix("var(--chart-1)", 45, "var(--background)") }}
							/>
						);
					})}
				{subject === "area" && (
					<path
						d={`${smooth(points)}L${width} ${height}L0 ${height}Z`}
						{...paint(id("area"), mix("var(--chart-1)", 20, "var(--background)"))}
					/>
				)}
				{subject !== "bar" && (
					<path
						d={smooth(points)}
						fill="none"
						strokeWidth="2"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
						style={{ stroke: "var(--chart-1)" }}
					/>
				)}
			</svg>
			{subject !== "bar" && (
				<span
					className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-background"
					style={{ left: `${n((last[0] / width) * 100)}%`, top: `${n((last[1] / height) * 100)}%` }}
				/>
			)}
		</>
	);
}

const avatar = (random: Random) => {
	const tone = random.pick(CHARTS);
	const hair = random.pick(["short", "long", "bun", "none"] as const);
	const figure = mix(tone, 60, "var(--background)");
	const strand = mix(tone, 70, "var(--foreground)");
	const tilt = Math.round(random.range(-3, 3));

	return (
		<>
			<rect width="64" height="64" style={{ fill: mix(tone, 22, "var(--muted)") }} />
			<g transform={`rotate(${tilt} 32 40)`}>
				{hair === "long" && <path d="M18 48Q14 18 32 15Q50 18 46 48Z" style={{ fill: strand }} />}
				<path d="M10 64Q11 46 32 45Q53 46 54 64Z" style={{ fill: figure }} />
				<circle cx="32" cy="29" r="11" style={{ fill: figure }} />
				{hair === "short" && (
					<path d="M21 29Q20 16 32 16Q44 16 43 28Q38 21 29 22Q24 23 21 29Z" style={{ fill: strand }} />
				)}
				{hair === "bun" && (
					<>
						<circle cx="32" cy="14" r="5" style={{ fill: strand }} />
						<path d="M21 28Q21 17 32 17Q43 17 43 28Q36 20 21 28Z" style={{ fill: strand }} />
					</>
				)}
				{hair === "long" && (
					<path d="M21 30Q21 17 32 17Q43 17 43 30Q38 22 26 23Q23 25 21 30Z" style={{ fill: strand }} />
				)}
			</g>
		</>
	);
};

const SIZES: Record<PlaceholderKind, string> = {
	photo: "aspect-[4/3] w-full",
	illustration: "aspect-[4/3] w-full",
	map: "aspect-[4/3] w-full",
	chart: "h-24 w-full overflow-visible bg-transparent",
	avatar: "size-10 shrink-0 rounded-full",
};

const sceneOf = (scenes: Record<string, Scene>, name: string, fallback: Scene) =>
	Object.hasOwn(scenes, name) ? scenes[name]! : fallback;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type PlaceholderProps = Omit<React.ComponentProps<"div">, "children"> & {
	kind?: PlaceholderKind;
	subject?: string;
	seed?: string;
	pin?: boolean;
	label?: string;
};

function Placeholder({ kind = "photo", subject, seed, pin, label, className, ...props }: PlaceholderProps) {
	const uid = React.useId().replace(/[^\w-]/g, "");
	const random = seeded(`${kind}:${subject ?? ""}:${seed ?? ""}`);
	const tag = Math.floor(random.next() * 2 ** 32).toString(36);
	const id = (name: string) => `ph${uid}${tag}-${name}`;
	const name = subject ?? (kind === "photo" ? "abstract" : kind === "illustration" ? "tiles" : "area");
	let art: React.ReactNode;
	let box = `0 0 ${W} ${H}`;

	if (kind === "chart") art = <Chart random={random} subject={isChartSubject(name) ? name : "area"} id={id} />;
	else if (kind === "avatar") {
		art = avatar(random);
		box = "0 0 64 64";
	} else if (kind === "map") art = map(random, id);
	else if (kind === "illustration") art = sceneOf(ILLUSTRATIONS, name, tiles)(random, id);
	else art = sceneOf(PHOTOS, name, abstract)(random, id);

	const description =
		label ??
		(kind === "avatar" || kind === "map"
			? capitalize(kind)
			: `${capitalize(name)} ${kind === "photo" && name === "people" ? "portrait" : kind}`);

	return (
		<div
			data-slot="placeholder"
			data-kind={kind}
			role="img"
			aria-label={description}
			className={cn("relative isolate overflow-hidden bg-muted", SIZES[kind], className)}
			{...props}
		>
			{kind === "chart" ? (
				art
			) : (
				<svg viewBox={box} preserveAspectRatio="xMidYMid slice" aria-hidden className="absolute inset-0 size-full">
					{art}
					{kind === "photo" && name !== "abstract" && photoFinish(id)}
				</svg>
			)}
			{kind === "map" && pin && <Pin />}
		</div>
	);
}

export { Placeholder };
