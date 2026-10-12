# 0036 · Recreate from screenshot is a create with the image; the screen links its image; the score is measured in the webview

- **Status:** proposed
- **Date:** 2026-10-12
- **Extends:** [0011](./0011-image-attachments-reach-every-provider.md), [0019](./0019-visual-review.md), [0029](./0029-moodboard-images-on-the-canvas.md)
- **Code:** [`src/shared/recreate.ts`](../../src/shared/recreate.ts), [`src/mainview/lib/recreate.ts`](../../src/mainview/lib/recreate.ts), `recreate` in [`src/mainview/lib/generation-session.ts`](../../src/mainview/lib/generation-session.ts), [`src/mainview/views/editor/screenshot-compare.tsx`](../../src/mainview/views/editor/screenshot-compare.tsx)

## Context

Competitors start from a reference. Rabisco could send a moodboard image with a prompt, but the user had to write the prompt and place the screen, and nothing showed how close the result came.

## Decision

**A recreate is a normal create run with one option, `recreate`. It is one undo step with its polish, like any create.**

- The selected moodboard image offers "Recreate from screenshot" under it, in its context menu and in the command palette. The request carries the image as its only attachment (decision 0011), with a fixed prompt that asks for one editable screen that matches it.
- **Device.** The image's natural size picks it: wider than tall is desktop, a ratio from 0.65 is tablet, wider than 1320 px is desktop, else mobile.
- **No plan.** Plan mode doesn't apply: a recreate is one screen with a reference.
- **Place.** The first new screen goes 80 px right of the image, top-aligned, past any screen or image already there. Its height follows the screenshot's ratio at the device width. The frame stores the image's id in `reference`.
- **Review.** The screenshot review (decision 0019) gets the screenshot first, then the screen's render, and asks to fix clear differences from it.

**The comparison runs in the webview, with no RPC.**

- A screen compares with the image in its `reference`, else the image beside it (decision 0029). An image compares with the screen recreated from it, else its nearest screen.
- The screen renders offstage at its width, cropped to the screenshot's height. Both images are drawn at most 160 px wide. The score is the share of pixels whose color differs by more than 24 in any channel.
- The view shows the two side by side, the screenshot over the screen with an opacity slider, or the CSS `difference` blend. `1`, `2` and `3` switch the mode; `Esc` closes.

## Why

- **One path.** A recreate reuses attachments, the review, placement and history. Providers don't know that it is a recreate.
- **A link that survives moves.** `reference` keeps the pair together when the user moves the screen away from the image.
- **A cheap, readable score.** A pixel share is fast at a small size and easy to explain. It is a guide, not a judge: two screens with the same background color score close even when their content differs.

## Consequences

- `rabisco.json` frames can have `reference`. Older apps ignore it.
- The score depends on the frame's width: a screenshot taken at another width compares after scaling.
