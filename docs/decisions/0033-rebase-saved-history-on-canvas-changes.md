# 0033 · A canvas changed while the project was closed is rebased into the saved history

- **Status:** accepted
- **Date:** 2026-10-12
- **Supersedes:** part of [0024](./0024-history-in-app-data.md) (history starts again when `rabisco.json` changed outside Rabisco)
- **Code:** [`src/mainview/lib/saved-history.ts`](../../src/mainview/lib/saved-history.ts), [`src/mainview/lib/canvas-rebase.ts`](../../src/mainview/lib/canvas-rebase.ts)

## Context

[0024](./0024-history-in-app-data.md) resumes a saved history only when the canvas in the folder matches the saved present. Any outside change to `rabisco.json`, for example a `git pull` that moved one frame, starts the history again. Undo then can't reach the changes made before the app was closed.

While a project is open, an outside change to `rabisco.json` is already folded into every undo step with `rebaseCanvas`. Reopening a project should follow the same rule.

## Decision

**When the project opens, or reloads from disk, the saved history is rebased onto the folder's canvas.**

- Changed files are folded in with `rebase`, as before. Then the difference between the saved present and the folder's canvas is folded into every step with `rebaseCanvas`. The difference covers frames, comments, sections, images, name, device, theme and locks.
- Undo never reverts the outside change. Local changes to other frames stay in their steps.
- If the rebased present still differs from the folder's canvas, the rebase can't apply. For example, the frames were only reordered, which `rebaseCanvas` doesn't track. Then the 0024 rule holds: history starts again from the folder and the saved state goes to a backup.

## Why

- **Everything is undoable** ([principle 1](../PRINCIPLES.md#1-ux-first)). A `git pull` while the app was closed no longer clears undo.
- **One rule for outside changes.** Open or closed, an outside change to `rabisco.json` is folded in the same way.
- **Never destructive.** When the result can't be checked against the folder, history starts again and the old state is backed up, as in 0024.

## Consequences

- A reload from disk after a sync keeps history in more cases, and backs up less often.
- An outside change that only reorders frames still clears history.
