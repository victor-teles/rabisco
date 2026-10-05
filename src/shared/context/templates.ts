import type { ContextFileName } from "../types";

// Guidance lives in HTML comments, so generations ignore an untouched template.
export const PRODUCT_TEMPLATE = `# Product

<!--
What is this product, in one or two sentences? What job does it do for people?
Example: "A budgeting app that helps freelancers set aside money for taxes on every payment."
-->

## Audience

<!--
Who uses it, and in what situation? What do they already know, and what do they care about?
Example: "Freelance designers in their first years of self-employment. They check the app on their phone, between client work."
-->

## Voice

<!--
How does the product talk? Pick a few traits and give an example sentence.
Example: "Calm, direct, never cute. Say 'You have R$ 1.200 set aside' rather than 'Woohoo, you're crushing it!'"
Language and locale, if they matter: "Brazilian Portuguese, currency in R$."
-->

## Constraints

<!--
What every screen must respect: platforms, accessibility, legal text, features that do not exist yet.
Example: "Mobile first. No dark patterns around subscriptions. No social features."
-->
`;

export const DESIGN_TEMPLATE = `# Design

## Visual direction

<!--
The feel, in a few words, and a reference or two.
Example: "Quiet and precise, like a good notebook. Lots of white space, one strong accent color."
-->

## Tokens

<!--
Tokens re-theme every screen. Remove the comment markers around the lines you want to apply.
Colors: background, foreground, card, popover, primary, secondary, muted, accent (each with a
-foreground pair), destructive, success, warning, border, input, ring, chart-1 to chart-5.
Also radius, font-sans, font-serif and font-mono. Values under "### Dark" apply in dark mode.

- primary: oklch(0.55 0.2 264)
- primary-foreground: #ffffff
- radius: 0.75rem
- font-sans: "Inter", system-ui, sans-serif

### Dark

- primary: oklch(0.7 0.15 264)
-->

## Typography

<!--
Type scale and how to use it.
Example: "Titles text-2xl font-semibold tracking-tight. Body text-sm. Numbers use tabular-nums."
-->

## Layout & spacing

<!--
Grid, spacing rhythm and density.
Example: "16px page padding on mobile. Sections 24px apart. One primary action per screen, at the bottom."
-->

## Components

<!--
Rules for the building blocks.
Example: "Cards have a border and no shadow. Buttons are full width on mobile. Lists use dividers, not cards."
-->

## Do / Don't

<!--
Example:
Do: use the primary color only for the main action.
Don't: use more than two font weights on a screen. Don't use emoji in the interface.
-->
`;

export const CONTEXT_TEMPLATES: Record<ContextFileName, string> = {
	"PRODUCT.md": PRODUCT_TEMPLATE,
	"DESIGN.md": DESIGN_TEMPLATE,
};
