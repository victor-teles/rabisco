# 0015 · Plan, then screens: a create is planned first, its shared parts are written before its screens

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0003](./0003-ai-provider-contract.md)
- **Code:** [`src/shared/ai/plan.ts`](../../src/shared/ai/plan.ts), [`src/bun/ai/plan-run.ts`](../../src/bun/ai/plan-run.ts), [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts), [`src/mainview/views/editor/plan-card.tsx`](../../src/mainview/views/editor/plan-card.tsx)

## Context

A `create` wrote all its screens in one run. In a flow of several screens, each screen made up its own header and tab bar, so the screens drifted apart. The user also had no say in which screens were made until they were on the canvas.

## Decision

**A create of one variation runs in two steps: a plan, then the files. The plan is text, like the theme reading ([0009](./0009-theme-read-from-design-md.md)).**

### The plan task

- The contract gets a `plan` task. The provider replies with one JSON block and writes no file. The request carries the context files, the component catalog and the paths of the project's screens, but no sources, so the step stays cheap.
- The plan lists the screens (path, name, purpose, key content), the shared components (path, PascalCase name, purpose, which screens use it) and the links between screens.
- Rabisco parses the reply at the boundary (`parsePlanReply`, then `fitPlan`). Paths must match `FILE_RULES`. A screen whose path exists gets a new path. A component the project already has, by path or by exported name, is dropped: the screens import that one. Links and users only point at planned or existing screens. At most 6 screens, 4 components and 24 links.
- An agent that writes the block to a file instead of replying still works: its files are read for the plan, then ignored.

### The plan card

- The plan shows in the chat as a checklist. The user can untick screens and components and rename a screen (its path follows). **Generate** or `↵` runs it, **Cancel** or `Esc` drops it.
- It starts by itself after 5 seconds. The countdown stops for good when the user touches the card, so reading it is never a race.
- A plan with one screen and no shared component skips the card and runs at once.
- If the plan step fails, the request runs as a one-shot create. Stop works during the plan step.

### Shell first, then screens in parallel

- On Generate, one run writes only the planned components. Then one run per screen writes only that screen, all in parallel, like variations. Each screen run gets the plan, the written components as read-only references, and its links as `data-link-to` targets.
- Each run is limited to its paths (`scopedProvider`). A screen written under another name is moved to its planned path. Other writes are dropped before validation, so the repair loop asks for what is missing.
- Every run goes through the usual validation and repair. A component that stays invalid is left out, and the screens are not told about it.
- The result is one `GenerateResult`: the components and the screens, frames in plan order, one reply written by Rabisco. So it is one undo step and one change summary.
- A failed screen run keeps the others and says which screen failed. A failed component run fails the whole create, and nothing is written.

## Why

- **Consistent flows.** The tab bar and header exist before any screen is written, so every screen imports the same one ([principle 2](../PRINCIPLES.md#2-component-based-by-default)).
- **Faster.** Screens run in parallel instead of one long run.
- **Control without a dead end.** The user sees the screens before paying for them, and does nothing if the plan is fine.
- **One contract.** The plan is a reply, so API, CLI and SDK providers support it the way they support the theme task. Code outside `src/bun/ai/providers/` doesn't know which provider made the plan.

## Consequences

- `PROMPT_VERSION` is 13: the plan task has its own system prompt, and runs that follow a plan get it in the request.
- A planned create costs one extra short request, and each screen run repeats the context. The eval (`bench/gen`, `--no-plan` to compare) measures both.
- Variations (more than one) still run as one-shot creates. Edits, repairs and requests with selected screens are not planned.
- The browser fallback runs the same orchestration on the mock provider.
