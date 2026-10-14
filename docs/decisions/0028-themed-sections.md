# 0028 · Sections set token modes for the screens inside them

- **Status:** accepted
- **Date:** 2026-10-11, accepted 2026-10-14 after a review against the code from Phases 18–24 ([LIT-153](/LIT/issues/LIT-153))
- **Extends:** [0009](./0009-theme-read-from-design-md.md), [0013](./0013-custom-tokens-names-in-the-compiler.md)

## Context

In Figma, a section or frame can set a variable mode, such as Dark or Brand B, and every layer inside follows it. Designers use this to show the same flow in light and dark, or for two brands, side by side.

Rabisco has one theme per project (`CanvasDoc.theme`, an `AppliedTheme`). `tokensToCss` writes light values on `:root` and `:root:not(.dark)`, and dark values on `.dark`. `themeCss` in `src/mainview/lib/render/styles.ts` wraps it, and every renderer sends that one string to its frame. Nothing ever sets `.dark` on a frame, so the `### Dark` tokens in DESIGN.md never show.

A section (⇧S) is a named, colored rectangle in `rabisco.json`. A screen belongs to the smallest section that holds its center (`sectionOf` in `src/shared/sections.ts`). Membership is not stored. It is worked out when it is needed.

Since this record was first written, Phases 18–24 added more places that render a screen. Each one gets only the theme string, never anything per screen:

| Renderer                                                                                  | How it renders                                                        | Knows the `Frame` and sections       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| Canvas frames, screens panel, compare view, components panel                              | `ScreenFrame`, theme from the `ScreenTheme` context                   | Canvas and screens panel do          |
| Snapshots (live and still frames, history thumbnails)                                     | `snapshots.ts` worker frame, key `entry, size, graph, hash(theme)`    | Through their caller                 |
| Home covers                                                                               | `coverFor` → `ScreenSource` → `ScreenPreview`                         | `coverFor` has the whole `CanvasDoc` |
| Play mode and the GIF walkthrough                                                         | `PlayView` layers; play navigates inside one frame                    | Frames, not sections                 |
| Image export, Copy to Figma, visual review, recreate diff, agent screenshots, HTML export | `renderOffstage(frame, files, theme, use)`                            | The `Frame`, not sections            |
| Share viewer and publish                                                                  | `buildShareSnapshot` → `ShareSnapshot` → `viewer.ts`                  | No. `ShareScreen` drops position     |
| Code export (Vite, Next.js, React Router)                                                 | `appProject`; routes render a bare `<Screen />`; `tokenFiles` for CSS | Frames, not sections                 |
| AI prompts and the MCP tools                                                              | `themeTokensText(request.theme)`; MCP summary already has `section`   | The run has the canvas               |

All of them run the same frame runtime (`public/runtime/frame.html`), except the code export. Theme CSS lands in its own `<style>` tag. Portals render outside `#root`, Tailwind's `dark:` variant is `&:is(.dark *)`, and the scene and Figma captures walk `document.body` and read the `html` and `body` backgrounds. So a mode must go on `<html>`, not on `#root`.

## Options

1. **A mode per section, read from DESIGN.md.** Modes are defined once in DESIGN.md. A section only picks one option per mode group. Frames already have every mode's values in their theme CSS. They need only a class or attribute on `<html>`.
2. **A full theme per section.** Each section stores its own token values. Flexible, but the design system splits across the canvas, and the export has no place for it.
3. **Modes per screen only.** Simple, but loses what makes Figma's version useful: drop a screen into the Dark section and it turns dark.

For comparing modes side by side:

- **A. "Duplicate with mode" copies files.** The copies are normal screens, as [0004](./0004-alternates-are-files.md) says.
- **B. Mirror frames.** A new kind of frame shows another frame's file in another mode, with no copy. But `Frame.file` is unique per canvas, and selection, snapshots, comments, alternates, locks, history and `data-link-to` all key on it. Every one of them would need a second key.

## Decision

**Option 1, plus temporary token drafts on a section. Comparing modes is option A.**

### Modes in DESIGN.md

