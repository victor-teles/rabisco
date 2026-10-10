# Generation eval

Measures what the AI makes, so a prompt change (`src/bun/ai/prompt.ts`, `PROMPT_VERSION`) shows its effect. It is the "Measure first" step of Phase 16 ([ROADMAP](../../docs/ROADMAP.md)) and also covers the "Real providers" checks of Phase 8.

The eval runs 12 fixed briefs (`briefs.ts`) through Rabisco's real AI layer (`createAiService`), with the same requests, repairs and validation as the app. Each result is written as a normal project folder, then scored from its files. Nothing is rendered here.

## Run it

```bash
hutch run bench:gen -- --list                         # providers and models in the app's settings
hutch run bench:gen -- --model claude-code:opus       # every brief against one model
hutch run bench:gen -- --model codex:gpt-5 --only bank-home,pricing-focus
hutch run bench:gen -- --mock                         # the mock provider: no AI, a smoke test of the eval
hutch run bench:gen -- --model claude-code:opus --style minimal   # briefs without a DESIGN.md start from a style
```

| Flag                | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `--model <ref>`     | `<provider>:<model>`, as listed by `--list`. Required unless `--mock`                      |
| `--mock`            | Runs the mock provider with a temporary settings folder                                    |
| `--list`            | Lists providers, their health and their models, then exits                                 |
| `--only <ids>`      | Comma-separated brief ids                                                                  |
| `--style <id>`      | Briefs without a DESIGN.md start from this style: minimal, editorial, playful, dense, bold |
| `--no-plan`         | Create briefs run in one go, without the plan step, to compare with plans                  |
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

Like the editor, a create brief with one variation is planned first ([decision 0015](../../docs/decisions/0015-plan-then-screens.md)): the plan step runs, the plan is accepted as it is, then its shared components and its screens are written. Time, tokens and cost include the plan. `--no-plan` runs the old one-shot create.

`<out>/report.json` holds `promptVersion`, `plan` (whether plans ran), `model`, `date`, the scores of each brief and the totals. The run prints one row per brief and the totals, or the change against `--baseline`.

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

With `--baseline`, a metric is "better" when it moves the right way: fewer errors, repairs, raw colors and lines outside the focus; more reuse and token use. Wall time, tokens and cost vary between runs; compare them over a few runs.

## Layout checks

Overflow, clipped text, overlaps, contrast and the other layout checks need a browser, so this eval can't run them. Open a brief's folder in Rabisco and run "Check design" from the command palette (⌘K). It lists the layout and color findings for the selected screens, or every screen, and "Copy JSON" copies them per screen file.
