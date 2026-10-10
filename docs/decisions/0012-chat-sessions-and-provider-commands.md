# 0012 · Chat sessions are files; provider commands are read and expanded by Rabisco

- **Status:** accepted
- **Date:** 2026-10-07
- **Extends:** [0003](./0003-ai-provider-contract.md)
- **Code:** [`src/shared/chats.ts`](../../src/shared/chats.ts), [`src/bun/project-folder.ts`](../../src/bun/project-folder.ts), [`src/bun/ai/commands.ts`](../../src/bun/ai/commands.ts), [`src/bun/ai/command-template.ts`](../../src/bun/ai/command-template.ts), [`src/mainview/lib/chat-commands.ts`](../../src/mainview/lib/chat-commands.ts)

## Context

A project had one conversation in `chat.jsonl`, and every prompt carried all of it as history. You couldn't start over on a new topic, and a long chat kept steering new screens.

CLI tools have their own slash commands: Markdown files in `~/.claude/commands`, `~/.codex/prompts`, and TOML files in `~/.gemini/commands`. The chat had no way to run them. Two facts limit how Rabisco can pass them on:

- CLI and SDK runs are isolated from the user's settings. Claude Code runs with `--no-session-persistence`, the Agent SDK with `settingSources: []`. So the tools don't load the user's commands themselves.
- `codex exec` and `gemini --prompt` don't expand commands in non-interactive mode.

## Decision

**Sessions**

- Each chat session is one file: `chats/<id>.jsonl`. The id sorts by creation time (`20261007-143012-a1b2`). A project opens its latest chat. A new chat writes nothing until its first message.
- On load, a pre-sessions `chat.jsonl` moves to `chats/`, named after its first message. `attachments/` stays shared.
- A generation gets the history of its `chatId` only. CLI and SDK agents now get it too, as a `<conversation>` section in the prompt (`PROMPT_VERSION` 9). API providers keep sending it as messages.
- Sessions are not project edits, so they stay out of undo history, like messages. Deleting a chat moves its file to the trash.

**Commands**

- `Provider` gets two optional methods: `listCommands(projectPath)` and `expandCommand(projectPath, name, args)`.
- Claude Code and the Agent SDK read `~/.claude/commands` and the project's `.claude/commands`. Codex reads `~/.codex/prompts`. Gemini CLI reads `~/.gemini/commands` and the project's `.gemini/commands`. API providers have none.
- The provider expands the template the way its tool does: `$ARGUMENTS` and `$1`…`$9` for Markdown, `{{args}}` for TOML. A template with no placeholder gets the arguments appended. The expanded text is the request's prompt, and the chat shows `/name args`.
- Built-in commands (`/new`, `/product-md`, `/design-md`, `/vary`, `/compare`, `/play`) run in the editor. A provider command can't take a built-in's name.

## Why

- **Files, like the rest of the project.** One readable file per chat, which git sync commits as "update the chat".
- **Isolation stays.** Reading the command files is all Rabisco does with the user's tool settings. The tools still don't load hooks, `CLAUDE.md` or MCP servers into design runs.
- **One contract.** Code outside `src/bun/ai/providers/` only sees command names and descriptions.

## Consequences

- Skills (`SKILL.md`), the tools' own built-in commands (`/review`, `/init`) and commands that use `!bash`, `@file` or `allowed-tools` are not supported: the text goes to the model as it is.
- Commands are read again on each list and each run, so a new command file shows up without a restart (the menu refreshes when the window gets focus).
