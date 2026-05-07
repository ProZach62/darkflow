# Darkwind.Client GMCP Protocol Specification

This document specifies the `Darkwind.Client` GMCP package, which carries client-side coordination messages: panel/feature subscriptions and on-demand media refresh.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Client.Subscriptions 1"]
```

Only `Darkwind.Client.Subscriptions` is advertised in the support set. The companion `Darkwind.Client.RefreshMedia` message is gated by other media-bearing packages (`Darkwind.Char.Avatar`, `Darkwind.Room.Image`).

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Client.Subscriptions` | Client -> Server | Declare which panels are visible and which feature streams are wanted |
| `Darkwind.Client.RefreshMedia` | Client -> Server | Ask the server to re-push current media (avatar and room image) |

Both messages flow client -> server only; the server does not echo a structured acknowledgement. Subscriptions take effect by gating subsequent server-driven pushes; RefreshMedia takes effect by triggering pushes on packages such as `Darkwind.Char.Avatar` and `Darkwind.Room.Image`.

## Darkwind.Client.Subscriptions

Direction: `Client -> Server`

Tells the server which UI surfaces the client currently cares about so the server can avoid pushing data the client will not render. Subscriptions are stored on the player attribute and used to gate downstream pushes (vitals, status, room, map, room image, avatar, group, inventory, enemy, chat, omens, quests, achievements, and the announcement bell).

### Schema

