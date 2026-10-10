import { afterEach, describe, expect, test } from "bun:test";
import { parseJsx } from "../jsx/tree";
import {
	BORDER_WIDTH_SCALE,
	boxClasses,
	classifyClass,
	colorCss,
	describeValue,
	FONT_SIZE_SCALE,
	FONT_WEIGHT_SCALE,
	getBox,
	GRID_COLUMNS_SCALE,
	INSET_SCALE,
	getStyle,
	isColorValue,
	LETTER_SPACING_SCALE,
	LINE_HEIGHT_SCALE,
	MARGIN_SCALE,
	OPACITY_SCALE,
	parseClass,
	parseColorInput,
	parseScaleInput,
	RADIUS_SCALE,
	readClassName,
	setBox,
	setBoxParts,
	setClassName,
	setCustomTokens,
	setStyle,
	SIZE_SCALE,
	SPACING_SCALE,
	splitModifier,
	styleClass,
	usedVariants,
	Z_INDEX_SCALE,
	type ClassHit,
} from "./classes";

const at = (source: string, needle: string) => {
	const index = source.indexOf(needle);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

const screen = (jsx: string) => `export default function Screen() {\n\treturn (\n\t\t${jsx}\n\t);\n}\n`;

describe("readClassName", () => {
	test("a plain string attribute", () => {
		const source = screen(`<div className="flex gap-2">Hi</div>`);
		expect(readClassName(source, at(source, "<div"))).toEqual({
			kind: "string",
			editable: true,
			classes: "flex gap-2",
			text: `"flex gap-2"`,
		});
	});

	test("a missing attribute is editable and empty", () => {
		const source = screen(`<div>Hi</div>`);
		expect(readClassName(source, at(source, "<div"))).toEqual({
			kind: "none",
			editable: true,
			classes: "",
			text: null,
		});
	});

	test("a string expression and a template literal without interpolation", () => {
		const a = screen(`<div className={"p-4 'x'"} />`);
		expect(readClassName(a, at(a, "<div"))).toMatchObject({ kind: "literal", editable: true, classes: "p-4 'x'" });
		const b = screen("<div className={`p-4\n\t\t\tmt-2`} />");
		expect(readClassName(b, at(b, "<div"))).toMatchObject({
			kind: "literal",
			editable: true,
			classes: "p-4\n\t\t\tmt-2",
		});
		const c = screen(`<div className={ 'p-4' } />`);
		expect(readClassName(c, at(c, "<div"))).toMatchObject({ kind: "literal", classes: "p-4" });
	});

	test("the first string argument of cn, clsx and cx", () => {
		for (const fn of ["cn", "clsx", "cx"]) {
			const source = screen(`<div className={${fn}("rounded-md border", active && "bg-accent")} />`);
			expect(readClassName(source, at(source, "<div"))).toMatchObject({
				kind: "call",
				editable: true,
				classes: "rounded-md border",
			});
		}

		const multiline = screen(`<div className={cn(\n\t\t\t"p-4",\n\t\t\tclassName,\n\t\t)} />`);
		expect(readClassName(multiline, at(multiline, "<div"))).toMatchObject({ kind: "call", classes: "p-4" });
		const single = screen(`<div className={cn("p-4")} />`);
		expect(readClassName(single, at(single, "<div"))).toMatchObject({ kind: "call", classes: "p-4" });
	});

	test("anything else is read-only", () => {
		for (const value of [
			"{styles.card}",
			"{`p-4 ${size}`}",
			'{open ? "a" : "b"}',
			'{cn(base, "p-4")}',
			'{"p-4 " + extra}',
			'{other("p-4")}',
		]) {
			const source = screen(`<div className=${value} />`);
			const info = readClassName(source, at(source, "<div"))!;
			expect(info.kind).toBe("dynamic");
			expect(info.editable).toBe(false);
			expect(info.text).toBe(value);
		}
	});

	test("decodes entities and escapes", () => {
		const a = screen(`<div className="a &amp; b" />`);
		expect(readClassName(a, at(a, "<div"))!.classes).toBe("a & b");
		const b = screen(`<div className={"content-[\\"x\\"]"} />`);
		expect(readClassName(b, at(b, "<div"))!.classes).toBe(`content-["x"]`);
	});

	test("null without an element or for a fragment", () => {
		const source = screen(`<><div /></>`);
		expect(readClassName(source, 3)).toBeNull();
		expect(readClassName(source, at(source, "<>"))).toBeNull();
		expect(readClassName("not tsx <", 0)).toBeNull();
	});
});

describe("setClassName", () => {
	test("edits a plain attribute in place", () => {
		const source = screen(`<div className="flex gap-2" id="a">Hi</div>`);
		expect(setClassName(source, at(source, "<div"), "grid gap-4")).toBe(
			screen(`<div className="grid gap-4" id="a">Hi</div>`),
		);
	});

	test("creates the attribute when missing", () => {
		const source = screen(`<div id="a">Hi</div>`);
		expect(setClassName(source, at(source, "<div"), "p-4")).toBe(screen(`<div id="a" className="p-4">Hi</div>`));
		const bare = screen(`<div />`);
		expect(setClassName(bare, at(bare, "<div"), "p-4")).toBe(screen(`<div className="p-4" />`));
	});

	test("removing all classes removes the attribute", () => {
		const source = screen(`<div className="p-4" id="a" />`);
		expect(setClassName(source, at(source, "<div"), "  ")).toBe(screen(`<div id="a" />`));
		const literal = screen(`<div className={"p-4"} />`);
		expect(setClassName(literal, at(literal, "<div"), "")).toBe(screen(`<div />`));
		const none = screen(`<div />`);
		expect(setClassName(none, at(none, "<div"), "")).toBe(none);
	});

	test("keeps quoting valid", () => {
		const source = screen(`<div className="p-4" />`);
		expect(setClassName(source, at(source, "<div"), `content-["x"] p-4`)).toBe(
			screen(`<div className={"content-[\\"x\\"] p-4"} />`),
		);
		const single = screen(`<div className={'p-4'} />`);
		expect(setClassName(single, at(single, "<div"), `content-['x']`)).toBe(
			screen(`<div className={'content-[\\'x\\']'} />`),
		);
		const template = screen("<div className={`p-4`} />");
		expect(setClassName(template, at(template, "<div"), "content-['`'] p-2")).toBe(
			screen("<div className={`content-['\\`'] p-2`} />"),
		);
	});

	test("edits the first literal of cn() and leaves the rest", () => {
		const source = screen(`<div className={cn("p-4 flex", active && "bg-accent")} />`);
		expect(setClassName(source, at(source, "<div"), "p-6 flex")).toBe(
			screen(`<div className={cn("p-6 flex", active && "bg-accent")} />`),
		);
		expect(setClassName(source, at(source, "<div"), "")).toBe(
			screen(`<div className={cn("", active && "bg-accent")} />`),
		);
	});

	test("round-trips what it reads", () => {
		const source = screen(`<div className={"a\\\\b"} />`);
		const info = readClassName(source, at(source, "<div"))!;
		expect(info.classes).toBe("a\\b");
		expect(setClassName(source, at(source, "<div"), info.classes)).toBe(source);
	});

	test("refuses dynamic values", () => {
		const source = screen(`<div className={styles.card} />`);
		expect(setClassName(source, at(source, "<div"), "p-4")).toBeNull();
	});

	test("the result still parses", () => {
		const source = screen(`<Card className={cn("p-4")}><p className="text-sm">Hi</p></Card>`);
		const out = setClassName(source, at(source, "<p"), `text-lg bg-[url("a.png")]`)!;
		expect(parseJsx(out).ok).toBe(true);
		expect(readClassName(out, at(out, "<p"))!.classes).toBe(`text-lg bg-[url("a.png")]`);
	});
});

describe("parseClass", () => {
	test("variants, important and negative", () => {
		expect(parseClass("md:hover:!-mt-4")).toEqual({
			raw: "md:hover:!-mt-4",
			variants: ["md", "hover"],
			important: true,
			importantLast: false,
			negative: true,
			utility: "mt-4",
		});
		expect(parseClass("p-4!")).toMatchObject({ variants: [], important: true, importantLast: true, utility: "p-4" });
		expect(parseClass("bg-[url(http://x)]")).toMatchObject({ variants: [], utility: "bg-[url(http://x)]" });
		expect(parseClass("[&>svg]:size-4")).toMatchObject({ variants: ["[&>svg]"], utility: "size-4" });
	});

	test("splitModifier", () => {
		expect(splitModifier("primary/50")).toEqual(["primary", "50"]);
		expect(splitModifier("[rgb(0_0_0/0.5)]")).toEqual(["[rgb(0_0_0/0.5)]", null]);
		expect(splitModifier("sm/[1.5]")).toEqual(["sm", "[1.5]"]);
	});
});

describe("classifyClass", () => {
	const cases: [string, ClassHit["prop"] | null, string?, string?][] = [
		["flex", "display", "", "flex"],
		["inline-flex", "display", "", "inline-flex"],
		["hidden", "display", "", "hidden"],
		["flex-col", "flexDirection", "flex", "col"],
		["flex-wrap", "flexWrap", "flex", "wrap"],
		["flex-1", "flex", "flex", "1"],
		["flex-none", "flex", "flex", "none"],
		["grow", "flexGrow", "grow", ""],
		["grow-0", "flexGrow", "grow", "0"],
		["flex-grow", "flexGrow", "grow", ""],
		["shrink-0", "flexShrink", "shrink", "0"],
		["flex-shrink-0", "flexShrink", "shrink", "0"],
		["self-center", "alignSelf", "self", "center"],
		["self-stretch", "alignSelf", "self", "stretch"],
		["relative", "position", "", "relative"],
		["sticky", "position", "", "sticky"],
		["inset-0", "inset", "inset", "0"],
		["inset-x-4", "inset", "inset-x", "4"],
		["top-1/2", "inset", "top", "1/2"],
		["-left-2", "inset", "left", "-2"],
		["right-[13px]", "inset", "right", "[13px]"],
		["inset-shadow-sm", null],
		["inset-ring-2", null],
		["z-10", "zIndex", "z", "10"],
		["-z-10", "zIndex", "z", "-10"],
		["z-[5]", "zIndex", "z", "[5]"],
		["overflow-hidden", "overflow", "overflow", "hidden"],
		["overflow-x-auto", null],
		["grid-cols-3", "gridColumns", "grid-cols", "3"],
		["grid-cols-[200px_1fr]", "gridColumns", "grid-cols", "[200px_1fr]"],
		["grid-cols-subgrid", "gridColumns", "grid-cols", "subgrid"],
		["font-serif", "fontFamily", "font", "serif"],
		["justify-between", "justifyContent", "justify", "between"],
		["justify-items-center", null],
		["items-center", "alignItems", "items", "center"],
		["gap-4", "gap", "gap", "4"],
		["gap-x-2", "gap", "gap-x", "2"],
		["p-4", "padding", "p", "4"],
		["px-[13px]", "padding", "px", "[13px]"],
		["pt-px", "padding", "pt", "px"],
		["ps-2", "padding", "ps", "2"],
		["m-auto", "margin", "m", "auto"],
		["-mt-4", "margin", "mt", "-4"],
		["mx-auto", "margin", "mx", "auto"],
		["-p-4", null],
		["w-full", "size", "w", "full"],
		["h-1/2", "size", "h", "1/2"],
		["size-10", "size", "size", "10"],
		["max-w-md", "maxWidth", "max-w", "md"],
		["min-h-screen", "minHeight", "min-h", "screen"],
		["text-lg", "fontSize", "text", "lg"],
		["text-sm/6", "fontSize", "text", "sm/6"],
		["text-[13px]", "fontSize", "text", "[13px]"],
		["text-[length:var(--x)]", "fontSize", "text", "[length:var(--x)]"],
		["text-primary", "textColor", "text", "primary"],
		["text-muted-foreground", "textColor", "text", "muted-foreground"],
		["text-white/80", "textColor", "text", "white/80"],
		["text-[#fff]", "textColor", "text", "[#fff]"],
		["text-[oklch(0.5_0.1_20)]", "textColor", "text", "[oklch(0.5_0.1_20)]"],
		["text-(--brand)", "textColor", "text", "(--brand)"],
		["text-center", "textAlign", "text", "center"],
		["text-ellipsis", null],
		["text-balance", null],
		["font-semibold", "fontWeight", "font", "semibold"],
		["font-[550]", "fontWeight", "font", "[550]"],
		["font-mono", "fontFamily", "font", "mono"],
		["font-['Inter']", "fontFamily", "font", "['Inter']"],
		["leading-tight", "lineHeight", "leading", "tight"],
		["leading-6", "lineHeight", "leading", "6"],
		["tracking-tight", "letterSpacing", "tracking", "tight"],
		["-tracking-[0.5px]", "letterSpacing", "tracking", "-[0.5px]"],
		["bg-primary", "backgroundColor", "bg", "primary"],
		["bg-primary/50", "backgroundColor", "bg", "primary/50"],
		["bg-slate-950", "backgroundColor", "bg", "slate-950"],
		["bg-[#fff]", "backgroundColor", "bg", "[#fff]"],
		["bg-transparent", "backgroundColor", "bg", "transparent"],
		["bg-cover", null],
		["bg-[url(/a.png)]", null],
		["bg-linear-to-r", null],
		["rounded", "borderRadius", "rounded", ""],
		["rounded-lg", "borderRadius", "rounded", "lg"],
		["rounded-sm", "borderRadius", "rounded", "sm"],
		["rounded-t-lg", "borderRadius", "rounded-t", "lg"],
		["rounded-tl", "borderRadius", "rounded-tl", ""],
		["rounded-[12px]", "borderRadius", "rounded", "[12px]"],
		["border", "borderWidth", "border", ""],
		["border-2", "borderWidth", "border", "2"],
		["border-t", "borderWidth", "border-t", ""],
		["border-x-[3px]", "borderWidth", "border-x", "[3px]"],
		["border-input", "borderColor", "border", "input"],
		["border-black", "borderColor", "border", "black"],
		["border-transparent", "borderColor", "border", "transparent"],
		["border-red-500/40", "borderColor", "border", "red-500/40"],
		["border-dashed", "borderStyle", "border", "dashed"],
		["border-t-primary", null],
		["border-collapse", null],
		["opacity-50", "opacity", "opacity", "50"],
		["shadow", "boxShadow", "shadow", ""],
		["shadow-sm", "boxShadow", "shadow", "sm"],
		["shadow-[0_1px_2px_rgba(0,0,0,0.1)]", "boxShadow", "shadow", "[0_1px_2px_rgba(0,0,0,0.1)]"],
		["shadow-black/5", "shadowColor", "shadow", "black/5"],
		["!p-4", "padding", "p", "4"],
		["p-4!", "padding", "p", "4"],
		["md:p-4", null],
		["hover:bg-accent", null],
		["dark:text-white", null],
		["pointer-events-none", null],
		["place-items-center", null],
		["translate-x-2", null],
	];

	for (const [cls, prop, name, value] of cases) {
		test(cls, () => {
			const hit = classifyClass(cls);

			if (prop === null) expect(hit).toBeNull();
			else expect(hit).toEqual({ prop, name: name!, value: value! });
		});
	}
});

describe("getStyle / setStyle", () => {
	test("reads the last unprefixed class", () => {
		expect(getStyle("md:text-lg text-sm text-center text-primary", "fontSize")).toBe("sm");
		expect(getStyle("md:text-lg text-sm text-center text-primary", "textAlign")).toBe("center");
		expect(getStyle("md:text-lg text-sm text-center text-primary", "textColor")).toBe("primary");
		expect(getStyle("hover:bg-accent", "backgroundColor")).toBeNull();
		expect(getStyle("bg-red-500 bg-blue-500", "backgroundColor")).toBe("blue-500");
		expect(getStyle("border border-input", "borderColor")).toBe("input");
		expect(getStyle("font-mono font-semibold", "fontWeight")).toBe("semibold");
	});

	test("replaces in place and keeps everything else, order included", () => {
		const classes = "flex md:text-lg text-sm hover:text-base text-primary";
		expect(setStyle(classes, "fontSize", "xl")).toBe("flex md:text-lg text-xl hover:text-base text-primary");
		expect(setStyle(classes, "textColor", "red-500/50")).toBe(
			"flex md:text-lg text-sm hover:text-base text-red-500/50",
		);
	});

	test("appends when the property is unset", () => {
		expect(setStyle("flex gap-2", "backgroundColor", "primary")).toBe("flex gap-2 bg-primary");
		expect(setStyle("", "display", "grid")).toBe("grid");
	});

	test("removes duplicates into the first place", () => {
		expect(setStyle("bg-red-500 p-4 bg-blue-500 m-2", "backgroundColor", "card")).toBe("bg-card p-4 m-2");
	});

	test("null removes, unchanged returns the same string", () => {
		expect(setStyle("flex  bg-primary  p-4", "backgroundColor", null)).toBe("flex  p-4");
		expect(setStyle("bg-primary p-4", "backgroundColor", null)).toBe("p-4");
		expect(setStyle("p-4  bg-primary", "backgroundColor", null)).toBe("p-4");
		expect(setStyle("p-4", "backgroundColor", null)).toBe("p-4");
		const same = "p-4   bg-primary";
		expect(setStyle(same, "backgroundColor", "primary")).toBe(same);
	});

	test("ambiguous prefixes don't touch each other", () => {
		const classes = "text-lg text-center text-primary border border-input font-semibold font-mono";
		expect(setStyle(classes, "fontSize", "sm")).toBe(
			"text-sm text-center text-primary border border-input font-semibold font-mono",
		);
		expect(setStyle(classes, "textAlign", "left")).toBe(
			"text-lg text-left text-primary border border-input font-semibold font-mono",
		);
		expect(setStyle(classes, "borderColor", "ring")).toBe(
			"text-lg text-center text-primary border border-ring font-semibold font-mono",
		);
		expect(setStyle(classes, "fontWeight", "bold")).toBe(
			"text-lg text-center text-primary border border-input font-bold font-mono",
		);
	});

	test("keeps !important", () => {
		expect(setStyle("!bg-primary p-4", "backgroundColor", "card")).toBe("!bg-card p-4");
		expect(setStyle("bg-primary! p-4", "backgroundColor", "card")).toBe("bg-card! p-4");
	});

	test("arbitrary values", () => {
		expect(setStyle("text-[13px]", "fontSize", "[15px]")).toBe("text-[15px]");
		expect(setStyle("bg-[#fff] p-2", "backgroundColor", "[oklch(0.5_0.1_20)]")).toBe("bg-[oklch(0.5_0.1_20)] p-2");
	});

	test("replaces unknown classes that conflict, per tailwind-merge", () => {
		expect(setStyle("p-4 bg-brand", "backgroundColor", "primary")).toBe("p-4 bg-primary");
		expect(setStyle("text-brand text-lg", "textColor", "primary")).toBe("text-primary text-lg");
		expect(setStyle("bg-cover bg-brand", "backgroundColor", "primary")).toBe("bg-cover bg-primary");
	});

	test("keeps whitespace layout of the other classes", () => {
		expect(setStyle("flex\n\t\titems-center\n\t\tbg-red-500", "backgroundColor", "card")).toBe(
			"flex\n\t\titems-center\n\t\tbg-card",
		);
		expect(setStyle("flex\n\t\tbg-red-500\n\t\titems-center", "backgroundColor", null)).toBe("flex\n\t\titems-center");
	});

	test("styleClass", () => {
		expect(styleClass("display", "flex")).toBe("flex");
		expect(styleClass("backgroundColor", "primary/50")).toBe("bg-primary/50");
		expect(styleClass("boxShadow", "")).toBe("shadow");
	});
});

describe("new properties", () => {
	test("position, z-index, overflow and grid columns write their classes", () => {
		expect(setStyle("flex p-4", "position", "absolute")).toBe("flex p-4 absolute");
		expect(setStyle("relative p-4", "position", "sticky")).toBe("sticky p-4");
		expect(setStyle("z-10", "zIndex", "-10")).toBe("-z-10");
		expect(setStyle("overflow-auto", "overflow", "hidden")).toBe("overflow-hidden");
		expect(setStyle("grid grid-cols-2 gap-4", "gridColumns", "3")).toBe("grid grid-cols-3 gap-4");
		expect(setStyle("flex-1", "flex", null)).toBe("");
		expect(setStyle("p-2", "flexShrink", "0")).toBe("p-2 shrink-0");
		expect(setStyle("p-2", "flexGrow", "")).toBe("p-2 grow");
		expect(setStyle("self-start", "alignSelf", "end")).toBe("self-end");
		expect(setStyle("font-sans text-sm", "fontFamily", "mono")).toBe("font-mono text-sm");
	});

	test("direction classes stay apart from the flex shorthand", () => {
		expect(getStyle("flex flex-col flex-1 flex-wrap", "flex")).toBe("1");
		expect(getStyle("flex flex-col flex-1 flex-wrap", "flexDirection")).toBe("col");
		expect(setStyle("flex flex-col flex-1", "flex", "none")).toBe("flex flex-col flex-none");
	});

	test("inset is a box", () => {
		expect(getBox("absolute inset-0 top-4", "inset")).toEqual({ top: "4", right: "0", bottom: "0", left: "0" });
		expect(setBoxParts("absolute", "inset", ["top", "right", "bottom", "left"], "0")).toBe("absolute inset-0");
		expect(setBoxParts("absolute inset-0", "inset", ["top"], "auto")).toBe("absolute inset-x-0 top-auto bottom-0");
		expect(setBoxParts("absolute top-2", "inset", ["top"], "-2")).toBe("absolute -top-2");
	});

	test("parseScaleInput: inset, z-index and grid columns", () => {
		expect(parseScaleInput("1/2", INSET_SCALE)).toBe("1/2");
		expect(parseScaleInput("16px", INSET_SCALE)).toBe("4");
		expect(parseScaleInput("-8px", INSET_SCALE)).toBe("-2");
		expect(parseScaleInput("full", INSET_SCALE)).toBe("full");
		expect(parseScaleInput("10", Z_INDEX_SCALE)).toBe("10");
		expect(parseScaleInput("15", Z_INDEX_SCALE)).toBe("[15]");
		expect(parseScaleInput("-10", Z_INDEX_SCALE)).toBe("-10");
		expect(parseScaleInput("auto", Z_INDEX_SCALE)).toBe("auto");
		expect(parseScaleInput("1.5", Z_INDEX_SCALE)).toBeNull();
		expect(parseScaleInput("3", GRID_COLUMNS_SCALE)).toBe("3");
		expect(parseScaleInput("16", GRID_COLUMNS_SCALE)).toBe("16");
		expect(parseScaleInput("0", GRID_COLUMNS_SCALE)).toBeNull();
		expect(parseScaleInput("subgrid", GRID_COLUMNS_SCALE)).toBe("subgrid");
	});
});

describe("variants", () => {
	const classes = "flex bg-card p-4 hover:bg-primary md:flex-col md:p-8 dark:text-white";

	test("reading a variant sees only its classes", () => {
		expect(getStyle(classes, "backgroundColor")).toBe("card");
		expect(getStyle(classes, "backgroundColor", "hover")).toBe("primary");
		expect(getStyle(classes, "backgroundColor", "focus")).toBeNull();
		expect(getStyle(classes, "flexDirection")).toBeNull();
		expect(getStyle(classes, "flexDirection", "md")).toBe("col");
		expect(getStyle(classes, "textColor", "dark")).toBe("white");
		expect(getBox(classes, "padding", "md")).toEqual({ top: "8", right: "8", bottom: "8", left: "8" });
		expect(getBox(classes, "padding", "hover")).toEqual({ top: null, right: null, bottom: null, left: null });
	});

	test("writing a variant leaves the base classes alone", () => {
		expect(setStyle(classes, "backgroundColor", "accent", "hover")).toBe(
			"flex bg-card p-4 hover:bg-accent md:flex-col md:p-8 dark:text-white",
		);
		expect(setStyle(classes, "backgroundColor", "muted", "focus")).toBe(`${classes} focus:bg-muted`);
		expect(setStyle(classes, "backgroundColor", null, "hover")).toBe(
			"flex bg-card p-4 md:flex-col md:p-8 dark:text-white",
		);
		expect(setStyle(classes, "flexDirection", "row", "md")).toBe(
			"flex bg-card p-4 hover:bg-primary md:flex-row md:p-8 dark:text-white",
		);
	});

	test("writing the base leaves the variants alone", () => {
		expect(setStyle(classes, "backgroundColor", null)).toBe(
			"flex p-4 hover:bg-primary md:flex-col md:p-8 dark:text-white",
		);
		expect(setBoxParts(classes, "padding", ["left", "right"], "6")).toBe(
			"flex bg-card px-6 py-4 hover:bg-primary md:flex-col md:p-8 dark:text-white",
		);
	});

	test("boxes write with the prefix on every class", () => {
		expect(setBoxParts(classes, "padding", ["top"], "2", "md")).toBe(
			"flex bg-card p-4 hover:bg-primary md:flex-col md:px-8 md:pt-2 md:pb-8 dark:text-white",
		);
		expect(setBoxParts("p-4", "padding", ["top", "right", "bottom", "left"], "2", "sm")).toBe("p-4 sm:p-2");
		expect(boxClasses("margin", { top: "-2", right: "auto", bottom: "-2", left: "auto" }, "lg")).toEqual([
			"lg:mx-auto",
			"lg:-my-2",
		]);
	});

	test("unknown conflicting classes are replaced only within the variant", () => {
		expect(setStyle("bg-brand hover:bg-brand", "backgroundColor", "primary", "hover")).toBe(
			"bg-brand hover:bg-primary",
		);
		expect(setStyle("bg-brand hover:bg-brand", "backgroundColor", "primary")).toBe("bg-primary hover:bg-brand");
	});

	test("important goes after the variant", () => {
		expect(setStyle("hover:!bg-card", "backgroundColor", "primary", "hover")).toBe("hover:!bg-primary");
		expect(setBoxParts("md:p-4!", "padding", ["top", "right", "bottom", "left"], "2", "md")).toBe("md:p-2!");
	});

	test("stacked variants are their own variant", () => {
		expect(getStyle("md:hover:bg-primary", "backgroundColor", "md")).toBeNull();
		expect(getStyle("md:hover:bg-primary", "backgroundColor", "md:hover")).toBe("primary");
	});

	test("styleClass and usedVariants", () => {
		expect(styleClass("backgroundColor", "primary", "hover")).toBe("hover:bg-primary");
		expect(usedVariants(classes)).toEqual(["", "hover", "md", "dark"]);
		expect(usedVariants("hover:bg-primary")).toEqual(["hover"]);
		expect(usedVariants("")).toEqual([]);
	});
});

describe("boxes", () => {
	test("padding precedence: sides over axes over all", () => {
		expect(getBox("p-4 px-2 pt-1", "padding")).toEqual({ top: "1", right: "2", bottom: "4", left: "2" });
		expect(getBox("pt-1 p-4", "padding")).toEqual({ top: "1", right: "4", bottom: "4", left: "4" });
		expect(getBox("md:p-8 py-3", "padding")).toEqual({ top: "3", right: null, bottom: "3", left: null });
		expect(getBox("ps-2 pe-3", "padding")).toEqual({ top: null, right: "3", bottom: null, left: "2" });
	});

	test("shortest form", () => {
		expect(boxClasses("padding", { top: "4", right: "4", bottom: "4", left: "4" })).toEqual(["p-4"]);
		expect(boxClasses("padding", { top: "2", right: "4", bottom: "2", left: "4" })).toEqual(["px-4", "py-2"]);
		expect(boxClasses("padding", { top: "1", right: "4", bottom: "2", left: "4" })).toEqual(["px-4", "pt-1", "pb-2"]);
		expect(boxClasses("padding", { top: "1", right: "2", bottom: "3", left: "4" })).toEqual([
			"pt-1",
			"pr-2",
			"pb-3",
			"pl-4",
		]);
		expect(boxClasses("padding", { top: "2", right: null, bottom: "2", left: null })).toEqual(["py-2"]);
		expect(boxClasses("margin", { top: "-2", right: "auto", bottom: "-2", left: "auto" })).toEqual([
			"mx-auto",
			"-my-2",
		]);
		expect(boxClasses("borderWidth", { top: "", right: "", bottom: "", left: "" })).toEqual(["border"]);
		expect(boxClasses("borderWidth", { top: null, right: null, bottom: "2", left: null })).toEqual(["border-b-2"]);
		expect(boxClasses("borderRadius", { tl: "lg", tr: "lg", br: "none", bl: "none" })).toEqual([
			"rounded-t-lg",
			"rounded-b-none",
		]);
		expect(boxClasses("size", { width: "4", height: "4" })).toEqual(["size-4"]);
		expect(boxClasses("size", { width: "full", height: "12" })).toEqual(["w-full", "h-12"]);
		expect(boxClasses("gap", { x: "2", y: "4" })).toEqual(["gap-x-2", "gap-y-4"]);
	});

	test("setBox replaces the group where it was", () => {
		expect(
			setBox("flex pt-2 items-center px-4 pb-2", "padding", { top: "3", right: "4", bottom: "3", left: "4" }),
		).toBe("flex px-4 py-3 items-center");
		expect(
			setBox("flex pt-2 items-center px-4 pb-2", "padding", { top: "3", right: "4", bottom: "2", left: "4" }),
		).toBe("flex px-4 pt-3 pb-2 items-center");
		expect(setBox("flex px-4 py-2", "padding", { top: "3", right: "3", bottom: "3", left: "3" })).toBe("flex p-3");
		expect(setBox("flex", "padding", { top: "3", right: "3", bottom: "3", left: "3" })).toBe("flex p-3");
		expect(setBox("flex p-4 gap-2", "padding", { top: null, right: null, bottom: null, left: null })).toBe(
			"flex gap-2",
		);
		expect(setBox("md:p-8 p-4", "padding", { top: "2", right: "2", bottom: "2", left: "2" })).toBe("md:p-8 p-2");
	});

	test("setBox leaves unchanged values alone", () => {
		const classes = "pt-2 pb-2 px-4";
		expect(setBox(classes, "padding", { top: "2", right: "4", bottom: "2", left: "4" })).toBe(classes);
	});

	test("setBoxParts", () => {
		expect(setBoxParts("p-4", "padding", ["left", "right"], "6")).toBe("px-6 py-4");
		expect(setBoxParts("px-6 py-4", "padding", ["top"], "6")).toBe("px-6 pt-6 pb-4");
		expect(setBoxParts("mx-auto -mt-2", "margin", ["top", "bottom"], "-2")).toBe("mx-auto -my-2");
		expect(setBoxParts("size-4 rounded", "size", ["width"], "8")).toBe("w-8 h-4 rounded");
		expect(setBoxParts("w-8 h-4", "size", ["height"], "8")).toBe("size-8");
		expect(setBoxParts("gap-2", "gap", ["y"], "4")).toBe("gap-x-2 gap-y-4");
		expect(setBoxParts("rounded-lg", "borderRadius", ["tl"], "none")).toBe(
			"rounded-r-lg rounded-tl-none rounded-bl-lg",
		);
		expect(setBoxParts("border border-input", "borderWidth", ["top", "right", "bottom", "left"], "2")).toBe(
			"border-2 border-input",
		);
		expect(setBoxParts("border-2 border-input", "borderWidth", ["top", "right", "bottom", "left"], null)).toBe(
			"border-input",
		);
	});

	test("radius corners", () => {
		expect(getBox("rounded-lg rounded-t-none", "borderRadius")).toEqual({ tl: "none", tr: "none", br: "lg", bl: "lg" });
		expect(setBoxParts("rounded-lg", "borderRadius", ["tl", "tr"], "none")).toBe("rounded-t-none rounded-b-lg");
		expect(setBoxParts("rounded-lg", "borderRadius", ["tl", "tr", "br", "bl"], "")).toBe("rounded");
	});

	test("keeps !important on the group", () => {
		expect(setBoxParts("!p-4", "padding", ["top", "right", "bottom", "left"], "2")).toBe("!p-2");
	});
});

describe("values", () => {
	test("isColorValue", () => {
		for (const value of [
			"primary",
			"muted-foreground",
			"red-500",
			"slate-950",
			"black",
			"white",
			"transparent",
			"current",
			"inherit",
			"primary/50",
			"[#fff]",
			"[oklch(0.5_0.1_20)]",
			"[color:var(--x)]",
			"(--brand)",
			"white/[0.3]",
		]) {
			expect(isColorValue(value)).toBe(true);
		}

		for (const value of ["lg", "red-550", "cover", "[13px]", "[url(/a.png)]", "primary/abc"])
			expect(isColorValue(value)).toBe(false);
	});

	test("parseScaleInput: spacing", () => {
		expect(parseScaleInput("4", SPACING_SCALE)).toBe("4");
		expect(parseScaleInput("16px", SPACING_SCALE)).toBe("4");
		expect(parseScaleInput("1px", SPACING_SCALE)).toBe("px");
		expect(parseScaleInput("13px", SPACING_SCALE)).toBe("[13px]");
		expect(parseScaleInput("1.5rem", SPACING_SCALE)).toBe("[1.5rem]");
		expect(parseScaleInput("13", SPACING_SCALE)).toBe("13");
		expect(parseScaleInput("[2px]", SPACING_SCALE)).toBe("[2px]");
		expect(parseScaleInput("[calc(1rem + 2px)]", SPACING_SCALE)).toBe("[calc(1rem_+_2px)]");
		expect(parseScaleInput("abc", SPACING_SCALE)).toBeNull();
		expect(parseScaleInput("-4", SPACING_SCALE)).toBeNull();
	});

	test("parseScaleInput: margin takes auto and negatives", () => {
		expect(parseScaleInput("auto", MARGIN_SCALE)).toBe("auto");
		expect(parseScaleInput("-4", MARGIN_SCALE)).toBe("-4");
		expect(parseScaleInput("-8px", MARGIN_SCALE)).toBe("-2");
		expect(parseScaleInput("-auto", MARGIN_SCALE)).toBeNull();
	});

	test("parseScaleInput: other scales", () => {
		expect(parseScaleInput("50%", SIZE_SCALE)).toBe("1/2");
		expect(parseScaleInput("100%", SIZE_SCALE)).toBe("full");
		expect(parseScaleInput("2/5", SIZE_SCALE)).toBe("2/5");
		expect(parseScaleInput("320px", SIZE_SCALE)).toBe("80");
		expect(parseScaleInput("16", FONT_SIZE_SCALE)).toBe("base");
		expect(parseScaleInput("13px", FONT_SIZE_SCALE)).toBe("[13px]");
		expect(parseScaleInput("600", FONT_WEIGHT_SCALE)).toBe("semibold");
		expect(parseScaleInput("Semibold", FONT_WEIGHT_SCALE)).toBe("semibold");
		expect(parseScaleInput("550", FONT_WEIGHT_SCALE)).toBe("[550]");
		expect(parseScaleInput("1.5", LINE_HEIGHT_SCALE)).toBe("normal");
		expect(parseScaleInput("1.2", LINE_HEIGHT_SCALE)).toBe("[1.2]");
		expect(parseScaleInput("6", LINE_HEIGHT_SCALE)).toBe("6");
		expect(parseScaleInput("0.025em", LETTER_SPACING_SCALE)).toBe("wide");
		expect(parseScaleInput("0.5px", LETTER_SPACING_SCALE)).toBe("[0.5px]");
		expect(parseScaleInput("1", BORDER_WIDTH_SCALE)).toBe("");
		expect(parseScaleInput("3", BORDER_WIDTH_SCALE)).toBe("3");
		expect(parseScaleInput("10", RADIUS_SCALE)).toBe("lg");
		expect(parseScaleInput("base", RADIUS_SCALE)).toBe("");
		expect(parseScaleInput("12px", RADIUS_SCALE)).toBe("[12px]");
		expect(parseScaleInput("50%", OPACITY_SCALE)).toBe("50");
		expect(parseScaleInput("33", OPACITY_SCALE)).toBe("33");
		expect(parseScaleInput("120", OPACITY_SCALE)).toBeNull();
	});

	test("describeValue", () => {
		expect(describeValue("4", SPACING_SCALE)).toEqual({ label: "4", hint: "16px" });
		expect(describeValue("13", SPACING_SCALE)).toEqual({ label: "13", hint: "52px" });
		expect(describeValue("[13px]", SPACING_SCALE)).toEqual({ label: "13px" });
		expect(describeValue("-2", MARGIN_SCALE)).toEqual({ label: "-2", hint: "-8px" });
		expect(describeValue("", BORDER_WIDTH_SCALE)).toMatchObject({ label: "1", hint: "1px" });
		expect(describeValue("[calc(1rem_+_2px)]", SPACING_SCALE)).toEqual({ label: "calc(1rem + 2px)" });
	});

	test("parseColorInput", () => {
		expect(parseColorInput("primary")).toBe("primary");
		expect(parseColorInput("red-500/50")).toBe("red-500/50");
		expect(parseColorInput("#ff0")).toBe("[#ff0]");
		expect(parseColorInput("oklch(0.5 0.1 20)")).toBe("[oklch(0.5_0.1_20)]");
		expect(parseColorInput("[#fff]")).toBe("[#fff]");
		expect(parseColorInput("lg")).toBeNull();
	});

	test("colorCss", () => {
		expect(colorCss("primary")).toBe("var(--primary)");
		expect(colorCss("primary", (name) => `var(--color-${name})`)).toBe("var(--color-primary)");
		expect(colorCss("red-500")).toBe("oklch(63.7% 0.237 25.331)");
		expect(colorCss("white")).toBe("#fff");
		expect(colorCss("[#abc]")).toBe("#abc");
		expect(colorCss("[oklch(0.5_0.1_20)]")).toBe("oklch(0.5 0.1 20)");
		expect(colorCss("black/50")).toBe("color-mix(in oklab, #000 50%, transparent)");
		expect(colorCss("(--brand)")).toBe("var(--brand)");
		expect(colorCss("inherit")).toBeNull();
		expect(colorCss("lg")).toBeNull();
	});
});

describe("custom tokens", () => {
	afterEach(() => setCustomTokens([]));

	test("are unknown until the project defines them", () => {
		expect(classifyClass("bg-brand")).toBeNull();
		expect(classifyClass("text-display")).toBeNull();
	});

	test("a color token makes its utility a color", () => {
		setCustomTokens(["color-brand", "color-brand-soft", "radius-panel"]);
		expect(isColorValue("brand")).toBe(true);
		expect(isColorValue("brand-soft/50")).toBe(true);
		expect(isColorValue("panel")).toBe(false);
		expect(classifyClass("bg-brand")).toEqual({ prop: "backgroundColor", name: "bg", value: "brand" });
		expect(classifyClass("text-brand/50")).toEqual({ prop: "textColor", name: "text", value: "brand/50" });
		expect(classifyClass("border-brand")).toEqual({ prop: "borderColor", name: "border", value: "brand" });
		expect(setStyle("p-4 bg-brand", "backgroundColor", "primary")).toBe("p-4 bg-primary");
		expect(setStyle("p-4 bg-primary", "backgroundColor", "brand")).toBe("p-4 bg-brand");
	});

	test("a text token makes its utility a font size", () => {
		setCustomTokens(["text-display", "color-brand"]);
		expect(classifyClass("text-display")).toEqual({ prop: "fontSize", name: "text", value: "display" });
		expect(getStyle("text-display text-brand", "fontSize")).toBe("display");
		expect(getStyle("text-display text-brand", "textColor")).toBe("brand");
		expect(setStyle("text-sm", "fontSize", "display")).toBe("text-display");
	});

	test("the swatch reads the token's variable", () => {
		setCustomTokens(["color-brand", "color-red-500"]);
		expect(colorCss("brand")).toBe("var(--color-brand)");
		expect(colorCss("brand/50", (name) => (name === "color-brand" ? "#f00" : ""))).toBe(
			"color-mix(in oklab, #f00 50%, transparent)",
		);
		expect(colorCss("red-500")).toBe("var(--color-red-500)");
	});

	test("ignores built-in and unknown names, and replaces the previous set", () => {
		setCustomTokens(["primary", "brand", "color-brand"]);
		setCustomTokens(["color-accent-2"]);
		expect(isColorValue("brand")).toBe(false);
		expect(isColorValue("accent-2")).toBe(true);
	});
});
