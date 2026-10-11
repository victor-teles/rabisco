# 0025 · Point and prompt sends every selected element: the focus is a list

- **Status:** accepted
- **Date:** 2026-10-10
- **Supersedes:** in [0003](./0003-ai-provider-contract.md), "a **focus** for point and prompt: one element of the target"
- **Code:** `focus` in [`src/shared/ai/contract.ts`](../../src/shared/ai/contract.ts), [`src/shared/ai/focus.ts`](../../src/shared/ai/focus.ts), [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts), [`src/bun/ai/focus-guard.ts`](../../src/bun/ai/focus-guard.ts), [`src/mainview/hooks/use-generation.ts`](../../src/mainview/hooks/use-generation.ts)

## Context

The editor lets the user ⇧-click several elements of one screen. A prompt sent with that selection reached the AI with only the first element as its focus, so the request changed one element and ignored the rest.

## Options

1. **Keep one focus and add the others as a second field.** Old providers keep working, but every reader has to merge two fields.
2. **Make `focus` a list.** One shape for one or many elements.
3. **Focus on the closest common parent.** One element again, but the prompt then allows changes to everything between the selected elements.

## Decision

**Option 2.** `GenerationRequest.focus` is `ElementFocus[]`, in selection order, all in one file. The editor selects elements in one file only, so the list never spans files.

- **Webview.** `send` takes every selected element. The chat message names the element, or the count when there are several (`2 elements in Home: …`). Design notes still focus on one element, as a list of one.
- **Main process.** The focus is kept only when its file is a target and every element still resolves; otherwise the request is a plain edit of the file, as before for a stale focus.
- **Prompt.** One element reads as before. Several are listed with their lines, the request applies to each and only to them, and every element's lines are quoted. A repair names them all. `PROMPT_VERSION` 19.
- **Guard.** A line is outside the focus only when it is outside every element.
- **Mock provider.** Restyles each element, last first so earlier offsets hold.

## Consequences

- Providers stay interchangeable: none reads `focus`; only the shared prompt and the mock do.
- If one selected element is gone from the file on disk, the whole focus is dropped and the edit covers the file.
