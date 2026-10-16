# 0047 · Fonts live in `public/fonts/` and are named for their face; providers can make images, and placeholders become `<img>`

- **Status:** proposed
- **Date:** 2026-10-15
- **Extends:** [0003](./0003-ai-provider-contract.md), [0010](./0010-project-images-pushed-to-frames.md), [0016](./0016-image-placeholders.md), [0034](./0034-history-follows-moves-and-keeps-images.md)
- **Code:** [`src/shared/fonts.ts`](../../src/shared/fonts.ts), [`src/shared/asset-usage.ts`](../../src/shared/asset-usage.ts), [`src/shared/placeholder-images.ts`](../../src/shared/placeholder-images.ts), [`src/bun/ai/providers/images.ts`](../../src/bun/ai/providers/images.ts), [`src/mainview/views/editor/assets-panel.tsx`](../../src/mainview/views/editor/assets-panel.tsx)

## Context

Phase 25 asks for an assets panel (images, icons and fonts with usage counts), custom fonts that exports embed, and AI images that replace placeholders on request. Screens could only use fonts installed on the computer. No `@font-face` was loaded anywhere, and the asset pipeline accepted only images. No provider could make an image.

## Decision

**Fonts are project assets, like images.**

- An uploaded font goes to `public/fonts/<family>[-<weight>][-italic].<ext>` (woff2, woff, ttf or otf). The name comes from the uploaded file's name: `BrandSans-BoldItalic.ttf` becomes `brand-sans-700-italic.ttf`. The family is the slug's words (`Brand Sans`), since CSS matches family names without case. The file name is the only record of the face. There is no manifest to keep in sync, and renaming the file changes the face.
- The same face uploaded again replaces the file.
- Fonts travel the same way as images ([0010](./0010-project-images-pushed-to-frames.md)). The frame registers each one with `FontFace` and `document.fonts`, so no stylesheet has to be rewritten.
- Uploading a family adds a font token to DESIGN.md when no font token names it yet: `font-brand-sans: "Brand Sans", ui-sans-serif, sans-serif`. The token and the theme change are one undo step. The inspector's Font family row then lists the font.
- The code export writes the files to `public/fonts/` and adds an `@font-face` to the stylesheet for each one. The HTML export adds an `@font-face` and the file for each family that its CSS names. Share links, publish and the website export carry fonts as `data:font/…` URLs. PNG and JPEG exports draw text in the frame, so they use the fonts too. The PDF export still uses Helvetica.

**Image generation is an optional provider method.**

- `Provider.generateImage?(request, signal)` takes a prompt and an aspect (`square`, `landscape` or `portrait`) and returns base64 bytes with a media type. OpenAI uses `gpt-image-1` through `/images/generations`. OpenRouter uses an image chat model with `modalities: ["image", "text"]`. The mock draws an SVG. Other providers leave the method out.
- The AI service uses the first enabled provider that has the method. The webview only asks `canGenerateImages` and `generateImage`, so nothing outside `src/bun/ai/providers/` knows which provider made an image. Image generation does not use the model picked for chat.
- The image goes to `public/images/<subject-seed>.<ext>`, like a picked image.

**Placeholders are replaced only when the user asks.**

- The Assets panel lists the photo, avatar, illustration and map placeholders. Charts stay as code. "Replace all", or the button on one placeholder, asks for an image for each one. The prompt is built from the placeholder's kind, subject, seed and label, the screen's name, the first line of PRODUCT.md, and an optional art direction.
- When the images arrive, each `<Placeholder>` becomes `<img src alt className>`. The kind's default size classes are kept unless the element's own classes set them, and `object-cover` is added. The import goes when it is no longer used. All the replacements are one undo step. A placeholder that moved while its image was made is matched by its props, and a removed one is skipped.

**Usage counts are read from the source** ([0006](./0006-components-from-source.md)):

- An image counts each `src`, `srcSet` or `url()` reference in screens and components.
- An icon counts each element of a lucide import, by icon name.
- A font counts the uses of the font tokens whose first family is the font.

Only unused images and fonts can be deleted. Deleting one is an undo step through the history's saved copies ([0034](./0034-history-follows-moves-and-keeps-images.md)).

## Consequences

- A font whose file name doesn't say its face gets weight 400 and normal style. The user renames the file to fix it.
- Variable fonts load as one face at weight 400.
- Image generation costs money and takes seconds per image. It only runs when the user asks, one image at a time, and it can be stopped between images.
- A generated image is not an undo step, like a picked image ([0010](./0010-project-images-pushed-to-frames.md)). Undoing the replacement brings back the placeholder, and the file stays in `public/images/`, where the panel shows it as unused.
- In browser mode (`hutch run hmr`), fonts and mock images live for the session only.
