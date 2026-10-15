# 0044 · Token tools rewrite the token's uses in the source; shadows, font weights and text styles are token kinds

- **Status:** proposed
- **Date:** 2026-10-14
- **Extends:** [0013](./0013-custom-tokens-names-in-the-compiler.md), [0006](./0006-components-from-source.md), [0009](./0009-theme-read-from-design-md.md)
- **Code:** [`src/shared/context/token-usage.ts`](../../src/shared/context/token-usage.ts), [`src/shared/context/design-system.ts`](../../src/shared/context/design-system.ts), [`src/shared/context/token-import.ts`](../../src/shared/context/token-import.ts), [`src/shared/context/tokens.ts`](../../src/shared/context/tokens.ts), [`src/mainview/views/editor/design-system-dialog.tsx`](../../src/mainview/views/editor/design-system-dialog.tsx)

## Context

Phase 14 made DESIGN.md's `## Tokens` the one place for tokens, with the name as the class (0013). Managing them still needed the code view. A rename left every `bg-brand` pointing at a name that no longer had a value. A delete gave no warning. Nothing found the `bg-[#e11d48]` that should have been `bg-brand`. Shadows, font weights and named type styles had no token at all.

## Decision

**A token change is one undo step over DESIGN.md and the screen and component files that use it. Uses are found in the class strings of the source, like the other component tools (0006).**

- **Uses:** a class reads a token when its prefix takes that kind and its value is the token's name: `hover:bg-brand/50`, `rounded-t-card`, `-mt-gutter`, `text-heading`, `shadow-card`. `var(--color-brand)` counts too. `rounded-sm` to `rounded-xl` count as uses of `radius`. Only `screens/` and `components/` are read.
- **Rename** rewrites those classes and `var()` references, keeping variants, `!` and modifiers. A rename to another kind changes only DESIGN.md. `radius` keeps its classes, because no other token sets `rounded-sm` to `rounded-xl`.
- **Delete** with uses asks first. "Detach and delete" writes the value into each use (`bg-[#e11d48]`; a color with its own dark value also gets `dark:bg-[…]`). "Delete only" leaves the classes, which fall back as 0013 says.
- **Raw values:** arbitrary values and Tailwind palette colors that equal a token's light value (colors compared in sRGB, lengths in px) are listed and replaced in one step. When two tokens share a value, `text-*` prefers a `-foreground` color and other prefixes prefer the other one. White, black and the built-in spacing and radius scales are left alone, since they are not wrong.
- **New kinds:** `shadow-*` (`shadow-card`) and `font-weight-*` (`font-heavy`). A shadow's `@theme reference` value is `var(--shadow-card, 0 0 #0000)`, because Tailwind writes a shadow's value into the class instead of reading the variable. Tailwind's own scale names (`shadow-sm`, `font-bold`) are invalid, and a family and a weight can't share a class.
- **Text styles** are `text-*` tokens that can also carry a weight and tracking: `text-heading: 2rem/1.2 600 -0.01em`. Tailwind's `--text-*--font-weight` and `--text-*--letter-spacing` make `text-heading` one class for all four. The inspector shows a project's text styles as a Style row. Picking one removes the element's own size, line height, weight and tracking in that state. Detach writes them back as arbitrary classes. A text style has no font family, because Tailwind's font size has no place for one.
- **Import** reads DTCG 2025 (object colors and dimensions, `$type` inherited from groups, `{group.token}` references, shadows, typography), Figma's Variables REST reply (the default mode is light, a mode named Dark is dark, aliases are followed, and floats need a name like radius or spacing to have a kind), pasted CSS and tweakcn links. A tweakcn theme link reads `tweakcn.com/r/themes/<id>.json`. DESIGN.md stays the source of truth (0013).

## Consequences

- A team can manage tokens without the code view. Every change, including one that rewrites 40 files, is one ⌘Z.
- Matching is textual. A class built at runtime (`` `bg-${tone}` ``) is not found and not rewritten. Prose in a string literal that looks like a class (`"bg-brand"`) is rewritten.
- Raw value matching is exact. A near miss (`#e11d49`) is not offered. That is deliberate: replacing it would change the screen.
- An imported Figma float with no telling name, like `Opacity` or `Spacing/4`, is skipped, as is a numeric name that Tailwind's own scale already uses.
