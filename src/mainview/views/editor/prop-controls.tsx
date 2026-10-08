import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isNumber, isString } from "../../../shared/guards";
import {
	controlKind,
	effectiveValue,
	literalKind,
	UNSET,
	visibleProps,
	type Literal,
	type PropValue,
} from "@/lib/props";
import { cn } from "@/lib/utils";
import type { ComponentExport, PropSpec, PropType } from "../../../shared/components/api";

export type PropChange = {
	/** Writing the API default removes the attribute */
	spec?: PropSpec;
	/** Typing (coalesced into one undo step per focus) rather than a discrete pick */
	continuous: boolean;
};

export type PropControlsProps = {
	/** `null` shows only `extra` attributes and children */
	spec: ComponentExport | null;
	/** By prop name; missing means unset */
	values: Record<string, PropValue>;
	onChange: (name: string, value: Literal | null, change: PropChange) => void;
	/** `null` when they hold elements or code (read-only); `undefined` hides the row */
	childrenText?: string | null;
	onChildrenChange?: (text: string, change: PropChange) => void;
	/** Attributes the API doesn't declare (`className`, DOM props) */
	extra?: string[];
	onFieldFocus?: () => void;
	/** Seals the current burst as one undo step */
	onFieldBlur?: () => void;
	disabled?: boolean;
	/** After a prop's field: a picker for `src`, a screen menu for `href` */
	adornment?: (name: string) => React.ReactNode;
	/** Shows "Add attribute"; one undo step */
	onAddAttribute?: (name: string, value: Literal) => void;
};

const SEGMENTED_MAX_OPTIONS = 3;

const SEGMENTED_MAX_CHARS = 18;

function typeText(type: PropType): string {
	switch (type.kind) {
		case "enum":
			return type.options.map((option) => `"${option}"`).join(" | ");
		case "node":
			return "ReactNode";
		case "function":
		case "other":
			return type.text;
		default:
			return type.kind;
	}
}

/** `tone?: "a" | "b" = "a"` */
export const propSignature = (prop: PropSpec) =>
	`${prop.name}${prop.optional ? "?" : ""}: ${typeText(prop.type)}${prop.default !== undefined ? ` = ${JSON.stringify(prop.default)}` : ""}`;

