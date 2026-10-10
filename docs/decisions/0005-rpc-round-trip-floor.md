# 0005 · The ~17.5 ms RPC round trip is a 16 ms poll in the main process

- **Status:** accepted (cause found by code reading plus a runtime experiment; in-app confirmation pending)
- **Date:** 2026-10-04
- **Evidence:** Electrobun devkit source in `.hutch/devkit/api` (Electrobun 2.0.2, Cottontail 0.7.1), the bench in [bench/compile](../../bench/compile), and the experiment below

## Context

[0001](./0001-compile-tsx-in-the-webview.md) measured a ~17.5 ms floor on every webview → main → webview request, whatever the payload (0 to 40 KB). That is close to one frame at 60 Hz, so a frame-aligned timer was the main suspect. The cost matters for every request on an interactive path and for how smoothly AI output can stream into frames.

## Findings

**Webview → main: no timer in the webview.** `rpc.request.x()` hands the packet to `sendMessageToHost` (`browser/index.ts:191`). That queues it and flushes straight away (`browser/index.ts:197`, `:261`), AES-GCM encrypts it and sends it over a localhost WebSocket (`browser/index.ts:85`). The native core receives it, queues it and signals a wakeup fd (`sdks/main/proc/native.ts:459`, `getHostMessageWakeupReadFD`).

**Main: the queue is drained on a 16 ms interval.** The main process can drain the native queue in two ways (`sdks/main/proc/native.ts:1438-1467`):

- Real Bun: always `startHostMessagePolling()`.
- Cottontail: read the wakeup fd with `createReadStream("/dev/null", { fd })` (`:1448`) and drain on each `data` event. If the stream errors, fall back to polling.

Polling is `setInterval(drainQueuedHostMessages, 16)` (`:1434`). An `EAGAIN` error is treated as expected and is not logged (`:1431`), so the fallback is silent. The error retry path also waits 16 ms (`:1372`).

**Cottontail always takes the fallback.** On Cottontail 0.7.1, `createReadStream` on a non-blocking pipe fd emits `error` with `EAGAIN` straight away instead of waiting for data. On a blocking pipe it delivers one chunk and then ends. A wakeup fd is a non-blocking pipe in practice, so the stream errors, and the main process polls every 16 ms.

**Main → webview: no timer.** The response is queued and flushed on a microtask (`sdks/main/core/BrowserView.ts:418`). It goes out over the socket through a synchronous FFI call, or through `evaluateJavascriptWithNoCompletion` as a fallback (`BrowserView.ts:264`). The webview's socket `message` handler dispatches it straight away (`browser/index.ts:94`).

**Why every round trip costs a full tick and not 0–16 ms.** The bench sends each request when the previous response arrives. The response leaves during a drain, and the next request reaches the queue less than 1 ms later, just after that drain. It waits one full interval, 16 ms plus macOS timer slack, which gives the ~17.5 ms measured. The p95 of ~25 ms matches an occasional missed tick.

Ruled out: `requestAnimationFrame` (not used by the transport), the 2 ms batching in `preload/internalRpc.ts` (internal RPC only), payload size, and a native timer (a `strings` search of `libElectrobunCore.dylib` shows none, which is weak evidence).

### Experiment

Run with the bundled Cottontail binary. `createReadStream("/dev/null", { fd: 0 })` on stdin:

| stdin                                | Result                                              |
| ------------------------------------ | --------------------------------------------------- |
| Non-blocking pipe (`O_NONBLOCK`)     | `error` with `EAGAIN` immediately, before any data  |
| Blocking pipe, 3 writes 300 ms apart | one `data` event, then `end`; later writes are lost |

### Still to confirm in the app

1. Wrap `globalThis.setInterval` before importing `electrobun/main` and log calls with a 16 ms delay.
2. Fire N pings with `Promise.all`. With polling, the total stays near 17.5 ms for N = 1…50, because one drain handles up to 4 × 256 packets (`native.ts:1326-1327`).

## Decision

**Treat a webview → main request as costing one 16 ms tick, and design around it. Don't patch the devkit.**

1. **Push, don't request.** Main → webview has no timer. Anything that streams or updates often goes from main to the webview as an RPC _message_: `filesChanged`, `generationStep`, and AI output into frames in Phase 2.
2. **Keep requests off interactive paths.** Compiling and Tailwind already run in the webview ([0001](./0001-compile-tsx-in-the-webview.md), [0002](./0002-incremental-tailwind-in-the-host.md)). Saves (`writeFiles`, `saveCanvas`) are fire-and-forget from the UI's point of view: the UI updates first, and the write completes in the background.
3. **Batch when requests are unavoidable.** Requests sent together, without awaiting each one, share one drain. One `writeFiles` with many changes is better than many single-file writes.
4. **Report it upstream.** The fix belongs in Cottontail (`createReadStream` should wait for readability on a non-blocking fd) or Electrobun (use a poll that doesn't rely on it, or log the fallback). Once fixed, the floor should drop to around 1 ms with no change in Rabisco.

## Alternatives not taken

- **Our own channel** (a localhost WebSocket served from main, or `__electrobunHostBridge.postMessage`, which reaches the handler without the drain, `native.ts:3534`). It would remove the floor but would duplicate auth and encryption that Electrobun already does, and it depends on Cottontail APIs that haven't been checked. Reconsider only if the upstream fix doesn't arrive and a hot path needs requests.
- **Patching `native.ts` locally.** The devkit is regenerated by Hutch, so the patch would be lost.

## Consequences

- RPC requests are fine for user actions (open, create, generate), where 17 ms can't be noticed.
- When the upstream fix lands, rerun `bench/compile` and update this record.
