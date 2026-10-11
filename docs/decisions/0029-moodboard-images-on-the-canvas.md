# 0029 · Moodboard images live in `public/moodboard/`; an image goes with prompts about its nearest screen

- **Status:** accepted
- **Date:** 2026-10-11
- **Extends:** [0010](./0010-project-images-pushed-to-frames.md), [0011](./0011-image-attachments-reach-every-provider.md)
- **Code:** [`src/shared/moodboard.ts`](../../src/shared/moodboard.ts), [`src/mainview/hooks/use-moodboard.ts`](../../src/mainview/hooks/use-moodboard.ts), [`src/mainview/views/editor/moodboard-layer.tsx`](../../src/mainview/views/editor/moodboard-layer.tsx), [`src/bun/assets.ts`](../../src/bun/assets.ts)

## Context

Designers collect references next to their work. MagicPath sends the images placed on the canvas next to the screens as references. Rabisco could only attach images in the composer, one prompt at a time, and a prompt couldn't say which image it meant.

## Decision

**Numbered images, and canvas images that travel as attachments.**

- **Numbers.** Images go to the provider in order as `Image 1`, `Image 2`… The composer chips, the chat thumbnails and the prompt use the same numbers. API providers get a `Image N: name` text block before each image; agents get the numbers next to the staged paths. `PROMPT_VERSION` is 20.
- **Storage.** A dropped, pasted or picked image is written to `public/moodboard/` and loads like every project image (decision 0010). `rabisco.json` stores `images` (`CanvasImage`: id, `src`, name, rectangle). Moving, resizing, adding and deleting go through history. Deleting a canvas image leaves its file.
- **Which images go.** Each image belongs to the screen it is nearest to, if that screen is within 600 canvas pixels. A prompt on selected screens sends the images that belong to them. A prompt with no selection, which creates screens, sends every image. At most 6 go, the nearest first, then in reading order. Images whose bytes didn't load are skipped.
- **Transport.** The webview appends them to the request's `attachments` after the composer's images, with `source: "moodboard"`. The provider layer handles them like any attachment (decision 0011). The chat keeps them with the message.
- **Visible.** Before sending, the canvas shows an `Image N` badge on each image that will go, and a line above the composer lists them. After sending, the chat thumbnails carry the number and "From the moodboard". "Edit and resend" leaves them out of the composer, because the moodboard adds them again.
- **Exports.** The Vite export and share links leave out `/moodboard/` images.

## Why

- **One path for images.** Moodboard images reuse project assets for display and attachments for the AI. Providers don't know where an image came from.
- **Nearest screen is predictable.** A fixed distance from the target alone also picked up images that clearly sat beside a neighbor screen.

## Consequences

- The moodboard image files are in the project folder, so git sync commits them.
- Moving a section does not move the images inside it yet.
- In browser mode (`hutch run hmr`) the bytes live only for the session; after a reload the images show a placeholder and are not sent.
