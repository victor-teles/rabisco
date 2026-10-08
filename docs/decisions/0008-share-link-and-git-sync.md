# 0008 · Share links are a local viewer; git sync uses the git CLI

- **Status:** accepted
- **Date:** 2026-10-04

## Context

Phase 7 asks for a read-only link to a project and for sync to a git repository. Rabisco has no server and no accounts, and it should not need them: the project is a folder on the user's computer ([principle 5](../PRINCIPLES.md#5-context-is-a-file)). The link must show the screens exactly as the canvas does, and the git integration must never lose work or hang waiting for a password.

## Decision

**A share link is a static viewer, served from memory by the main process on the local network.**

- **The viewer is a static site:** `index.html` (screen list, back, restart), `viewer.js`, `snapshot.js` and `runtime/frame.html` (`src/shared/share/viewer.ts`). It plays the screens with the real screen runtime in a sandboxed frame (`allow-scripts` only), in play mode, so `data-link-to` links work ([0007](./0007-prototype-links-in-source.md)). The screen is in the URL hash, so the browser's back button works.
- **The webview builds the snapshot** (`src/mainview/lib/share-snapshot.ts`), because that is where TSX compiles and Tailwind builds ([0001](./0001-compile-tsx-in-the-webview.md), [0002](./0002-incremental-tailwind-in-the-host.md)). The snapshot holds the compiled modules of every picked screen, the shared stylesheet and the CSS of the applied DESIGN.md tokens. Alternates are left out.
- **The main process adds the runtime and serves it** (`src/bun/share.ts`). It reads `frame.html` and `frame.js` from the app bundle (`views/mainview/runtime`), so the runtime doesn't travel over RPC. `frame.js` is inlined into `frame.html`, because browsers don't let a sandboxed `file://` frame load other files.
- **The server is read-only.** `Bun.serve` on `0.0.0.0` with a random port, GET and HEAD only, and a random 144-bit token as the first path segment. It serves only the snapshot files in memory, never the file system. `frame.html` also gets `Content-Security-Policy: sandbox allow-scripts`, so the screen stays sandboxed even when someone opens it on its own. The server runs only while something is shared.
- **Updates are explicit.** "Update link" sends a new snapshot and keeps the URL. The popover shows when the design changed since the last update. "Stop sharing", or closing the project, ends the link, and sharing again makes a new one.
- **"Export as website…"** writes the same files to a folder. It works from any path, on any static host and from `file://`.

**Git sync runs the system `git` in the project folder** (`src/bun/git.ts`).

- **Scoped to the project folder.** Every command uses the pathspec `.` from the project folder, so a project inside a bigger repository only stages and commits its own files (`commit -- .`). Other staged changes stay staged.
- **Sync = commit, rebase, push.** Rabisco commits local changes with a generated message (`Rabisco: add settings screen, update DESIGN.md`, with the files in the body; `src/shared/git.ts`). Then it fetches, rebases onto the upstream (or onto `<remote>/<branch>` before the first push), and pushes. The first push sets the upstream.
- **Never destructive.** No force push. A failed rebase is aborted, so the repository is left as it was, with Rabisco's commit kept locally. Rabisco shows git's error and its output.
- **Never hangs.** `GIT_TERMINAL_PROMPT=0`, SSH in batch mode, no editor, and a timeout on every command (90 s for the network). Missing git, a missing identity and authentication failures each get a sentence that says what to do.
- **Pulled files reach the canvas through the folder watcher**, like edits made in another editor: `ProjectWatcher` sees the changed files and pushes `filesChanged`, and the editor rebases its undo history onto them.

## Why

- No account, no upload: the link costs nothing, works offline on a LAN and the design never leaves the computer.
- The same runtime, compiled modules and CSS as the canvas: what people see through the link is what the designer sees ([principle 3](../PRINCIPLES.md#3-screens-are-react)).
- The `git` CLI already has the user's credentials (keychain helpers, SSH keys) and their config. Rabisco only needs to call it safely.

## Consequences

- The link works only on the same network, and only while Rabisco is open with the project. To share more widely, export the website and host it, or push to git. A hosted relay would need a new decision.
- The first share may trigger the macOS firewall prompt for incoming connections.
- `rabisco.json` isn't watched: canvas layout pulled from git appears when the project is opened again, and the editor may write its in-memory canvas over it before that.
- The snapshot contains the TSX source of each module (frames use it for error excerpts). People with the link can read the code, which is the design.
