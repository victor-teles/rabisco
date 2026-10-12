# 0030 · Coding agents reach Rabisco through a local MCP server, off by default; a stdio bridge and the `rabisco` CLI are its clients

- **Status:** accepted
- **Date:** 2026-10-12
- **Extends:** [0005](./0005-rpc-round-trip-floor.md), [0006](./0006-components-from-source.md), [0008](./0008-share-link-and-git-sync.md), [0018](./0018-search-replace-edits.md), [0019](./0019-visual-review.md), [0021](./0021-generations-outlive-the-editor.md), [0024](./0024-history-in-app-data.md)

## Context

Phase 22 asks that Claude Code, Codex, Cursor, VS Code and Claude Desktop can work on the canvas. Screens are files, so an agent can already edit them. But it can't see the selection, take a screenshot, run "Check design", or make a change that is one undo step. An edit it makes on disk reaches Rabisco through the folder watcher as an outside change, which undo never reverts ([0024](./0024-history-in-app-data.md)).

The Model Context Protocol (MCP) is what all five clients speak. MCP directories (the official MCP Registry, Smithery, Glama, the Cursor directory, the Claude directory) list a server by a copy-paste client config. Their rules ([LIT-63](/LIT/issues/LIT-63#document-competitive-data)) ask for a stdio entry point that runs with `npx`, that answers `initialize` and `tools/list` with the app closed and no token, and that has a `title` and hints on every tool.

The state an agent needs lives in the webview. The project session holds the canvas, the selection and the undo history ([0021](./0021-generations-outlive-the-editor.md)). TSX compiles, Tailwind builds and screenshots render there ([0001](./0001-compile-tsx-in-the-webview.md), [0019](./0019-visual-review.md)). The main process only holds the file system.

## Decision

**The main process serves MCP over HTTP on `127.0.0.1`. It is off by default and has one token for each run of the server.**

- **Off by default.** Settings → Agents has "Let coding agents use Rabisco". When it is off, no port is open. When it is on, the server starts with the app and stops when the setting goes off or the app quits.
- **Loopback only.** `Bun.serve` on `127.0.0.1` with a random port, never `0.0.0.0` like the share link ([0008](./0008-share-link-and-git-sync.md)). One path, `POST /mcp`. The server rejects a `Host` header other than `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), and any request with an `Origin` header (web pages).
- **A token for each server run.** Each start makes a random 256-bit token. Every request needs `Authorization: Bearer <token>`, compared in constant time. The token lives in memory and in the discovery file, never in the project, settings or the keychain. A restart of the server or the app makes a new one. "Reset access" in Settings restarts the server.
- **Small and stateless.** The server handles JSON-RPC `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`, and answers each with one JSON response. No SSE, no sessions, no resources or prompts. It is written by hand over `Bun.serve`, because the MCP SDK's HTTP transport isn't proven on Cottontail.

**The discovery file tells local clients how to connect.**

- The app writes `<userData>/mcp.json` with mode `0600`: `{ version, enabled, port, token, pid, appVersion }`. With the setting off, it writes `{ version, enabled: false, pid, appVersion }`. On quit it deletes the file.
- `RABISCO_MCP_FILE` overrides the path, for tests and odd setups.
- Client configs therefore never hold a port or a token, and they never go stale.

**Clients use a stdio bridge, `rabisco mcp`. Every client gets the same config.**

- The bridge is a small Node-compatible script (`src/mcp-bridge/`, built with `bun build --target=node`). It reads MCP messages on stdin and writes them to stdout. It uses the official MCP SDK's stdio transport; that dependency is in the bridge only.
- It ships two ways: inside the app as the `rabisco` command, and on npm as `rabisco-mcp`. The npm `package.json` has `mcpName: "io.github.victor-teles/rabisco"`, the name in the official MCP Registry. The repository has a `Dockerfile` that runs the bridge, for Glama.
- The config in docs and directories is `{ "command": "npx", "args": ["-y", "rabisco-mcp"] }`. One-click setup in Settings writes the same server entry, but points at the `rabisco` command in the app bundle, so it needs no Node. It writes to `~/.claude.json` (Claude Code, through `claude mcp add` when the CLI is there), `~/.codex/config.toml`, `~/.cursor/mcp.json`, VS Code's user `mcp.json` and `claude_desktop_config.json`.
- **It works with the app closed.** `initialize` is answered by the bridge. `tools/list` comes from the app when it is reachable, and from the list bundled in the bridge (`src/shared/mcp/tools.ts`) when it isn't. So directories and Docker builds see every tool with no app and no token.
- **Clear errors.** For each `tools/call` the bridge reads the discovery file, then forwards the call. A call that can't reach the app returns `isError` with a sentence:
  - no file, or its `pid` isn't alive, or the connection is refused: "Rabisco isn't running. Open Rabisco and try again."
  - `enabled: false`: "The MCP server is off. Turn on Settings → Agents → Let coding agents use Rabisco."
  - `401`: the bridge reads the file again once (the server restarted), then says "Rabisco refused the token. Reset access in Settings → Agents."
- The bridge sends the client's `clientInfo.name` (for example "claude-code") with each call, so Rabisco can say who made a change.

**A call runs in the webview, against the project open in the editor.**

- The main process pushes `agentCall { callId, tool, args, client }` to the webview as an RPC message. Main → webview has no timer ([0005](./0005-rpc-round-trip-floor.md)). The webview answers with one `agentResult` request. One call costs about one 16 ms tick, which is fine for a tool call. The main process waits at most 30 s, then returns an error.
- Tools act on the project attached to the editor. With no project open, they return "No project is open in Rabisco." `open_project` opens one by path.
- The webview runs tools through the same code the editor uses: the session, the compiler, the design check, the offstage render. No tool code reaches the app another way.

**Tools.** Names are short, because clients prefix them with the server name. Every tool has a `title`, an input schema, and `readOnlyHint`, `destructiveHint` and `idempotentHint` annotations.

| Tool                | What it does                                                                                     | Read only | Destructive |
| ------------------- | ------------------------------------------------------------------------------------------------ | --------- | ----------- |
| `get_project`       | Name, path, screens, components, sections, devices, whether git is set up                        | yes       | no          |
| `get_selection`     | The selected screens and elements, as file and element path                                      | yes       | no          |
| `get_screen`        | The TSX of a screen or component, and the files it imports                                       | yes       | no          |
| `get_element_tree`  | The element tree of a file, read from the source ([0006](./0006-components-from-source.md))      | yes       | no          |
| `get_screenshot`    | A PNG of a screen or one element, rendered offstage like the design check, at most 1280 px wide  | yes       | no          |
| `get_design_tokens` | The applied DESIGN.md tokens and the DESIGN.md text                                              | yes       | no          |
| `list_components`   | The project's components with their props, and the shadcn and uai catalog screens can import     | yes       | no          |
| `list_comments`     | Open comments, with their screen and element                                                     | yes       | no          |
| `check_design`      | Runs "Check design" on screens and returns the findings                                          | yes       | no          |
| `create_screen`     | Adds a screen from TSX, at a free spot or next to a given screen                                 | no        | no          |
| `edit_screen`       | Changes a screen with search/replace blocks ([0018](./0018-search-replace-edits.md)) or full TSX | no        | yes         |
| `write_component`   | Creates or replaces a component file                                                             | no        | yes         |
| `set_design_tokens` | Sets tokens in DESIGN.md's Tokens section                                                        | no        | yes         |
| `add_comment`       | Adds a comment to a screen or element                                                            | no        | no          |
| `open_project`      | Opens a project folder in the editor                                                             | no        | no          |

There is no delete tool. Deleting stays a user action.

**Every write is one undo step, and visible.**

- A write tool lands through the session's `change`, like a generation result ([0021](./0021-generations-outlive-the-editor.md)), with a unique coalesce key. One call is one undo step. `⌘Z` takes it back, and the step is saved with the history ([0024](./0024-history-in-app-data.md)).
- The step's label names the client and the tool, for example "Claude Code: edit Settings". The History panel lists agent steps with a marker and a filter.
- Before a write lands, the webview compiles the new TSX. If it doesn't compile, or a search block doesn't match, the call returns `isError` with the reason and nothing changes.
- Paths are checked against the project: screens and components must be `.tsx` files inside the folder, and only DESIGN.md takes tokens. No `..`, no absolute paths. The check runs on the resolved path, so a symlink can't lead out of the folder.
- A write is refused while a generation runs in the same project, and when it targets a locked element or a locked screen. The error says why.
- Frames that an agent wrote to show an "Agent is editing" marker with the client's name. It fades 5 s after that agent's last write.

**The `rabisco` CLI is the bridge with commands. It talks to the running app through the same server.**

- `rabisco mcp` runs the stdio bridge.
- `rabisco open <path>` launches Rabisco with the folder, or opens it in the running app through `open_project`. It works with the server off: it starts the app with the path as an argument.
- `rabisco check [screen…]`, `rabisco screenshot <screen> [-o file.png]` and `rabisco export <folder>` call `check_design`, `get_screenshot` and an `export_website` tool. `export_website` is not in `tools/list`; only the CLI calls it. They need the app running with the server on, and print the same sentences as the bridge when it isn't. `--project <path>` opens that project first.
- Settings → Agents has "Install the `rabisco` command", which links the bundled command into `/usr/local/bin` after asking.

## Why

- **The app works without AI and without an account** ([principle 4](../PRINCIPLES.md#4-bring-your-own-ai)). The server needs neither. With it off, nothing changes.
- **Everything is undoable** ([principle 1](../PRINCIPLES.md#1-ux-first)). An agent's change goes through history like the user's own, instead of arriving as an outside edit.
- **One way in.** The bridge, the CLI and every client use the same tools over the same endpoint. The webview runs them with the editor's own code, so an agent sees what the user sees.
- **Listable.** A stdio bridge on npm with a fixed config is what MCP directories expect. A bundled copy keeps one-click setup free of Node.
- **Small attack surface.** Loopback, a fresh token, no file or shell tools, paths kept inside the project, and screens still render only in sandboxed frames ([principle 3](../PRINCIPLES.md#3-screens-are-react)).

## Alternatives not taken

- **HTTP configs in the clients.** The token changes on each start, so a stored config would break. A fixed token in client configs would live forever in plain files.
- **MCP served by the bridge alone, reading the project folder.** It would work with the app closed, but it couldn't see the selection, render a screenshot or write through history, which is the point of Phase 22.
- **A Unix socket instead of TCP.** Safer against other users on the machine, but `Bun.serve` on a socket isn't proven on Cottontail, and Windows would need a second transport. Reconsider if a local attack shows up that the token doesn't cover.

## Consequences

- Any process running as the user can read the discovery file and use the server. It can already edit the project files, so this adds the selection and screenshots, not new reach. The setting is off until the user turns it on.
- Tools work only with the app open and a project in the editor. An agent that just needs to edit files can still edit them on disk; those edits stay outside changes.
- The tool list is part of a public contract. Renaming a tool or changing its input breaks client configs and directory listings, so changes add tools or optional fields.
- The npm package and the bundled command must be released together with the app. An older bridge still works, because `tools/list` comes from the app when it runs.
- The `rabisco` command in the bundle needs a runtime. The implementation must confirm it can run with the app's bundled Bun; if not, one-click setup falls back to `npx`.
- A security review of the server, the discovery file and the path checks is needed before the server ships.
