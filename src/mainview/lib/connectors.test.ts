import { describe, expect, test } from "bun:test";
import type { Frame } from "../../shared/types";
import { connectorsOf, linkAnchors, routesOf } from "./connectors";
import type { LinkBoxes } from "./render/link-boxes";
import { sourceVersion } from "./render/protocol";

const HOME = `export default function Home() {
	return (
		<main>
			<button data-link-to="screens/settings.tsx">Settings</button>
			<a data-link-to="settings">Also settings</a>
			<b data-link-to="back">Back</b>
		</main>
	);
}
`;

const FILES = { "screens/home.tsx": HOME, "screens/settings.tsx": "export default () => <div />;" };

const frame = (file: string, x: number): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 400,
	height: 800,
});

const FRAMES = [frame("screens/home.tsx", 0), frame("screens/settings.tsx", 600)];

const BUTTON = HOME.indexOf("<button");

const BACK = HOME.indexOf("<b ");

const boxesFor = (version: string, width = 400): ReadonlyMap<string, LinkBoxes> =>
	new Map([
		[
			"screens/home.tsx",
			{
				version,
				width,
				boxes: new Map([
					[BUTTON, { x: 20, y: 100, width: 120, height: 40 }],
					[BACK, { x: 20, y: 300, width: 60, height: 20 }],
				]),
			},
		],
	]);

describe("connectors", () => {
	test("without element boxes, links to the same screen share a connector from the frame edge", () => {
		const routes = routesOf(connectorsOf(FRAMES, FILES));
		const screen = routes.find((route) => route.connector.kind === "screen")!;

		expect(routes).toHaveLength(2);
		expect(screen.connector.links).toHaveLength(2);
		expect(screen.from.x).toBe(400);
		expect(screen.from.y).toBeCloseTo(800 / 3);
		expect(screen.start).toEqual(screen.from);
		expect(screen.to.x).toBe(600);
	});

	test("a link with a measured element starts at the element", () => {
		const anchors = linkAnchors(FRAMES, FILES, boxesFor(sourceVersion(HOME)));
		const routes = routesOf(connectorsOf(FRAMES, FILES, anchors));
		const button = routes.find((route) => route.connector.links.some((link) => link.start === BUTTON))!;
		const back = routes.find((route) => route.connector.kind === "back")!;

		expect(routes).toHaveLength(3);
		expect(button.connector.links).toHaveLength(1);
		expect(button.from).toEqual({ x: 140, y: 120 });
		expect(button.fromSide).toBe("right");

		expect(back.start).toEqual({ x: 80, y: 310 });
		expect(back.from).toEqual({ x: 400, y: 310 });
	});

	test("boxes of another version or width are ignored", () => {
		for (const boxes of [boxesFor("old"), boxesFor(sourceVersion(HOME), 390)]) {
			const anchors = linkAnchors(FRAMES, FILES, boxes);

			expect(connectorsOf(FRAMES, FILES, anchors).every((connector) => connector.anchor === null)).toBe(true);
		}
	});

	test("an element outside the frame is kept on its edge", () => {
		const boxes = new Map([
			[
				"screens/home.tsx",
				{
					version: sourceVersion(HOME),
					width: 400,
					boxes: new Map([[BUTTON, { x: 300, y: 900, width: 200, height: 40 }]]),
				},
			],
		]);

		const routes = routesOf(connectorsOf(FRAMES, FILES, linkAnchors(FRAMES, FILES, boxes)));
		const button = routes.find((route) => route.connector.anchor !== null)!;

		expect(button.from).toEqual({ x: 400, y: 800 });
	});
});