```json
{
  "reason": "panel-open",
  "full": false,
  "panels": {
    "avatar": true,
    "vitals": true,
    "status": true,
    "worth": false,
    "stats": false,
    "room": true,
    "group": false,
    "inventory": true,
    "enemy": true,
    "chat": false,
    "map": true,
    "roomImage": true,
    "omens": false,
    "quests": false,
    "achievements": false
  },
  "features": {
    "announcementsBadge": true,
    "announcementsList": false,
    "enemyAutoOpen": true,
    "windows": true,
    "ide": true,
    "completion": true,
    "giphy": true
  }
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `reason` | string | Yes | Free-form telemetry tag for why this update was sent. Common values: `login`, `reconnect`, `panel-open`, `panel-close`, `visibility-sync`, `character-login`, `modal-open`, `ctrl-k` |
| `full` | boolean | No | When `true`, the server should re-push the full canonical state for all subscribed surfaces; when `false`, the server may send only deltas relative to the previous subscription mapping |
| `panels` | object | No | Map of panel id -> visibility boolean. See "Panels" below for keys recognized by the current server |
| `features` | object | No | Map of feature flag -> boolean. See "Features" below |

### Panels

The current server recognizes the following panel keys. Unknown keys are stored but have no effect on push gating.

| Panel | Notes |
|-------|-------|
| `avatar` | Drives `Darkwind.Char.Avatar` and is part of the media-subscription gate |
| `vitals` | Driven by `Char.Vitals`. The client always sends `vitals: true` |
| `status` | Driven by `Char.Status`. The client forces `status: true` whenever the buffs panel is open |
| `worth` | Driven by `Char.Worth` |
| `stats` | Driven by `Char.Stats` and `Char.RealStats` |
| `room` | Drives `Room.Info` push gate (alongside `map` and `roomImage`) |
| `group` | Driven by `Group` |
| `inventory` | Driven by `Char.Items.*` |
| `enemy` | Driven by `Char.Enemy` and gated together with `enemyAutoOpen` |
| `chat` | Driven by standard `Comm.Channel.*` messages (`List`, `Players`, `Start`, `End`, and `Text`) |
| `map` | Drives `Room.Info` push gate |
| `roomImage` | Drives `Darkwind.Room.Image` and `Room.Info` push gates |
| `omens` | Drives `Darkwind.Divine` |
| `sky` | Drives `Darkwind.Sky`; the client animates between occasional syncs |
| `quests` | Drives `Darkwind.Quests.*` |
| `achievements` | Drives `Darkwind.Achievements.*` |

### Features

| Feature | Notes |
|---------|-------|
| `announcementsBadge` | Subscribe to unread-count badge updates (`Darkwind.Announcements.State`/`Update`) |
| `announcementsList` | Request a `Darkwind.Announcements.List` snapshot. The web client sets this to `true` only when the user opens the announcements modal, and clears the flag locally after sending so subsequent subscription messages will not re-request the snapshot |
| `enemyAutoOpen` | Allow the server to auto-open an enemy panel when combat begins |
| `windows` | Allow `Darkwind.Window.*` flow |
| `ide` | Allow `Darkwind.IDE.*` flow |
| `completion` | Allow `Darkwind.Completion.*` flow |
| `giphy` | Allow `Darkwind.Giphy.Show` overlays |

The `windows`, `ide`, `completion`, and `giphy` feature flags are advertised as `true` by the current client by default; they exist so future client versions can opt out of these surfaces without dropping the support declaration.

### Client Behavior

- The client coalesces panel-visibility changes through a 150 ms debounce timer in `panelManager.syncGmcpSubscriptions` to avoid bursts of subscription messages.
- The client always sends `vitals: true`. When the `buffs` panel is open, the client also forces `status: true`.
- `Char.Status` is treated as sticky state: after the initial full status payload, subsequent delta payloads are merged into the cached status object instead of replacing it.
- The client advertises standard `Comm.Channel 1`, stores `Comm.Channel.List` / `Comm.Channel.Players`, tracks `Comm.Channel.Start` / `Comm.Channel.End` scopes, renders `Comm.Channel.Text`, requests `Comm.Channel.Players` once character data confirms login, and exposes `Comm.Channel.Enable` through the GMCP helper.
- Sent automatically on:
  - WebSocket open (`reason: "login"` or `"reconnect"`, `full: true`)
  - Initial panel hydration (`reason: "visibility-sync"`, `full: true`)
  - Each panel open/close (`reason: "panel-open"` / `"panel-close"`, `full: false`)
  - First receipt of `Char.Vitals` or `Char.Status` after login (`reason: "character-login"`, `full: true`), exactly once per session
  - User opening the announcements modal (`reason: "modal-open"`, `features: { announcementsList: true }`)
  - `Ctrl+K` GMCP restart (`reason: "ctrl-k"`, `full: true`)

### Server Behavior

- Stores the latest payload on the player attribute `gmcp_subscriptions`.
- When `full` is truthy, the server re-pushes the full snapshot for every subscribed surface.
- When `full` is falsy, the server diffs the new mapping against the previous mapping and only pushes for surfaces that newly turned on.
- Push helpers (`send_char_vitals`, `send_room_info`, `send_darkwind_divine`, `send_achievements_*`, etc.) consult `query_gmcp_panel_subscription` / `query_gmcp_feature_subscription` before sending.
- A missing panels mapping is treated as "all off"; a missing top-level subscriptions attribute is treated as "all on" so legacy clients remain functional.

## Darkwind.Client.RefreshMedia

Direction: `Client -> Server`

Asks the server to re-push the player's current media payloads (avatar and room image). This is used after the client's WebSocket reconnects, after a `Ctrl+K` handshake reset, and any other moment where the client may have dropped media URLs from local state.

### Schema

The message carries no payload:

```text
Darkwind.Client.RefreshMedia
```

Compliant clients may send an empty JSON object `{}`; the current Darkflow client sends the package name with no payload.

### Server Behavior

- The server re-pushes the current `Darkwind.Char.Avatar` and `Darkwind.Room.Image` payloads through their normal helpers, subject to the corresponding subscription gates.
- Other media surfaces (room images for sub-rooms, etc.) are pushed as part of the same refresh path.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Or, for messages with no payload:

```text
PackageName
```

Examples:

```text
Darkwind.Client.Subscriptions {"reason":"panel-open","full":false,"panels":{"vitals":true,"status":true,"buffs":false,"omens":true},"features":{"announcementsBadge":true,"enemyAutoOpen":true,"windows":true,"ide":true,"completion":true,"giphy":true}}
```

```text
Darkwind.Client.RefreshMedia
```
