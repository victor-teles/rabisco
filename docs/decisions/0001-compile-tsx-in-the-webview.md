# 0001 · Compile screen TSX in the webview, with Sucrase

- **Status:** accepted
- **Date:** 2026-10-04
- **Evidence:** [bench/compile](../../bench/compile), results in `bench/compile/results/2026-10-04-macos-arm64.json` (Apple Silicon, Electrobun 2.0.2, Cottontail 0.7.1)

## Context

Screens are React components written in TSX ([principle 3](../PRINCIPLES.md#3-screens-are-react)). Before a frame can render a screen, the TSX must become JavaScript. There were two places to do that:

1. **Main process** (Cottontail): native `Bun.Transpiler` or `Bun.build`.
2. **Webview** (WKWebView): esbuild-wasm, SWC wasm or Sucrase.

## Measurements

Median time per compile. The medium fixture is a 157-line screen, the large one has 753 lines.

| Compiler | Where | Medium | Large | Cold start | Size cost |
| --- | --- | --- | --- | --- | --- |
| `Bun.Transpiler` | main | 0.011 ms | 0.047 ms | 0.8 ms | none (native) |
| `Bun.build` | main | 0.59 ms | 1.58 ms | 4.9 ms | none (native) |
| Sucrase | webview | **0.30 ms** | **1.35 ms** | 4 ms | ~1.5 MB unminified JS |
| SWC (wasm) | webview | 0.40 ms | 1.35 ms | 68 ms init | 17 MB wasm |
| esbuild (wasm) | webview | 1.8 ms | 5.1 ms | 81–314 ms init | 13 MB wasm |

| Cost | Median |
| --- | --- |
| RPC round trip webview → main, any payload from 0 to 40 KB | **~17.5 ms** |
| Compile in main as seen from the webview (round trip included) | ~17.5 ms |
| Sucrase in the main process (pure JS) | 15.5 ms (medium), 77 ms (large) |

## Findings

1. **The RPC round trip dominates.** It costs ~17.5 ms whatever the payload size. Compiling costs well under 2 ms in either process. Where the compile runs matters much less than whether a round trip happens.
2. **Pure JavaScript is ~50× slower in Cottontail than in WKWebView.** Sucrase took 15.5 ms vs 0.3 ms, and Tailwind took 27 ms vs 1.5 ms to initialise. Cottontail's JavaScriptCore appears to run without the optimising JIT. Native APIs (`Bun.*`) are fast, but any JavaScript-heavy work belongs in the webview.
3. **`Bun.Transpiler.transformSync` is not usable on its own.** It always emits dev-mode JSX helpers with hashed names (`jsxDEV_7x81h0kn`) and no import, and it ignores the tsconfig JSX settings. React's production `jsx-dev-runtime` exports `jsxDEV` as `undefined`, so a shim would be needed. `Bun.build` produces correct output.
4. **`Bun.build` resolves extensionless imports only from disk**, not from in-memory `files`.

## Decision

**Compile TSX in the webview, using Sucrase.**

- The interactive path is the one that UX first cares about: inline text edits, inspector changes, and drag-to-change in Phase 6. That path starts in the webview. Compiling there takes ~0.3 ms instead of a ~17.5 ms round trip, so it is about 50× faster.
- For changes that start in the main process (AI output, files edited in an external editor), the cost is the same either way: one message to the webview. Sending source instead of compiled code costs nothing extra.
- Sucrase is the fastest webview option at every size, and it needs no wasm and no initialisation step. SWC is close in speed but costs 68 ms to initialise and 17 MB. esbuild-wasm is 4–6× slower.

### How it works

- The main process owns files on disk and pushes **source** to the webview: on project open, on external file changes and while AI output streams in.
- The webview compiles each file **separately** with Sucrase (`transforms: ["typescript", "jsx"]`, `jsxRuntime: "automatic"`, `production: true`).
- Modules link at runtime inside the frame. `react`, `lucide-react` and `@/components/ui/*` come from the screen runtime. Project files (`../components/*`) come from a module registry fed by the host.
- **Recompile only when needed.** Each compiled file is cached by a content hash. A change recompiles that one file. Only the frames whose module graph includes it re-render.

## Consequences

- Screens are not bundled. Import resolution is part of the screen runtime (Phase 1), which also gives Rabisco a natural place to add hot reload per file.
- Sucrase only strips types and transforms JSX. It does not type-check. Type errors surface as runtime errors in the frame, which is acceptable for previews. Type-checking can be added later as a background lint step, off the hot path.
- `Bun.build` stays available in the main process for export (Phase 7), where bundling a screen with its components from disk takes ~0.5 ms.
- **Follow-up:** find out why the RPC round trip has a ~17.5 ms floor (it looks like one frame at 60 Hz). That cost also limits how smooth AI streaming into frames can be.