export function PropControls({
	spec,
	values,
	onChange,
	childrenText,
	onChildrenChange,
	extra = [],
	onFieldFocus,
	onFieldBlur,
	disabled,
	adornment,
	onAddAttribute,
}: PropControlsProps) {
	const props = spec ? visibleProps(spec) : [];
	const fieldEvents = { onFocus: onFieldFocus, onBlur: onFieldBlur };
	const add = onAddAttribute ? <AddAttribute disabled={disabled} onAdd={onAddAttribute} /> : null;

	if (!props.length && !extra.length && childrenText === undefined) {
		return (
			<div className="flex flex-col gap-1.5">
				<p className="text-xs text-subtle-foreground">No props.</p>
				{add}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			{props.map((prop) => (
				<PropRow key={prop.name} label={prop.name} title={propSignature(prop)}>
					<Control
						name={prop.name}
						type={prop.type}
						spec={prop}
						value={values[prop.name] ?? UNSET}
						onChange={onChange}
						disabled={disabled}
						{...fieldEvents}
					/>
					{adornment?.(prop.name)}
				</PropRow>
			))}
			{childrenText !== undefined ? (
				<PropRow label="children" title="Text inside the component">
					{childrenText === null ? (
						<ReadOnly text="Elements or code" />
					) : (
						<TextField
							label="children"
							value={childrenText}
							placeholder="Text"
							disabled={disabled}
							onChange={(text) => onChildrenChange?.(text, { continuous: true })}
							{...fieldEvents}
						/>
					)}
				</PropRow>
			) : null}
			{extra.map((name) => {
				const value = values[name] ?? UNSET;
				const literal = value.kind === "literal" ? value.value : undefined;

				const type: PropType = { kind: literalKind(literal) };

				return (
					<PropRow key={name} label={name} title={`${name} (not declared by the component)`} subtle>
						<Control
							name={name}
							type={type}
							value={value}
							onChange={onChange}
							disabled={disabled}
							optional
							{...fieldEvents}
						/>
						{adornment?.(name)}
					</PropRow>
				);
			})}
			{add}
		</div>
	);
}

const ATTRIBUTE_NAME = /^[A-Za-z_][\w:.-]*$/;

/** An empty value writes a bare attribute (`disabled`) */
function AddAttribute({ disabled, onAdd }: { disabled?: boolean; onAdd: (name: string, value: Literal) => void }) {
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const valid = ATTRIBUTE_NAME.test(name.trim());

	const close = () => {
		setAdding(false);
		setName("");
		setValue("");
	};

	const commit = () => {
		if (!valid) return;
		onAdd(name.trim(), value === "" ? true : value);
		close();
	};

	const keys = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") commit();
		else if (event.key === "Escape") close();
	};

	if (!adding) {
		return (
			<Button
				variant="ghost"
				size="xs"
				disabled={disabled}
				onClick={() => setAdding(true)}
				className="-ml-1.5 self-start text-subtle-foreground"
			>
				<Plus />
				Add attribute
			</Button>
		);
	}

	return (
		<div
			className="flex min-h-8 items-center gap-2"
			onBlur={(event) => {
				// Leaving both fields without a name drops the row
				if (!event.currentTarget.contains(event.relatedTarget) && !name.trim()) close();
			}}
		>
			<input
				autoFocus
				value={name}
				placeholder="name"
				aria-label="Attribute name"
				aria-invalid={(name.trim() !== "" && !valid) || undefined}
				spellCheck={false}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={keys}
				className={cn(
					fieldClass,
					"w-[72px] shrink-0 font-mono text-[11px]",
					name.trim() && !valid && "border-destructive/60",
				)}
			/>
			<input
				value={value}
				placeholder="value"
				aria-label="Attribute value"
				spellCheck={false}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={keys}
				className={fieldClass}
			/>
			<Button
				variant="ghost"
				size="icon-xs"
				className="size-7 shrink-0"
				disabled={!valid}
				aria-label="Add"
				onClick={commit}
			>
				<Plus />
			</Button>
		</div>
	);
}

function PropRow({
	label,
	title,
	subtle,
	children,
}: {
	label: string;
	title: string;
	subtle?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-8 items-center gap-2">
			<span
				title={title}
				className={cn(
					"w-[72px] shrink-0 truncate text-xs",
					subtle ? "text-subtle-foreground" : "text-muted-foreground",
				)}
			>
				{label}
			</span>
			<div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
		</div>
	);
}

