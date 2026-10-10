# 0017 · "Improve prompt" is a `brief` reply; quick tasks run on an optional fast model chosen in the main process

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0003](./0003-ai-provider-contract.md)
- **Code:** [`src/bun/ai/brief.ts`](../../src/bun/ai/brief.ts), `modelForTask` in [`src/shared/ai/settings.ts`](../../src/shared/ai/settings.ts), `resolveFor` in [`src/bun/ai/service.ts`](../../src/bun/ai/service.ts), [`src/mainview/hooks/use-improve-prompt.ts`](../../src/mainview/hooks/use-improve-prompt.ts)

## Context

Phase 16 adds three things that touch the provider layer:

- **Improve prompt.** A short prompt ("a budget app") gives the model little to work with. The composer should turn it into a brief, with PRODUCT.md, that the user edits before sending. On Home there is no project yet.
- **Model per task.** A create needs the best model. Edits, plans, theme reads and context files are shorter and run more often, so a cheaper or faster model fits them.
- **Auto style.** A new project can write DESIGN.md from its first prompt before the screens.

## Decision

**The brief is a reply, like the theme ([0009](./0009-theme-read-from-design-md.md)) and the plan ([0015](./0015-plan-then-screens.md)).**

- The contract gets a `brief` task. The request carries the prompt and the context files with content, and no files, components or history. The provider replies with the brief as plain text and writes nothing; file events are dropped.
- It has its own RPC, `improvePrompt`, because Home has no project path. It streams through `generationEvent` and stops with `stopGeneration`, like a generation.
- The brief streams into the composer in place of the prompt. It is never sent by itself. "Undo improve", or one `⌘Z` in the field, puts the original back. Stop or an error also puts it back.

**An optional fast model, picked in Settings, runs the quick tasks. The main process chooses the model, so the webview doesn't know the routing.**

- `providers.json` gets an optional `fastModel` (a `ModelRef`). Files without it still load. Removing its provider clears it.
- `FAST_TASKS` are `edit`, `repair`, `context`, `theme`, `plan` and `brief`. `create`, `vary` and the screens of a planned create keep the model picked in the composer. The webview always sends the picked model; for a fast task the service uses `fastModel` instead, when it is set and available, else the picked one.
- Point and prompt and Mix are edits, so they run on the fast model. The repair loop inside a run uses that run's model, so a create's repairs stay on the create's model.

**Auto writes DESIGN.md with the existing `context` task.** With no screens to read, the context task writes DESIGN.md from the request: the look it describes and PRODUCT.md. The webview applies it, and its tokens, as one undo step before the plan, so undoing the screens keeps the look. A failure, or a DESIGN.md without tokens, starts from Minimal and says so in the chat.

## Why

- **One contract.** A text reply works the same for API, CLI and SDK providers, as the theme and plan tasks already show.
- **Providers stay interchangeable.** Code outside `src/bun/ai/providers/` sees model refs and task names only.
- **Cost where it counts.** The quality of new screens comes from the picked model; the frequent small runs get cheaper and faster.

## Consequences

- `PROMPT_VERSION` 14: the brief has its own system prompt, and the context task writes DESIGN.md from the prompt when there are no screens.
- A fast model that is too weak makes worse edits. The Settings row says which tasks it runs, and "Same as picked" turns it off.
- The browser fallback runs the brief on the mock provider.
