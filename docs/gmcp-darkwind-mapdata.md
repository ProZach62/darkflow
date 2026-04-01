# Darkwind.MapData GMCP Protocol Specification

This document specifies the `Darkwind.MapData` GMCP package, a collaborative mapping system that aggregates room traversal data from all connected players and pushes resolved area maps back to clients.

---

## Package Overview

| Package | Direction | Description |
|---------|-----------|-------------|
| `Darkwind.MapData.RoomUpdate` | Client -> Server | Report a room traversal (player moved from room A to room B via direction) |
| `Darkwind.MapData.Area` | Server -> Client | Push resolved area map data (all positioned rooms in an area) |
| `Darkwind.MapData.RoomCoords` | Server -> Client | Push coordinate correction for a single room (reserved for future use) |

The client declares support via `Core.Supports.Set`:
```json
["Darkwind.MapData 1"]
```

---

## How It Works

### Collaborative Mapping Flow

1. Player moves from room A to room B by typing a direction (e.g., "north")
2. Server sends `Room.Info` with room B's data (name, area, terrain, exits)
3. Client sends `Darkwind.MapData.RoomUpdate` reporting: "I was in room A, went north, arrived at room B"
4. Server's map daemon (`map_d.c`) records the edge: A --north--> B (and reverse: B --south--> A)
5. Server incrementally positions room B relative to room A using direction offsets
6. Server pushes `Darkwind.MapData.Area` with all positioned rooms in the area back to the client
7. Client merges server coordinates into its local map (server coords take priority)

Every player's movement contributes to the shared map. New players connecting for the first time receive the full explored map for their area immediately.

### Coordinate System

- Coordinates are per-area, relative to a seed room at (0, 0, 0)
- The first room with edges discovered in an area becomes the seed (persisted)
- Direction offsets:

| Direction | dx | dy | dz |
|-----------|----|----|-----|
| north | 0 | -1 | 0 |
| south | 0 | +1 | 0 |
| east | +1 | 0 | 0 |
| west | -1 | 0 | 0 |
| northeast | +1 | -1 | 0 |
| northwest | -1 | -1 | 0 |
| southeast | +1 | +1 | 0 |
| southwest | -1 | +1 | 0 |
| up | 0 | 0 | +1 |
| down | 0 | 0 | -1 |

---

## Darkwind.MapData.RoomUpdate

Sent by the client each time the player moves to a different room via a recognized direction command.

### Schema