function Control({
	name,
	type,
	spec,
	value,
	onChange,
	onFocus,
	onBlur,
	disabled,
	optional,
}: {
	name: string;
	type: PropType;
	spec?: PropSpec;
	value: PropValue;
	onChange: PropControlsProps["onChange"];
	onFocus?: () => void;
	onBlur?: () => void;
	disabled?: boolean;
	optional?: boolean;
}) {
	const kind = controlKind(type, value);
	const current = effectiveValue(spec, value);
	const canRemove = optional ?? spec?.optional ?? true;
	const placeholder = spec?.default !== undefined ? String(spec.default) : canRemove ? "—" : "Required";
	const discrete = (next: Literal | null) => onChange(name, next, { spec, continuous: false });
	const typing = (next: Literal | null) => onChange(name, next, { spec, continuous: true });

	switch (kind) {
		case "readonly":
			return (
				<ReadOnly
					text={value.kind === "expression" ? `{${value.text}}` : spec ? typeText(spec.type) : "—"}
					code={value.kind === "expression"}
				/>
			);
		case "boolean":
			return (
				<Switch label={name} checked={current === true} disabled={disabled} onChange={(checked) => discrete(checked)} />
			);
		case "number":
			return (
				<NumberInput
					label={name}
					value={isNumber(current) && value.kind === "literal" ? current : null}
					placeholder={placeholder}
					disabled={disabled}
					onChange={(next) => typing(next === null && !canRemove ? 0 : next)}
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);
		case "enum": {
			const options = type.kind === "enum" ? type.options : [];
			const selected = isString(current) ? current : "";
			const segmented = options.length <= SEGMENTED_MAX_OPTIONS && options.join("").length <= SEGMENTED_MAX_CHARS;

			return segmented ? (
				<ToggleGroup
					type="single"
					size="sm"
					variant="outline"
					value={selected}
					disabled={disabled}
					onValueChange={(next) => next && discrete(next)}
					aria-label={name}
					className="w-full"
				>
					{options.map((option) => (
						<ToggleGroupItem key={option} value={option} className="h-7 min-w-0 flex-1 px-1.5 text-xs">
							<span className="truncate">{option}</span>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			) : (
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="xs"
							disabled={disabled}
							aria-label={name}
							className="h-7 w-full min-w-0 justify-between gap-1 px-2 text-xs font-normal"
						>
							<span className={cn("truncate", !selected && "text-subtle-foreground")}>{selected || placeholder}</span>
							<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-36">
						<DropdownMenuRadioGroup value={selected} onValueChange={discrete}>
							{options.map((option) => (
								<DropdownMenuRadioItem key={option} value={option} className="text-[13px]">
									{option}
									{option === spec?.default ? (
										<span className="ml-auto pl-3 text-xs text-subtle-foreground">default</span>
									) : null}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		default:
			return (
				<TextField
					label={name}
					value={value.kind === "literal" ? String(value.value) : ""}
					placeholder={placeholder}
					disabled={disabled}
					onChange={(text) => typing(text === "" && canRemove ? null : text)}
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);
	}
}

const fieldClass =
	"h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-subtle-foreground focus:border-ring disabled:opacity-50";

function TextField({
	label,
	value,
	placeholder,
	disabled,
	onChange,
	onFocus,
	onBlur,
}: {
	label: string;
	value: string;
	placeholder: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	onFocus?: () => void;
	onBlur?: () => void;
}) {
	// What was typed, while focused: the source may normalize it (trimmed children, a trailing space)
	const [draft, setDraft] = useState<string | null>(null);

	return (
		<input
			value={draft ?? value}
			placeholder={placeholder}
			disabled={disabled}
			aria-label={label}
			spellCheck={false}
			onFocus={onFocus}
			onBlur={() => {
				setDraft(null);
				onBlur?.();
			}}
			onChange={(event) => {
				setDraft(event.target.value);
				onChange(event.target.value);
			}}
			onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
			className={fieldClass}
		/>
	);
}

/** Tolerates partial text ("-", "") while typing; ↑/↓ step by 1 (⇧ 10) */
function NumberInput({
	label,
	value,
	placeholder,
	disabled,
	onChange,
	onFocus,
	onBlur,
}: {
	label: string;
	value: number | null;
	placeholder: string;
	disabled?: boolean;
	onChange: (value: number | null) => void;
	onFocus?: () => void;
	onBlur?: () => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);

	return (
		<input
			inputMode="decimal"
			value={draft ?? (value === null ? "" : String(value))}
			placeholder={placeholder}
			disabled={disabled}
			aria-label={label}
			onFocus={(event) => {
				onFocus?.();
				event.currentTarget.select();
			}}
			onBlur={() => {
				setDraft(null);
				onBlur?.();
			}}
			onChange={(event) => {
				const text = event.target.value;
				setDraft(text);

				if (text.trim() === "") onChange(null);
				else if (Number.isFinite(Number(text))) onChange(Number(text));
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
				else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
					const base = value ?? (Number(placeholder) || 0);
					setDraft(null);
					onChange(base + step);
				}
			}}
			className={cn(fieldClass, "tabular-nums")}
		/>
	);
}

function Switch({
	label,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
				checked ? "bg-primary" : "bg-input",
			)}
		>
			<span
				className={cn(
					"size-3 rounded-full bg-background shadow-sm transition-transform duration-150",
					checked ? "translate-x-3.5" : "translate-x-0.5",
				)}
			/>
		</button>
	);
}

function ReadOnly({ text, code }: { text: string; code?: boolean }) {
	return (
		<span
			title={text}
			className={cn("min-w-0 truncate text-xs text-subtle-foreground", code && "font-mono text-[11px]")}
		>
			{text}
		</span>
	);
}
