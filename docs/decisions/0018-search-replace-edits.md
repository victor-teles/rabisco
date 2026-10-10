# 0018 · API providers edit files with search/replace blocks; a block that doesn't match asks once for the whole file

- **Status:** accepted
- **Date:** 2026-10-10
- **Supersedes:** the "files are always complete" rule for API providers in [0003](./0003-ai-provider-contract.md)
- **Code:** [`src/bun/ai/edit-blocks.ts`](../../src/bun/ai/edit-blocks.ts), [`src/bun/ai/protocol.ts`](../../src/bun/ai/protocol.ts), `runGeneration` in [`src/bun/ai/run.ts`](../../src/bun/ai/run.ts), `TEXT_PROTOCOL_RULES` in [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts)

## Context

[0003](./0003-ai-provider-contract.md) makes API models write every file whole, in a `<rabisco-file>` tag. For a create that is right. For an edit it is not:

- **Slow and costly.** Changing one heading in a 300-line screen streams all 300 lines back. Output tokens cost several times more than input tokens and set the latency.
- **Changes outside the request.** A model that copies a whole file drifts: it renames a class, drops a line or rewrites copy nobody asked about. Point and prompt then has to warn about changes outside the element.

CLI and SDK agents already edit files in place, in their staging directory. API models can do the same with a format they know well.

## Decision

**In edit and repair tasks, an API model may change a file it was given with exact search/replace blocks:**

```
<rabisco-edit path="screens/home.tsx">
<<<<<<< SEARCH
			<h1 className="text-2xl">Orders</h1>
=======
			<h1 className="text-3xl">Order history</h1>
>>>>>>> REPLACE
</rabisco-edit>
```

- One tag per file, one or more blocks, applied in order. New files, and files that change most of their lines, still use `<rabisco-file>`. Agent mode does not change.
- **Rabisco applies the blocks in the main process**, inside the text protocol parser, against the current content of the file: the request's file, or the last write to it in the same reply. Each SEARCH must match **exactly once**. Rabisco tries an exact match, then a match that ignores indentation and trailing spaces on each line (the replacement is re-indented to the match). Nothing looser: two matches, no match or an empty SEARCH is a failure.
- **The applied file is a normal write.** The parser emits `status` "Editing <path>" when the tag opens, then `file.start` and `file.end` with the whole applied file when it closes. Validation, the repair loop, the focus guard, the change summary and undo see a whole file, as before. There is no `file.delta`: a half-applied file is not a prefix of the final one, so the frame updates once, when the tag closes.
- **A failure never guesses.** If any block fails, no block of that tag is applied. The parser emits `status` "Edit didn't match" with the path. `runGeneration` turns it into a repair problem that asks for the whole file in a `<rabisco-file>` tag, and the repair loop sends it with the file's current content. This uses one of the repair attempts. If the whole file never comes, the file stays as it was and the problem is shown.
- `RunResult.editFallbacks` counts the edit tags that didn't match in a run, and the main process logs it, so the generation benchmark can score it.

## Why

- **Faster and cheaper.** An edit's output is the changed lines plus a few lines of context, not the file. For a typical point-and-prompt change that is a small fraction of the output tokens, and output tokens dominate both cost and time to finish.
- **Fewer changes outside the request.** Lines the model doesn't send can't drift.
- **Safe.** An exact match or nothing, and a fallback to the whole file, means a bad block can't corrupt a file. `file.end` stays the only content Rabisco trusts.
- **A known format.** The conflict-marker blocks are common in training data and in other coding tools, so models write them reliably.

## Consequences

- `createTextProtocolParser` takes the request's files, and reports `unmatched` paths next to `written`, `deleted` and `truncated`. A reply with only an unmatched edit is not `invalid_output`.
- `PROMPT_VERSION` 16 documents the tag in `TEXT_PROTOCOL_RULES` and asks for it in the edit, repair and focus task texts (text mode only).
- An edit streams less to the canvas: the frame changes when each tag closes, with an "Editing" step before it.
- Variations of an edit ("Vary this") apply blocks to the source file, then Rabisco renames the write as before ([0004](./0004-alternates-are-files.md)).
