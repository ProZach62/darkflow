# Darkwind.Giphy GMCP Protocol Specification

This document specifies the `Darkwind.Giphy` GMCP package, which delivers transient GIF-reaction overlays to web-client players when other players share a GIF on a chat channel.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Giphy 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Giphy.Show` | Server -> Client | Pop a transient GIF overlay over the terminal output |

The package has no client -> server messages. Web-client visibility is gated by the player setting that controls whether GIF popups are enabled, plus the `giphy` feature flag in `Darkwind.Client.Subscriptions`.

## Darkwind.Giphy.Show

Direction: `Server -> Client`

Tells the client to show a GIF reaction overlay for a brief duration. The overlay covers the lower-right of the terminal area and is dismissable with its close button.

### Schema

```json
{
  "channel": "chat",
  "caption": "Chat",
  "talker": "Elyndar",
  "phrase": "high five",
  "gifUrl": "https://media.giphy.com/media/abc123/giphy.gif",
  "durationMs": 10000
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `channel` | string | No | Channel name the GIF was shared on. Used to scope replays |
| `caption` | string | No | Display caption shown in the overlay header (often a humanized channel name) |
| `talker` | string | No | Display name of the player who shared the GIF; defaults to `Someone` when omitted |
| `phrase` | string | No | Search phrase the GIF was matched against; rendered in quotes when present |
| `gifUrl` | string | Yes | HTTPS URL of the GIF to display. The client ignores the message when this is missing or empty |
| `durationMs` | number | No | Display duration in milliseconds. Defaults to `10000`. Values below `1000` are clamped up to `1000` |

### Client Behavior

- A single overlay element is reused across messages; new payloads cancel any pending hide timer and replace the displayed image.
- The image is preloaded by setting `src`. If the load errors, the overlay hides immediately.
- After `durationMs`, the overlay auto-hides. The user can also dismiss early via the close button.
- The client tracks a recent-replay map keyed by `(caption || channel, talker, phrase)` (lowercased) and matches output lines of the form `[<caption>] <talker> shared a GIF for "<phrase>".`. Clicking such a chat line replays the corresponding GIF without a new GMCP push. The map is bounded to 100 entries (oldest evicted first).
- When the `giphy` feature flag is `false` in the current `Darkwind.Client.Subscriptions`, the server should not send this message; the client itself does not gate display on the flag.

### Server Behavior

- Sent by the giphy daemon when a player issues a `gif` channel command and the GIF is approved.
- Sent only to recipients who:
  - Are on the receiving end of the channel
  - Are connecting via the web client
  - Have GIF popups enabled in their player settings
- The server also sends a fallback plain-text channel line (`[<channel>] <talker> shared a GIF for "<phrase>".`) so non-web clients still receive context.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Giphy.Show {"channel":"chat","caption":"Chat","talker":"Elyndar","phrase":"high five","gifUrl":"https://media.giphy.com/media/abc123/giphy.gif","durationMs":10000}
```
