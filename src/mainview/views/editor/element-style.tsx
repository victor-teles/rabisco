/**
 * Design tab: style controls for the selected element (Phase 6), read from and
 * written back to its Tailwind `className` through the class model in
 * `src/shared/tailwind/classes.ts`. Layout, spacing, size, type, fill, border
 * and effects edit unprefixed classes only (`md:`, `hover:`… stay as written),
 * and a raw "Classes" field is the escape hatch. A computed `className`
 * (`{styles.card}`, `{`p-4 ${x}`}`) shows read-only.
 *
 * Wiring, under the element props panel (node-props.tsx):
 *
 * ```tsx
 * <ElementStyle
 * 	source={source}
 * 	start={start}
 * 	disabled={structure.busy}
 * 	onChange={(next, step) => editFile(file, () => next, step)}
 * 	onFieldFocus={() => {}}
 * 	onFieldBlur={onEndStep}
 * />
 * ```
 *
 * `onChange` gets the whole new source of the file; `step` is set for typing
 * (one undo step per field focus, sealed by `onFieldBlur`) and unset for
 * discrete picks (menus, toggles, swatches), which are one step each.
 */

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
import { cn } from "@/lib/utils";
import { findElement, parseJsx } from "../../../shared/jsx";
import {
	BORDER_WIDTH_SCALE,
	classNameOf,
	colorCss,
	describeValue,
	FONT_SIZE_SCALE,
	FONT_WEIGHT_SCALE,
	getBox,
	getStyle,
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
	setStyle,
	SHADOW_SCALE,
	SIZE_SCALE,
	SPACING_SCALE,
	splitModifier,
	THEME_COLORS,
	type BoxGroup,
	type Scale,
	type ScaleOption,
	type SimpleProp,
} from "../../../shared/tailwind/classes";

export type ElementStyleProps = {
	/** The file's source */
	source: string;
	/** The selected element's start offset in `source` */
	start: number;
	/** A generation runs: controls are read-only */
	disabled?: boolean;
	/** The new source of the file; `step` coalesces a typing burst into one undo step */
	onChange: (nextSource: string, step?: string) => void;
	/** A text field took focus: a new undo burst starts */
	onFieldFocus?: () => void;
	/** A text field lost focus: its burst is one finished step */
	onFieldBlur?: () => void;
};

/** Elements with no content to lay out or no text to style. */
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

/** Field events plus the change to write, shared by every control. */
type Edit = {
	/** Writes new classes; `field` set for typing (coalesced per focus) */
	apply: (classes: string, field?: string) => void;
	onFocus: () => void;
	onBlur: () => void;
	disabled?: boolean;
};

