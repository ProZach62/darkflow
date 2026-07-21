# Darkwind.MapData GMCP Protocol Specification

> Historical protocol: Darkflow no longer advertises or handles
> `Darkwind.MapData 1`. Current mapping uses
> [`Darkwind.MapData2 2`](gmcp-darkwind-mapdata-v2.md). This document is
> retained for older clients and migration work.

This document specifies the retired `Darkwind.MapData` protocol. It covers the
traversal reports older clients sent, the authoritative map state the server
returned, and the correction flow used when local inference diverged from
server coordinates.

## Package Overview

Historical support declaration:

```json
["Darkwind.MapData 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.MapData.RoomUpdate` | Client -> Server | Report a confirmed room transition plus the client movement sequence, when available |
| `Darkwind.MapData.Area` | Server -> Client | Deliver a full area snapshot |
| `Darkwind.MapData.Update` | Server -> Client | Deliver an incremental area sync payload with versioning |
| `Darkwind.MapData.Sync` | Client -> Server | Request a full or incremental sync for one area |
| `Darkwind.MapData.RoomCoords` | Server -> Client | Correct one room's coordinates without sending a full area payload |

## Historical Client Model

The client keeps a local room graph in `localStorage["darkwind-map-data"]`. Each room record stores:

```json
{
  "id": "string",
  "name": "string",
  "area": "string",
  "environment": "string",
  "exits": { "north": "dest_room_id" },
  "x": 0,
  "y": 0,
  "z": 0,
  "coordSource": "inferred | server"
}
```

The client also stores:

- `currentRoomId`
- `previousRoomId`
- per-area sync versions
- a bounded movement intent queue with sequence numbers and timestamps

Local coordinates may be inferred from recent movement commands, but server-provided coordinates remain authoritative.

## Movement Intent And Local Inference

Before a command is sent, the client checks whether the first token is a recognized movement command or alias:

| Command | Canonical direction |
|---------|---------------------|
| `n` / `north` | `north` |
| `s` / `south` | `south` |
| `e` / `east` | `east` |
| `w` / `west` | `west` |
| `ne` / `northeast` | `northeast` |
| `nw` / `northwest` | `northwest` |
| `se` / `southeast` | `southeast` |
| `sw` / `southwest` | `southwest` |
| `u` / `up` | `up` |
| `d` / `down` | `down` |

Each recognized movement intent is queued with:

```json
{
  "seq": 12,
  "direction": "north",
  "command": "n",
  "ts": 1710000000000
}
```

The queue is short-lived and bounded. Intents older than 2500 ms are pruned, and only the most recent 25 are retained.

When `Room.Info` indicates the player has entered a different room, the client consumes the oldest still-valid movement intent and may infer coordinates for the destination room relative to the room just left. If the area has no positioned rooms yet, the client can seed the prior room at `0,0,0` and infer the destination from that origin.

## Coordinate Sources And Resync Rules

The client treats coordinates in two classes:

- `inferred`: derived locally from recent movement intent plus known room coordinates
- `server`: received from `Darkwind.MapData.Area`, `Darkwind.MapData.Update`, or `Darkwind.MapData.RoomCoords`

The legacy client requested a resync when its assumptions were no longer trustworthy. The implemented triggers were:

- an inferred coordinate would collide with an already occupied coordinate in the same area
- the player changes rooms without a trusted movement intent, while other stale intents are still pending
- the current room already has authoritative server coordinates, but the latest traversal report would imply different coordinates relative to the previous room

Resync requests are rate-limited per area. When one is triggered, the client emits a system notice of the form:

- `Map sync: resyncing <area> (<reason>).`

When the current room is corrected by authoritative server data, the client emits:

- `Map sync: corrected current room position from x,y,z to x,y,z (server area data).`
- `Map sync: corrected current room position from x,y,z to x,y,z (server correction).`

After a correction to the current room, the client clears pending movement intents.

## Darkwind.MapData.RoomUpdate

Direction: `Client -> Server`

Sent after `Room.Info` confirms that the player entered a different room and the client has a trusted movement direction to associate with that transition.

### Schema