- `### Dark`, or any token sub-heading with "dark" in it, keeps working. It is the `scheme` group, with the options `light` and `dark`.
- Other groups use a heading in the form `### <Group> mode: <Option>`, for example `### Brand mode: Acme` or `### Density mode: Compact`. The word `mode` before the colon is what makes it a group. A loose heading such as `### Colors: Neutral`, which AI and other tools write, stays plain tokens as today.
- The first option of a group is its default. It usually lists no tokens, because the project values are its values.
- An option lists only the tokens it changes. A `#### Dark` heading inside an option holds that option's dark values.
- Group and option names become slugs (`[a-z0-9-]`). The parser drops a heading whose slug is empty or taken, and reports it with the invalid tokens.
- An option can name a custom token the project doesn't have. It gets the same check as a project token, and its name goes to the compiler (0013) like any other. Outside that option it falls back to the value in `FALLBACKS`. An invalid value is reported, as today.
- If two groups set the same token, the group written later in DESIGN.md wins, and the tokens panel warns.
- Modes are part of the applied theme (0009). `DesignTokens` gains an optional `modes` list of groups, each with a list of options (`name`, `light`, `dark`). An old `AppliedTheme` without `modes` stays valid.

### Theme CSS carries every option

`tokensToCss` keeps one stylesheet for all frames. After the base blocks it writes each option, in DESIGN.md order:

```css
:root[data-mode-brand="acme"] {
	/* custom tokens, both schemes */
}
:root:not(.dark)[data-mode-brand="acme"] {
	/* built-in colors, light */
}
:root.dark[data-mode-brand="acme"] {
	/* the option's dark values */
}
```

These selectors beat the base `.dark` and `:root:not(.dark)` blocks, so an option wins over the project values in both schemes. Built-in colors follow the same light-only rule as the base blocks. The `scheme` group is the `.dark` class. Every other group is a `data-mode-<group>` attribute.

### Where the mode is chosen

- `CanvasSection.modes` and `Frame.modes` are optional maps from group to option, in `rabisco.json`.
- `resolveModes(frame, sections, theme)` in `src/shared/modes.ts` returns a `ResolvedMode` with an option for **every** group, `scheme` included. For each group it takes the first match from this list:
  1. the screen's own choice
  2. the sections that hold the screen's center, from smallest to largest
  3. the group's default
- A choice that names an option no longer in the theme is skipped, so the next level wins. Nothing is rewritten.
- The resolved mode is worked out on render, like membership. It is never stored per screen. A screen dragged into or out of a section re-themes on drop because its resolved mode changed.
- Every frame gets an explicit value for every group. A frame never relies on "no attribute" for a default.

### How a frame gets its mode

- The protocol gains a `{ type: "mode", mode }` message and an optional `mode` field on `modules`. The runtime sets `.dark` and `data-mode-*` on `document.documentElement`, and removes any it no longer gets.
- `FrameHost` keeps the last mode and sends it again when the frame reloads and on each play navigation, the same way it re-sends `#play`. A mode change does not rebuild Tailwind and does not send new theme CSS.
- `ScreenFrame` and `renderOffstage` take an optional `mode`. Without one, a frame renders the defaults, which is the same as today.

### Every renderer uses the screen's resolved mode

Each caller resolves the mode where it has the `Frame` and the sections. It passes the result down. Renderers never look up sections themselves.

- **Canvas frames, screens panel, compare view, components panel.** The editor resolves each frame's mode from `canvas.sections`. Component previews have no section and use the defaults.
- **Snapshots.** The snapshot key adds the mode: `entry, size, graph, hash(theme), mode`. The worker frame reuses a render when only the theme, size or mode changed, and gets a `mode` message for it. History thumbnails resolve from the `frames` and `sections` saved in each history `Snapshot`.
- **Home covers.** `coverFor` resolves the cover screen's mode and puts it on `ScreenSource`. The cover renders in that mode with no badge. The screens panel shows no badge either. Its section header lists the section's modes in muted text. This follows Principle 1, "Calm interface".
- **Play mode and the GIF walkthrough.** `PlayView` gets the sections. Each layer sends the mode of the screen it shows, and sends it again when it navigates. An overlay uses its own screen's mode. The walkthrough records what play shows, so it needs no change.
- **Image export, Copy to Figma, visual review, recreate diff, agent screenshots.** Each caller passes the resolved mode to `renderOffstage`. Copy to Figma reads computed styles, so the paste looks like the canvas. It does not create Figma variables or modes.
- **Share viewer and publish.** `ShareScreen` gains `mode`, resolved in `buildShareSnapshot`, because the snapshot drops positions. The viewer sends it with `modules` and on every navigation. A snapshot written before this has no `mode` and renders the defaults.
- **HTML export.** `markup` is the inner HTML of `#root`, so the mode on the frame's `<html>` is lost. `htmlScreen` writes the class and attributes on the `<html>` element of its own template.
- **Code export.** The export writes a small `ScreenMode` component. Each route wraps its screen in `<ScreenMode mode={…}>`, which sets `.dark` and the `data-mode-*` attributes on `document.documentElement` in a layout effect, and puts back the old values on unmount. Portals then follow the mode too. The exported stylesheet uses the same selectors as the frames, written by `tokensToCss`, so there is one writer. A screen exports the way it looks on the canvas.
- **Copy for agent.** `AgentContextScreen` gains `mode`. The markdown names each screen's mode next to its section.
- **AI.** `GenerateParams` carries a resolved mode for each target. The prompt lists the token values that apply in that mode, and still asks for token classes, not raw colors. Point and prompt sends the mode of the focused screen. The MCP project summary adds `mode` next to `section`, and `getDesignTokens` returns the groups.

