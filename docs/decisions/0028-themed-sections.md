# 0028 · Sections set token modes for the screens inside them

- **Status:** proposed
- **Date:** 2026-10-11
- **Extends:** [0009](./0009-theme-read-from-design-md.md), [0013](./0013-custom-tokens-names-in-the-compiler.md)

## Context

In Figma, a section or frame can set a variable mode, such as Dark or Brand B, and every layer inside follows it. Designers use this to show the same flow in light and dark, or for two brands, side by side.

Rabisco has one theme per project (`CanvasDoc.theme`). `tokensToCss` writes light values on `:root:not(.dark)` and dark values on `.dark`, and every frame gets the same theme CSS through the `ScreenTheme` context. Nothing ever sets `.dark` on a frame, so the `### Dark` tokens in DESIGN.md never show. A section (⇧S) is a named, colored rectangle in `rabisco.json`. A screen belongs to the smallest section that holds its center (`sectionOf` in `src/shared/sections.ts`). Membership is not stored.

## Options

1. **A mode per section, read from DESIGN.md.** Modes are defined once in DESIGN.md. A section only picks one option per mode group. Frames already have every mode's values in their theme CSS; they need only a class or attribute on the root.
2. **A full theme per section.** Each section stores its own token values. Flexible, but the design system splits across the canvas, and the export has no place for it.
3. **Modes per screen only.** Simple, but loses what makes Figma's version useful: drop a screen into the Dark section and it turns dark.

## Proposed decision

**Option 1, plus temporary token overrides on a section for trying out changes.**

- **Modes live in DESIGN.md.** `### Dark` keeps working as the `scheme` group. Other groups use a heading per option, for example `### Brand: Acme` or `### Density: Compact`. An option lists only the tokens it changes. The first option of a group is its default.
- **Theme CSS carries every option.** `tokensToCss` writes each option as a selector on the frame root: `.dark` for the scheme, `[data-mode-brand="acme"]` for the others. One stylesheet for all frames, as today. A mode change sends a small message to the frame, with no Tailwind rebuild and no new theme CSS.
- **A section stores its choices.** `CanvasSection.modes` maps a group to an option, in `rabisco.json`, next to the section's color. A `Frame` can have `modes` too.
- **The resolved mode comes from position.** For each group: the screen's own choice, then the innermost section that sets the group, then the sections around it, then the project default. It is worked out when frames move, like membership, and never stored per screen.
- **Overrides are a section draft.** `CanvasSection.tokens` holds token values that apply to that section only, written as extra CSS for its frames. They are canvas state, not design: "Save as mode" writes them to DESIGN.md as a new option, "Apply to project" writes them as the project values, and "Discard" removes them. Each is one undo step.
- **Every renderer resolves the mode the same way.** Play mode, the share viewer, image export and snapshots take each screen's resolved mode. Snapshot cache keys include it.
- **The code export keeps the canvas modes.** Each screen's route sets its resolved mode on a wrapper: `.dark` for the scheme and a `data-mode-*` attribute for each other group. A screen exports the way it looks on the canvas. A section's token draft is not exported until it is saved as a mode or applied to the project.
- **The AI sees it.** A request for a screen carries its resolved mode, so the prompt asks for token classes that work in that mode instead of raw colors.

## Open questions

- **Comparing modes.** A frame's file is unique per canvas, so "Duplicate with mode" copies files today. A mirror frame that shows the same file in another mode would avoid copies, but needs a new kind of frame.
- **Group names in DESIGN.md.** How to read loose headings written by other tools, and what happens when an option names a token the project doesn't have.
- **Defaults per section on Home covers and in the screens panel.** Show a mode badge, or just render the cover in the mode?

## Consequences

- `CanvasSection` and `Frame` gain optional `modes`, and `CanvasSection` gains `tokens`. Old `rabisco.json` files load unchanged.
- The token parser and `tokensToCss` grow mode groups. DESIGN.md files with only light and dark stay valid.
- Screens with hard-coded colors won't follow a mode. The dark mode pass and "Find raw values" (Phase 25) are how users fix them.
