# 0003 · AI provider contract: providers write files

- **Status:** accepted. The "files are always complete" rule for API providers is superseded by [0018](./0018-search-replace-edits.md)
- **Date:** 2026-10-04
- **Types:** [`src/shared/ai/contract.ts`](../../src/shared/ai/contract.ts)

## Context

[Principle 4](../PRINCIPLES.md#4-bring-your-own-ai): providers can be CLI tools (Claude Code, Codex, Gemini), SDKs (Claude Agent SDK, Vercel AI SDK) or APIs (Anthropic, OpenAI, OpenRouter, Ollama). They work very differently:

- **CLI and SDK agents** edit files with tools, in a working directory.
- **API models** return text.

The rest of Rabisco must not care which kind is running.

## Decision

**A provider's only output is file writes, delivered as one stream of events.** Rabisco validates, names, places and renders the files.

### Interface

```ts
interface Provider {
	id;
	kind: "cli" | "sdk" | "api";
	label;
	capabilities;
	health(): Promise<ProviderHealth>; // installed? authenticated? reachable?
	listModels(): Promise<ProviderModel[]>;
	generate(request, signal): AsyncIterable<GenerationEvent>;
}
```

### Request

A `GenerationRequest` contains:

- the task (`create`, `edit` or `repair`), the prompt, the model and the target device;
- **context**: the contents of `PRODUCT.md` and `DESIGN.md`, always included when present ([principle 5](../PRINCIPLES.md#5-context-is-a-file));
- **files** the provider may read: edit targets, project components it should reuse, and screens that show the style;
- **components**: a catalog of every project component with its props signature and users, built from the whole project, so it is complete even when component sources don't fit in `files`;
- **targets** for an edit, **problems** for a repair, image **attachments**, and the chat **history**;
- a **focus** for point and prompt: one element of the target (its offsets, lines, snippet and a label). The prompt asks for a change to that element only, and a guard notes any change outside it in the reply.

### Events

| Event            | Meaning                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `status`         | Progress for the user (thinking summary, tool call, step)                            |
| `message.delta`  | Assistant text for the chat, streamed                                                |
| `file.start`     | A write begins: logical path, kind (`screen` or `component`), screen name and device |
| `file.delta`     | Streamed content, so the frame can render while the file is still being written      |
| `file.end`       | The complete file. **The only content Rabisco trusts.**                              |
| `file.delete`    | Remove a file                                                                        |
| `done` / `error` | Exactly one of these ends every stream. Errors carry a code and a `retryable` flag.  |

### How each kind maps to events

- **API providers** are prompted to wrap each file in `<rabisco-file path="…" kind="…" name="…">…</rabisco-file>`. A streaming parser turns tags into `file.*` events, and text outside tags into `message.delta`. Files are always complete: no diffs, and no "rest unchanged" placeholders.
- **CLI and SDK agents** run in a **staging copy** of the relevant project files, never in the project itself. Rabisco watches the staging directory and emits `file.*` events as files change. When the agent finishes, Rabisco diffs the staging directory against the project. The agent's own text becomes `message.delta`, and its tool calls become `status`.

### Validation and repair

Every `file.end` passes through the same checks before it reaches the canvas:

1. **Path:** `screens/<kebab>.tsx` or `components/<kebab>.tsx` only.
2. **Compile:** Sucrase ([0001](./0001-compile-tsx-in-the-webview.md)).
3. **Imports:** only `react`, `lucide-react`, `@/components/ui/*`, `@/lib/utils` and project components (`../components/x` from screens, `./x` between components).
4. **Exports:** a screen default-exports one component, and components use named exports. A written component must not export a component another component file already exports (the repair asks the model to import or extend that one).
5. **Render:** the frame reports a runtime error, if any.

If a check fails, Rabisco sends a `repair` task with the problems, up to **2** times, before it shows the error to the user. The last valid version of the file stays on the canvas meanwhile.

### Variations

**A request with N variations runs N independent generations in parallel**, each producing the same logical file. Rabisco names the results: the first is `welcome.tsx` and the others are `welcome.alt-N.tsx` ([0004](./0004-alternates-are-files.md)). Providers never name or coordinate variations: each run only gets a one-line hint ("variation 2 of 3, take a visibly distinct direction") so the runs don't converge, and Rabisco renames what they write as it streams (`src/shared/ai/variants.ts`). That keeps prompts simple and gives more diverse results than asking one call for "3 versions". "Vary this" runs N edits of one screen whose writes all become new alternates, and "Mix" is an edit that gets the source variation as a read-only reference.

## Why

- **One output shape for very different providers.** Agents already think in files, and text models can be taught a simple tag. Normalising to file events keeps validation, rendering, undo and git in one place.
- **Files are the product.** Screens are TSX files ([principle 3](../PRINCIPLES.md#3-screens-are-react)), so the provider output is the project, not a format that needs converting.
- **Safe by construction.** Agents never touch the real project folder, and nothing reaches the canvas without validation.
- **Streaming still works.** `file.delta` lets frames render while code arrives. `file.end` stays authoritative, so a broken partial stream can't corrupt a file.

## Consequences

- Phase 2 implements: the text protocol parser, a staging-directory runner for CLI and SDK providers, the validation pipeline and the repair loop.
- Every write is a file change, so one generation equals one undo step.
- The prompt for API providers must document the tag format and the file rules. It lives with the provider layer, versioned with the contract.
- Credentials are outside the contract: each provider reads them from the OS keychain or relies on its own CLI login.