### Section token drafts

- `CanvasSection.tokens` holds a draft: token values for that section only, in the same `light` and `dark` shape as `DesignTokens`. It is canvas state, not design.
- The host writes a section's draft as a second, small stylesheet and sends it to the frames whose center is in that section. The frame puts it after the theme CSS, with selectors that beat every mode option. When sections nest, the drafts merge from the largest section to the smallest, so the smallest wins for each token.
- "Save as mode" writes the draft to DESIGN.md as a new option of a group the user picks, sets that option on the section, and clears the draft. "Apply to project" writes the values to DESIGN.md as the project values and clears the draft. "Discard" clears it. Each one is a single undo step that covers both the canvas and DESIGN.md.
- Renderers that show the canvas show drafts: canvas, snapshots, covers, play, image export, Copy to Figma, and a share link on the local network. Outputs that ship the product leave drafts out: code export, HTML export, publish and Copy for agent. The publish dialog says how many sections have drafts that won't be published.
- The AI sees a screen's draft values, so it knows what the user is looking at. It writes token classes either way.

### "Duplicate with mode"

- It runs on a section, from its menu. The user picks one option of one group.
- It copies the section, its member screens (`membersOf`) and their files, the same way ⌘D does (`uniqueScreenPath`, `<name> copy`). The copy goes to the right of the section, one section gap away.
- The new section gets the source's `modes` with the picked option set. A copied screen loses its own choice for that group, so it follows the new section. It keeps its choices for other groups.
- `data-link-to` values in the copies that point at screens copied in the same step are rewritten to the new paths. A flow played from the copy then stays in the copy, and in its mode. Links to screens outside the section are kept.
- Components are shared, not copied. The section's draft is copied.
- The whole step is one undo step and selects the new section.
- Mirror frames (option B) are not built. A later record can add them if copies prove to be a problem.

## Consequences

- `CanvasSection` gains optional `modes` and `tokens`. `Frame` gains optional `modes`. `DesignTokens` gains optional `modes`. Old `rabisco.json` files and applied themes load unchanged.
- The token parser, `tokensToCss`, the tokens panel and `themeTokensText` learn mode groups. A DESIGN.md with only light and dark stays valid.
- `ScreenFrame`, `renderOffstage`, `FrameHost`, the snapshot key, `ScreenSource`, `ShareScreen`, `AgentContextScreen` and `GenerateParams` each gain an optional mode. A missing mode means the defaults, which is how every screen renders today.
- Screens with hard-coded colors won't follow a mode. "Find raw values" (Phase 25) and the dark mode pass (Phase 27) are how users fix them.
- Sections and frames are canvas state, so every mode and draft change goes through history (`change()`).

## Build order ([LIT-46](/LIT/issues/LIT-46))

One task is too big. The build is five steps. Each step ships on its own, and the first one starts now.

1. **Dark on frames.** `Frame.modes` and `CanvasSection.modes` for the `scheme` group, `resolveModes`, the `mode` message, `FrameHost` re-send, the snapshot key, the Theme row in the section inspector and menu, and the screen menu choice. Canvas, screens panel, covers, history and play. **This step comes first.**
2. **Every other renderer.** The `mode` parameter on `renderOffstage` and all its callers, `ShareScreen.mode`, HTML export, the code export `ScreenMode`, Copy for agent, the AI request and the MCP summary. After this, dark looks the same everywhere.
3. **Mode groups in DESIGN.md.** Parser, `DesignTokens.modes`, the option selectors in `tokensToCss`, the tokens panel, and the Theme row listing every group.
4. **Section token drafts.** Draft stylesheet, "Save as mode", "Apply to project", "Discard", and drafts left out of shipped outputs.
5. **"Duplicate with mode".**
