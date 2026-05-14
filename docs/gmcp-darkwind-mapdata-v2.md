# Darkwind.MapData2 GMCP Protocol Specification

`Darkwind.MapData2` is the server-authoritative map protocol. The server owns
room topology and display layout; the client renders the graph it receives and
does not infer coordinates from typed movement commands.

## Support

```json
["Darkwind.MapData2 1"]
```

## Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.MapData2.Current` | Server -> Client | Current room graph/layout state |
| `Darkwind.MapData2.Area` | Server -> Client | Full area snapshot |
| `Darkwind.MapData2.Update` | Server -> Client | Incremental area snapshot |
| `Darkwind.MapData2.Sync` | Client -> Server | Request full or incremental area sync |

## Room Record

```json
{
  "id": "room-id",
  "name": "Temple Yard",
  "area": "Darkwind",
  "env": "outside, city",
  "positioned": true,
  "x": 0,
  "y": 0,
  "z": 0,
  "coordSource": "room | grid | solver",
  "version": 12,
  "exits": {
    "north": "other-room-id"
  },
  "exitKinds": {
    "north": "spatial",
    "up": "vertical",
    "enter": "special"
  }
}
```

Topology comes from `exits`. Coordinates are display metadata. A room may be
connected but not positioned; clients should keep the graph edge and show the
layout as pending or unresolved.

## Darkwind.MapData2.Current

Sent after the server observes the player room during `Room.Info` handling.

```json
{
  "id": "room-id",
  "name": "Temple Yard",
  "area": "Darkwind",
  "env": "outside, city",
  "positioned": true,
  "x": 0,
  "y": 0,
  "z": 0,
  "coordSource": "solver",
  "areaVersion": 33,
  "exits": {},
  "exitKinds": {}
}
```

## Darkwind.MapData2.Area And Update

Both messages use the same area payload. `replace: true` means the client should
discard cached non-current rooms for that area before merging.

```json
{
  "area": "Darkwind",
  "version": 33,
  "replace": true,
  "more": false,
  "rooms": []
}
```

If `more` is true, the client sends `Darkwind.MapData2.Sync` with the returned
`version` to request the next chunk.

## Darkwind.MapData2.Sync

```json
{
  "area": "Darkwind",
  "version": 33
}
```

Use `version: 0` for a full resync. Positive versions request rooms changed
after that area version.

## V1 Compatibility

`Darkwind.MapData` remains available as fallback during rollout. The Darkflow
client prefers MapData2 after the first `Darkwind.MapData2.Current` message and
stops using browser movement intent as map layout authority.
