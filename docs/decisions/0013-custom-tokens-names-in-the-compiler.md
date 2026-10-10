# 0013 · Custom tokens use Tailwind namespaces; the compiler gets the names, frames get the values

- **Status:** accepted
- **Date:** 2026-10-07
- **Extends:** [0002](./0002-incremental-tailwind-in-the-host.md), [0009](./0009-theme-read-from-design-md.md)
- **Code:** [`src/shared/context/tokens.ts`](../../src/shared/context/tokens.ts), [`src/mainview/lib/render/styles.ts`](../../src/mainview/lib/render/styles.ts), [`src/mainview/lib/render/tailwind.ts`](../../src/mainview/lib/render/tailwind.ts)

## Context

DESIGN.md's `## Tokens` section could only set the shadcn names (`primary`, `muted`, `radius`…). A brand color, a card radius or a display type size had no name, so screens used raw values (`bg-[#e11d48]`) and a change meant editing every screen.

Applied tokens reach frames as a second stylesheet of CSS variables, so a value change re-themes screens with no Tailwind rebuild (0009). A new class like `bg-brand` is different: Tailwind builds it only if the compiler's `@theme` knows `--color-brand`. Putting the values in `@theme` would mean a new compiler for every value edit, and a rebuild of every frame's CSS.

## Decision

**A custom token is named with its Tailwind v4 theme namespace, so the name is the class. The compiler gets the names in a `@theme reference` block; the values stay in the theme stylesheet.**

- **Names:** `color-*` (`bg-brand`, `text-brand`), `radius-*` (`rounded-card`), `font-*` (`font-display`), `text-*` with an optional line height (`text-display: 3rem/1.1`), `spacing-*` (`p-gutter`), and `spacing` for the base step. Each kind has its own value whitelist, like the built-in tokens. Names that would shadow built-ins (`color-primary`, `radius-lg`) are invalid.
- **Compiler:** `@theme reference { --color-brand: currentcolor; }`. In reference mode Tailwind builds `bg-brand` as `var(--color-brand, currentcolor)` and emits no variables, so the theme stylesheet's value always wins. The fallback only shows in a mode with no value.
- **Values:** `tokensToCss` writes custom tokens on `:root` (their light value applies in dark mode too) and their dark values on `.dark`. A text token's line height is `--text-display--line-height`, the way Tailwind declares font sizes.
- **Rebuilds:** the webview keeps one set of custom names for the session. It only grows, like the candidate set. When `themeCss` sees a name that isn't in it, the compiler restarts once (~1.5 ms) with every known candidate, and frames get the new CSS. A value edit rebuilds nothing.
- **Export:** `index.css` gets the same `@theme reference` block, then the values, so the exported project builds the same classes with the Tailwind CLI.

## Consequences

- Adding `color-brand` in DESIGN.md makes `bg-brand` work in every open frame after one compiler restart. Editing its value is as cheap as editing `primary`.
- A removed or renamed token keeps its name in the compiler until the next app start. Its classes still build and fall back to the default, which is harmless.
- DTCG and Figma JSON stay import and export formats. DESIGN.md is still the one source of truth.
