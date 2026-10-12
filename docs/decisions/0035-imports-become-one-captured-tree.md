# 0035 · HTML paste, live URL capture and Figma paste become one captured tree; deterministic code turns it into TSX, AI only tidies

- **Status:** proposed
- **Date:** 2026-10-12
- **Extends:** [0001](./0001-compile-tsx-in-the-webview.md), [0009](./0009-theme-read-from-design-md.md), [0010](./0010-project-images-pushed-to-frames.md), [0013](./0013-custom-tokens-names-in-the-compiler.md), [0016](./0016-image-placeholders.md), [0018](./0018-search-replace-edits.md)

## Context

Phase 21 adds three ways to start from something that exists: paste HTML, capture a live URL, and paste from Figma. Each must give an editable screen: TSX with Tailwind classes that use the project's tokens.

The three sources are very different:

- **HTML paste.** Browsers put `text/html` on the clipboard. Safari and Chrome write resolved styles inline on each element, but class rules from the page's stylesheets don't come along. People also copy markup from devtools, which arrives as `text/plain`.
- **Live URL.** Most sites build their DOM with scripts. Many forbid framing (`X-Frame-Options`, `frame-ancestors`). Loading one runs third-party code.
- **Figma.** Figma writes `text/html` with two HTML comments: `(figmeta)` holds JSON metadata and `(figma)` holds a base64 `fig-kiwi` buffer. The buffer is a compressed Kiwi message (deflate or zstd) that carries its own schema. The format is not documented and can change. Image fills carry a hash, not bytes.

The rules that apply: screens are sandboxed and generated code never reaches the app ([0001](./0001-compile-tsx-in-the-webview.md)). The app works with no provider and no account. Every change is undoable. Screen code must be code a developer accepts in review, with no inline style soup (Principle 3).

## Options

1. **Send the source to the AI and ask for a screen.** Easy to build, but it needs a provider, costs a model call per paste, and gives a different result each time. A large page doesn't fit in a prompt.
2. **A converter per source.** Three style mappers and three TSX writers that drift apart.
3. **One captured tree.** Each source becomes the same intermediate tree of boxes, text and resolved styles. One deterministic converter writes TSX from it. AI is an optional clean-up pass on the result.

## Proposed decision

**Option 3.** Capture is per source. Conversion is shared, pure and deterministic. AI is never needed to get a screen.

### The captured tree

`CapturedNode` in `src/shared/import/`: tag, text, the element's box, a small set of resolved styles (layout, spacing, size, type, color, border, radius, shadow, opacity, position), image references and children. It is plain JSON with a size cap: 3,000 nodes and 5 MB. Everything that crosses a boundary is parsed into it with a validator; nothing else is trusted.

The capture skips nodes that don't render (`display: none`, `visibility: hidden`, zero size), and drops `script`, `iframe`, `object`, `embed`, event attributes and `javascript:` URLs. `canvas` and `video` become image placeholders ([0016](./0016-image-placeholders.md)). Inline `svg` is kept after the same sanitizing.

### Where each source is captured

- **HTML paste runs in a sandboxed import frame in the webview.** The webview reads `text/html` from the native paste event. An import frame in `offstage()` has an opaque origin, a CSP with no network (`default-src 'none'`, images from `data:` and `blob:` only) and only our capture script. The script parses the HTML with `DOMParser` (which runs no scripts), sanitizes it, lays it out at the target width, reads `getComputedStyle` and posts the tree back. Styles are compared with a blank element of the same tag, so only real differences count.
- **Live URL capture runs in a hidden, sandboxed `BrowserWindow` owned by the main process.** Electrobun's `sandbox: true` turns off RPC and leaves only an event bridge. The window has its own non-persistent `partition` (no cookies or storage shared with the app), navigation rules that allow only `https:` and `http:`, and no downloads. After `dom-ready`, the main process waits for the page to settle (500 ms with no layout change, at most 15 s), runs the same capture script with `executeJavascript`, and reads the tree from the event bridge. Then it closes the window.
- **Figma paste runs in a Web Worker in the webview.** The worker finds the `(figma)` comment, checks the `fig-kiwi` header and version, decompresses, decodes the Kiwi message with its own schema and maps nodes to the tree. Auto layout becomes flex (direction, gap, padding, alignment, wrap, hug and fill). Absolute children become absolute boxes. Text keeps font, size, weight, line height and letter spacing. Fills, strokes, corner radii and effects become color, border, radius and shadow. Bound variables stay as variable names.

The app's webview never loads a captured site, and no captured code runs next to the app or the RPC layer. The capture script returns data only. A page can lie to it; the result is still parsed and capped like any untrusted input.

URL capture uses the width of the chosen device preset. Sites that need a login can't be captured, because the window shares no session with the user's browser; HTML paste is the way in for those.

### Images

The tree names images by URL (HTML and live URL) or by `data:` bytes. The main process downloads `https:` images with a 10 s timeout like the brand kit fetch, the 20 MB limit of project images and at most 40 images into `public/images/imported/`, and they load like any project image ([0010](./0010-project-images-pushed-to-frames.md)). An image that fails, and every Figma image fill, becomes a placeholder with the original name as its `alt`.

