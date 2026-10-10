# 0010 · Project images are pushed to frames as bytes, and the frame points `src` at them

- **Status:** accepted
- **Date:** 2026-10-06
- **Code:** [`src/bun/assets.ts`](../../src/bun/assets.ts), [`src/mainview/lib/render/assets.ts`](../../src/mainview/lib/render/assets.ts), [`src/mainview/runtime/assets.ts`](../../src/mainview/runtime/assets.ts), [`src/shared/assets.ts`](../../src/shared/assets.ts)

## Context

The inspector's image picker copies a file into `<project>/public/images/` and writes `src="/images/logo.png"` into the screen. That is what a Vite app expects: Vite serves `public/` at `/`. On the canvas, though, frames load from `views://mainview/runtime/frame.html`, so `/images/logo.png` resolves into the app bundle and the image doesn't show. Exports didn't carry `public/` either.

Frames are sandboxed with an opaque origin and must never reach the file system or RPC. Project files reach them as source pushed by the host ([0001](./0001-compile-tsx-in-the-webview.md)), and webview → main requests cost a 16 ms tick ([0005](./0005-rpc-round-trip-floor.md)).

## Options

1. **A handler for `/images/…` inside `views://`.** Electrobun 2.0.2 serves `views://` from the app bundle natively and has no hook for custom paths or schemes in the webview. `urlSchemes` in the config is for deep links into the app.
2. **A local HTTP server in the main process** serving `public/`. Frames would still need their `src` rewritten (`/` is the bundle), the server needs a token and CORS for the opaque origin, and it is one more listening socket. It does not work in the share viewer or a `file://` export.
3. **Push the bytes once and rewrite `src` in the frame.** Same path as modules and CSS.

## Decision

**Option 3.** Images are not project files: they never enter `ProjectFiles`, history or undo.

- **Main process.** `openProject` returns `assets`: every image under `public/` (png, jpg, gif, webp, svg, avif, ico; up to 20 MB each; no dot files, no symlinks) as base64, keyed by the `src` a screen writes (`/images/logo.png`). An `AssetTracker` remembers size and mtime. Changes under `public/` reach the `ProjectWatcher`, which asks the tracker for what changed and pushes `assetsChanged` (a message, not a request). Picking an image pushes it right away.
- **Webview.** `projectAssets` holds each image once as a Blob with a `version`. Every `FrameHost` posts an `assets` message with only what the frame lacks, before the modules, and skips the diff when the version hasn't moved. Posting a Blob shares its bytes with the frame instead of copying them. Closing the project clears the store, so home covers can't pick up another project's images.
- **Frame.** The frame makes its own object URLs. The `react/jsx-runtime` the screens import rewrites a `src` prop, and `url()`s in `style.backgroundImage` and `style.background`, when they name a known image. The shared stylesheet gets the same `url()` rewrite, for classes like `bg-[url(/images/hero.png)]`. When images change, the screen renders again. Snapshots read the Blob behind an object URL directly, so PNG, JPEG and PDF exports include the images.
- **Exports.** The Vite export writes the images to `public/`. The share snapshot carries them as `data:` URLs, and the viewer posts them to its frame the same way. Git sync already commits the whole project folder, `public/` included.

## Consequences

- The bytes cross RPC once as base64 on open, and again only for files that change. Very large image folders make opening slower; files over 20 MB are skipped with a warning.
- Only `src`, inline background styles and stylesheet `url()`s resolve. `srcSet`, `<source>`, `React.createElement` calls and images created from script (`new Image()`) still point at the bundle.
- A screen that renders before an image arrives shows it as broken until the `assets` message lands, then re-renders.
- In browser mode (`hutch run hmr`) there is no project folder, so there are no images; nothing else changes.
