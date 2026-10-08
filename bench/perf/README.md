# Perf benchmark

Guards the Phase 9 targets ([ROADMAP](../../docs/ROADMAP.md)) that can be measured outside the packaged app. It runs the webview's render pipeline (`src/mainview/lib/render`, `src/mainview/lib/history.ts`) under Bun on a synthetic 30-screen project built from `src/shared/mock-generator.ts`.

```bash
hutch run bench:perf
```

It prints a table and exits with code 1 when a check is over its limit.

## What it measures

| Check                   | What it does                                                                                                   | Limit          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| Tailwind builds on open | Resets the builder with the project's candidates, then syncs 30 frames one task at a time, as `FrameHost` does | 1 build        |
| CSS posted on open      | Counts the full stylesheets that reach frames (in a `modules` message or a `css` push)                         | 1 per frame    |
| Open, host side         | Compile and CSS work for the first sync of every frame, without the waits between tasks                        | 150 ms         |
| Candidate extraction    | `extractCandidates` on every file of the project, p95                                                          | 0.5 ms         |
| Compile a screen        | `compileSource` (Sucrase) on a screen that isn't cached, median and p95                                        | 5 ms and 15 ms |
| Keystroke               | Typing a class into one screen: graph, compile, candidates and the incremental Tailwind build, p95             | 20 ms          |
| Drag                    | 120 coalesced pointermoves of one frame on the 30-screen canvas: undo steps and the cost of one commit         | 1 step, 0.5 ms |

Bun runs JavaScriptCore like the WKWebView, but not WebKit's 1 ms timer clamp or its JIT limits. Read the times as relative numbers: they catch regressions, they don't prove the targets.

## Check by hand in the packaged app

These depend on WebKit rendering, iframes and the RPC, so this benchmark can't see them. Use a 30-screen project (`hutch run build`, then open the app):

- **Pan and zoom hold 120 fps** on a ProMotion display. Record a trackpad pan and a pinch zoom in Safari Web Inspector's Timelines (Rendering Frames); no frame should take more than 8.3 ms, and React should not render the editor per event.
- **Dragging a frame or a pin holds 120 fps** and leaves one undo step.
- **A keystroke in the code view or a style field shows in the frame within 50 ms.** Measure from the key event to the frame's next paint in Timelines.
- **Opening a project shows the first frames within 500 ms**, with one Tailwind build. `screenStyles.builds` in the console should go up by one per project open.
