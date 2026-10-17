# 0049 · Screen frames load the Inter the app ships, lazily, before the project's own fonts

- **Status:** proposed
- **Date:** 2026-10-17
- **Extends:** [0041](./0041-copy-to-figma-draws-text-from-shipped-inter.md), [0047](./0047-fonts-in-public-and-images-from-providers.md)
- **Code:** [`src/mainview/lib/render/shipped-fonts.ts`](../../src/mainview/lib/render/shipped-fonts.ts), [`src/mainview/lib/figma-fonts.ts`](../../src/mainview/lib/figma-fonts.ts), [`src/mainview/runtime/fonts.ts`](../../src/mainview/runtime/fonts.ts), [`src/mainview/lib/share-snapshot.ts`](../../src/mainview/lib/share-snapshot.ts)

## Context

Generated themes often ask for `font-sans: "Inter", …`. Frames did not load Inter, so a screen showed Inter only when the user had it installed. Copy to Figma always draws text with the Inter the app ships ([0041](./0041-copy-to-figma-draws-text-from-shipped-inter.md)). For everyone else, the canvas and Figma showed different text, with different widths and line breaks. 0041 left loading Inter into frames to a separate change.

Frames have an opaque origin. A `FontFace` or `@font-face` that loads from a URL is a CORS fetch, and the app's `views://` origin does not answer one. Icons work because classic scripts don't need CORS. Project fonts work because the host posts their bytes ([0047](./0047-fonts-in-public-and-images-from-providers.md)).

## Options

| Option                                                   | Covers share links | Cost per frame                                                 |
| -------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| Inline the font files into `frame.js` as `data:` URLs    | yes                | about 460 KB more script for every frame to parse, used or not |
| `@font-face` with a URL in `frame.html`                  | no                 | fails: the CORS fetch has no answer from an opaque origin      |
| **The host posts the files as Blobs; faces load lazily** | yes, as `data:`    | 12 `FontFace` objects; a file decodes only when text needs it  |

## Decision

**The editor loads the shipped Inter files once and posts them to every frame. The frame registers them as lazy faces of the family `Inter`.**

1. **Files.** The same 12 files as Copy to Figma: latin, latin-ext and the symbols subset, weights 400 to 700. `loadShippedFonts()` fetches them at app start into Blobs. Copy to Figma reads its bytes from the same Blobs.
2. **Posting.** `FrameHost` posts a `fonts` message on `ready`, before `assets` and the modules, so the first render already has the faces. When the files arrive after a frame is ready, they are posted to it then. Posting a Blob shares its bytes and does not copy them.
3. **In the frame.** Each file becomes `new FontFace("Inter", url(blob:…), { weight, unicodeRange })`, added once. A face that no text uses never loads. Text that asks for Inter loads only the weights and ranges it needs. Snapshots already wait for `document.fonts.ready`.
4. **The project wins.** Project fonts are added after the shipped faces. A project that uploads its own Inter (`public/fonts/inter-*.woff2`) gets its own files, because for the same descriptors the face added last wins.
5. **Share links, publish and the website export.** When the theme or the CSS names Inter in a font stack, the snapshot carries the files as `data:font/woff` URLs, and the viewer posts them before the images. A family that only starts with Inter, such as `"Inter Tight"`, does not count.

## Consequences

- The canvas, play mode, covers, snapshots, image export and share links show the same Inter as Copy to Figma, on every machine.
- A system font named Inter is shadowed by the shipped one, so text looks the same on every machine.
- Cost per frame: 12 `FontFace` objects and their `blob:` URLs. A screen in Inter decodes about 30 KB of WOFF per weight it uses, and a screen without Inter decodes nothing. This was not measured in WebKit.
- A share snapshot that uses Inter is about 460 KB larger: 350 KB of files, as base64.
- The HTML and code exports don't bundle Inter yet. Without it installed, they fall back to the next family in the stack.
