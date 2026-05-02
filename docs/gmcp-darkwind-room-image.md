# Darkwind.Room.Image GMCP Protocol Specification

This document specifies the `Darkwind.Room.Image` GMCP package as implemented by the current Darkflow web client and the Darkwind mudlib.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Room.Image 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Room.Image` | Server -> Client | Push the current room's generated image URL |

The package has no client -> server messages. Refresh requests for room imagery are issued through `Darkwind.Client.RefreshMedia`; see [`gmcp-darkwind-client.md`](gmcp-darkwind-client.md).

## Darkwind.Room.Image

Direction: `Server -> Client`

Provides the URL of the room image to render in the room image panel.

### Schema

```json
{
  "url": "https://media.darkwind.org/rooms/darkwind/tavern.jpg",
  "name": "The Smoky Tavern"
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | Yes | HTTPS URL of a room image; the client ignores the message if `url` is missing or empty |
| `name` | string | No | Display caption used as the image alt text and lightbox title |

### Client Behavior

- On receipt, the client marks the room image as loading and keeps the previous image visible while a probe `Image` element preloads the new URL.
- On preload success, the client swaps to the new URL, clears the loading state, and re-renders the `roomImage` panel.
- On preload failure, the client clears the loading state and keeps the previously rendered image (if any).
- The room image is reset to `null` on `Room.Info` messages whose `num` differs from the cached room number; clients then show a "Generating room image..." placeholder until a new `Darkwind.Room.Image` arrives.
- The image is rendered with a click-to-zoom modal that escapes via the close button or `Escape`.

### Server Behavior

- Sent when the player enters a new room, when a room image is regenerated, and in response to `Darkwind.Client.RefreshMedia`.
- The server only sends the message when the player's GMCP support set advertises `Darkwind.Room.Image 1`.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Room.Image {"url":"https://media.darkwind.org/rooms/darkwind/tavern.jpg","name":"The Smoky Tavern"}
```
