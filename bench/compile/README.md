# Compile benchmark

Measures where Rabisco should compile screen TSX and build Tailwind CSS, inside the runtimes the app actually ships with:

- **Main process:** Cottontail (JavaScriptCore, Bun-compatible APIs): `Bun.Transpiler`, `Bun.build`, Sucrase, Tailwind `compile()`
- **Webview:** WKWebView: esbuild-wasm, Sucrase, SWC wasm, Tailwind `compile()` and `@tailwindcss/browser`
- **RPC:** webview → main round trips, with and without compiling

```bash
hutch run bench:compile
```

The app runs the main-process benchmarks, opens a window for the webview benchmarks, writes `bench-results.json` to its userData directory (the path is printed as `BENCH_RESULTS_PATH`) and quits. Copy the file to `results/` to keep it.

Fixtures (`shared/fixtures.ts`) are realistic generated screens: small (16 lines), medium (157), large (753), plus a screen that imports three local components.

WebKit clamps `performance.now()` to 1 ms, so webview samples time a batch of calls and divide. The `note` field says the batch size.

The decisions taken from these numbers are in [docs/decisions](../../docs/decisions).