export function ElementStyle({ source, start, disabled, onChange, onFieldFocus, onFieldBlur }: ElementStyleProps) {
	const burst = useRef(0);
	const element = findElement(parseJsx(source), start);

	if (!element || element.name === null) return null;
	const info = classNameOf(source, element);
	const tag = element.intrinsic ? element.name : null;

	const edit: Edit = {
		apply: (classes, field) => {
			const next = setClassName(source, start, classes);

			if (next !== null && next !== source)
				onChange(next, field ? `style:${start}:${field}:${burst.current}` : undefined);
		},
		onFocus: () => {
			burst.current += 1;
			onFieldFocus?.();
		},
		onBlur: () => onFieldBlur?.(),
		disabled,
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

	const classes = info.classes;
	const replaced = tag !== null && REPLACED.has(tag);
	const hasLayout = !replaced && !(tag !== null && FORM_FIELDS.has(tag));
	const hasText = !replaced;

	return (
		<div className="flex flex-col gap-4 border-b p-4" key={start}>
			{hasLayout ? <LayoutSection classes={classes} edit={edit} /> : null}
			<SpacingSection classes={classes} edit={edit} />
			<SizeSection classes={classes} edit={edit} />
			{hasText ? <TypographySection classes={classes} edit={edit} /> : null}
			<Section title="Fill">
				<ColorField
					label="Background"
					value={getStyle(classes, "backgroundColor")}
					edit={edit}
					onPick={(value, field) => edit.apply(setStyle(classes, "backgroundColor", value), field && `bg:${field}`)}
				/>
			</Section>
			<BorderSection classes={classes} edit={edit} />
			<EffectsSection classes={classes} edit={edit} />
			<ClassesField
				classes={classes}
				edit={edit}
				note={tag === null ? `Passed to ${element.name} as its className.` : null}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sections

type SectionProps = { classes: string; edit: Edit };

/** Writes one-class property `prop`: typed values coalesce under the property's name. */
const styleWriter = (classes: string, edit: Edit, prop: SimpleProp) => (value: string | null, continuous: boolean) =>
	edit.apply(setStyle(classes, prop, value), continuous ? prop : undefined);

function LayoutSection({ classes, edit }: SectionProps) {
	const display = getStyle(classes, "display");
	const flex = display === "flex" || display === "inline-flex";
	const grid = display === "grid" || display === "inline-grid";
	const direction = getStyle(classes, "flexDirection");
	const wrap = getStyle(classes, "flexWrap");

	return (
		<Section title="Layout">
			<Row label="Display">
				<SelectField
					label="Display"
					value={display}
					options={DISPLAY_OPTIONS}
					edit={edit}
					onChange={styleWriter(classes, edit, "display")}
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
							// `flex-row` is the default: picking it again removes the class
							onChange={(value) =>
								edit.apply(setStyle(classes, "flexDirection", value === "row" || value === null ? null : value))
							}
						/>
						<IconToggle
							icon={WrapText}
							label={wrap === "wrap" ? "Wrapping (flex-wrap)" : "Wrap (flex-wrap)"}
							pressed={wrap === "wrap"}
							disabled={edit.disabled}
							onChange={(pressed) => edit.apply(setStyle(classes, "flexWrap", pressed ? "wrap" : null))}
						/>
					</div>
				</Row>
			) : null}
			{flex || grid ? (
				<>
					<Row label="Justify">
						<SelectField
							label="Justify content"
							value={getStyle(classes, "justifyContent")}
							options={JUSTIFY_OPTIONS}
							edit={edit}
							onChange={styleWriter(classes, edit, "justifyContent")}
						/>
					</Row>
					<Row label="Align">
						<SelectField
							label="Align items"
							value={getStyle(classes, "alignItems")}
							options={ALIGN_OPTIONS}
							edit={edit}
							onChange={styleWriter(classes, edit, "alignItems")}
						/>
					</Row>
					<BoxField
						title="Gap"
						group="gap"
						classes={classes}
						scale={SPACING_SCALE}
						linked={GAP_ALL}
						split={GAP_AXES}
						edit={edit}
					/>
				</>
			) : null}
		</Section>
	);
}

function SpacingSection({ classes, edit }: SectionProps) {
	return (
		<Section title="Spacing">
			<BoxField
				title="Padding"
				group="padding"
				classes={classes}
				scale={SPACING_SCALE}
				linked={AXES}
				split={SIDES}
				edit={edit}
			/>
			<BoxField
				title="Margin"
				group="margin"
				classes={classes}
				scale={MARGIN_SCALE}
				linked={AXES}
				split={SIDES}
				edit={edit}
			/>
		</Section>
	);
}

function SizeSection({ classes, edit }: SectionProps) {
	const size = getBox(classes, "size");

	const limits: [SimpleProp, string][] = [
		["minWidth", "Min W"],
		["maxWidth", "Max W"],
		["minHeight", "Min H"],
		["maxHeight", "Max H"],
	];

	const anyLimit = limits.some(([prop]) => getStyle(classes, prop) !== null);
	const [showLimits, setShowLimits] = useState(false);

	const writeSize = (part: string) => (value: string | null, continuous: boolean) =>
		edit.apply(setBoxParts(classes, "size", [part], value), continuous ? `size:${part}` : undefined);

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
					scale={SIZE_SCALE}
					edit={edit}
					onChange={writeSize("width")}
				/>
				<ScaleField
					label="H"
					ariaLabel="Height"
					value={size.height ?? null}
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
								value={getStyle(classes, prop)}
								scale={MAX_SIZE_SCALE}
								edit={edit}
								onChange={styleWriter(classes, edit, prop)}
							/>
						))
					: null}
			</div>
		</Section>
	);
}

