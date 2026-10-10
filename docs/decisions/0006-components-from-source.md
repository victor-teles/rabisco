# 0006 · Component tools read the TSX source, not the rendered DOM

- **Status:** accepted
- **Date:** 2026-10-04

## Context

Phase 5 tools need to understand structure. "Make component" extracts a subtree. Duplicate suggestions compare subtrees. The props controls read and write attributes. A drop inserts an element into a screen. The structure could come from the DOM rendered in the frames, or from the TSX files.

## Decision

**Structure comes from the source.** `src/shared/jsx` builds a JSX tree from Sucrase's tokenizer (`sucrase/dist/esm/parser`, already in the webview for compiling, [0001](./0001-compile-tsx-in-the-webview.md)). Each node keeps its exact source offsets. Every edit is a text transform (`insertChild`, `setAttribute`, `addImport`, `extractComponent`) that returns new file content. The editor applies that content as one undoable change.

- **Equivalence:** two subtrees are the same component when they have the same tags, attribute names, `className` values and expressions. They may differ only in text and string attribute values. Those differences become props. `findDuplicates` and `extractComponent` use this one rule, so "Make component" on a suggestion replaces every occurrence.
- **From the DOM back to the source:** the compiler adds `data-rabisco-loc="<path>:<offset>"` to every intrinsic element before Sucrase runs, on the same line, so error lines don't move. A frame answers a `hit-test` message with the location under a point. Drops use this now, and element selection in Phase 6 will too.
- **Component APIs** (`src/shared/components/api.ts`) come from the props type and the `cva` variants in the same file. The same catalog feeds the inspector controls, the previews and the generation prompt ([0003](./0003-ai-provider-contract.md)).

## Why

- [Principle 3](../PRINCIPLES.md#3-screens-are-react): the file is the design. An edit made from the canvas must be one a developer would write, with the same formatting and no hidden scene graph.
- The DOM loses what matters for components: `.map` lists, conditionals, props and imports.
- It runs the same way in Bun (tests, prompts, validation) and in the webview.

## Consequences

- Runtime error columns can be off on lines that got a location attribute. Line numbers stay correct.
- Prop types that can't be inferred fall back to `any`. Variants are read only from a `cva` table in the same file.
- A file that doesn't parse (for example, mid-stream) has no structure. The outline keeps its last good tree.
