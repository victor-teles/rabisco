# 0031 · Opt-in, anonymous funnel counts: five events, off by default, sent to our own endpoint

- **Status:** proposed
- **Date:** 2026-10-11
- **Relates to:** [0003](./0003-ai-provider-contract.md), [0005](./0005-rpc-round-trip-floor.md), [0024](./0024-history-in-app-data.md)
- **Code:** none yet. Implementation follows once this record is accepted.

## Context

Rabisco is local-first and sends nothing today. Growth can't tell whether people reach activation, "the first kept screen", or come back a week later. The board approved proposing opt-in, anonymous funnel counts (LIT-37, 2026-10-11).

The constraints are the ones the product already keeps. The app works without AI. Code outside the providers doesn't know which provider is active. Credentials stay in the keychain. Generated screens never reach the app or the network on their own. A count must not weaken any of these.

## Decision

**Off by default. One question, one toggle.**

- The first-run onboarding ends with one question: "Help improve Rabisco by sending anonymous usage counts?" The buttons are "Send counts" and "Not now". "Not now" is the default focus. Nothing is sent before the user answers.
- Settings → Privacy has the same toggle, with "Show what would be sent" and "Reset install ID".
- Turning it off stops sending at once and deletes the local queue. The app behaves the same with the toggle on or off. No feature waits on it.
- Development builds, `hutch run hmr` (browser mode) and test runs never send, whatever the toggle says.

**Five events, nothing else.**

Every event has exactly these fields:

| Field         | Example        | Notes                                                    |
| ------------- | -------------- | -------------------------------------------------------- |
| `event`       | `first_launch` | One of the five names below                              |
| `day`         | `2026-10-11`   | UTC date. No time of day                                 |
| `app_version` | `0.14.0`       | The app's version string                                 |
| `install_id`  | random UUID v4 | See "Identity"                                           |
| `os`          | `macos`        | `macos`, `windows` or `linux`. No version                |
| `provider`    | `claude-code`  | Only on `provider_connected`. The provider `type`, below |

| Event                | When it fires                                                                                                                                                                                                      | Once per install |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `first_launch`       | The user turns counts on for the first time. Its `day` is the day of the real first launch, which the app writes to `telemetry.json` on first launch and never sends unless counts are on                          | yes              |
| `provider_connected` | A provider is saved in Settings or onboarding, or a detected CLI is accepted. `provider` is the `ProviderType` from `PROVIDER_TYPES` (for example `claude-code`, `ollama`, `anthropic`). Never a key, URL or model | once per type    |
| `first_screen`       | The first generation that creates a screen finishes                                                                                                                                                                | yes              |
| `first_kept_screen`  | In the same session as a generated screen, the user edits it, picks it among variations, copies it, exports it or syncs it with git                                                                                | yes              |
| `returned`           | The app opens a project that existed before, on day 7 to 14 after the first launch                                                                                                                                 | yes              |

Adding an event or a field needs a new record that supersedes this one, and an update to the public page.

**Never sent.** Prompts, code, TSX, DESIGN.md content, file names, project names, paths, screen content, images, model output, model names, API keys, base URLs, error messages, git remotes, chat content, counts of screens or projects, and the time of day. IP-derived location is not stored (see "Transport").

**Identity.** A random UUID v4, made when counts are turned on, stored in `telemetry.json` in the app's user data folder, next to the AI settings. It is not in project files and not in the keychain. There is no account and no email. "Reset install ID" makes a new UUID and clears the record of which once-per-install events were sent, so the new ID starts fresh. Turning counts off and on again keeps the ID; resetting is the explicit way to break the link.

**Where the events are made and how they travel.**

- The main process owns counting: `src/bun/telemetry.ts`. It checks the toggle, keeps the "already sent" flags and the queue in `telemetry.json`, and sends.
- `first_launch`, `provider_connected` and `returned` happen in the main process already (onboarding save, settings save, project open). They need no new RPC.
- `first_screen` and `first_kept_screen` are known in the webview. The webview sends one fire-and-forget RPC message (`funnelEvent { event }`) the first time each happens, and keeps a flag so it never sends it again. That is at most two messages in the life of an install. No count is ever sent per frame, per pointer move or per edit ([0005](./0005-rpc-round-trip-floor.md)).
- The webview never reaches the network for counts. Screen frames have no access to any of it.
- The queue is sent as one HTTPS POST at launch and then at most once a day, with a 5 s timeout. A failed send keeps the queue and tries again next launch. The queue holds at most 50 events; older ones are dropped. Sending never blocks startup, generation or saving.

**Transport and storage: our own endpoint, not a third-party SDK.**

- Events go to `https://t.rabisco.dev/v1/events`, a small collector we run (a serverless function and one database table). No analytics SDK ships in the app.
- The collector drops the IP address and the user agent before writing. It stores only the fields in the table above, plus the day it was received. The hosting provider's own request logs are turned off or kept at most 7 days.
- Raw events are kept for 13 months, so a year can be compared with the one before. After that only daily totals per event, version and OS remain.
- Read access: the CTO and the growth owner, through read-only queries. Totals may be published; raw rows are never shared outside the company.
- We picked our own endpoint over a privacy-focused service (Plausible, PostHog Cloud, Aptabase) because the event list is tiny, we control retention and IP handling end to end, and the public page can point to the collector's source. If running it costs more than it saves, a later record may move to such a service with the same fields.

**Transparency.**

- A public page, `docs/TELEMETRY.md` and the same text on the website, lists every event, every field, an example payload, the endpoint, retention and who can read the data. It is generated from the same schema the app uses, so the two can't drift.
- Settings → Privacy → "Show what would be sent" shows the queued events as the exact JSON the next POST would carry, and the install ID. With counts off it shows "Nothing is sent."

## Why

- **Activation needs a signal, but only a tiny one.** Five events answer the funnel questions: do people connect a provider, do they generate, do they keep a result, do they come back. Day-rounded times and no per-action counts make the data useless for anything else.
- **Opt-in with "Not now" focused** keeps faith with a local-first tool. Fewer people will say yes. Counts from the people who do are enough to compare versions.
- **Provider type, not provider details.** The type is a fixed list Rabisco already knows (`PROVIDER_TYPES`). It tells growth which onboarding paths matter without touching keys, endpoints or models. Code outside `src/bun/ai/providers/` still doesn't know which provider runs a generation; the event reads the saved settings type, not the provider object.
- **Main process owns it.** Counting sits next to the settings store and the network, away from the webview and further still from the sandboxed screens.

## Consequences

- The onboarding gets one more question, and Settings gets a Privacy section. UXDesigner reviews the copy and placement.
- SecurityEngineer reviews the collector, the IP handling and `telemetry.json` before the first release that sends.
- The collector is a new service to run, with its own small cost and on-call. If it is down, the app keeps working and the queue waits.
- `first_kept_screen` needs the session to remember which screens were generated in it. That state already exists for "Edit and resend"; the implementation task confirms it.
- `returned` only fires for installs that opted in by day 14. Retention numbers count opted-in installs only, and growth reads them that way.
- People who never opt in are invisible. That is the cost of the choice, and we accept it.