function TypographySection({ classes, edit }: SectionProps) {
	const fontSize = getStyle(classes, "fontSize");
	// `text-sm/6` carries a line height: keep it when picking another size
	const [sizeValue, lineModifier] = fontSize === null ? [null, null] : splitModifier(fontSize);
	const align = getStyle(classes, "textAlign");

	return (
		<Section title="Typography">
			<Row label="Size">
				<ScaleField
					ariaLabel="Font size"
					value={sizeValue}
					scale={FONT_SIZE_SCALE}
					edit={edit}
					onChange={(value, continuous) =>
						edit.apply(
							setStyle(classes, "fontSize", value === null ? null : lineModifier ? `${value}/${lineModifier}` : value),
							continuous ? "fontSize" : undefined,
						)
					}
				/>
			</Row>
			<Row label="Weight">
				<SelectField
					label="Font weight"
					value={getStyle(classes, "fontWeight")}
					options={FONT_WEIGHT_SCALE.options}
					edit={edit}
					onChange={styleWriter(classes, edit, "fontWeight")}
				/>
			</Row>
			<Row label="Line height">
				<ScaleField
					ariaLabel="Line height"
					value={getStyle(classes, "lineHeight") ?? lineModifier}
					scale={LINE_HEIGHT_SCALE}
					edit={edit}
					onChange={(value, continuous) => {
						// A `leading-*` class takes over from the size's `/6`
						const next = setStyle(classes, "lineHeight", value);
						edit.apply(
							lineModifier ? setStyle(next, "fontSize", sizeValue) : next,
							continuous ? "lineHeight" : undefined,
						);
					}}
				/>
			</Row>
			<Row label="Tracking">
				<ScaleField
					ariaLabel="Letter spacing"
					value={getStyle(classes, "letterSpacing")}
					scale={LETTER_SPACING_SCALE}
					edit={edit}
					onChange={styleWriter(classes, edit, "letterSpacing")}
				/>
			</Row>
			<Row label="Align">
				<Segmented
					label="Text align"
					value={align}
					options={TEXT_ALIGN_OPTIONS}
					disabled={edit.disabled}
					onChange={(value) => edit.apply(setStyle(classes, "textAlign", value))}
				/>
			</Row>
			<Row label="Color">
				<ColorField
					label="Text color"
					value={getStyle(classes, "textColor")}
					edit={edit}
					onPick={(value, field) => edit.apply(setStyle(classes, "textColor", value), field && `text:${field}`)}
				/>
			</Row>
		</Section>
	);
}

function BorderSection({ classes, edit }: SectionProps) {
	const width = getBox(classes, "borderWidth");
	const hasBorder = Object.values(width).some((value) => value !== null);

	return (
		<Section title="Border">
			<BoxField
				title="Radius"
				group="borderRadius"
				classes={classes}
				scale={RADIUS_SCALE}
				linked={ALL_CORNERS}
				split={CORNERS}
				edit={edit}
			/>
			<BoxField
				title="Width"
				group="borderWidth"
				classes={classes}
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
							value={getStyle(classes, "borderColor")}
							edit={edit}
							onPick={(value, field) => edit.apply(setStyle(classes, "borderColor", value), field && `border:${field}`)}
						/>
					</Row>
					<Row label="Style">
						<SelectField
							label="Border style"
							value={getStyle(classes, "borderStyle")}
							options={BORDER_STYLE_OPTIONS}
							placeholder="solid"
							edit={edit}
							onChange={styleWriter(classes, edit, "borderStyle")}
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
					value={getStyle(classes, "opacity")}
					scale={OPACITY_SCALE}
					placeholder="100"
					edit={edit}
					onChange={styleWriter(classes, edit, "opacity")}
				/>
			</Row>
			<Row label="Shadow">
				<SelectField
					label="Shadow"
					value={getStyle(classes, "boxShadow")}
					options={SHADOW_SCALE.options}
					edit={edit}
					onChange={styleWriter(classes, edit, "boxShadow")}
				/>
			</Row>
		</Section>
	);
}

/** Every class, as text: the escape hatch for what the controls don't cover. */
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
					edit.apply(next, "classes");
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

// ---------------------------------------------------------------------------
// Layout primitives

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex h-5 items-center justify-between">
				<h3 className="text-xs font-medium text-subtle-foreground">{title}</h3>
				{action}
			</div>
			{children}
		</section>
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

// ---------------------------------------------------------------------------
// Controls

/**
 * A box group (padding, radius…) as linked fields (X and Y, or one value) or
 * one field per side or corner. It opens split when the linked fields can't
 * show the values, and the toggle switches by hand.
 */