```json
{
  "id": "string",
  "from_id": "string",
  "direction": "string",
  "name": "string",
  "area": "string",
  "environment": "string"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | MD5 hash of the destination room (from `Room.Info` `num` field) |
| `from_id` | string | Yes | MD5 hash of the room the player just left |
| `direction` | string | Yes | Canonical direction name (north, south, east, west, northeast, northwest, southeast, southwest, up, down) |
| `name` | string | No | Room short description |
| `area` | string | No | Area/domain name |
| `environment` | string | No | Terrain type(s) as English list (e.g., "outside, city and road") |

### When to Send

- Only when `Room.Info` arrives with a different room ID than the current room
- Only when the client has a pending direction from a recognized movement command
- Only when there is a known "from" room (not the first room after connecting)

### Direction Recognition

The client tracks the last command sent to the server. If it matches a known direction or alias, it is stored as the pending direction:

| Alias | Direction |
|-------|-----------|
| n | north |
| s | south |
| e | east |
| w | west |
| ne | northeast |
| nw | northwest |
| se | southeast |
| sw | southwest |
| u | up |
| d | down |

Full direction names also match (north, south, etc.).

---

## Darkwind.MapData.Area

Sent by the server to push resolved map data for an entire area. Sent after every `Room.Info` message if the map daemon has positioned rooms for that area.

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
        "direction": "dest_room_id"
      }
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `area` | string | Area name |
| `rooms` | array | Array of positioned room objects |
| `rooms[].id` | string | MD5 hash room identifier |
| `rooms[].name` | string | Room short description |
| `rooms[].env` | string | Terrain type(s) |
| `rooms[].x` | number | X coordinate (east/west axis, east is positive) |
| `rooms[].y` | number | Y coordinate (north/south axis, south is positive) |
| `rooms[].z` | number | Z coordinate (up/down axis, up is positive) |
| `rooms[].exits` | object | Direction -> destination room ID mapping |

### Client Behavior

When receiving `Darkwind.MapData.Area`:
- Create room records for any rooms not already known locally
- Override local coordinates with server-provided coordinates (server is authoritative)
- Update exits from server data
- Re-render the map panel

---

## Darkwind.MapData.RoomCoords

Reserved for future use. Will push coordinate corrections for individual rooms without sending the full area data.

### Schema

```json
{
  "id": "string",
  "x": 0,
  "y": 0,
  "z": 0
}
```

---

## Server-Side Architecture

### Map Daemon (map_d.c)

The map daemon maintains three persistent data structures:

- `mmRooms` -- mapping of room_id -> room data (name, area, env, x, y, z, positioned flag)
- `mmEdges` -- mapping of room_id -> (direction -> dest_room_id)
- `mmSeeds` -- mapping of area_name -> seed room_id (first room discovered, persisted)
- `mmAreas` -- mapping of area_name -> array of room_ids (index for fast area lookup)

### Coordinate Resolution

**Incremental (on each RoomUpdate):**
- If the from_id room has coordinates and the destination does not, position the destination relative to from_id using direction offsets
- If this is the first edge in an area, seed the from_id at (0, 0, 0)

**Full BFS (manual, via `mapd resolve <area>`):**
- Clears all positioned flags for the area
- BFS flood-fill from the persisted seed room
- Assigns coordinates based on edge directions
- Skips coordinate conflicts (two rooms wanting the same cell)

### Virtual Room Support

Virtual rooms (VRDAEMON grid system) get stable identities via:
- `query_map_id()` -- returns `"daemon_path:grid_coord"` for grid rooms, `null` for standalone vrrooms
- `query_map_exit_path()` -- returns `"daemon_path:grid_coord"` for integer exits without cloning rooms
- `set_grid_coord()` -- called by vrdaemon.setup_room() to assign the grid coordinate

Standalone virtual rooms (like `w_shore.c`) that inherit VRROOM but aren't grid-managed fall back to `load_name()` for their identity, like normal rooms.

### Admin Commands (mapd)

| Command | Description |
|---------|-------------|
| `mapd status` | Show total rooms, areas, positioned counts |
| `mapd areas` | List all mapped areas with room counts |
| `mapd area <name>` | Show details for a specific area |
| `mapd room <id>` | Show details for a room by MD5 hash |
| `mapd here` | Debug info for the current room (object name, map ID, exits, GMCP hash) |
| `mapd resolve <area>` | Re-run full BFS coordinate resolution for an area |
| `mapd dump <area>` | Dump all positioned rooms with names, coordinates, and terrain |
| `mapd conflicts <area>` | Show coordinate conflicts, orphans, and unreachable rooms |
| `mapd removeroom <id>` | Remove a specific room and all its edges |
| `mapd cleararea <area>` | Delete all map data for an area |
| `mapd clearall` | Delete ALL map data |

---

## Client-Side Architecture

### Data Model (map-data.js)

- Room graph stored in a `Map`: roomId -> `{ id, name, area, environment, exits, x, y, z }`
- Coordinate index: `"area:x,y,z"` -> roomId (prevents coordinate conflicts)
- Persisted to `localStorage['darkwind-map-data']`
- Direction tracking via `trackCommand()` called before sending commands

### Rendering (map-renderer.js)

- CSS Grid of 32x32px div tiles
- Each terrain type maps to a CSS class with a background-image tile
- Player position shown with `::after` pseudo-element overlay + white glow
- Viewport sized to fill the panel body
- Z-level indicator overlay in bottom-right corner
- 22 terrain types: city, road, path, forest, jungle, canopy, plains, farm, hills, mountain, desert, sea, lake, river, beach, swamp, arctic, underground, inside, barren, underwater, sky, outside

### Merge Strategy

The client maintains both locally-inferred and server-provided coordinates:
1. On movement: client infers coordinates from direction + previous room position
2. On `Darkwind.MapData.Area`: server coordinates override local coordinates
3. Server coordinates are authoritative -- they come from BFS resolution across all players' data

---

## Room Identity

Room IDs are MD5 hashes generated server-side in `send_room_info()`:

| Room Type | Identity Source |
|-----------|----------------|
| Normal rooms | `hash(TLS_HASH_MD5, load_name(room))` -- file path of the room |
| Virtual grid rooms | `hash(TLS_HASH_MD5, query_map_id())` -- `"daemon_path:grid_coord"` |
| Standalone virtual rooms | `hash(TLS_HASH_MD5, load_name(room))` -- file path (same as normal) |

Exit destination IDs use the same logic:
- Normal exits: `hash(TLS_HASH_MD5, query_exit_path(dir))`
- Virtual grid exits: `hash(TLS_HASH_MD5, query_map_exit_path(dir))` -- `"daemon_path:dest_coord"`
- String exits from virtual rooms: `hash(TLS_HASH_MD5, file_path)` (same as normal)

---

## GMCP Definitions (gmcp_defs.h)

```c
#define GMCP_PKG_DARKWIND_MAPDATA                    "Darkwind.MapData"
#define GMCP_PKG_DARKWIND_MAPDATA_ROOMUPDATE         "Darkwind.MapData.RoomUpdate"
#define GMCP_PKG_DARKWIND_MAPDATA_AREA               "Darkwind.MapData.Area"
#define GMCP_PKG_DARKWIND_MAPDATA_ROOMCOORDS         "Darkwind.MapData.RoomCoords"
```

---

## Transport

GMCP messages are sent as binary WebSocket frames. Format:

```
PackageName JSONPayload
```

Example raw frame:
```
Darkwind.MapData.RoomUpdate {"id":"abc123","from_id":"def456","direction":"north","area":"Darkwind"}
```

For telnet clients, GMCP uses the standard IAC SB/SE subnegotiation wrapping (TELOPT 201).
