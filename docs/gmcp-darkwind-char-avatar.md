# Darkwind.Char.Avatar GMCP Protocol Specification

This document specifies the `Darkwind.Char.Avatar` GMCP package as implemented by the current Darkflow web client and the Darkwind mudlib.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Char.Avatar 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Char.Avatar` | Server -> Client | Push the character's current avatar image URL |

The package has no client -> server messages. Refresh requests are issued through `Darkwind.Client.RefreshMedia`; see [`gmcp-darkwind-client.md`](gmcp-darkwind-client.md).

## Darkwind.Char.Avatar

Direction: `Server -> Client`

Provides the URL of the avatar image to render in the character avatar panel.
An AI-generated portrait takes priority. When the character does not have one,
the server sends a bundled portrait selected from the character's gender and
race.

### Schema

```json
{
  "url": "https://media.darkwind.org/avatars/elyndar/01.jpg",
  "name": "Elyndar"
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | Yes | HTTPS or root-relative URL of an avatar image; the client ignores the message if `url` is missing or empty |
| `name` | string | No | Display caption rendered under the avatar; defaults to `Avatar` when omitted |

### Client Behavior

- The client stores the latest avatar payload as `gmcpData.avatar` and re-renders the `avatar` panel.
- The avatar image is shown with a click-to-zoom modal handler that opens the same URL in the room-image lightbox.
- Generated avatar URLs take priority over bundled defaults.
- The server derives bundled defaults from `query_gender()` and `query_race()`,
  for example `/assets/avatars/female-high-elf.png`.
- Unsupported races or a gender other than male/female do not produce a
  race-specific URL; the client retains its built-in placeholder in that case.
- If `url` is missing, the existing avatar (if any) is left in place; the client does not clear the panel from this message.
- A built-in placeholder (`/assets/avatar-ghost.svg`) is rendered when no avatar has been received yet.

### Server Behavior

- Sent on character login, after avatar regeneration, and in response to a `Darkwind.Client.RefreshMedia` request.
- The server only sends the message when the player's GMCP support set advertises `Darkwind.Char.Avatar 1`.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Char.Avatar {"url":"https://media.darkwind.org/avatars/elyndar/01.jpg","name":"Elyndar"}
```
