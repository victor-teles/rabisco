# 0020 · Plan mode: a create is planned only when the user turns it on, and the plan waits for approval

- **Status:** accepted
- **Date:** 2026-10-10
- **Supersedes:** in [0015](./0015-plan-then-screens.md), "a create of one variation is planned first", the 5 second auto-start and the skipped card for a one-screen plan
- **Code:** [`src/mainview/hooks/use-plan-mode.ts`](../../src/mainview/hooks/use-plan-mode.ts), `plansFirst` in [`src/shared/ai/plan.ts`](../../src/shared/ai/plan.ts), [`src/mainview/lib/generation-session.ts`](../../src/mainview/lib/generation-session.ts), [`src/mainview/views/editor/plan-card.tsx`](../../src/mainview/views/editor/plan-card.tsx)

## Context

With 0015, every create ran a plan step first, and the plan started by itself after 5 seconds. Users asked for planning to be a choice, and for a plan to run only when they approve it. A countdown makes the user race the card, and a plan that starts by itself is not an approval.

## Decision

- **Plan mode is a toggle in the composer.** "Plan first" sits next to the variations picker, on Home and in the chat. It is off by default. The choice is stored in `localStorage`, like the variations count.
- **The shortcut is `⇧⌘P`** while the prompt has focus. Claude Code uses `⇧⇥`, but in a text field `⇧⇥` moves focus back, and keyboard users need it to leave the composer. `⇧⌘P` is free in Rabisco, needs ⌘ so it can't be typed, and `P` is for plan.
- **Off:** a create runs in one go, with no plan step. This is the create from before 0015.
- **On:** a create of one variation with no selection runs the plan task. The plan card waits until the user acts. Generate or `↵` runs it, Cancel or `Esc` drops it. Unticking and renaming stay. A one-screen plan also shows the card.
- **A reply revises the plan.** While a plan waits, a message with no selection, focus or command is feedback. The plan task runs again with the first prompt, the plan and the message. The new plan replaces the card. If that step fails or is stopped, the old plan comes back. The run that follows gets the first prompt and the feedback.
- **Other requests drop the plan.** An edit of the selection or a command replaces the waiting plan, and the chat says so.
- With selected screens or more than one variation, the toggle is dimmed and its tooltip says why.
- If the plan step fails, the request still runs as a one-shot create (no dead end).

## Why

- **The user decides.** A plan costs a request and a stop, so it is opt-in. Generation is never started by a timer ([principle 1](../PRINCIPLES.md#1-ux-first)).
- **One code path for off.** Off is the one-shot create that variations already use, so there is no hidden planning.
- **Feedback in the chat** reads like any reply, and keeps the composer usable while a plan waits.

## Consequences

- Shared shell first ([0015](./0015-plan-then-screens.md)) only runs in plan mode. Without it, screens of a flow can drift apart again.
- The eval (`bench/gen`) runs one-shot creates by default. `--plan` runs the plan step and accepts the plan as it is.
