# AGENTS.md

Rules for AI agents working in this repository. Read [docs/PRINCIPLES.md](docs/PRINCIPLES.md) before a product or design decision, and [docs/decisions/](docs/decisions/README.md) before you change architecture.

## Project

Rabisco is an AI-first design canvas. You describe an app and get editable screens on an infinite canvas. Each screen is a React component in TSX, styled with Tailwind.

- **Runtime:** [Electrobun](https://framework.blackboard.sh/electrobun/) 2.x, managed by Hutch. Electrobun is NOT Electron. Do not use Electron APIs or patterns. See [llms.txt](llms.txt).
- **Package manager:** Bun. Do not use npm, yarn or pnpm.
- **UI:** React 19, Tailwind v4, [shadcn/ui](https://ui.shadcn.com) and blocks from [uai](https://uaiblocks.vercel.app).

## Layout

| Path                              | What                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `src/bun/`                        | Main process (Cottontail): window, RPC handlers, project store, git       |
| `src/bun/ai/`                     | AI provider layer (decision 0003). Every provider implements one contract |
| `src/shared/`                     | Types, the RPC schema and the AI contract shared by both sides            |
| `src/mainview/`                   | Webview (React). `@/*` resolves here                                      |
| `src/mainview/runtime/`           | Sandboxed screen runtime that renders generated TSX in frames             |
| `src/mainview/lib/render/`        | Compile (Sucrase), Tailwind build, frame host and protocol                |
| `src/mainview/components/ui/`     | shadcn primitives                                                         |
| `src/mainview/components/ui/uai/` | uai blocks                                                                |
| `docs/decisions/`                 | Architecture decision records                                             |
| `tools/oxlint/anti-slop/`         | Vendored lint rules. Do not edit; see `UPSTREAM.md`                       |

## Commands

Run tasks through Hutch (`hutch.config.ts`):

```bash
hutch run dev          # build the UI and launch the app, rebuild on changes
hutch run hmr          # UI only in the browser at http://localhost:5173 (RPC falls back to localStorage)
hutch run typecheck    # tsc --noEmit
hutch run lint         # oxlint with the anti-slop rules
hutch run fmt          # oxfmt
bun test               # all tests; bun test <path> for one file
```

Before you finish a change, run `hutch run typecheck`, `hutch run lint`, `hutch run fmt:check` and the tests that cover the files you touched. Report failures as they are. Do not skip or weaken a check to make it pass.

## UI kit: shadcn and uai

This project uses shadcn/ui (style `new-york`, base color `neutral`, icons from `lucide-react`) and the uai theme and blocks from https://uaiblocks.vercel.app. The `@uai` registry is configured in `components.json`.

- **Reuse before you build.** Check `src/mainview/components/ui/` and `ui/uai/` first. Then check the shadcn catalog and the uai catalog at https://uaiblocks.vercel.app. Hand-write a component only when neither has one.
- **Add a shadcn primitive:** `bunx --bun shadcn@latest add <name>`.
- **Add a uai block:** `bunx --bun shadcn@latest add @uai/<name>`.
- After you add a component, check its imports. The CLI sometimes writes `from "cn"`. Change it to `@/lib/utils` (shadcn) or `@/lib/uai-utils` (uai).
- Treat generated primitives as owned code. Small edits are fine; keep them close to upstream so you can update them later.
- Use the theme's CSS variables and semantic classes (`bg-background`, `text-muted-foreground`, `border-border`). Do not hard-code colors.
- Merge class names with `cn()`. Build variants with `class-variance-authority`.
- Use `sonner` for toasts and `lucide-react` for icons. Do not add another icon or toast library.
- Keep the editor chrome quiet so the designs carry the color (Principle 1, "Calm interface").

## Architecture rules

- **Decisions are binding.** Follow the records in `docs/decisions/`. To change one, write a new record that supersedes it and add it to the table in `docs/decisions/README.md`.
- **Screens are sandboxed.** Generated screen code renders in isolated frames and must never reach the app, the RPC layer or the file system.
- **Providers are interchangeable.** Code outside `src/bun/ai/providers/` must not know which provider is active. Credentials stay in the keychain and never go into project files.
- **The app works without AI.** Opening and editing a project must not require a configured provider.
- **Everything is undoable.** Any new mutation of a project, including AI edits, goes through history.
- **Keep RPC off hot paths.** A round trip costs ~17.5 ms (decision 0005). Push, batch, and do not call RPC per frame or per pointer move.
- **Components come from source.** Component tools read the TSX source, not the rendered DOM (decision 0006).
- **Keyboard first.** A new frequent action needs a shortcut that follows Figma conventions. Add it to the shortcut table in `README.md`.

## Code style

The formatter and linter enforce most style. Run them; do not argue with them.

- Tabs, 120 columns (oxfmt).
- TypeScript strict. No unused locals or parameters.
- Anti-slop rules are errors. In practice:
  - Every `as` assertion (except `as const`) needs a nearby `// SAFETY:` comment that says why it holds. Prefer a type guard or parsing.
  - No `unknown` parameters, returns or type aliases, and no `object` parameters. Parse external input at the boundary into a named type.
  - No `.filter().map()` chains, no spreading accumulators in `reduce`, no `...(cond ? x : {})`.
  - No `Reflect.get` or `Reflect.apply`.
  - No shape words in names (`userObject`, `itemsArray`).
  - Separate declarations and logical groups of statements with a blank line.
- Write code that reads like the code around it. Match its naming and idiom.
- Do not add comments, including JSDoc. Let names and structure explain the code. The only exception is the `// SAFETY:` comment the lint rule requires.
- Keep diffs in scope. Do not refactor or reformat unrelated code.

## Tests

- Use `bun:test`. Put tests next to the source as `*.test.ts`.
- No module mocking. Replace dependencies through real interfaces (for example the mock provider in `src/bun/ai/providers/mock.ts`).
- Use the helpers in `src/bun/test-utils.ts` (`tempDir`, `compileTsx`, `renderScreen`) for file system and rendering tests.
- Add or update tests when you change behavior.

## Docs

- Update `README.md` when you change commands, layout or shortcuts.
- Update `docs/ROADMAP.md` when you finish or change a planned item.
- Write in plain, short sentences.

## Git

- Do not commit, push or open a PR unless the user asks.
- Commit messages: imperative mood, sentence case, no prefix (for example "Fix Phase 8 bugs and bundle the Claude binary in the app").
