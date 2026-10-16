import { describe, expect, test } from "bun:test";
import { findElement, parseJsx } from "../jsx";
import { CLICK } from "./triggers";
import {
	anchorIds,
	editLink,
	effectiveTransition,
	hasExpressionLink,
	hrefScreen,
	LINK_ATTRIBUTE,
	linkHrefToScreen,
	linkSettingsOfElement,
	linkStarts,
	listLinks,
	normalizeTarget,
	readLink,
	resolveLink,
	retargetLinks,
	screenHref,
	setLink,
} from "./links";

const HOME = `export default function Home() {
	return (
		<main>
			<button data-link-to="screens/settings.tsx">Settings</button>
			<a data-link-to={"back"}>Back</a>
			<Card data-link-to={target} />
			<p>Hi</p>
		</main>
	);
}
`;

const SETTINGS = `export default function Settings() {\n\treturn <main><TabBar /></main>;\n}\n`;

const TAB_BAR = `export function TabBar() {\n\treturn <nav><a data-link-to='home'>Home</a></nav>;\n}\n`;

const FILES = {
	"screens/home.tsx": HOME,
	"screens/settings.tsx": SETTINGS,
	"components/tab-bar.tsx": TAB_BAR,
	"DESIGN.md": `data-link-to="x"`,
};

const startOf = (source: string, needle: string) => source.indexOf(needle);

describe("reading links", () => {
	test("reads string and string-expression values, not code", () => {
		expect(readLink(FILES, { file: "screens/home.tsx", start: startOf(HOME, "<button") })).toBe("screens/settings.tsx");
		expect(readLink(FILES, { file: "screens/home.tsx", start: startOf(HOME, "<a") })).toBe("back");
		expect(readLink(FILES, { file: "screens/home.tsx", start: startOf(HOME, "<Card") })).toBeNull();
		expect(readLink(FILES, { file: "screens/home.tsx", start: startOf(HOME, "<p") })).toBeNull();
		expect(readLink(FILES, { file: "screens/gone.tsx", start: 0 })).toBeNull();
		expect(readLink(FILES, { file: "screens/home.tsx", start: 3 })).toBeNull();
	});

	test("an expression value is reported as code", () => {
		const element = (needle: string) => findElement(parseJsx(HOME), startOf(HOME, needle))!;
		expect(hasExpressionLink(element("<Card"))).toBe(true);
		expect(hasExpressionLink(element("<a"))).toBe(false);
		expect(hasExpressionLink(element("<p"))).toBe(false);
	});

	test("lists every literal link of screens and components, in order", () => {
		expect(listLinks(FILES)).toEqual([
			{ file: "components/tab-bar.tsx", start: startOf(TAB_BAR, "<a"), to: "home" },
			{ file: "screens/home.tsx", start: startOf(HOME, "<button"), to: "screens/settings.tsx" },
			{ file: "screens/home.tsx", start: startOf(HOME, "<a"), to: "back" },
		]);
	});

	test("skips files that don't parse", () => {
		expect(listLinks({ "screens/broken.tsx": `export default () => <div data-link-to="x">` })).toEqual([]);
	});
});

describe("writing links", () => {
	test("sets, replaces and removes the attribute", () => {
		const p = startOf(HOME, "<p");
		const linked = setLink(HOME, p, "screens/settings.tsx")!;
		expect(linked).toContain(`<p ${LINK_ATTRIBUTE}="screens/settings.tsx">Hi</p>`);
		const button = startOf(HOME, "<button");
		expect(setLink(HOME, button, "back")).toContain(`<button data-link-to="back">`);
		expect(setLink(HOME, button, null)).toContain("<button>Settings</button>");
		expect(setLink(HOME, button, "  ")).toContain("<button>Settings</button>");
		expect(setLink(HOME, p, null)).toBe(HOME);
		expect(setLink(HOME, 3, "back")).toBeNull();
	});

	test("retargets links to a renamed screen and leaves others alone", () => {
		const files = { ...FILES, "screens/home.tsx": HOME.replace(`<p>`, `<p data-link-to="settings">`) };
		const changes = retargetLinks(files, "screens/settings.tsx", "screens/preferences.tsx");
		expect(changes).toHaveLength(1);
		const next = changes[0]!.content!;
		expect(changes[0]!.path).toBe("screens/home.tsx");
		expect(next.match(/data-link-to="screens\/preferences\.tsx"/g)).toHaveLength(2);
		expect(next).toContain(`data-link-to={"back"}`);
		expect(retargetLinks(files, "screens/nowhere.tsx", "screens/x.tsx")).toEqual([]);
	});

	test("retargets the export's href routes to a renamed screen", () => {
		const home = `export default function Home() {
	return (
		<nav>
			<a href="#/settings" data-link-to="screens/settings.tsx">Settings</a>
			<a href="#/settings">Again</a>
			<a href="#/profile">Profile</a>
			<a href={"#/settings"}>Literal</a>
			<a href={route}>Code</a>
		</nav>
	);
}
`;

		const changes = retargetLinks({ ...FILES, "screens/home.tsx": home }, "screens/settings.tsx", "screens/prefs.tsx");
		const next = changes.find((change) => change.path === "screens/home.tsx")!.content!;
		expect(next).toContain(`<a href="#/prefs" data-link-to="screens/prefs.tsx">Settings</a>`);
		expect(next).toContain(`<a href="#/prefs">Again</a>`);
		expect(next).toContain(`<a href="#/prefs">Literal</a>`);
		expect(next).toContain(`<a href="#/profile">Profile</a>`);
		expect(next).toContain(`<a href={route}>Code</a>`);
	});

	test("lists the starts of the elements with a literal link", () => {
		expect(linkStarts(HOME)).toEqual([startOf(HOME, "<button"), startOf(HOME, "<a")]);
		expect(linkStarts("export default () => <p />;")).toEqual([]);
	});
});