function BoxField({
	title,
	group,
	classes,
	scale,
	linked,
	split,
	edit,
}: SectionProps & { title: string; group: BoxGroup; scale: Scale; linked: Part[]; split: Part[] }) {
	const box = getBox(classes, group);

	const common = (parts: readonly string[]) => {
		const values = parts.map((part) => box[part] ?? null);

		return values.every((value) => value === values[0]) ? values[0]! : undefined;
	};

	const mixed = linked.some((part) => common(part.parts) === undefined);
	const [splitChoice, setSplitChoice] = useState<boolean | null>(null);
	const isSplit = splitChoice ?? mixed;
	const fields = isSplit ? split : linked;

	const write = (part: Part) => (value: string | null, continuous: boolean) =>
		edit.apply(
			setBoxParts(classes, group, part.parts, value),
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
							value={value ?? null}
							placeholder={value === undefined ? "Mixed" : "—"}
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

/**
 * Text field for a scale value with the Tailwind scale in a menu (`4 · 16px`).
 * Typing takes scale values, px (`16px` → `4`), CSS lengths and `[…]`; empty
 * unsets. ↑/↓ step along the scale.
 */
function ScaleField({
	label,
	ariaLabel,
	value,
	scale,
	placeholder = "—",
	edit,
	onChange,
}: {
	label?: string;
	ariaLabel: string;
	value: string | null;
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
				placeholder={placeholder}
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

/** Radio items for a scale (`label · hint`), plus "Clear" when set. */
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

/** A menu of fixed choices (display, weight, shadow…); a value outside them shows as written. */
function SelectField({
	label,
	value,
	options,
	placeholder = "—",
	edit,
	onChange,
}: {
	label: string;
	value: string | null;
	options: ScaleOption[];
	placeholder?: string;
	edit: Edit;
	onChange: (value: string | null, continuous: boolean) => void;
}) {
	const option = options.find((o) => o.value === value);
	const text = value === null ? placeholder : option ? option.label : value || "base";

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

/** Icon toggles for a few choices; clicking the active one unsets it. */
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

// ---------------------------------------------------------------------------
// Colors

let themeColors: Map<string, string> | null = null;

/** A theme token's color in the screens' default (light) theme, for swatches. */
function tokenColor(name: string): string {
	if (!themeColors) {
		themeColors = new Map();
		const root = /:root\s*\{([^}]*)\}/.exec(SCREEN_THEME_CSS)?.[1] ?? "";

		for (const match of root.matchAll(/--([\w-]+):\s*([^;]+);/g)) themeColors.set(match[1]!, match[2]!.trim());
	}

	return themeColors.get(name) ?? `var(--${name})`;
}

const swatchCss = (value: string) => colorCss(value, tokenColor);

/** Transparent shows as a checkerboard under the color. */
const CHECKERBOARD = "repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px";

function Swatch({ value, className }: { value: string | null; className?: string }) {
	const css = value === null ? null : swatchCss(value);

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

/**
 * A color property: a swatch button opening the theme tokens, then the
 * palette, then a field for any CSS color and the opacity. Picking keeps the
 * current opacity (`/50`).
 */
function ColorField({
	label,
	value,
	edit,
	onPick,
}: {
	label: string;
	value: string | null;
	edit: Edit;
	onPick: (value: string | null, field?: string) => void;
}) {
	const [open, setOpen] = useState(false);
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
						<Swatch value={value} className="size-4" />
						<span className={cn("truncate", value === null && "text-subtle-foreground")} title={value ?? undefined}>
							{value === null ? "None" : colorLabel(value)}
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
									selected={base === token}
									onPick={pick}
									className="aspect-square"
								/>
							))}
						</div>
					</ColorGroup>
					<ColorGroup title="Palette">
						<div className="flex max-h-44 flex-col gap-px overflow-y-auto rounded-sm">
							{Object.keys(PALETTE).map((hue) => (
								<div key={hue} className="grid grid-cols-11 gap-px">
									{PALETTE_SHADES.map((shade) => (
										<ColorCell
											key={shade}
											value={`${hue}-${shade}`}
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
								<ColorCell key={keyword} value={keyword} selected={base === keyword} onPick={pick} className="size-5" />
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
	selected,
	onPick,
	className,
}: {
	value: string;
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
			<span className="absolute inset-0" style={{ background: swatchCss(value) ?? undefined }} />
		</button>
	);
}

/** Any CSS color (`#0ea5e9`, `oklch(…)`, a token name) and the opacity modifier. */
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
