// Style controls edit the classes of one state (`hover:`, `md:`…, or none for Default); the others stay as written.
// A computed className is read-only.

import { useRef, useState } from "react";
import {
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowRight,
	ChevronDown,
	Lock,
	Plus,
	Scan,
	WrapText,
	X,
	type LucideIcon,
} from "lucide-react";
import { InspectorSection } from "@/components/app/inspector-section";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SCREEN_THEME_CSS } from "@/lib/render/theme";
import { commonValue, editEach, restyle, retoken, sharedClasses } from "@/lib/element-selection";
import { cn } from "@/lib/utils";
import {
	customTokenNames,
	tokenKind,
	tokenUtility,
	type DesignTokens,
	type TokenKind,
} from "../../../shared/context/tokens";
import { findElement, parseJsx, type JsxElement } from "../../../shared/jsx";
import {
	BORDER_WIDTH_SCALE,
	classNameOf,
	colorCss,
	describeValue,
	FONT_SIZE_SCALE,
	FONT_WEIGHT_SCALE,
	getBox,
	getStyle,
	GRID_COLUMNS_SCALE,
	INSET_SCALE,
	LETTER_SPACING_SCALE,
	LINE_HEIGHT_SCALE,
	MARGIN_SCALE,
	MAX_SIZE_SCALE,
	OPACITY_SCALE,
	PALETTE,
	PALETTE_SHADES,
	parseColorInput,
	parseScaleInput,
	RADIUS_SCALE,
	setBoxParts,
	setClassName,
	setCustomTokens,
	setStyle,
	SHADOW_SCALE,
	SIZE_SCALE,
	SPACING_SCALE,
	splitModifier,
	THEME_COLORS,
	usedVariants,
	Z_INDEX_SCALE,
	type BoxGroup,
	type Scale,
	type ScaleOption,
	type SimpleProp,
} from "../../../shared/tailwind/classes";

export type ElementStyleProps = {
	source: string;
	/** Start offset in `source` */
	start: number;
	/** The other selected elements: the controls show what they share, and an edit writes to all of them */
	extras?: readonly number[];
	disabled?: boolean;
	/** `step` coalesces a typing burst into one undo step */
	onChange: (nextSource: string, step?: string) => void;
	onFieldFocus?: () => void;
	/** Seals the current typing burst as one undo step */
	onFieldBlur?: () => void;
	/** `""` for Default, `hover`, `md`…: the prefix the controls read and write */
	variant: string;
	onVariantChange: (variant: string) => void;
	/** The applied theme: its swatches color the pickers and its custom tokens join them */
	tokens?: DesignTokens;
};

const REPLACED = new Set([
	"img",
	"video",
	"canvas",
	"iframe",
	"svg",
	"picture",
	"audio",
	"embed",
	"object",
	"hr",
	"br",
	"wbr",
	"path",
	"circle",
	"rect",
	"line",
	"polyline",
	"polygon",
	"ellipse",
	"g",
	"use",
]);

const FORM_FIELDS = new Set(["input", "textarea", "select"]);

const DISPLAY_OPTIONS: ScaleOption[] = [
	{ value: "block", label: "Block" },
	{ value: "flex", label: "Flex" },
	{ value: "grid", label: "Grid" },
	{ value: "inline", label: "Inline" },
	{ value: "inline-block", label: "Inline block" },
	{ value: "inline-flex", label: "Inline flex" },
	{ value: "inline-grid", label: "Inline grid" },
	{ value: "contents", label: "Contents" },
	{ value: "hidden", label: "Hidden" },
];

const JUSTIFY_OPTIONS: ScaleOption[] = ["start", "center", "end", "between", "around", "evenly", "stretch"].map(
	(value) => ({ value, label: value }),
);

const ALIGN_OPTIONS: ScaleOption[] = ["start", "center", "end", "stretch", "baseline"].map((value) => ({
	value,
	label: value,
}));

const SELF_OPTIONS: ScaleOption[] = ["auto", "start", "center", "end", "stretch", "baseline"].map((value) => ({
	value,
	label: value,
}));

const POSITION_OPTIONS: ScaleOption[] = ["static", "relative", "absolute", "fixed", "sticky"].map((value) => ({
	value,
	label: value,
}));

const OVERFLOW_OPTIONS: ScaleOption[] = ["visible", "hidden", "clip", "scroll", "auto"].map((value) => ({
	value,
	label: value,
}));

const FLEX_OPTIONS: ScaleOption[] = [
	{ value: "1", label: "Fill", hint: "flex-1" },
	{ value: "auto", label: "Auto", hint: "flex-auto" },
	{ value: "initial", label: "Initial", hint: "flex-initial" },
	{ value: "none", label: "None", hint: "flex-none" },
];

/** The theme defines these three (DESIGN.md tokens `font-sans`, `font-serif`, `font-mono`) */
const FONT_FAMILY_OPTIONS: ScaleOption[] = [
	{ value: "sans", label: "Sans" },
	{ value: "serif", label: "Serif" },
	{ value: "mono", label: "Mono" },
];

/** Value `""` is Default; the rest are Tailwind variants */
const STATES: { value: string; label: string; hint?: string }[] = [
	{ value: "", label: "Default" },
	{ value: "hover", label: "Hover" },
	{ value: "focus", label: "Focus" },
	{ value: "dark", label: "Dark" },
];

const BREAKPOINTS: { value: string; label: string; hint?: string }[] = [
	{ value: "sm", label: "sm", hint: "≥ 640px" },
	{ value: "md", label: "md", hint: "≥ 768px" },
	{ value: "lg", label: "lg", hint: "≥ 1024px" },
];

const BORDER_STYLE_OPTIONS: ScaleOption[] = ["solid", "dashed", "dotted", "double", "none"].map((value) => ({
	value,
	label: value,
}));

const DIRECTION_OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
	{ value: "row", label: "Row", icon: ArrowRight },
	{ value: "col", label: "Column", icon: ArrowDown },
];

const TEXT_ALIGN_OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
	{ value: "left", label: "Left", icon: AlignLeft },
	{ value: "center", label: "Center", icon: AlignCenter },
	{ value: "right", label: "Right", icon: AlignRight },
	{ value: "justify", label: "Justify", icon: AlignJustify },
];

type Part = { label: string; parts: readonly string[] };

