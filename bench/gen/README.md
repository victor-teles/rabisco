# Generation eval

Measures what the AI makes, so a prompt change (`src/bun/ai/prompt.ts`, `PROMPT_VERSION`) shows its effect. It is the "Measure first" step of Phase 16 ([ROADMAP](../../docs/ROADMAP.md)) and also covers the "Real providers" checks of Phase 8.

The eval runs 12 fixed briefs (`briefs.ts`) through Rabisco's real AI layer (`createAiService`), with the same requests, repairs and validation as the app. Each result is written as a normal project folder, then scored from its files. Then the screens it wrote are rendered in headless Chrome for the layout checks.

## Run it

```bash
hutch run bench:gen -- --list                         # providers and models in the app's settings
hutch run bench:gen -- --model claude-code:opus       # every brief against one model
hutch run bench:gen -- --model codex:gpt-5 --only bank-home,pricing-focus
hutch run bench:gen -- --mock                         # the mock provider: no AI, a smoke test of the eval
hutch run bench:gen -- --model claude-code:opus --style minimal   # briefs without a DESIGN.md start from a style
hutch run bench:gen -- --rescore bench/gen/runs/<run>  # layout checks only, on a run you already have
```

| Flag                | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `--model <ref>`     | `<provider>:<model>`, as listed by `--list`. Required unless `--mock`                      |
| `--mock`            | Runs the mock provider with a temporary settings folder                                    |
| `--list`            | Lists providers, their health and their models, then exits                                 |
| `--only <ids>`      | Comma-separated brief ids                                                                  |
| `--style <id>`      | Briefs without a DESIGN.md start from this style: minimal, editorial, playful, dense, bold |
| `--plan`            | Plans create briefs first and accepts each plan as it is, like plan mode in the editor     |
| `--no-plan`         | The default: create briefs run in one go. Kept so older commands still work                |
| `--no-layout`       | Skips the layout checks in headless Chrome                                                 |
| `--rescore <dir>`   | Runs only the layout checks on the projects of an earlier run and updates its report.json  |
| `--user-data <dir>` | Folder with `providers.json`. Default: the app's, the installed app before a dev run       |
| `--out <dir>`       | Default `bench/gen/runs/<time>-<model>/` (ignored by git)                                  |
| `--baseline <file>` | A previous `report.json`; prints each total's change                                       |
| `--parallel <n>`    | Briefs at a time. Default 1, since CLI providers may rate limit                            |
| `--timeout <s>`     | Stops a brief after this long. Default 900                                                 |

API keys come from the keychain, like in the app. A brief that fails is recorded with its error code; the run goes on. The command exits with code 1 when any brief failed.

## The briefs

They cover phone, tablet and desktop; empty projects and themed ones; and every task. Themed projects have a PRODUCT.md, a DESIGN.md with a `## Tokens` section (custom tokens included) and two project components. Edit, focus and vary briefs start from a small hand-written screen.

| Task   | What it asks                                                           |
| ------ | ---------------------------------------------------------------------- |
| create | New screens, one screen or a flow of several                           |
| edit   | A change to a seed screen                                              |
| focus  | Point and prompt: an edit with `focus` on one element of a seed screen |
| vary   | New alternates of a seed screen (`variations: 2`)                      |

A tablet brief generates as tablet, at 834×1194. Runs from before prompt v12 designed tablet briefs at 390×844, so compare their tablet scores with care.

Change the briefs only together with a new baseline. Scores compare across runs of the same briefs.

## Output

Each brief becomes `<out>/<brief>.rabisco/`, with its files, `rabisco.json` (new frames placed as the editor places them) and a chat with the prompt and the reply. Open it in Rabisco to look at the screens.

Like the editor with plan mode off ([decision 0020](../../docs/decisions/0020-plan-mode.md)), a create brief runs in one go. With `--plan`, a create brief with one variation is planned first ([decision 0015](../../docs/decisions/0015-plan-then-screens.md)): the plan step runs, the plan is accepted as it is, then its shared components and its screens are written. Time, tokens and cost include the plan.

