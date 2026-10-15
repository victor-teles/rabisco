import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	normalizeTokenName,
	parseTokenForm,
	type TokenEdit,
	type TokenForm,
	type TokenFormErrors,
} from "../../../shared/context/token-edit";
import { tokenClass, tokenKind, validateToken, type DesignTokens } from "../../../shared/context/tokens";

export const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem] items-start gap-1";

export const FIELD =
	"h-6 rounded-[5px] border-transparent bg-transparent px-1.5 font-mono text-[11px] shadow-none hover:border-input focus-visible:border-ring focus-visible:ring-0 md:text-[11px] dark:bg-transparent";

/** Enter or blur commits, Esc puts the value back. `onCommit` writes the value, or returns why it can't. */
export function TokenField({
	label,
	value,
	placeholder,
	swatch = false,
	invalid,
	onCommit,
	onError,
}: {
	label: string;
	value: string;
	placeholder?: string;
	swatch?: boolean;
	invalid: boolean;
	onCommit: (next: string) => string | null;
	onError: (reason: string | null) => void;
}) {
	const [draft, setDraft] = useState(value);
	const [shown, setShown] = useState(value);
	const cancelled = useRef(false);

	// DESIGN.md changed under the field (undo, the text editor): show the new value
	if (shown !== value) {
		setShown(value);
		setDraft(value);
	}

	const commit = () => {
		const next = draft.trim();

		if (next === value) {
			setDraft(value);
			onError(null);

			return;
		}

		const reason = onCommit(next);

		if (!reason) setDraft(value);
		onError(reason);
	};

	return (
		<div className="relative min-w-0">
			{swatch && value ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
					style={{ background: value }}
				/>
			) : null}
			<Input
				value={draft}
				placeholder={placeholder}
				aria-label={label}
				aria-invalid={invalid && draft !== value ? true : undefined}
				title={draft || placeholder}
				spellCheck={false}
				autoComplete="off"
				className={cn(FIELD, swatch && value && "pl-6", "placeholder:text-subtle-foreground")}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (cancelled.current) cancelled.current = false;
					else commit();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						cancelled.current = true;
						setDraft(value);
						onError(null);
						event.currentTarget.blur();
					}
				}}
			/>
		</div>
	);
}

const EMPTY_FORM: TokenForm = { name: "", light: "", dark: "" };

/** Enter adds, Esc closes */
export function AddTokenForm({
	tokens,
	example = { name: "color-brand", light: "Light" },
	onAdd,
	onClose,
}: {
	tokens: DesignTokens;
	/** Placeholders for the name and light value */
	example?: { name: string; light: string };
	onAdd: (edit: TokenEdit) => void;
	onClose: () => void;
}) {
	const [form, setForm] = useState<TokenForm>(EMPTY_FORM);
	const [errors, setErrors] = useState<TokenFormErrors>({});
	const name = normalizeTokenName(form.name);
	const color = tokenKind(name) === "color";
	const messages = [errors.name, errors.light, errors.dark].filter((message) => message !== undefined);

	const submit = () => {
		const parsed = parseTokenForm(form, tokens);

		if (parsed.edit) onAdd(parsed.edit);
		else setErrors(parsed.errors);
	};

	const field = (key: keyof TokenForm, placeholder: string) => {
		const value = form[key].trim();
		const showSwatch = key !== "name" && color && value !== "" && validateToken(name, value) === null;

		return (
			<div className="relative min-w-0">
				{showSwatch ? (
					<span
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
						style={{ background: value }}
					/>
				) : null}
				<Input
					value={form[key]}
					placeholder={placeholder}
					aria-label={`New token ${key === "name" ? "name" : `${key} value`}`}
					aria-invalid={errors[key] ? true : undefined}
					autoFocus={key === "name"}
					spellCheck={false}
					autoComplete="off"
					className={cn(FIELD, "border-input placeholder:text-subtle-foreground", showSwatch && "pl-6")}
					onChange={(event) => {
						setForm({ ...form, [key]: event.target.value });
						setErrors({ ...errors, [key]: undefined });
					}}
				/>
			</div>
		);
	};

	return (
		<form
			role="listitem"
			aria-label="Add token"
			className="flex flex-col py-1"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
			}}
		>
			<div className={ROW}>
				{field("name", example.name)}
				{field("light", example.light)}
				{field("dark", "Dark")}
				<Button type="submit" variant="ghost" size="icon-xs" aria-label="Add token" title="Add token (Enter)">
					<Check />
				</Button>
			</div>
			{name && !errors.name && tokenClass(name) ? (
				<span className="px-1.5 pt-0.5 font-mono text-[10px] text-subtle-foreground">{tokenClass(name)}</span>
			) : null}
			{messages.map((message) => (
				<p key={message} className="px-1.5 pt-0.5 text-[11px]/4 text-pretty text-destructive">
					{message}
				</p>
			))}
		</form>
	);
}