const SIDES: Part[] = [
	{ label: "T", parts: ["top"] },
	{ label: "R", parts: ["right"] },
	{ label: "B", parts: ["bottom"] },
	{ label: "L", parts: ["left"] },
];

const AXES: Part[] = [
	{ label: "X", parts: ["left", "right"] },
	{ label: "Y", parts: ["top", "bottom"] },
];

const ALL_SIDES: Part[] = [{ label: "", parts: ["top", "right", "bottom", "left"] }];

const CORNERS: Part[] = [
	{ label: "TL", parts: ["tl"] },
	{ label: "TR", parts: ["tr"] },
	{ label: "BL", parts: ["bl"] },
	{ label: "BR", parts: ["br"] },
];

const ALL_CORNERS: Part[] = [{ label: "", parts: ["tl", "tr", "br", "bl"] }];

const GAP_ALL: Part[] = [{ label: "", parts: ["x", "y"] }];

const GAP_AXES: Part[] = [
	{ label: "X", parts: ["x"] },
	{ label: "Y", parts: ["y"] },
];

type Edit = {
	/** Runs on each selected element's classes. `field` set for typing (coalesced per focus) */
	apply: (change: (classes: string) => string, field?: string) => void;
	/** Each selected element's classes; one entry for a single element */
	all: readonly string[];
	variant: string;
	onFocus: () => void;
	onBlur: () => void;
	disabled?: boolean;
	tokens: DesignTokens;
};

export function ElementStyle({
	source,
	start,
	extras = NO_EXTRAS,
	disabled,
	onChange,
	onFieldFocus,
	onFieldBlur,
	variant,
	onVariantChange,
	tokens = NO_TOKENS,
}: ElementStyleProps) {
	const burst = useRef(0);

	registerTokens(tokens);
	const tree = parseJsx(source);
	const element = findElement(tree, start);

	if (!element || element.name === null) return null;
	const info = classNameOf(source, element);
	const tag = element.intrinsic ? element.name : null;

	// Computed classNames are left out of a multi-element edit
	const all = [
		info.classes,
		...extras.flatMap((extra) => {
			const other = findElement(tree, extra);
			const otherInfo = other && other.name !== null ? classNameOf(source, other) : null;

			return otherInfo?.editable ? [otherInfo.classes] : [];
		}),
	];

	const skipped = extras.length + 1 - all.length;
	const backgroundMixed = commonValue(all.map((own) => getStyle(own, "backgroundColor", variant))) === undefined;

	const edit: Edit = {
		apply: (change, field) => {
			const next = extras.length
				? editEach(source, [start, ...extras], restyle(change)).source
				: setClassName(source, start, change(info.classes));

			if (next !== null && next !== source)
				onChange(next, field ? `style:${start}:${field}:${burst.current}` : undefined);
		},
		all,
		onFocus: () => {
			burst.current += 1;
			onFieldFocus?.();
		},
		onBlur: () => onFieldBlur?.(),
		variant,
		disabled,
		tokens,
	};

	if (!info.editable) {
		return (
			<div className="flex flex-col gap-2 border-b p-4">
				<h3 className="text-xs font-medium text-subtle-foreground">Style</h3>
				<div className="flex items-start gap-2 rounded-md border border-dashed px-2.5 py-2">
					<Lock className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
					<div className="flex min-w-0 flex-col gap-1">
						<p className="text-xs text-muted-foreground">The classes are computed. Edit them in the code.</p>
						<code className="truncate font-mono text-[11px] text-subtle-foreground" title={info.text ?? undefined}>
							className={info.text}
						</code>
					</div>
				</div>
			</div>
		);
	}

	const classes = extras.length ? sharedClasses(all) : info.classes;
	const replaced = tag !== null && REPLACED.has(tag);
	const hasLayout = !replaced && !(tag !== null && FORM_FIELDS.has(tag));
	const hasText = !replaced;
	const parentLayout = layoutOf(source, element.parent);

	return (
		<div className="flex flex-col gap-4 border-b p-4" key={start}>
			<StateSwitch classes={classes} value={variant} disabled={disabled} onChange={onVariantChange} />
			{skipped ? (
				<p className="-mt-2 text-xs text-subtle-foreground">
					{skipped === 1 ? "One element computes its classes" : `${skipped} elements compute their classes`}, so edits
					leave it out.
				</p>
			) : null}
			{hasLayout ? <LayoutSection classes={classes} edit={edit} /> : null}
			{parentLayout ? <ItemSection classes={classes} edit={edit} parent={parentLayout} /> : null}
			<SpacingSection edit={edit} />
			<SizeSection classes={classes} edit={edit} />
			<PositionSection classes={classes} edit={edit} />
			{hasText ? <TypographySection classes={classes} edit={edit} /> : null}
			<Section title="Fill">
				<ColorField
					label="Background"
					value={getStyle(classes, "backgroundColor", variant)}
					mixed={backgroundMixed}
					edit={edit}
					onPick={(value, field) =>
						edit.apply((classes) => setStyle(classes, "backgroundColor", value, variant), field && `bg:${field}`)
					}
				/>
			</Section>
			<BorderSection classes={classes} edit={edit} />
			<EffectsSection classes={classes} edit={edit} />
			<ClassesField
				classes={classes}
				edit={edit}
				note={
					extras.length
						? "The classes every selected element has. Edits add and remove them on each."
						: tag === null
							? `Passed to ${element.name} as its className.`
							: null
				}
			/>
		</div>
	);
}

type SectionProps = { classes: string; edit: Edit };

const NO_EXTRAS: readonly number[] = [];

const NO_TOKENS: DesignTokens = { light: {}, dark: {} };

let registered: DesignTokens | null = null;

/** The class parse needs the custom names to read `bg-brand` and `text-display`; one project is open at a time */
function registerTokens(tokens: DesignTokens) {
	if (tokens === registered) return;
	registered = tokens;
	setCustomTokens(customTokenNames(tokens));
}

