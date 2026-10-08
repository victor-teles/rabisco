# 0011 · Image attachments reach every provider; agents get them as files

- **Status:** accepted
- **Date:** 2026-10-07
- **Code:** [`src/bun/ai/attachments.ts`](../../src/bun/ai/attachments.ts), [`src/bun/ai/staging.ts`](../../src/bun/ai/staging.ts), [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts), [`src/bun/ai/providers/codex.ts`](../../src/bun/ai/providers/codex.ts)

## Context

You can paste, drop or pick images in the chat composer. The request carries them as `attachments` (base64, [0003](./0003-ai-provider-contract.md)). API providers already sent them as image content blocks. CLI and SDK agents got only the file names, so they never saw the images. The prompt said "use them as reference" for images the model could not open.

## Decision

**Every provider gets the images. How depends on its kind, and only the provider layer knows.**

- **API providers** send each image as a content block in the last user turn: an `image` block for Anthropic, an `image_url` data URL for OpenAI-compatible endpoints. The prompt names the images.
- **CLI and SDK agents** get a copy of each image in their staging directory, under `.rabisco/attachments/<n>-<name>.<ext>`. The prompt lists those paths and asks the agent to open them with its file tools before it starts. Claude Code, the Agent SDK and Gemini CLI read images with their read tools. Codex also gets each path as an `--image=<path>` flag.
- The folder is hidden, so the staging diff never reports the images as changes, and the agent's writes there are ignored like any path outside `screens/` and `components/`.
- Repair requests drop the images: a repair fixes code, not the design.
- Chat history keeps the images (in `attachments/`, next to `chat.jsonl`). Older turns go to the model as text only. **Edit and resend** and **Regenerate** send the images of that prompt again.

## Why

- **One contract.** The webview sends the same request whatever the provider. Code outside `src/bun/ai/providers/` and the staging runner doesn't know how images travel.
- **Agents think in files.** A file in the working directory is the one input every agent CLI can read, with no CLI-specific flags beyond Codex's optional one.
- **Safe.** The images are copies in the temporary staging directory. Agents still never touch the project folder.

## Consequences

- `ProviderCapabilities.images` is `true` for the CLI and SDK agents and for the mock provider.
- Images add input tokens on every provider. Rabisco doesn't resize them yet; a very large screenshot can exceed a provider's per-image limit, and that provider's error shows in the chat.
- `PROMPT_VERSION` is 8: the attachment text differs between text and agent mode.