### From styles to classes and tokens

A pure function in `src/shared/import/` writes TSX from the tree and the applied theme. The same tree and theme always give the same code.

- **Structure.** Semantic tags stay (`nav`, `header`, `button`, `a`, `ul`). A box with one child and no styles of its own is merged into its child. Flow layout stays flow: widths and heights are written only for images, absolute boxes and fixed-size Figma frames.
- **Only what differs.** Inherited properties are written where they change from the parent. Default values for the tag are left out.
- **Tokens first.** Each value is matched in order: a project token (built-in and custom, [0013](./0013-custom-tokens-names-in-the-compiler.md)), then the Tailwind scale, then an arbitrary value. Colors match by OKLab distance under a small threshold. Spacing matches the `--spacing` step. Font size, radius and shadow match the nearest step within 1 px. A value with no match becomes an arbitrary class (`bg-[#e11d48]`), never an inline `style`.
- **Readable output.** Repeated arbitrary values are counted. The import reports them as token candidates ("3 colors and 2 radii are not tokens yet").

### Tokens from the source

- **Live URL.** The capture also reads `:root` custom properties, the body's background and text, and the most used colors, radii and fonts. Rabisco proposes a `## Tokens` section from them with the same rules as the built-in heuristics: body colors become `background` and `foreground`, the most used filled button or link color becomes `primary`. With a provider, the theme task from [0009](./0009-theme-read-from-design-md.md) can read them instead. The user picks "Keep project theme" or "Use the site's theme". The second writes DESIGN.md, and conversion then matches against the new tokens, so the screen uses token classes.
- **Figma variables.** A variable bound to a fill, radius, gap or padding becomes a custom token named with its Tailwind namespace (`Brand/500` → `color-brand-500`). Missing tokens are proposed for DESIGN.md. A name that already exists keeps the project's value, and the import says so. A name that isn't a valid token name (`Spacing/4` gives `spacing-4`, `Radius/LG` gives the built-in `radius-lg`) stays a plain value and matches like any other.
- **HTML paste.** No new tokens. Values match the project's tokens or stay arbitrary.

Re-theming always asks first, as in [0009](./0009-theme-read-from-design-md.md).

### What AI does

Nothing in capture or conversion. After an import, a provider can run "Tidy imported screen": a normal edit request on the new file with search/replace blocks ([0018](./0018-search-replace-edits.md)). The prompt asks it to swap absolute boxes for flex or grid, use the project's components and shadcn primitives, pull out repeated parts as components, and keep the look. For a live URL or a Figma frame that came with a PNG, the source image is attached so the provider can compare. The tidy is its own undo step, so the deterministic result is always one ⌘Z away.

### With no provider

All three imports work. The screen is the deterministic result. "Tidy imported screen" is shown as unavailable, with the usual link to set up a provider. The token proposal from a live URL uses the heuristics only.

### Where the result goes, and undo

The import adds a new screen at the paste point (like pasting screens), named from the page title, the Figma frame name or "Imported". Its width is the source's: the Figma frame, the device preset for a URL, or the selection's width for HTML (desktop when unknown). The screen file, its canvas frame and its images are one undo step. Accepting proposed tokens is a second step.

### Paste order

⌘V keeps its current order: Rabisco screens and element code first, then Figma (`(figma)` in `text/html`), then HTML, then images, then text. HTML counts as an import only when it has at least one element with layout or a resolved style. A plain run of text keeps today's behavior. The canvas menu gets "Import from HTML or URL…", a dialog that takes a URL or HTML source pasted as text.

## Consequences

- Most of the work, and all the tests, are in pure functions: tree validation, Figma decoding, style-to-class mapping and the TSX writer. They run in `bun test` with fixtures and no browser.
- Rabisco gains two small dependencies for the Figma buffer: a deflate decoder and a zstd decoder (for example `fflate` and `fzstd`). The Kiwi decoder is small enough to own.
- The Figma format is unofficial. A version check fails fast with "This Figma copy uses a format Rabisco can't read yet" instead of a broken screen. Fixtures from real copies guard against drift.
- A live URL capture costs one hidden web view for up to 15 s. Only one runs at a time, and it can be stopped.
- Deterministic output is faithful but flat. Deep `div` trees from real sites come through as they are, and the tidy pass is how they become components. Without a provider, users clean them up by hand.
- Pasting into a selected element of an existing screen is not part of this record. The tree and converter allow it, so it can come later without a new decision.

## Open questions

- **Figma images.** Image fills have only a hash in the clipboard. Fetching them needs the Figma REST API and a personal token. Is an optional token, kept in the keychain like provider credentials, worth adding?
- **Fonts.** A captured font family that the project doesn't load renders with a fallback. Should the import add a `font-*` token with the family name, or leave fonts to DESIGN.md?
- **Thresholds.** The color distance and the 1 px snapping need tuning against real pages and Figma files before they are fixed.