/** The custom tokens of one kind as options after the built-in ones: `radius-card` is `card` (`rounded-card`) */
function tokenOptions(tokens: DesignTokens, kind: TokenKind): ScaleOption[] {
	return customTokenNames(tokens).flatMap((name) => {
		if (tokenKind(name) !== kind) return [];
		const value = tokens.light[name] ?? tokens.dark[name] ?? "";
		const utility = tokenUtility(name);

		// The first family of a stack, the size without its line height
		const hint =
			kind === "font"
				? value.split(",")[0]!.replace(/["']/g, "").trim()
				: kind === "text"
					? value.split("/")[0]!.trim()
					: value;

		return [{ value: utility, label: utility, hint: hint || undefined }];
	});
}

const withTokens = (scale: Scale, tokens: DesignTokens, kind: TokenKind): Scale => ({
	...scale,
	options: [...scale.options, ...tokenOptions(tokens, kind)],
});

/** Never a class value: marks parts of one box that differ */
const MIXED = "\u0000mixed";

/** The selected elements differ in what `read` returns */
const isMixed = (edit: Edit, read: (classes: string) => string | null) => commonValue(edit.all.map(read)) === undefined;

const mixedStyle = (edit: Edit, prop: SimpleProp) => isMixed(edit, (own) => getStyle(own, prop, edit.variant));

/** How the parent lays out its children; `unknown` for a component or computed classes */
type ParentLayout = "flex" | "grid" | "unknown";

function layoutOf(source: string, parent: JsxElement | null): ParentLayout | null {
	if (!parent || parent.name === null) return null;

	if (!parent.intrinsic) return "unknown";
	const info = classNameOf(source, parent);

	if (!info.editable) return "unknown";
	const display = getStyle(info.classes, "display");

	return display === "flex" || display === "inline-flex"
		? "flex"
		: display === "grid" || display === "inline-grid"
			? "grid"
			: null;
}

/** In a state, show what Default sets when the state doesn't: `md:` overrides only some classes */
const effective = (classes: string, prop: SimpleProp, variant: string) =>
	getStyle(classes, prop, variant) ?? (variant ? getStyle(classes, prop) : null);

function StateSwitch({
	classes,
	value,
	disabled,
	onChange,
}: {
	classes: string;
	value: string;
	disabled?: boolean;
	onChange: (variant: string) => void;
}) {
	const used = new Set(usedVariants(classes));
	const current = [...STATES, ...BREAKPOINTS].find((state) => state.value === value);

	const item = (state: { value: string; label: string; hint?: string }) => (
		<DropdownMenuRadioItem key={state.value} value={state.value} className="text-[13px]">
			{state.label}
			<span className="ml-auto flex items-center gap-2 pl-3">
				{state.hint ? <span className="text-xs text-subtle-foreground tabular-nums">{state.hint}</span> : null}
				<span
					className={cn("size-1.5 rounded-full bg-primary", (!state.value || !used.has(state.value)) && "invisible")}
					aria-label={state.value && used.has(state.value) ? "Has classes" : undefined}
				/>
			</span>
		</DropdownMenuRadioItem>
	);

	return (
		<div className="-my-1 flex h-7 items-center justify-between gap-2">
			<span className="text-xs text-muted-foreground">State</span>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="xs"
						disabled={disabled}
						aria-label="State to edit"
						title="Edit the classes of a state or breakpoint (hover:, md:…)"
						className={cn(
							"-mr-1.5 h-7 gap-1 px-2 text-[13px] font-normal text-muted-foreground",
							value && "bg-accent font-mono text-xs text-accent-foreground",
						)}
					>
						{value ? `${value}:` : (current?.label ?? "Default")}
						<ChevronDown className="size-3" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuRadioGroup value={value} onValueChange={onChange}>
						{STATES.map(item)}
						<DropdownMenuSeparator />
						{BREAKPOINTS.map(item)}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

const styleWriter = (edit: Edit, prop: SimpleProp) => (value: string | null, continuous: boolean) =>
	edit.apply((classes) => setStyle(classes, prop, value, edit.variant), continuous ? prop : undefined);

function LayoutSection({ classes, edit }: SectionProps) {
	const display = getStyle(classes, "display", edit.variant);
	const shown = effective(classes, "display", edit.variant);
	const flex = shown === "flex" || shown === "inline-flex";
	const grid = shown === "grid" || shown === "inline-grid";
	const direction = getStyle(classes, "flexDirection", edit.variant);
	const wrap = getStyle(classes, "flexWrap", edit.variant);

	return (
		<Section title="Layout">
			<Row label="Display">
				<SelectField
					label="Display"
					value={display}
					mixed={mixedStyle(edit, "display")}
					options={DISPLAY_OPTIONS}
					edit={edit}
					onChange={styleWriter(edit, "display")}
				/>
			</Row>
			{flex ? (
				<Row label="Direction">
					<div className="flex min-w-0 flex-1 items-center gap-1">
						<Segmented
							label="Direction"
							value={direction ?? "row"}
							options={DIRECTION_OPTIONS}
							disabled={edit.disabled}
							onChange={(value) =>
								edit.apply((classes) =>
									setStyle(classes, "flexDirection", value === "row" || value === null ? null : value, edit.variant),
								)
							}
						/>
						<IconToggle
							icon={WrapText}
							label={wrap === "wrap" ? "Wrapping (flex-wrap)" : "Wrap (flex-wrap)"}
							pressed={wrap === "wrap"}
							disabled={edit.disabled}
							onChange={(pressed) =>
								edit.apply((classes) => setStyle(classes, "flexWrap", pressed ? "wrap" : null, edit.variant))
							}
						/>
					</div>
				</Row>
			) : null}
			{flex || grid ? (
				<>
					<Row label="Justify">
						<SelectField
							label="Justify content"
							value={getStyle(classes, "justifyContent", edit.variant)}
							mixed={mixedStyle(edit, "justifyContent")}
							options={JUSTIFY_OPTIONS}
							edit={edit}
							onChange={styleWriter(edit, "justifyContent")}
						/>
					</Row>
					<Row label="Align">
						<SelectField
							label="Align items"
							value={getStyle(classes, "alignItems", edit.variant)}
							mixed={mixedStyle(edit, "alignItems")}
							options={ALIGN_OPTIONS}
							edit={edit}
							onChange={styleWriter(edit, "alignItems")}
						/>
					</Row>
					{grid ? (
						<Row label="Columns">
							<ScaleField
								ariaLabel="Grid columns"
								value={getStyle(classes, "gridColumns", edit.variant)}
								mixed={mixedStyle(edit, "gridColumns")}
								scale={GRID_COLUMNS_SCALE}
								edit={edit}
								onChange={styleWriter(edit, "gridColumns")}
							/>
						</Row>
					) : null}
					<BoxField title="Gap" group="gap" scale={SPACING_SCALE} linked={GAP_ALL} split={GAP_AXES} edit={edit} />
				</>
			) : null}
			<Row label="Overflow">
				<SelectField
					label="Overflow"
					value={getStyle(classes, "overflow", edit.variant)}
					mixed={mixedStyle(edit, "overflow")}
					options={OVERFLOW_OPTIONS}
					placeholder="visible"
					edit={edit}
					onChange={styleWriter(edit, "overflow")}
				/>
			</Row>
		</Section>
	);
}

/** How the element sits in its flex or grid parent */
function ItemSection({ classes, edit, parent }: SectionProps & { parent: ParentLayout }) {
	const grow = getStyle(classes, "flexGrow", edit.variant);
	const shrink = getStyle(classes, "flexShrink", edit.variant);

	return (
		<Section title={parent === "grid" ? "Grid item" : "Flex item"}>
			{parent !== "grid" ? (
				<>
					<Row label="Flex">
						<SelectField
							label="Flex"
							value={getStyle(classes, "flex", edit.variant)}
							mixed={mixedStyle(edit, "flex")}
							options={FLEX_OPTIONS}
							edit={edit}
							onChange={styleWriter(edit, "flex")}
						/>
					</Row>
					<Row label="Resize">
						<ToggleGroup
							type="multiple"
							size="sm"
							variant="outline"
							value={[grow === "" ? "grow" : "", shrink === "0" ? "shrink" : ""].filter(Boolean)}
							disabled={edit.disabled}
							onValueChange={(next) => {
								const grows = next.includes("grow");
								const fixed = next.includes("shrink");

								edit.apply((own) => {
									const ownGrow = getStyle(own, "flexGrow", edit.variant);
									const ownShrink = getStyle(own, "flexShrink", edit.variant);

									const withGrow = setStyle(
										own,
										"flexGrow",
										grows ? "" : ownGrow === "" ? null : ownGrow,
										edit.variant,
									);

									return setStyle(
										withGrow,
										"flexShrink",
										fixed ? "0" : ownShrink === "0" ? null : ownShrink,
										edit.variant,
									);
								});
							}}
							aria-label="Grow and shrink"
							className="w-full"
						>
							<ToggleGroupItem
								value="grow"
								title="Take the free space (grow)"
								className="h-8 min-w-0 flex-1 px-1.5 text-xs"
							>
								Grow
							</ToggleGroupItem>
							<ToggleGroupItem
								value="shrink"
								title="Never shrink (shrink-0)"
								className="h-8 min-w-0 flex-1 px-1.5 text-xs"
							>
								No shrink
							</ToggleGroupItem>
						</ToggleGroup>
					</Row>
				</>
			) : null}
			<Row label="Align self">
				<SelectField
					label="Align self"
					value={getStyle(classes, "alignSelf", edit.variant)}
					mixed={mixedStyle(edit, "alignSelf")}
					options={SELF_OPTIONS}
					placeholder="auto"
					edit={edit}
					onChange={styleWriter(edit, "alignSelf")}
				/>
			</Row>
		</Section>
	);
}

function PositionSection({ classes, edit }: SectionProps) {
	const position = effective(classes, "position", edit.variant);
	const placed = position !== null && position !== "static";

	return (
		<Section title="Position">
			<Row label="Position">
				<SelectField
					label="Position"
					value={getStyle(classes, "position", edit.variant)}
					mixed={mixedStyle(edit, "position")}
					options={POSITION_OPTIONS}
					placeholder="static"
					edit={edit}
					onChange={styleWriter(edit, "position")}
				/>
			</Row>
			{placed ? (
				<BoxField title="Inset" group="inset" scale={INSET_SCALE} linked={ALL_SIDES} split={SIDES} edit={edit} />
			) : null}
			<Row label="Z-index">
				<ScaleField
					ariaLabel="Z-index"
					value={getStyle(classes, "zIndex", edit.variant)}
					mixed={mixedStyle(edit, "zIndex")}
					scale={Z_INDEX_SCALE}
					placeholder="auto"
					edit={edit}
					onChange={styleWriter(edit, "zIndex")}
				/>
			</Row>
		</Section>
	);
}

function SpacingSection({ edit }: Pick<SectionProps, "edit">) {
	return (
		<Section title="Spacing">
			<BoxField title="Padding" group="padding" scale={SPACING_SCALE} linked={AXES} split={SIDES} edit={edit} />
			<BoxField title="Margin" group="margin" scale={MARGIN_SCALE} linked={AXES} split={SIDES} edit={edit} />
		</Section>
	);
}

function SizeSection({ classes, edit }: SectionProps) {
	const size = getBox(classes, "size", edit.variant);

	const limits: [SimpleProp, string][] = [
		["minWidth", "Min W"],
		["maxWidth", "Max W"],
		["minHeight", "Min H"],
		["maxHeight", "Max H"],
	];

	const anyLimit = limits.some(([prop]) => getStyle(classes, prop, edit.variant) !== null);
	const [showLimits, setShowLimits] = useState(false);

	const writeSize = (part: string) => (value: string | null, continuous: boolean) =>
		edit.apply(
			(classes) => setBoxParts(classes, "size", [part], value, edit.variant),
			continuous ? `size:${part}` : undefined,
		);

	return (
		<Section
			title="Size"
			action={
				anyLimit || showLimits ? null : (
					<Button
						variant="ghost"
						size="xs"
						className="-mr-1.5 h-5 text-subtle-foreground"
						disabled={edit.disabled}
						onClick={() => setShowLimits(true)}
					>
						<Plus />
						Min/max
					</Button>
				)
			}
		>
			<div className="grid grid-cols-2 gap-2">
				<ScaleField
					label="W"
					ariaLabel="Width"
					value={size.width ?? null}
					mixed={isMixed(edit, (own) => getBox(own, "size", edit.variant).width ?? null)}
					scale={SIZE_SCALE}
					edit={edit}
					onChange={writeSize("width")}
				/>
				<ScaleField
					label="H"
					ariaLabel="Height"
					value={size.height ?? null}
					mixed={isMixed(edit, (own) => getBox(own, "size", edit.variant).height ?? null)}
					scale={SIZE_SCALE}
					edit={edit}
					onChange={writeSize("height")}
				/>
				{anyLimit || showLimits
					? limits.map(([prop, label]) => (
							<ScaleField
								key={prop}
								label={label}
								ariaLabel={label}
								value={getStyle(classes, prop, edit.variant)}
								mixed={mixedStyle(edit, prop)}
								scale={MAX_SIZE_SCALE}
								edit={edit}
								onChange={styleWriter(edit, prop)}
							/>
						))
					: null}
			</div>
		</Section>
	);
}

/** `text-sm/6` carries a line height: the size and its `/6` */
function fontSizeOf(classes: string, variant: string) {
	const fontSize = getStyle(classes, "fontSize", variant);

	return fontSize === null ? [null, null] : splitModifier(fontSize);
}

function TypographySection({ classes, edit }: SectionProps) {
	const [sizeValue, lineModifier] = fontSizeOf(classes, edit.variant);
	const align = getStyle(classes, "textAlign", edit.variant);

	return (
		<Section title="Typography">
			<Row label="Font">
				<SelectField
					label="Font family"
					value={getStyle(classes, "fontFamily", edit.variant)}
					mixed={mixedStyle(edit, "fontFamily")}
					options={[...FONT_FAMILY_OPTIONS, ...tokenOptions(edit.tokens, "font")]}
					placeholder="Sans"
					edit={edit}
					onChange={styleWriter(edit, "fontFamily")}
				/>
			</Row>
			<Row label="Size">
				<ScaleField
					ariaLabel="Font size"
					value={sizeValue}
					mixed={isMixed(edit, (own) => fontSizeOf(own, edit.variant)[0])}
					scale={withTokens(FONT_SIZE_SCALE, edit.tokens, "text")}
					edit={edit}
					onChange={(value, continuous) =>
						edit.apply(
							(own) => {
								// Keep the element's line height when picking another size
								const modifier = fontSizeOf(own, edit.variant)[1];

								return setStyle(
									own,
									"fontSize",
									value === null ? null : modifier ? `${value}/${modifier}` : value,
									edit.variant,
								);
							},
							continuous ? "fontSize" : undefined,
						)
					}
				/>
			</Row>
			<Row label="Weight">
				<SelectField
					label="Font weight"
					value={getStyle(classes, "fontWeight", edit.variant)}
					mixed={mixedStyle(edit, "fontWeight")}
					options={FONT_WEIGHT_SCALE.options}
					edit={edit}
					onChange={styleWriter(edit, "fontWeight")}
				/>
			</Row>
			<Row label="Line height">
				<ScaleField
					ariaLabel="Line height"
					value={getStyle(classes, "lineHeight", edit.variant) ?? lineModifier}
					mixed={isMixed(edit, (own) => getStyle(own, "lineHeight", edit.variant) ?? fontSizeOf(own, edit.variant)[1])}
					scale={LINE_HEIGHT_SCALE}
					edit={edit}
					onChange={(value, continuous) =>
						edit.apply(
							(own) => {
								// A `leading-*` class takes over from the size's `/6`
								const next = setStyle(own, "lineHeight", value, edit.variant);
								const [size, modifier] = fontSizeOf(own, edit.variant);

								return modifier ? setStyle(next, "fontSize", size, edit.variant) : next;
							},
							continuous ? "lineHeight" : undefined,
						)
					}
				/>
			</Row>
			<Row label="Tracking">
				<ScaleField
					ariaLabel="Letter spacing"
					value={getStyle(classes, "letterSpacing", edit.variant)}
					mixed={mixedStyle(edit, "letterSpacing")}
					scale={LETTER_SPACING_SCALE}
					edit={edit}
					onChange={styleWriter(edit, "letterSpacing")}
				/>
			</Row>
			<Row label="Align">
				<Segmented
					label="Text align"
					value={align}
					options={TEXT_ALIGN_OPTIONS}
					disabled={edit.disabled}
					onChange={(value) => edit.apply((classes) => setStyle(classes, "textAlign", value, edit.variant))}
				/>
			</Row>
			<Row label="Color">
				<ColorField
					label="Text color"
					value={getStyle(classes, "textColor", edit.variant)}
					mixed={mixedStyle(edit, "textColor")}
					edit={edit}
					onPick={(value, field) =>
						edit.apply((classes) => setStyle(classes, "textColor", value, edit.variant), field && `text:${field}`)
					}
				/>
			</Row>
		</Section>
	);
}

function BorderSection({ classes, edit }: SectionProps) {
	const width = getBox(classes, "borderWidth", edit.variant);
	// A state can recolor a border that Default draws
	const hasBorder = [width, getBox(classes, "borderWidth")].some((box) => Object.values(box).some((v) => v !== null));

	return (
		<Section title="Border">
			<BoxField
				title="Radius"
				group="borderRadius"
				scale={withTokens(RADIUS_SCALE, edit.tokens, "radius")}
				linked={ALL_CORNERS}
				split={CORNERS}
				edit={edit}
			/>
			<BoxField
				title="Width"
				group="borderWidth"
				scale={BORDER_WIDTH_SCALE}
				linked={ALL_SIDES}
				split={SIDES}
				edit={edit}
			/>
			{hasBorder ? (
				<>
					<Row label="Color">
						<ColorField
							label="Border color"
							value={getStyle(classes, "borderColor", edit.variant)}
							mixed={mixedStyle(edit, "borderColor")}
							edit={edit}
							onPick={(value, field) =>
								edit.apply(
									(classes) => setStyle(classes, "borderColor", value, edit.variant),
									field && `border:${field}`,
								)
							}
						/>
					</Row>
					<Row label="Style">
						<SelectField
							label="Border style"
							value={getStyle(classes, "borderStyle", edit.variant)}
							mixed={mixedStyle(edit, "borderStyle")}
							options={BORDER_STYLE_OPTIONS}
							placeholder="solid"
							edit={edit}
							onChange={styleWriter(edit, "borderStyle")}
						/>
					</Row>
				</>
			) : null}
		</Section>
	);
}

function EffectsSection({ classes, edit }: SectionProps) {
	return (
		<Section title="Effects">
			<Row label="Opacity">
				<ScaleField
					ariaLabel="Opacity"
					value={getStyle(classes, "opacity", edit.variant)}
					mixed={mixedStyle(edit, "opacity")}
					scale={OPACITY_SCALE}
					placeholder="100"
					edit={edit}
					onChange={styleWriter(edit, "opacity")}
				/>
			</Row>
			<Row label="Shadow">
				<SelectField
					label="Shadow"
					value={getStyle(classes, "boxShadow", edit.variant)}
					mixed={mixedStyle(edit, "boxShadow")}
					options={SHADOW_SCALE.options}
					edit={edit}
					onChange={styleWriter(edit, "boxShadow")}
				/>
			</Row>
		</Section>
	);
}

function ClassesField({ classes, edit, note }: SectionProps & { note: string | null }) {
	const [draft, setDraft] = useState<string | null>(null);
	const text = classes.replace(/\s+/g, " ").trim();

	return (
		<Section title="Classes">
			<textarea
				value={draft ?? text}
				placeholder="flex gap-2 p-4"
				disabled={edit.disabled}
				aria-label="Classes"
				spellCheck={false}
				rows={Math.min(6, Math.max(2, Math.ceil(text.length / 34)))}
				onFocus={edit.onFocus}
				onBlur={() => {
					setDraft(null);
					edit.onBlur();
				}}
				onChange={(event) => {
					// One line: a newline in a plain attribute would turn it into an expression
					const next = event.target.value.replace(/[\r\n]+/g, " ");
					setDraft(next);
					edit.apply((own) => retoken(own, text, next), "classes");
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				className="w-full min-w-0 resize-none rounded-md border bg-transparent px-2.5 py-1.5 font-mono text-[11px] leading-4 outline-none placeholder:text-subtle-foreground focus:border-ring disabled:opacity-50"
			/>
			{note ? <p className="text-xs text-subtle-foreground">{note}</p> : null}
		</Section>
	);
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<InspectorSection title={title} action={action}>
			{children}
		</InspectorSection>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex min-h-8 items-center gap-2">
			<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">{label}</span>
			<div className="flex min-w-0 flex-1 items-center">{children}</div>
		</div>
	);
}

/** Opens split when the linked fields can't show the values */
function BoxField({
	title,
	group,
	scale,
	linked,
	split,
	edit,
}: Pick<SectionProps, "edit"> & { title: string; group: BoxGroup; scale: Scale; linked: Part[]; split: Part[] }) {
	const boxes = edit.all.map((own) => getBox(own, group, edit.variant));

	/** `undefined` when the parts or the elements differ */
	const common = (parts: readonly string[]) =>
		commonValue(
			boxes.map((box) => {
				const values = parts.map((part) => box[part] ?? null);

				// A value no box part has, so differing parts never match each other
				return commonValue(values) ?? MIXED;
			}),
		);

	const mixed = linked.some((part) => common(part.parts) === undefined);
	const [splitChoice, setSplitChoice] = useState<boolean | null>(null);
	const isSplit = splitChoice ?? mixed;
	const fields = isSplit ? split : linked;

	const write = (part: Part) => (value: string | null, continuous: boolean) =>
		edit.apply(
			(classes) => setBoxParts(classes, group, part.parts, value, edit.variant),
			continuous ? `${group}:${part.parts.join(",")}` : undefined,
		);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex h-5 items-center justify-between">
				<span className="text-xs text-muted-foreground">{title}</span>
				<IconToggle
					icon={Scan}
					label={
						isSplit
							? `${title}: one value per ${group === "borderRadius" ? "corner" : "side"} (switch to linked)`
							: `${title}: set each ${group === "borderRadius" ? "corner" : "side"}`
					}
					pressed={isSplit}
					disabled={edit.disabled}
					small
					onChange={setSplitChoice}
				/>
			</div>
			<div className={cn("grid gap-2", fields.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
				{fields.map((part) => {
					const value = common(part.parts);

					return (
						<ScaleField
							key={part.label}
							label={part.label}
							ariaLabel={`${title} ${part.label || "all"}`.trim()}
							value={value === undefined || value === MIXED ? null : value}
							mixed={value === undefined || value === MIXED}
							scale={scale}
							edit={edit}
							onChange={write(part)}
						/>
					);
				})}
			</div>
		</div>
	);
}

/** Typing takes scale values, px (`16px` → `4`), CSS lengths and `[…]`; empty unsets */
function ScaleField({
	label,
	ariaLabel,
	value,
	mixed = false,
	scale,
	placeholder = "—",
	edit,
	onChange,
}: {
	label?: string;
	ariaLabel: string;
	value: string | null;
	/** The selected elements differ: shows "Mixed" */
	mixed?: boolean;
	scale: Scale;
	placeholder?: string;
	edit: Edit;
	/** `continuous` for typing, coalesced into one undo step per focus */
	onChange: (value: string | null, continuous: boolean) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const shown = value === null ? null : describeValue(value, scale);
	const invalid = draft !== null && draft.trim() !== "" && parseScaleInput(draft, scale) === null;

	const stepBy = (direction: 1 | -1) => {
		const options = scale.options;
		const index = options.findIndex((option) => option.value === value);

		const next =
			index < 0
				? value === null
					? options[direction > 0 ? 0 : options.length - 1]
					: undefined
				: options[index + direction];

		if (next) onChange(next.value, true);
	};

	return (
		<div
			className={cn(
				"flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-transparent pl-2 text-[13px] focus-within:border-ring",
				invalid && "border-destructive/60 focus-within:border-destructive/60",
				edit.disabled && "opacity-50",
			)}
		>
			{label ? <span className="shrink-0 text-xs text-subtle-foreground">{label}</span> : null}
			<input
				value={draft ?? shown?.label ?? ""}
				placeholder={mixed ? "Mixed" : placeholder}
				disabled={edit.disabled}
				aria-label={ariaLabel}
				aria-invalid={invalid || undefined}
				spellCheck={false}
				onFocus={(event) => {
					edit.onFocus();
					event.currentTarget.select();
				}}
				onBlur={() => {
					setDraft(null);
					edit.onBlur();
				}}
				onChange={(event) => {
					const text = event.target.value;
					setDraft(text);

					if (!text.trim()) onChange(null, true);
					else {
						const next = parseScaleInput(text, scale);

						if (next !== null) onChange(next, true);
					}
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
					else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						setDraft(null);
						stepBy(event.key === "ArrowUp" ? 1 : -1);
					}
				}}
				className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-subtle-foreground"
			/>
			{draft === null && shown?.hint ? (
				<span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">{shown.hint}</span>
			) : null}
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						disabled={edit.disabled}
						aria-label={`${ariaLabel} scale`}
						className="flex h-full w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
					>
						<ChevronDown className="size-3" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="max-h-72 min-w-36 overflow-y-auto">
					<ScaleMenuItems value={value} options={scale.options} onPick={(next) => onChange(next, false)} />
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function ScaleMenuItems({
	value,
	options,
	onPick,
}: {
	value: string | null;
	options: ScaleOption[];
	onPick: (value: string | null) => void;
}) {
	return (
		<>
			{/* `""` is a real value (a bare `rounded`), so "unset" needs a value no option has */}
			<DropdownMenuRadioGroup value={value ?? "\u0000"} onValueChange={onPick}>
				{options.map((option) => (
					<DropdownMenuRadioItem key={option.value} value={option.value} className="text-[13px]">
						{option.label}
						{option.hint ? (
							<span className="ml-auto pl-3 text-xs text-subtle-foreground tabular-nums">{option.hint}</span>
						) : null}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
			{value !== null ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="text-[13px]" onSelect={() => onPick(null)}>
						Clear
					</DropdownMenuItem>
				</>
			) : null}
		</>
	);
}

/** A value outside the options shows as written */
function SelectField({
	label,
	value,
	mixed = false,
	options,
	placeholder = "—",
	edit,
	onChange,
}: {
	label: string;
	value: string | null;
	mixed?: boolean;
	options: ScaleOption[];
	placeholder?: string;
	edit: Edit;
	onChange: (value: string | null, continuous: boolean) => void;
}) {
	const option = options.find((o) => o.value === value);
	const text = value === null ? (mixed ? "Mixed" : placeholder) : option ? option.label : value || "base";

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="xs"
					disabled={edit.disabled}
					aria-label={label}
					className="h-8 w-full min-w-0 justify-between gap-1 px-2.5 text-[13px] font-normal"
				>
					<span className={cn("truncate", value === null && "text-subtle-foreground")}>{text}</span>
					<span className="flex shrink-0 items-center gap-1.5">
						{option?.hint ? (
							<span className="text-[11px] text-subtle-foreground tabular-nums">{option.hint}</span>
						) : null}
						<ChevronDown className="size-3 text-muted-foreground" />
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-72 min-w-40 overflow-y-auto">
				<ScaleMenuItems value={value} options={options} onPick={(next) => onChange(next, false)} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Clicking the active option unsets it */
function Segmented({
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	label: string;
	value: string | null;
	options: { value: string; label: string; icon: LucideIcon }[];
	disabled?: boolean;
	onChange: (value: string | null) => void;
}) {
	return (
		<ToggleGroup
			type="single"
			size="sm"
			variant="outline"
			value={value ?? ""}
			disabled={disabled}
			onValueChange={(next) => onChange(next || null)}
			aria-label={label}
			className="w-full"
		>
			{options.map(({ value: option, label: text, icon: Icon }) => (
				<ToggleGroupItem
					key={option}
					value={option}
					aria-label={text}
					title={text}
					className="h-8 min-w-0 flex-1 px-1.5 text-muted-foreground"
				>
					<Icon className="size-3.5" strokeWidth={1.8} />
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function IconToggle({
	icon: Icon,
	label,
	pressed,
	disabled,
	small,
	onChange,
}: {
	icon: LucideIcon;
	label: string;
	pressed: boolean;
	disabled?: boolean;
	small?: boolean;
	onChange: (pressed: boolean) => void;
}) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			disabled={disabled}
			onClick={() => onChange(!pressed)}
			className={cn(
				"shrink-0 text-muted-foreground",
				small ? "-mr-1 size-5" : "size-8 border",
				pressed && "bg-accent text-accent-foreground",
			)}
		>
			<Icon className={small ? "size-3" : "size-3.5"} strokeWidth={1.8} />
		</Button>
	);
}

let defaultTheme: Map<string, string> | null = null;

/** The screens' default light theme: the `:root` values and the `@theme` colors that point at them */
function defaultVariables() {
	if (!defaultTheme) {
		defaultTheme = new Map();

		for (const block of [/@theme inline\s*\{([^}]*)\}/, /:root\s*\{([^}]*)\}/]) {
			const body = block.exec(SCREEN_THEME_CSS)?.[1] ?? "";

			for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) defaultTheme.set(match[1]!, match[2]!.trim());
		}
	}

	return defaultTheme;
}

type SwatchCss = (value: string) => string | null;

const swatchCache = new WeakMap<DesignTokens, SwatchCss>();

/**
 * Swatches in the applied theme's light values, then the default theme's. A custom token with only a dark value
 * shows that. `var(--primary)` references resolve, so a token pointing at another shows its color.
 */
function swatchesOf(tokens: DesignTokens): SwatchCss {
	const cached = swatchCache.get(tokens);

	if (cached) return cached;
	const defaults = defaultVariables();

	const variable = (name: string, depth = 0): string => {
		const value = tokens.light[name] ?? defaults.get(name) ?? tokens.dark[name];

		if (value === undefined) return `var(--${name})`;
		const ref = /^var\(--([\w-]+)\)$/.exec(value)?.[1];

		return ref && depth < 8 ? variable(ref, depth + 1) : value;
	};

	const swatch: SwatchCss = (value) => colorCss(value, variable);
	swatchCache.set(tokens, swatch);

	return swatch;
}

const CHECKERBOARD = "repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px";

function Swatch({ css, className }: { css: string | null; className?: string }) {
	return (
		<span
			className={cn(
				"relative inline-block shrink-0 overflow-hidden rounded-[4px] border border-black/10 dark:border-white/15",
				className,
			)}
			style={{ background: CHECKERBOARD }}
		>
			{css ? <span className="absolute inset-0" style={{ background: css }} /> : null}
		</span>
	);
}

/** `primary/50` → `primary · 50%`; `[#fff]` → `#fff`. */
function colorLabel(value: string) {
	const [base, modifier] = splitModifier(value);
	const name = base.startsWith("[") ? base.slice(1, -1).replace(/_/g, " ") : base;

	return modifier === null ? name : `${name} · ${modifier.replace(/^\[|\]$/g, "")}${/^\d+$/.test(modifier) ? "%" : ""}`;
}

/** Picking keeps the current opacity (`/50`) */
function ColorField({
	label,
	value,
	mixed = false,
	edit,
	onPick,
}: {
	label: string;
	value: string | null;
	mixed?: boolean;
	edit: Edit;
	onPick: (value: string | null, field?: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const swatch = swatchesOf(edit.tokens);
	const custom = tokenOptions(edit.tokens, "color");
	const [base, modifier] = value === null ? [null, null] : splitModifier(value);
	const withOpacity = (next: string) => (modifier === null ? next : `${next}/${modifier}`);
	const pick = (next: string) => onPick(withOpacity(next));

	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={edit.disabled}
						aria-label={label}
						className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-transparent px-2 text-left text-[13px] outline-none hover:bg-accent/50 focus-visible:border-ring disabled:opacity-50 data-[state=open]:border-ring"
					>
						<Swatch css={value === null ? null : swatch(value)} className="size-4" />
						<span className={cn("truncate", value === null && "text-subtle-foreground")} title={value ?? undefined}>
							{value === null ? (mixed ? "Mixed" : "None") : colorLabel(value)}
						</span>
					</button>
				</PopoverTrigger>
				<PopoverContent align="end" className="flex w-64 flex-col gap-3 p-3">
					<ColorGroup title="Theme">
						<div className="grid grid-cols-9 gap-1">
							{THEME_COLORS.map((token) => (
								<ColorCell
									key={token}
									value={token}
									css={swatch(token)}
									selected={base === token}
									onPick={pick}
									className="aspect-square"
								/>
							))}
						</div>
					</ColorGroup>
					{custom.length ? (
						<ColorGroup title="Project">
							<div className="grid max-h-28 grid-cols-2 gap-1 overflow-y-auto">
								{custom.map((token) => (
									<button
										key={token.value}
										type="button"
										title={`${token.value}: ${token.hint ?? "no value"}`}
										aria-pressed={base === token.value}
										onClick={() => pick(token.value)}
										className={cn(
											"flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
											base === token.value && "bg-accent text-accent-foreground",
										)}
									>
										<Swatch css={swatch(token.value)} className="size-4" />
										<span className="truncate">{token.label}</span>
									</button>
								))}
							</div>
						</ColorGroup>
					) : null}
					<ColorGroup title="Palette">
						<div className="flex max-h-44 flex-col gap-px overflow-y-auto rounded-sm">
							{Object.keys(PALETTE).map((hue) => (
								<div key={hue} className="grid grid-cols-11 gap-px">
									{PALETTE_SHADES.map((shade) => (
										<ColorCell
											key={shade}
											value={`${hue}-${shade}`}
											css={swatch(`${hue}-${shade}`)}
											selected={base === `${hue}-${shade}`}
											onPick={pick}
											className="h-4 rounded-[2px]"
										/>
									))}
								</div>
							))}
						</div>
						<div className="flex gap-1">
							{["black", "white", "transparent", "current"].map((keyword) => (
								<ColorCell
									key={keyword}
									value={keyword}
									css={swatch(keyword)}
									selected={base === keyword}
									onPick={pick}
									className="size-5"
								/>
							))}
						</div>
					</ColorGroup>
					<CustomColor value={value} base={base} modifier={modifier} onPick={onPick} edit={edit} />
				</PopoverContent>
			</Popover>
			{value !== null ? (
				<Button
					variant="ghost"
					size="icon-xs"
					className="size-8 shrink-0 text-muted-foreground"
					aria-label={`Remove ${label.toLowerCase()}`}
					title="Remove"
					disabled={edit.disabled}
					onClick={() => onPick(null)}
				>
					<X className="size-3.5" />
				</Button>
			) : null}
		</div>
	);
}

function ColorGroup({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[11px] font-medium text-subtle-foreground">{title}</span>
			{children}
		</div>
	);
}

function ColorCell({
	value,
	css,
	selected,
	onPick,
	className,
}: {
	value: string;
	css: string | null;
	selected: boolean;
	onPick: (value: string) => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			title={value}
			aria-label={value}
			aria-pressed={selected}
			onClick={() => onPick(value)}
			className={cn(
				"relative overflow-hidden rounded-[4px] border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15",
				selected && "z-10 ring-2 ring-foreground ring-offset-1 ring-offset-popover",
				className,
			)}
			style={{ background: CHECKERBOARD }}
		>
			<span className="absolute inset-0" style={{ background: css ?? undefined }} />
		</button>
	);
}

function CustomColor({
	value,
	base,
	modifier,
	edit,
	onPick,
}: {
	value: string | null;
	base: string | null;
	modifier: string | null;
	edit: Edit;
	onPick: (value: string | null, field?: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const [opacityDraft, setOpacityDraft] = useState<string | null>(null);
	const baseText = base === null ? "" : base.startsWith("[") ? base.slice(1, -1).replace(/_/g, " ") : base;
	const opacity = modifier === null ? "" : modifier.replace(/^\[|\]$/g, "");
	const invalid = draft !== null && draft.trim() !== "" && parseColorInput(draft) === null;

	const commit = () => {
		if (draft === null) return;
		const next = parseColorInput(draft);

		if (next !== null) onPick(modifier === null || next.includes("/") ? next : `${next}/${modifier}`);
		setDraft(null);
	};

	return (
		<div className="flex items-center gap-1.5">
			<input
				value={draft ?? baseText}
				placeholder="#0ea5e9, oklch(…)"
				aria-label="Custom color"
				aria-invalid={invalid || undefined}
				spellCheck={false}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
				className={cn(
					"h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-[11px] outline-none placeholder:text-subtle-foreground focus:border-ring",
					invalid && "border-destructive/60 focus:border-destructive/60",
				)}
			/>
			<label className="flex h-8 w-16 shrink-0 items-center gap-1 rounded-md border px-2 text-[13px] focus-within:border-ring">
				<input
					value={opacityDraft ?? opacity}
					placeholder="100"
					inputMode="numeric"
					aria-label="Opacity"
					disabled={value === null || edit.disabled}
					onFocus={edit.onFocus}
					onBlur={() => {
						setOpacityDraft(null);
						edit.onBlur();
					}}
					onChange={(event) => {
						const text = event.target.value.replace(/%$/, "");
						setOpacityDraft(text);

						if (base === null) return;

						if (!text.trim() || text.trim() === "100") onPick(base, "opacity");
						else if (/^\d{1,2}$/.test(text.trim())) onPick(`${base}/${Number(text)}`, "opacity");
					}}
					onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
					className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-subtle-foreground disabled:opacity-50"
				/>
				<span className="text-xs text-subtle-foreground">%</span>
			</label>
		</div>
	);
}
