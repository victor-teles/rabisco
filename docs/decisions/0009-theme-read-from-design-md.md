# 0009 · The theme is read from any DESIGN.md, with AI when it has no Tokens section

- **Status:** accepted
- **Date:** 2026-10-05
- **Code:** [`src/shared/context/theme.ts`](../../src/shared/context/theme.ts), `runThemeReading` in [`src/bun/ai/run.ts`](../../src/bun/ai/run.ts)

## Context

Screens render with an applied theme, stored as `theme` in `rabisco.json`, and Rabisco asks before DESIGN.md re-themes them. Until now the theme came only from a `## Tokens` section with `- primary: oklch(…)` lines. DESIGN.md has no standard format, though. People paste files written for other tools: prose with `{colors.primary}` references and hex values, tables of radii, font names with substitutes. Those files set no tokens, and Rabisco asked people to add a Tokens section by hand.

## Decision

**Any DESIGN.md can theme the screens. A `## Tokens` section is optional: when it has valid tokens, Rabisco uses them as they are, with no AI. Otherwise a `theme` generation task reads the tokens from the whole file.**

- **The task never writes files.** The provider gets DESIGN.md only (no screens, components or history) and replies with a `## Tokens` block in the syntax `parseDesignTokens` already reads. Every value goes through `validateToken`; unknown names and invalid values are dropped. Files the provider writes are ignored, so DESIGN.md stays as it is. A reply with no valid token is `invalid_output`.
- **The applied theme records its source.** `theme.source` is a hash of DESIGN.md's content (`contextBody`: comments and blank lines don't count). When DESIGN.md's source differs from the applied one and it has no tokens, the bar over the canvas says "DESIGN.md changed" and offers "Update theme". Older projects have no `source`, so a prose DESIGN.md offers an update once.
- **Still on request.** Reading runs only when the user clicks "Update theme". It follows the usual rule of one generation at a time and can be stopped. The result is one undo step, and the bar shows the changed colors with Undo. Results are cached by source for the session, so going back to a version of DESIGN.md doesn't read it again.

## Consequences

- Pasting a DESIGN.md from another tool themes the screens after one click. The file is never rewritten to fit Rabisco.
- Reading a theme costs one model call per DESIGN.md version. Projects that want it deterministic, or that have no AI provider, keep using a Tokens section.
- The mapping onto shadcn names (background, muted, muted-foreground…) is the model's judgment. The prompt asks for tokens the document states or implies, dark values only for a dark theme, and readable foreground pairs. The bar's swatches and Undo are the check.
