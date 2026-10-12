# 0032 · Antigravity CLI replaces Gemini CLI

- **Status:** accepted
- **Date:** 2026-10-11
- **Supersedes:** the Gemini CLI parts of [0012](./0012-chat-sessions-and-provider-commands.md)
- **Code:** [`src/bun/ai/providers/antigravity.ts`](../../src/bun/ai/providers/antigravity.ts), [`src/bun/ai/settings-store.ts`](../../src/bun/ai/settings-store.ts), [`src/bun/ai/commands.ts`](../../src/bun/ai/commands.ts)

## Context

Gemini CLI is deprecated. Google's agent CLI is now the Antigravity CLI (`agy`). It signs in with the same Google account and runs Gemini models, and also Claude and GPT-OSS models.

## Decision

- The `gemini-cli` provider type is removed. A new `antigravity` type runs `agy --print` with `--output-format stream-json`, `--mode accept-edits` and `--disable-slash-commands` in the staging folder.
- The run uses a custom agent, `--agent rabisco`, that Rabisco writes to `.agents/agents/rabisco.md` in the staging folder. Its only tools are file tools: view, list, find, grep, write and replace. The default agent runs `ls` first. Headless mode denies the command, and agy then ends the turn without writing.
- Any other denied action shows as a status line. Rabisco never passes `--dangerously-skip-permissions`.
- `agy` runs in the real path of the staging folder. On macOS the temp folder is a symlink (`/var` → `/private/var`), and `agy` denies writes when its working folder is not the real path.
- Models come from `agy models`, with a short built-in list as a fallback.
- Commands are Antigravity workflows: Markdown files in `~/.gemini/config/global_workflows` and the project's `.agents/workflows`. TOML commands are no longer read.
- A saved `gemini-cli` provider loads as an `antigravity` provider with the default label. Its binary path and models are dropped, and so is a default or fast model that pointed to it.

## Why

- **Bring your own AI.** Users of Gemini models keep a CLI that uses their subscription.
- **Same isolation.** Writes go only to the staging folder, which Rabisco diffs. The agent has no terminal, browser or MCP tools, like Claude Code with `--tools`.

## Consequences

- Users who picked a Gemini model as the default pick a model again.
- The custom agent still inherits the user's ambient Antigravity skills and rules.
- All Gemini models on one account share a quota. A spent quota is a `rate_limited` error with agy's own message, which can name a reset days away.
- The event mapping comes from a real `agy` 1.3.3 run. A new `agy` release can change the stream; the provider test holds the recorded shape.
