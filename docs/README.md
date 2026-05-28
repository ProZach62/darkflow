# Darkflow Client Docs

This directory documents the Darkflow browser client for Darkwind. If you came here from an outside link and do not know the repo yet, start with this file.

Darkflow is the web client in `play.darkwind.ai`. It serves the browser UI, connects to the Darkwind MUD over WebSocket, renders terminal output, and handles custom `Darkwind.*` GMCP messages used by the game for richer client features such as maps, panels, media, IDE editing, quests, achievements, announcements, and command completion.

## Where To Start

- [`gmcp-darkwind-index.md`](gmcp-darkwind-index.md) is the main catalog of custom `Darkwind.*` GMCP packages. Use it when you need to know what protocol messages exist and which document owns each one.
- [`BLUEPRINT-webclient.md`](BLUEPRINT-webclient.md) explains the original WebSocket client design: how LDMud WebSocket connections work, how output flows to the browser, and what the client architecture was meant to cover.
- [`PLAN-webclient.md`](PLAN-webclient.md) is the original implementation plan for the hosted web client, including server structure, Docker expectations, UI layout, ANSI rendering, command history, and verification notes.

If you are changing protocol behavior, treat the current client implementation in `public/js/` as the source of truth and update the relevant GMCP doc at the same time.

## GMCP Protocol Docs

The `gmcp-darkwind-*.md` files describe custom GMCP extensions under the `Darkwind.*` namespace. They are package specs, not general player-facing help files.

| Document | What It Covers |
| --- | --- |
| [`gmcp-darkwind-index.md`](gmcp-darkwind-index.md) | The full advertised package list and message catalog. |
| [`gmcp-darkwind-client.md`](gmcp-darkwind-client.md) | Client-to-server capability and media refresh messages, including subscriptions and refresh requests. |
| [`gmcp-darkwind-window.md`](gmcp-darkwind-window.md) | Dynamic server-driven UI windows and client responses such as submit, action, and closed events. |
| [`gmcp-darkwind-ide.md`](gmcp-darkwind-ide.md) | In-browser code editor open, save, save result, and close messages. |
| [`gmcp-darkwind-mapdata.md`](gmcp-darkwind-mapdata.md) | Map state, movement inference, room coordinates, area data, sync, and correction messages. |
| [`gmcp-darkwind-mapdata-v2.md`](gmcp-darkwind-mapdata-v2.md) | Server-authoritative map graph, display layout metadata, and V2 sync messages. |
| [`gmcp-darkwind-completion.md`](gmcp-darkwind-completion.md) | Tab completion request/result flow and client behavior for ambiguous completions. |
| [`gmcp-darkwind-quests.md`](gmcp-darkwind-quests.md) | Quest list, objective progress update, and completion payloads rendered by the client panels. |
| [`gmcp-darkwind-achievements.md`](gmcp-darkwind-achievements.md) | Achievement snapshots and incremental updates. |
| [`gmcp-darkwind-announcements.md`](gmcp-darkwind-announcements.md) | Announcement snapshots, new/update/state messages, and mark-read actions. |
| [`gmcp-darkwind-char-avatar.md`](gmcp-darkwind-char-avatar.md) | Character avatar URL pushes from the game to the client. |
| [`gmcp-darkwind-room-image.md`](gmcp-darkwind-room-image.md) | Room image URL pushes and client-side preload behavior. |
| [`gmcp-darkwind-divine.md`](gmcp-darkwind-divine.md) | Divine/patron state snapshots shown in the client. |
| [`gmcp-darkwind-giphy.md`](gmcp-darkwind-giphy.md) | Transient Giphy overlay messages. |

## Web Client Design Docs

These files are useful for understanding why the client is shaped the way it is, especially if you are new to LDMud, WebSocket transport, or the early deployment assumptions.

| Document | What It Covers |
| --- | --- |
| [`BLUEPRINT-webclient.md`](BLUEPRINT-webclient.md) | The transport model, WebSocket handshake assumptions, ANSI output handling, proposed client components, and testing guidance. |
| [`PLAN-webclient.md`](PLAN-webclient.md) | The concrete Node/Express static server plan, Docker outline, single-page client layout, JavaScript subsystems, and verification checklist. |

Some details in the blueprint and plan are historical. When they differ from the live repo, prefer the live code and then update the docs if the docs are supposed to remain current.

## How To Use This Directory

- To add or change a `Darkwind.*` package, update [`gmcp-darkwind-index.md`](gmcp-darkwind-index.md) and the package-specific spec.
- To investigate a client feature, start with the matching protocol doc, then trace the implementation in `public/js/`.
- To debug transport or rendering assumptions, read [`BLUEPRINT-webclient.md`](BLUEPRINT-webclient.md), then compare against the current WebSocket and terminal code.
- To onboard a new contributor, send them this README first, then the index, then the specific package document for the feature they are touching.

## Repo Orientation

Useful nearby paths from the repo root:

- `public/` contains browser-served assets.
- `public/js/` contains most client behavior.
- `server.js` serves the static client.
- `public/version.json` is the runtime version source used by the client API.
- `docs/` is this documentation directory.

The sibling Darkwind game/mudlib repo owns the server-side LPC behavior that emits or receives these messages. Keep client docs precise about what this repo sends, receives, and renders; do not assume server behavior unless it is verified in the game repo.
