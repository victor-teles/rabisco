# Rabisco principles

These principles decide trade-offs. When two options conflict, the principle that appears first wins.

## 1. UX first

The canvas is the product. AI serves the canvas.

- **Fast feedback.** Show progress within 100 ms of any action. Stream generation into the canvas as it happens. Never show a spinner with no context.
- **No dead ends.** You can select, edit, vary or undo every AI result. A bad generation costs one keystroke.
- **Everything is undoable.** That includes AI edits, deletes and bulk changes.
- **Direct manipulation over prompts.** If a change is faster with the mouse (move, resize, edit a word), the mouse must work. Use prompts for the changes the mouse cannot make.
- **Keyboard first, mouse friendly.** Every frequent action has a shortcut. Shortcuts follow Figma conventions where they exist.
- **Calm interface.** Chrome stays quiet so that the designs carry the color.

## 2. Component based by default

Rabisco designs are systems, not pictures.

- Screens are built from components, and components are built from design tokens (color, type, spacing, radius).
- When the AI generates a screen, it reuses the project's components before it creates new ones.
- A change to a component updates every screen that uses it.
- The default library is shadcn/ui, so a design starts from proven primitives.
- Repeated structure becomes a component. Rabisco suggests this. The user decides.

## 3. Screens are React

A screen is a React component written in TSX and styled with Tailwind. It is not an image or a proprietary scene graph.

- **Real code, real modules.** You can split a screen into components, import it, version it and diff it like any source file.
- **What you see is what you ship.** Exported code is the same code the canvas renders. There is no conversion step.
- **Isolated rendering.** Each screen renders in a sandbox, so generated code can never reach the app or the file system.
- **Readable by people.** Generated code must be code a developer would accept in review. Use clear names, a sensible structure and no inline style soup.

## 4. Bring your own AI

Rabisco does not lock you to one model or one vendor. A provider can be:

| Kind | Examples | Why |
| --- | --- | --- |
| **CLI** | Claude Code, Codex CLI, Gemini CLI | Reuses a subscription the user already has. No keys in Rabisco. |
| **SDK** | Claude Agent SDK, Vercel AI SDK | Agent loops, tools and streaming in-process. |
| **API** | Anthropic, OpenAI, OpenRouter, Ollama or any OpenAI-compatible endpoint | Direct control over the model, cost and local models. |

- Every provider implements one interface, and the rest of the app does not know which one it is talking to.
- Credentials stay on the user's machine and never appear in project files.
- Rabisco works with no provider configured. You can still open and edit projects. Only generation is unavailable.

## 5. Context is a file

Rabisco reads plain Markdown files that describe the product and the design language:

- **`PRODUCT.md`**: what the product is, who it serves, its voice and its constraints.
- **`DESIGN.md`**: tokens, typography, component rules, layout and the visual direction.

These files sit next to the project. You can edit them in any editor and keep them in git. Every generation includes them. The AI must follow them, and Rabisco shows which file shaped a result.

## 6. Variations, not verdicts

Design is choosing between options. One answer is not enough.

- A generation can produce several variations of a screen.
- Variations sit side by side so you can compare them on the canvas.
- You pick one. The others are kept as alternates, not deleted.
- A variation can be the starting point for more variations.