describe("resolving links", () => {
	test("forgives the usual ways of naming a screen", () => {
		for (const to of [
			"screens/settings.tsx",
			"./screens/settings.tsx",
			"/screens/settings.tsx",
			"settings",
			"settings.tsx",
			"screens/settings",
		]) {
			expect(normalizeTarget(to)).toBe("screens/settings.tsx");
		}
	});

	test("resolves screens and back, and reports missing targets as broken", () => {
		expect(resolveLink("settings", FILES)).toEqual({ kind: "screen", file: "screens/settings.tsx" });
		expect(resolveLink("back", FILES)).toEqual({ kind: "back" });
		expect(resolveLink("Back", FILES)).toEqual({ kind: "back" });
		expect(resolveLink("screens/profile.tsx", FILES)).toEqual({ kind: "broken", to: "screens/profile.tsx" });
		// Components and context files are not screens
		expect(resolveLink("components/tab-bar.tsx", FILES)).toEqual({ kind: "broken", to: "components/tab-bar.tsx" });
		expect(resolveLink("screens/#x", FILES).kind).toBe("broken");
	});
});

describe("href links", () => {
	test("screenHref and hrefScreen round-trip through the export's hash route", () => {
		expect(screenHref("screens/settings.tsx")).toBe("#/settings");
		expect(hrefScreen("#/settings", FILES)).toBe("screens/settings.tsx");
		expect(hrefScreen("#/missing", FILES)).toBeNull();
		expect(hrefScreen("https://example.com", FILES)).toBeNull();
	});

	test("linkHrefToScreen writes href and data-link-to in one edit", () => {
		const source = `export default function A() {\n\treturn <a href="/x">Go</a>;\n}\n`;
		const next = linkHrefToScreen(source, source.indexOf("<a"), "screens/settings.tsx");
		expect(next).toBe(
			`export default function A() {\n\treturn <a href="#/settings" data-link-to="screens/settings.tsx">Go</a>;\n}\n`,
		);
		expect(linkHrefToScreen(source, 0, "screens/settings.tsx")).toBeNull();
	});
});