`<out>/report.json` holds `promptVersion`, `plan` (whether plans ran), `layout` (the browser, or why the checks were skipped), `model`, `date`, the scores of each brief and the totals. The run prints one row per brief and the totals, or the change against `--baseline`.

## What each score means

| Score                | Meaning                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| ok / error           | The generation returned files, or the error code it failed with (`rate_limited`, `invalid_output`…)         |
| repairs              | Repair attempts after the first try (from the attempt number of the generation events)                      |
| problems             | Problems left after the repairs; those files were not written                                               |
| files                | Screens (`s`) and components (`c`) written                                                                  |
| time                 | Wall time of the generation, repairs included                                                               |
| tokens, cost         | Input and output tokens and cost in USD, when the provider reports them                                     |
| raw colors           | `raw-color` findings of `sourceFindings` (`src/shared/design/source-checks.ts`) in the written files        |
| source findings      | Every source finding in the written files                                                                   |
| reuse                | Project components that new screens import, out of those the project had. Totals count create and vary      |
| ui / uai             | `@/components/ui/*` primitives and `@/components/ui/uai/*` blocks imported by the written files             |
| tokens               | Themed briefs: custom DESIGN.md tokens the written files use through their classes, out of those defined    |
| custom token classes | Uses of those classes (`bg-brand`, `hover:text-brand/80`, `rounded-card`)                                   |
| focus out            | Focus briefs: changed lines outside the focused element (`focus-guard.ts`). A deleted file counts all lines |
| plan                 | Create briefs: a plan ran first, and how many of its shared components were written                         |
| layout               | Layout findings on the written screens: errors (`e`), warnings (`w`) and screens that failed to render      |

With `--baseline`, a metric is "better" when it moves the right way: fewer errors, repairs, raw colors, layout findings and lines outside the focus; more reuse and token use. A total that one of the two reports doesn't have (layout before this check, or a run with `--no-layout`) shows no change. Wall time, tokens and cost vary between runs; compare them over a few runs.

## Layout checks

Overflow, clipped text, overlaps, contrast, empty containers and font sizes need a rendered screen. After the briefs run, the eval renders every screen the brief wrote (new screens, alternates and changed seeds) and runs the same checks as "Check design" in the app (`src/mainview/runtime/design-lint.ts`, `src/shared/design/layout-checks.ts`).

How it works (`layout.ts`, `layout-page.ts`):

1. It builds the screen runtime (`vite.runtime.config.ts`) into a temporary folder, so the checks match the current source.
2. Bun compiles each screen and its imports with the app's compiler (Sucrase) and builds its Tailwind CSS and DESIGN.md theme, like the editor does.
3. A local server serves a small page and the runtime. `playwright-core` opens the page in headless Chrome. The page puts each screen in a sandboxed frame at its frame size, sends it over the frame protocol (`modules`, then `measure` to grow it to its content, then `lint`), and returns the findings.
4. Findings get their file and line. An edit, focus or vary brief also renders its seed screen; findings the seed already had don't count, so only what the model added is scored.

Each brief's score has `layout`: the screens checked, the screens that failed to render (with the error), errors, warnings, counts by rule and every finding with its path and line. The totals add `layout errors`, `layout warnings` and one row per rule. Lower is better.

It drives the Google Chrome you have installed (`channel: "chrome"`); it downloads no browser. Without Chrome, the eval prints why, skips the layout checks and keeps the other scores. `bun install` adds `playwright-core`.

The app renders screens in WKWebView (WebKit), and the eval in Chrome (Blink). Text metrics, font fallback and some CSS details differ, so a clipped-text or overlap finding can show in one and not the other. Compare layout totals between runs of the eval, not with the app. To see a finding in the app, open the brief's folder in Rabisco and run "Check design" from the command palette (⌘K).

`--rescore <run dir>` runs only the layout checks on an earlier run's projects. It adds `layout` to each brief in that run's `report.json` and the layout rows to its totals; nothing is generated again.