```json
{
  "id": "string",
  "from_id": "string",
  "direction": "string",
  "move_seq": 12,
  "name": "string",
  "area": "string",
  "environment": "string"
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | Yes | Destination room identifier from `Room.Info.num` |
| `from_id` | string | Yes | Previous room identifier |
| `direction` | string | Yes | Canonical direction name |
| `move_seq` | number | No | Sequence number assigned by the movement intent queue |
| `name` | string | No | Destination room name |
| `area` | string | No | Destination room area |
| `environment` | string | No | Destination room environment text |

### Client Expectations

- `move_seq` is optional and should be treated as advisory correlation data.
- The client only sends this message when it can associate a room change with a recognized direction command.
- The client does not wait for a server acknowledgement before continuing to render the local map.

Example:

```json
{
  "id": "abc123",
  "from_id": "def456",
  "direction": "north",
  "move_seq": 42,
  "name": "South Road",
  "area": "Darkwind",
  "environment": "outside, road"
}
```

## Darkwind.MapData.Area

Direction: `Server -> Client`

Delivers a full snapshot for one area. The client merges the supplied rooms and treats any included coordinates as authoritative.

### Schema

```json
{
  "area": "string",
  "rooms": [
    {
      "id": "string",
      "name": "string",
      "env": "string",
      "x": 0,
      "y": 0,
      "z": 0,
      "exits": {
        "north": "dest_room_id"
      }
    }
  ]
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `area` | string | Yes | Area name used as the local map namespace |
| `rooms` | array | Yes | Full room payload array for the area |
| `rooms[].id` | string | Yes | Room identifier |
| `rooms[].name` | string | No | Room name |
| `rooms[].env` | string | No | Environment text |
| `rooms[].x` | number | No | Authoritative X coordinate |
| `rooms[].y` | number | No | Authoritative Y coordinate |
| `rooms[].z` | number | No | Authoritative Z coordinate |
| `rooms[].exits` | object | No | Direction-to-room mapping |

### Client Behavior

- Creates unknown rooms.
- Updates `name`, `env`, and `exits` when present.
- Replaces local inferred coordinates with server coordinates.
- Marks coordinate source as `server`.
- Persists merged data to local storage.

## Darkwind.MapData.Update

Direction: `Server -> Client`

Delivered an incremental sync payload for one area. The legacy web client
treated the room payload like `Darkwind.MapData.Area`, then updated the stored
area version and optionally requested the next chunk.

The exact incremental diff semantics are inferred from client behavior rather than documented server code. The client requires the following shape:

### Schema

```json
{
  "area": "string",
  "version": 7,
  "more": true,
  "rooms": [
    {
      "id": "string",
      "name": "string",
      "env": "string",
      "x": 0,
      "y": 0,
      "z": 0,
      "exits": {}
    }
  ]
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `area` | string | Yes | Area name |
| `version` | number | Yes | Server version after applying this payload |
| `more` | boolean | No | When truthy, the client immediately requests the next chunk |
| `rooms` | array | Yes | Incremental room data merged with the same rules as `Area` |

### Client Behavior

- Merges `rooms` exactly as it would for `Darkwind.MapData.Area`.
- Stores `version` under the area's local sync state.
- If `more` is truthy, sends `Darkwind.MapData.Sync { area, version }`.

## Darkwind.MapData.Sync

Direction: `Client -> Server`

Requests a full or incremental sync for one area.

### Schema

```json
{
  "area": "Darkwind",
  "version": 7
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `area` | string | Yes | Area to sync |
| `version` | number | Yes | `0` requests a full resync; a positive value requests incremental changes since that version |

### Client Behavior

- Normal sync requests use the last stored version for the area, defaulting to `0`.
- Forced resyncs always send `version: 0`.

## Darkwind.MapData.RoomCoords

Direction: `Server -> Client`

Corrected one room's coordinates without requiring a full area payload. The
legacy client applied this message immediately; the current client does not
register this handler.

### Schema

```json
{
  "id": "string",
  "area": "string",
  "name": "string",
  "environment": "string",
  "x": 0,
  "y": 0,
  "z": 0
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | Yes | Room identifier |
| `area` | string | No | Used to populate or correct the local room record |
| `name` | string | No | Used when creating an unknown room locally |
| `environment` | string | No | Used when creating an unknown room locally |
| `x` | number | Yes | Authoritative X coordinate |
| `y` | number | Yes | Authoritative Y coordinate |
| `z` | number | Yes | Authoritative Z coordinate |

### Client Behavior

- Creates the room locally if it does not exist yet.
- Applies the new coordinates as authoritative server data.
- Persists the result.
- Emits a correction notice if the corrected room is the current room and the position changed.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.MapData.Sync {"area":"Darkwind","version":7}
```
