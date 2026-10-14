# 0041 · Copy to Figma draws text from glyph outlines we write, with Inter shipped in the app and positions measured in the frame

- **Status:** accepted
- **Date:** 2026-10-14
- **Extends:** [0039](./0039-copy-to-figma.md)

## Context

Copy to Figma ([0039](./0039-copy-to-figma.md), [LIT-43](/LIT/issues/LIT-43)) pastes frames, auto layout, image fills, icons and names into real Figma. Text layers paste with the right props but draw nothing.

Tests in figma.com ([LIT-145](/LIT/issues/LIT-145)) found:

- Figma does not lay out pasted text. It draws the glyph outlines in `derivedTextData`, which a real copy carries.
- More than 20 variants without outlines draw nothing: no size, size 0, other layout versions, `fallbackGlyphs`, a wrong font digest, `dirtyFromInitialLoad`, and fonts not loaded yet.
- An auto layout pass that changes a text's size (stretch or fill) makes Figma lay the text out again. Hug text and text outside auto layout stay blank.
- `derivedTextData` with only `glyphs` (`commandsBlob`, `position`, `fontSize`) draws. After an edit, Figma lays the text out again. The outline blob uses the same path format as our icon vectors.

0039 said a text layer must have the right font, size, weight, line height and wrap. Blank text fails that bar.

Screens ask for `font-sans: "Inter", system-ui, sans-serif` (`src/bun/ai/prompt.ts`). The encoder already maps families to Inter, Roboto Mono or Noto Serif (`fontFamily` in `to-figma.ts`). Frames do not load Inter, so a screen renders in Inter only when the user has it installed.

## Options

| Option                                                     | Text draws on paste | Cost                                              |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| Ship as is; the user edits each text                       | no                  | none; fails the 0039 bar                          |
| A Figma plugin that creates text through the API           | yes                 | 0039 rejected it: a manual step on every copy     |
| Read outlines from the user's installed fonts              | sometimes           | the webview can't read font files; not portable   |
| **Ship Inter, write outlines, measure positions in frame** | yes                 | about 120 KB of fonts and a small TrueType reader |

## Decision

**Write `derivedTextData.glyphs` for every text layer, from Inter outlines that ship with the app, at positions the frame measures with the same Inter file.**

1. **Fonts.** Add `@fontsource/inter` (OFL 1.1). Use the static `latin` and `latin-ext` `.woff` files for weights 400, 500, 600 and 700, normal style. WOFF 1 tables are zlib, so `fflate` (already a dependency) reads them. Do not use the `.woff2` files; they need Brotli. Ship the OFL text with the app. Roboto Mono and Noto Serif wait until a fixture screen needs them; until then mono and serif text get Inter outlines (step 4).
2. **Reader.** A small TrueType reader in `src/shared/export/figma/` reads `cmap` (format 4 and 12), `loca`, `glyf` (simple and composite glyphs), `hmtx` and `head`. It turns quadratic contours into our vector blob format. No new parser dependency. It reads only the files we ship, but it still bounds-checks every offset and fails to "no outlines" instead of throwing.
3. **Positions.** The capture in the frame loads the same file with `FontFace`. For each text layer it lays out a hidden copy of the text at the layer's width, with the layer's type styles, and reads each character's box with `Range.getClientRects`. So kerning and line breaks match what Inter gives, and the text box size comes from the same layout. The hidden copy is removed after the capture; the visible screen does not change. Positions go back to the webview as data, parsed and capped like the rest of the `CapturedNode` tree.
4. **Fallback.** A family we don't ship keeps its own font name in the layer and gets Inter outlines of the nearest weight. It draws on paste and becomes exact when Figma lays it out again on the first edit. A character with no glyph in our files is skipped in the outline. The copy toast counts layers with skipped characters: "2 texts use characters that draw after an edit."
5. **Loading.** Fonts load on the first Copy to Figma, not at app start or in every frame. Copy to Figma remains offline: no network, no provider, no account.

### Fidelity check

- The round trip test reads `derivedTextData` back and checks that every text layer has glyphs, that glyph positions lie inside the layer box, and that line count matches the fixture.
- A reader test decodes known glyphs (`A`, `g`, a composite like `é`) and compares contour counts and advance widths with values from the font.
- QA's acceptance pass in real Figma (0039) now includes: every text draws on paste, hug and fixed-width text alike, and stays editable.

## Consequences

- The app grows by about 120 KB of font files plus the OFL text.
- Pasted text looks like Inter, even when the user's Rabisco shows the system font because Inter is not installed. That matches what Figma shows after an edit. Loading the shipped Inter into every frame, so Rabisco and Figma match, is a separate change to screen rendering and exports; it gets its own issue.
- `derivedTextData` is an unofficial field. If Figma changes it, the schema test and the QA pass show it, the same way as the rest of the buffer.
- The TrueType reader is ours to maintain. It is small, covers only the tables above, and only ever reads files we ship.
