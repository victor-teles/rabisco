# 0002 · Build Tailwind CSS incrementally in the webview host, and share it with every frame

- **Status:** accepted
- **Date:** 2026-10-04
- **Evidence:** [bench/compile](../../bench/compile), results in `bench/compile/results/2026-10-04-macos-arm64.json`

## Context

Screens use Tailwind classes. Each frame needs CSS for the classes its screen uses, and the CSS must be ready the moment the screen renders. The requirement: **fast, and recompile only when needed**.

The options were:

1. Load the `@tailwindcss/browser` runtime inside every frame.
2. Build CSS with Tailwind's `compile()` API, in the main process or in the webview host, and inject it into frames.

## Measurements

Median times. The medium fixture uses 238 class candidates.

| Step | Webview host | Main process |
| --- | --- | --- |
| `compile()`: create a compiler from the input CSS | 1.5 ms | 27 ms |
| `build()` cold, about 240 candidates | 1.7–2.6 ms | 5.8–6.6 ms |
| `build()` with 5 new classes | 3.0 ms (p95 14 ms) | 2.3 ms |
| `build()` with no new classes | ~0 ms | 0.007 ms |
| Extract candidates from a screen's source | 0.02 ms | 0.065 ms |

| Per frame, until the first element is styled | Median | p95 |
| --- | --- | --- |
| Precompiled CSS injected as `<style>` | **8 ms** | 11 ms |
| `@tailwindcss/browser` runtime in the frame | 19 ms | 70 ms |

## Decision

**One Tailwind compiler per project, in the webview host, building incrementally. The CSS it produces is shared with every frame.**

- **Compiler:** created on project open from `@import "tailwindcss"` plus the project theme (tokens from DESIGN.md, see Phase 3). It is recreated only when the theme changes, which takes ~1.5 ms.
- **Candidates:** extracted from each file's source when that file compiles (0.02 ms), using the same cache as the TSX compile ([0001](./0001-compile-tsx-in-the-webview.md)).
- **Build only when needed:** the host keeps the union of all candidates. `build()` runs only when that set gains a class, otherwise nothing runs. A typical edit that adds a few classes costs ~3 ms.
- **Distribution:** frames receive the CSS as a stylesheet. When the CSS changes, the host pushes the new stylesheet to the open frames.
- The candidate set only grows during a session. Stale CSS for removed classes is harmless, and a full rebuild happens on the next project open.

## Why not the alternatives

- **`@tailwindcss/browser` in every frame:** 2.4× slower to first styled paint, with a long tail (70 ms p95). Every frame would pay for its own compiler (276 KB of script), parse it and scan its own DOM. With 20 screens on the canvas, that is 20 compilers instead of one.
- **Main process:** Cottontail runs this JavaScript-heavy work 5–18× slower (see [0001](./0001-compile-tsx-in-the-webview.md), finding 2). Every update would also pay the ~17.5 ms RPC round trip.

## Consequences

- The frame sandbox receives CSS from the host over `postMessage`, together with the compiled modules. Frames never compile anything themselves.
- Export (Phase 7) can produce the final CSS with the same `compile()` call, or with the regular Tailwind CLI in the exported project.
