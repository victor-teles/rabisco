# 0019 · The polish run reviews screenshots; a provider without images runs the plain polish

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0003](./0003-ai-provider-contract.md), [0011](./0011-image-attachments-reach-every-provider.md), [0017](./0017-brief-task-and-fast-model.md)
- **Code:** [`src/shared/design/polish.ts`](../../src/shared/design/polish.ts), `polish` in [`src/mainview/hooks/use-generation.ts`](../../src/mainview/hooks/use-generation.ts), [`src/mainview/views/editor/design-check.ts`](../../src/mainview/views/editor/design-check.ts), `generate` in [`src/bun/ai/service.ts`](../../src/bun/ai/service.ts)

## Context

After a create, edit or vary, the webview checks the new screens offstage. Error findings become one `repair` run, the polish, merged into the generation's undo step. The checks read the layout, so they miss what only shows when you look: uneven spacing, a weak hierarchy, a screen that ignores DESIGN.md. Most models can see images now, and screenshots of a screen are cheap: the design check already renders it offstage.

## Decision

**The polish also looks at screenshots of the new screens. It is on by default and stays one run per generation.**

- The design check takes the screenshot in the same offstage render as its lint: a JPEG at scale 1 (at most 1280 px wide), cut at twice the frame's height, at most 6 screens.
- The run is a `repair` of the screens and of the files with errors. Its problems are the errors, possibly none. A repair with no problems tells the model to review its targets as the request asks. The request text gives the user's prompt, the screenshots' names, the warnings, and asks for the smallest fix of clear visual problems only, or no files.
- The webview keeps only writes to the run's targets that already exist. They join the generation's undo step, so one `⌘Z` takes back the generation and the review.
- Settings: "Polish after generating" turns both off. "Review screenshots after generating" sits under it and is on by default. With the review off, the polish is as before: errors only, no screenshots.

**The screenshots travel in `GenerateParams.review`, not in `attachments`. The main process decides whether to use them.**

- `review` holds the review's prompt and its screenshots. The service resolves the model first ([0017](./0017-brief-task-and-fast-model.md)). If the provider takes images, the run uses `review.prompt` and sends the screenshots as attachments, which reach every provider as in [0011](./0011-image-attachments-reach-every-provider.md).
- If the provider can't take images (`capabilities.images` is `false`), the run is the plain polish: the outer prompt and the errors, no images. With no errors there is nothing to run, and the service returns no changes. Either way the result has `withoutImages`, a status step says so, and the reply says it once per session.
- If a review run fails for another reason and there are errors, the webview runs the plain polish once.
- Composer attachments are unchanged: they are sent to every provider, as before.

**The review runs on the fast model when one is set.** It is a `repair`, one of `FAST_TASKS`. It runs after every generation, so its cost counts most, and it asks for small, conservative fixes. A user who wants the picked model to review sets the fast model to "Same as picked".

## Why

- **One run.** The review and the polish share a request, so turning the review on adds one model call per generation at most, and none to the undo stack.
- **Providers stay interchangeable.** The webview doesn't know which model runs or whether it sees images; the main process does both.
- **Calm.** The review must keep the design and may write nothing. A run that writes nothing says "Review: nothing to fix."

## Consequences

- `PROMPT_VERSION` 17: the repair task text has a review form for a repair with no problems.
- Every generation with new screens costs one more call while the review is on. The setting says so.
- The mock provider fixes a repair's targets in place (contrast, clipped text), so the polish can be tested without a model.
