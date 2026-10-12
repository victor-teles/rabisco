# 0024 · Undo history and session versions are saved in app data; a backup comes before a migration or a reload that clears history

- **Status:** accepted, partly superseded by [0033](./0033-rebase-saved-history-on-canvas-changes.md) (a canvas changed while closed is rebased into the history)
- **Date:** 2026-10-10
- **Supersedes:** part of [0023](./0023-version-history.md) (session versions last only as long as the session)
- **Extends:** [0021](./0021-generations-outlive-the-editor.md), [0005](./0005-rpc-round-trip-floor.md)
- **Code:** [`src/bun/saved-history.ts`](../../src/bun/saved-history.ts), [`src/shared/saved-history.ts`](../../src/shared/saved-history.ts), [`src/mainview/lib/saved-history.ts`](../../src/mainview/lib/saved-history.ts), [`src/mainview/lib/project-session.ts`](../../src/mainview/lib/project-session.ts), [`src/bun/project-folder.ts`](../../src/bun/project-folder.ts)

## Context

Undo history and the versions of [0023](./0023-version-history.md) (checkpoints without git, and AI changes) live in the project's session ([0021](./0021-generations-outlive-the-editor.md)). When the session ends, after a quit, a crash or an eviction, they are gone. A project without git has no other way back.

Two more paths throw work away. A reload from disk after a sync that brought in commits starts the history again. Opening a project can rewrite it: a frame whose file is missing is dropped from `rabisco.json`, and a pre-sessions `chat.jsonl` moves to `chats/`. Nothing keeps a copy.

## Decision

**History is saved per project in the app's data folder, not in the project.**

- The file is `<userData>/history/<folder-name>-<hash>.json`. The hash is the first 12 hex digits of the SHA-256 of the project's absolute path. The file also stores the path, and a file whose path differs reads as none.
- It holds the undo steps (past, present and redo), and the session versions with their snapshots. A snapshot keeps the canvas fields (frames, comments, theme, name, device, locks, sections). Its files point into one `contents` list, so file text that many steps share is stored once. The coalesce key isn't saved: a reopened project starts a new step.
- At most 16 M characters of file text are saved. The present is always saved. Then the newest versions, then the redo steps, then the newest undo steps fill the budget, and the oldest go first. History still keeps at most 200 steps and 50 versions.
- The webview packs the history and sends it in one `writeHistory` request 2 s after the last change to the steps or the versions, and when the session flushes its canvas (detach, release, before sync). Selection changes and identical steps don't write. The main process writes to a temporary file and renames it, so a crash never leaves half a file. Nothing is sent per keystroke or per pointer move ([0005](./0005-rpc-round-trip-floor.md)).
- `openProject` and `readHistory` go out together when a session loads, so they share one drain. A history that can't be read is ignored, and the project still opens.
- The browser fallback (`hutch run hmr`) has no app data folder. There, history stays in the session, as before.

**A saved history is resumed only when it still fits the folder.**

- Files that changed while the project was closed are folded into every step with `rebase`, the same way a change made outside Rabisco is folded in while the project is open. Undo never reverts them.
- If the canvas in the folder differs from the saved present, `rabisco.json` was changed outside Rabisco (for example by a `git pull`). Then the history starts again from the folder, and the state that was saved goes to a backup. The comparison ignores key order and missing lists, so a normal round trip through `rabisco.json` still matches.
- Versions are kept either way. Restoring a version is an edit ([0023](./0023-version-history.md)), so a version from before an outside change can't overwrite that change without an undo step.
- A reload from disk uses the same rule: when only files changed, the history is kept. When it must clear history, it backs up first.

**A backup comes before a migration or a reload that clears history.**

- Backups go to `<userData>/backups/<folder-name>-<hash>/<time>-<reason>/`. A backup holds the project files and `rabisco.json`, plus `chat.jsonl` and the saved history (`history.json`) when they exist. The 10 newest backups of each project are kept.
- `loadProject` backs up before it drops frames whose files are missing, and before it moves a legacy `chat.jsonl`. `openProject` returns the folder as `backup`.
- A reload or a reopen that clears history backs up the state it is about to replace. The webview sends that state with `backupProject`, because the folder already holds the new version.
- The user sees where it is: a toast with **Show** after a backup on open, and **Show backup** on the "Reloaded the project from disk" toast. Both reveal the folder in Finder.
- Legacy `userData/projects/*.json` projects are already kept as `*.json.migrated`, so their migration needs no other backup.

## Why

- **Everything is undoable** ([principle 1](../PRINCIPLES.md#1-ux-first)), across quits and crashes, with or without git.
- **The project folder stays clean.** Old copies of every screen would make a repository larger with each commit and conflict on every sync. Undo history belongs to one person on one computer. It is not part of the design.
- **Never destructive.** A saved history is used only when it fits the folder. When it doesn't, nothing is lost: the old state is in a backup.
- **The app works without AI and without git.** Saving history needs neither.

## Consequences

- Moving or renaming a project folder starts its history again. The old history file stays in app data until the next file for that path replaces it.
- Deleting a project deletes its saved history. Its backups stay in app data, at most 10 for each path.
- History and backups don't include images under `public/` ([0010](./0010-project-images-pushed-to-frames.md)), or chats other than a legacy `chat.jsonl`.
- A change made in the last 2 s before a crash can be missing from the saved history. The files and the canvas are saved on their own, sooner.
- Another computer, or another clone of the same repository, doesn't get this history. Git checkpoints ([0023](./0023-version-history.md)) remain the way to share versions.