describe("transitions and overlays", () => {
	const SOURCE = `export default function A() {\n\treturn <button data-link-to="screens/b.tsx">Go</button>;\n}\n`;
	const START = SOURCE.indexOf("<button");
	const settingsOf = (source: string) => linkSettingsOfElement(findElement(parseJsx(source), START)!);

	test("reads literal transition and mode, and ignores code and unknown values", () => {
		const written = `<a data-link-to="b" data-link-transition="Push" data-link-mode={"sheet"} />`;
		expect(linkSettingsOfElement(findElement(parseJsx(written), 0)!)).toMatchObject({
			transition: "push",
			mode: "sheet",
		});
		const code = `<a data-link-to="b" data-link-transition={kind} data-link-mode="popup" />`;
		expect(linkSettingsOfElement(findElement(parseJsx(code), 0)!)).toMatchObject({ transition: null, mode: null });
	});

	test("an unwritten transition is instant, or the overlay's own default", () => {
		expect(effectiveTransition({ transition: null, mode: null })).toBe("instant");
		expect(effectiveTransition({ transition: null, mode: "sheet" })).toBe("slide");
		expect(effectiveTransition({ transition: null, mode: "overlay" })).toBe("dissolve");
		expect(effectiveTransition({ transition: "push", mode: "overlay" })).toBe("push");
	});

	test("writes a transition and a mode, and leaves defaults out", () => {
		const pushed = editLink(SOURCE, START, { transition: "push" })!;
		expect(pushed).toContain(`<button data-link-to="screens/b.tsx" data-link-transition="push">`);
		expect(editLink(pushed, START, { transition: "instant" })).toBe(SOURCE);
		const sheet = editLink(SOURCE, START, { mode: "sheet" })!;
		expect(settingsOf(sheet)).toMatchObject({ transition: null, mode: "sheet" });
		expect(editLink(sheet, START, { transition: "slide" })).toBe(sheet);
		expect(settingsOf(editLink(sheet, START, { transition: "instant" })!)).toMatchObject({
			transition: "instant",
			mode: "sheet",
		});
		expect(editLink(sheet, START, { mode: null })).toBe(SOURCE);
	});

	test("removing a link or pointing it back drops its transition and mode", () => {
		const full = editLink(SOURCE, START, { mode: "overlay", transition: "push" })!;
		expect(settingsOf(full)).toMatchObject({ transition: "push", mode: "overlay" });
		expect(editLink(full, START, { to: null })).toBe(SOURCE.replace(` data-link-to="screens/b.tsx"`, ""));
		expect(editLink(full, START, { to: "back" })).toBe(SOURCE.replace("screens/b.tsx", "back"));
		expect(editLink(full, START, { to: "screens/c.tsx" })).toBe(full.replace("screens/b.tsx", "screens/c.tsx"));
		expect(editLink(SOURCE, 3, { transition: "push" })).toBeNull();
	});
});

describe("timing, triggers and actions (decision 0046)", () => {
	const SOURCE = `export default function A() {\n\treturn <button data-link-to="screens/b.tsx">Go</button>;\n}\n`;
	const START = SOURCE.indexOf("<button");
	const settingsOf = (source: string) => linkSettingsOfElement(findElement(parseJsx(source), START)!);

	test("reads duration, easing and trigger, forgiving units and case", () => {
		const written = `<a data-link-to="b" data-link-duration="0.2s" data-link-easing="Ease-Out" data-link-trigger="after 1s" />`;
		expect(linkSettingsOfElement(findElement(parseJsx(written), 0)!)).toMatchObject({
			duration: 200,
			easing: "ease-out",
			trigger: { kind: "after", ms: 1000 },
		});
		const unknown = `<a data-link-to="b" data-link-duration="slow" data-link-easing="bouncy" data-link-trigger="swipe" />`;
		expect(linkSettingsOfElement(findElement(parseJsx(unknown), 0)!)).toMatchObject({
			duration: null,
			easing: null,
			trigger: CLICK,
		});
	});

	test("writes timing and a trigger, and a click trigger needs no attribute", () => {
		const timed = editLink(SOURCE, START, {
			duration: 150,
			easing: "ease-in",
			trigger: { kind: "key", key: "Enter" },
		})!;

		expect(timed).toContain(`data-link-duration="150" data-link-easing="ease-in" data-link-trigger="key Enter"`);
		expect(editLink(timed, START, { duration: null, easing: null, trigger: CLICK })).toBe(SOURCE);
	});

	test("an anchor or a URL drops what only moving between screens needs, and keeps the trigger", () => {
		const full = editLink(SOURCE, START, { transition: "push", duration: 200, trigger: { kind: "hover" } })!;
		expect(editLink(full, START, { to: "#pricing" })).toBe(
			SOURCE.replace("screens/b.tsx", "#pricing").replace(">Go", ` data-link-trigger="hover">Go`),
		);
		expect(settingsOf(editLink(full, START, { to: "https://example.com" })!)).toMatchObject({
			transition: null,
			duration: null,
			trigger: { kind: "hover" },
		});
		expect(editLink(full, START, { to: null })).toBe(SOURCE.replace(` data-link-to="screens/b.tsx"`, ""));
	});

	test("resolves anchors and URLs", () => {
		expect(resolveLink("#pricing", FILES)).toEqual({ kind: "anchor", id: "pricing" });
		expect(resolveLink(" https://example.com/a ", FILES)).toEqual({ kind: "url", url: "https://example.com/a" });
		expect(resolveLink("mailto:hi@example.com", FILES)).toEqual({ kind: "url", url: "mailto:hi@example.com" });
		expect(resolveLink("#", FILES).kind).toBe("broken");
	});

	test("lists the literal ids a screen can scroll to", () => {
		const source = `export default function A() {\n\treturn <main><section id="pricing" /><div id={x} /><p id="faq" /><b id="a b" /></main>;\n}\n`;
		expect(anchorIds(source)).toEqual(["pricing", "faq"]);
		expect(anchorIds("<main")).toEqual([]);
	});
});
