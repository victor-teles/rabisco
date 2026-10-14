# 0042 · Copy to Figma ships an Inter symbols subset for arrows and UI symbols

- **Status:** accepted
- **Date:** 2026-10-14
- **Extends:** [0041](./0041-copy-to-figma-draws-text-from-shipped-inter.md)

## Context

0041 ships the fontsource Inter `latin` and `latin-ext` files. They have no arrows: "→" (U+2192) is in no fontsource Inter subset. UI copy uses arrows often ("Learn more →"), and also ⌘, ✓ and ★. Today these pastes with a gap and draw only after an edit ([LIT-148](/LIT/issues/LIT-148)).

## Options

| Option                                         | Covers arrows | Cost                                      |
| ---------------------------------------------- | ------------- | ----------------------------------------- |
| Our own subset of the official Inter release   | yes           | about 29 KB for 4 weights, a build script |
| The full Inter files from the official release | yes           | over 1 MB for 4 weights                     |
| Keep the gap, count it in the toast            | no            | none                                      |

## Decision

**Ship a symbols subset of Inter 4.1, the same version as the fontsource files.** `tools/inter-symbols.sh` builds it with fontTools from the official release. It holds arrows, math operators, technical symbols (⌘ ⌥ ⌫), geometric shapes, misc symbols and dingbats (U+2190–23FF, U+25A0–27BF), weights 400 to 700, WOFF 1, no hinting and no layout tables. The files live in `src/mainview/lib/fonts/` and load with the other files in `figma-fonts.ts`. The OFL text that ships with the app covers them.

## Consequences

- "→", "⌘", "✓" and similar characters draw on paste.
- The app grows by about 29 KB.
- To change the range or the Inter version, edit and run the script, and keep the version the same as `@fontsource/inter`.
