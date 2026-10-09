# 0014 · Screens can import uai blocks as `@/components/ui/uai/<name>`; the screen theme carries their extra tokens

- **Status:** accepted
- **Date:** 2026-10-07
- **Extends:** [0002](./0002-incremental-tailwind-in-the-host.md), [0009](./0009-theme-read-from-design-md.md)
- **Code:** [`src/shared/components/ui-modules.ts`](../../src/shared/components/ui-modules.ts), [`src/mainview/runtime/externals.ts`](../../src/mainview/runtime/externals.ts), [`src/mainview/lib/render/theme.ts`](../../src/mainview/lib/render/theme.ts), [`src/mainview/lib/render/styles.ts`](../../src/mainview/lib/render/styles.ts)

## Context

Screens could only import shadcn primitives. AI apps and SaaS screens rebuilt metric cards, banners, steppers, search fields and chat messages from raw elements on every generation. The uai registry has these as composed blocks, and some already live in `src/mainview/components/ui/uai/` for the editor.

The blocks use more than the shadcn theme: `subtle-foreground` and `border-strong` colors, an `ease-out-quint` curve, a few animations and a `shimmer-text` utility. DESIGN.md has no tokens for them.

## Decision

**A block is a UI module like a primitive, named by its path: `@/components/ui/uai/metric-card` is `uai/metric-card` in `UI_MODULES`. Only listed blocks reach frames; editor blocks stay out.**

- **One list:** `UI_MODULES` names the blocks and the parts screens may import. The frame externals, the prompt, validation, the component library and the outline all key on it, and tests keep it in sync with `externals.ts` and the sources.
- **Vetting:** a block goes in only if it imports nothing but React, lucide, `class-variance-authority`, other UI modules and `@/lib/uai-utils`, styles itself with theme variables, and touches only its own frame's `window` and `document`.
- **Classes:** the screen Tailwind build scans the source of every UI module screens can import, blocks included, so their classes exist before any screen uses them.
- **Theme:** the screen theme adds the blocks' motion and `shimmer-text`, and derives `--subtle-foreground` and `--border-strong` from `muted-foreground`, `border`, `foreground` and `background` with `color-mix`. A DESIGN.md theme re-themes the blocks with no new tokens.
- **Export:** a block's source is copied to `src/components/ui/uai/`, with the primitives it imports and `src/lib/uai-utils.ts`.

## Consequences

- The model gets the blocks in the module list with a one-line composition hint each. `PROMPT_VERSION` went to 11.
- A new block is one entry in `UI_MODULES` and one in `externals.ts`. The tests fail until both match its exports.
- The runtime bundle grows by the blocks' code. They share the primitives and icons it already has.
- The derived colors follow the theme but can't be set on their own. If a project needs that, they become DESIGN.md tokens in a later record.
