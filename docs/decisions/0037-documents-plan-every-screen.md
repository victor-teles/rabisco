# 0037 · An attached PRD or Markdown file goes into the prompt as text, and always plans first

- **Status:** proposed
- **Date:** 2026-10-12
- **Extends:** [0003](./0003-ai-provider-contract.md), [0011](./0011-image-attachments-reach-every-provider.md), [0015](./0015-plan-then-screens.md)
- **Code:** [`src/shared/ai/documents.ts`](../../src/shared/ai/documents.ts), `documentsText` and `planRules` in [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts), `plansFirst` in [`src/shared/ai/plan.ts`](../../src/shared/ai/plan.ts), `toDocuments` in [`src/mainview/hooks/use-generation.ts`](../../src/mainview/hooks/use-generation.ts)

## Context

People often start from a PRD or a spec in Markdown. Rabisco could take images with a prompt, but not a document. A pasted PRD made a long prompt, and plan mode capped a plan at 6 screens, so a spec with ten screens lost some of them.

## Decision

**A document is text in the request, not a file the provider opens.**

- The composer takes `.md`, `.markdown`, `.mdx` and `.txt` files (and `text/markdown` or `text/plain`) by the add menu, paste or drop. Images keep their numbers; documents don't take one.
- The webview reads each file as text into a `PromptDocument` (`name`, `content`): line endings normalized, trimmed, at most 4 documents and 60,000 characters each. A longer one is cut with a note.
- `GenerationRequest.documents` carries them. `userPrompt` puts each in a `<document index name>` block before the images and the task, in text and agent mode alike. So every provider reads them the same way, with no staging files and no image support needed.
- They go to the plan, to each screen run of the accepted plan, and to edits and the DESIGN.md run of the same prompt. A repair drops them, as it drops images.
- The chat keeps them inline on the user message (`documents`), so "Edit and resend" and plan revisions carry them. A malformed stored document is dropped on load.

**An attached document always plans first.** `plansFirst` is true for a create of one version with a document, even when plan mode is off. The user reviews, unticks or renames the screens on the plan card before any is written.

**A plan from a document can be longer.** This replaces the cap of 6 screens in 0015. `PLAN_LIMITS.screens` is 12, the hard cap `fitPlan` applies. The plan prompt for a document asks for every screen the documents describe, at most 12, with their fields and copy in `content`. A plan from a prompt alone is still asked for at most 6 (`PLAN_LIMITS.promptScreens`).

## Why

- **Every provider.** Text reaches API models, CLI agents and local models alike. Files in the staging directory would need tool use, and images need vision.
- **Review before cost.** A PRD can describe many screens. Planning first shows the whole list before any run starts.
- **Fidelity.** Screen runs get the document too, so a screen uses the spec's own fields and copy, not only the plan's one-line summary.

## Consequences

- A document costs input tokens in the plan and in every screen run. 60,000 characters is about 15,000 tokens per run.
- A plan of 12 screens starts 12 parallel runs, as before with 6.
- The mock provider plans one screen per section heading, so the flow works offline and in the browser build.
- PDF and Word files aren't read. A user exports them to Markdown first.
