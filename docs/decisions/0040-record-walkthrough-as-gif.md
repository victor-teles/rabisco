# 0040 · A walkthrough is recorded in play mode as one raster per step, with transitions rebuilt from the motion tables, and saved as a GIF made in the webview

- **Status:** accepted
- **Date:** 2026-10-14
- **Extends:** [0007](./0007-prototype-links-in-source.md), [0008](./0008-share-link-and-git-sync.md)

## Context

Phase 23 asks for a way to record a prototype walkthrough as a video or a GIF, to share without a link.

The app can't record its own window. WKWebView has no `getDisplayMedia`. `screencapture` and ffmpeg are not in a packaged app, and the main process can't see inside the sandboxed frames.

The screen frame can already draw itself to an image: `snapshot` with `raster` (`src/mainview/runtime/raster.ts`). Play mode ([0007](./0007-prototype-links-in-source.md)) knows each step and its transition, from the motion tables in `src/shared/prototype/transitions.ts`.

These rules stay: screens are sandboxed, and the app works with no account and no AI.

## Options

| Option                                                      | Works in the packaged app | Transitions                        | Cost                                        |
| ----------------------------------------------------------- | ------------------------- | ---------------------------------- | ------------------------------------------- |
| One raster per step in play mode, encoded in the webview    | yes                       | rebuilt from the motion tables     | a GIF encoder in TypeScript                 |
| Screen capture in the main process (`screencapture`/ffmpeg) | no; not in the bundle     | real                               | a native binary, a screen recording prompt  |
| `MediaRecorder` on a canvas in the share viewer             | only in a browser         | real, if the canvas redraws frames | the viewer must run, and the output is WebM |

## Decision

**Record in play mode, one raster per step.** A record button sits in the play mode bar. While it records, the bar shows a red dot, the time and **Stop**. `Esc` stops it (after an open overlay closes).

1. **Capture.** After each change in play mode settles (400 ms), and once a second, play mode asks the visible frames for a `snapshot` with `raster`. It takes the screen and every open overlay, with each overlay's rect. A step that looks the same as the last one is dropped. The frames stay sandboxed: they send back a PNG data URL, as for image export.
2. **Motion.** Each step keeps the transition that led to it: the screen plan or the overlay motion from the 0007 tables. It is the same plan play mode runs, so reduced motion gives a cut.
3. **Frames.** A pure function (`walkthroughFrames` in `src/shared/prototype/walkthrough.ts`) turns the steps into GIF frames. A step holds for the time the user spent on it, from 0.7 s to 4 s; the last step holds 2 s. A transition becomes 40 ms frames. Each frame poses the layers from the keyframes (opacity and `translateX`/`translateY` in percent) with the plan's easing.
4. **Encode.** A canvas in the webview draws each frame. A GIF encoder in TypeScript (`src/shared/export/gif.ts`) writes it: an exact palette when a frame has 256 colors or fewer, median cut otherwise, and LZW. It loops forever. The longest side is at most 960 px.
5. **Save.** The user picks a folder and the file is written through `writeExport` as `<project>-walkthrough.gif`. No network, no provider, no account.

A recording keeps up to 120 steps, then stops and says so.

## What waits

- **Video (MP4 or WebM).** `VideoEncoder` is not in every WKWebView we support. When it is, the same frames can go to MP4. A GIF opens everywhere: in Slack, GitHub, Linear and email.
- **Recording in the share viewer.** A stakeholder could record in a browser. It needs the same capture in the viewer, so it waits for a request.
- **A cursor and click marks.** The raster has no pointer. A later step can draw a click mark at the link that moved the step.
- **Scroll inside a screen.** A capture takes the frame's whole scene, so a step that only scrolls looks the same and is dropped.

## Consequences

- Recording costs nothing until the user presses record. While it records, each capture is one `snapshot` per visible frame, at most once a second and after each step. No RPC per frame.
- The output is smooth between steps but not a real video. Animations inside a screen (a spinner, a CSS transition) don't show.
- `walkthroughFrames`, the easing and the GIF encoder are pure and tested in `bun test` with no browser.
