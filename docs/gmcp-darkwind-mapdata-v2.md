# Darkwind.MapData2 GMCP Protocol

`Darkwind.MapData2` is Darkwind's server-authoritative collaborative map. The
server owns room identity, topology, layout, cache generations, and sync
boundaries. Clients render completed snapshots and must not infer Darkwind
coordinates from typed movement commands.

## Negotiation

```json
["Darkwind.MapData2 2"]
```

Version 2 adds map epochs, area generations, stable snapshot cursors, explicit
completion, trust metadata, and live-exit validation. The server retains the
version 1 offset/version response path for clients advertising version 1.

## Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.MapData2.Current` | Server -> Client | Current room plus live movement truth |
| `Darkwind.MapData2.Area` | Server -> Client | Full area payload and version-1 compatibility snapshot |
| `Darkwind.MapData2.Update` | Server -> Client | Full or incremental snapshot page |
| `Darkwind.MapData2.Sync` | Client -> Server | Start or continue a snapshot |
| `Darkwind.MapData2.Error` | Server -> Client | Restart or retry instruction |
| `Darkwind.MapData2.Browse` | Client -> Server | Request a catalog map |
| `Darkwind.MapData2.BrowseArea` | Server -> Client | Catalog map page |
| `Darkwind.MapData2.Reset` | Server -> Client | Invalidate one area or the complete map cache |

## Room Record

```json
{
  "id": "450359962737049",
  "name": "Temple Yard",
  "area": "Darkwind",
  "env": "outside, city",
  "observed": true,
  "observedAt": 1783612800,
  "layoutState": "verified",
  "positioned": true,
  "x": 0,
  "y": 0,
  "z": 0,
  "coordSource": "room | grid | solver",
  "version": 12,
  "exits": { "north": "450359962737050" },
  "exitKinds": { "north": "spatial" },
  "exitDoors": { "north": 1 },
  "walkSafe": { "north": true },
  "details": ["shop"]
}
```

`layoutState` is `frontier`, `pending`, `verified`, `adjusted`, or
`identity_conflict`. Frontier records are destination stubs that have not been
visited. Adjusted rooms are positioned away from their natural cell to preserve
both rooms after a collision. Clients must display these states without
inventing adjacency.

Room ids are stable 52-bit integers on the Darkwind server, while clients may
also encounter their string representation in caches or compatible servers.
Because LDMud represents booleans as integers, server frames encode boolean
flags such as `observed`, `positioned`, `complete`, `replace`, and `more` as
`0` or `1`; clients also accept JSON `false` and `true` from compatible servers.

## Current

`Current` contains the room record plus:

```json
{
  "protocol": 2,
  "mapEpoch": "1783612800-123456",
  "areaGeneration": 3,
  "areaVersion": 91,
  "areaName": "Darkwind",
  "liveExits": { "north": "450359962737050" },
  "liveDoors": { "north": 1 }
}
```

`liveExits` and `liveDoors` are the current observation, not durable shared
topology. A speedwalk must verify the next direction and destination against
these fields before sending the command.

## Version 2 Sync

Initial or incremental request:

```json
{
  "area": "Darkwind",
  "mapEpoch": "1783612800-123456",
  "generation": 3,
  "since": 40,
  "snapshotVersion": 0,
  "cursor": 0
}
```

The first response freezes `snapshotVersion`. Continuations repeat it and use
the returned room-id cursor:

```json
{
  "protocol": 2,
  "mapEpoch": "1783612800-123456",
  "area": "Darkwind",
  "areaGeneration": 3,
  "since": 40,
  "snapshotVersion": 91,
  "latestVersion": 93,
  "cursor": "450359962737099",
  "complete": false,
  "replace": false,
  "rooms": []
}
```

Clients stage every page and commit only when `complete` is true. `replace`
means the committed snapshot replaces that area's cached membership. When
`latestVersion` is greater than `snapshotVersion`, request an incremental sync
immediately after commit. Empty areas still produce a completed response.

An epoch mismatch invalidates the whole MapData2 cache. An area-generation
mismatch invalidates only that area. `Error.restart` instructs the client to
discard the staged transfer and request a full area snapshot. Rate-limit errors
carry `retryAfterMs`.

## Area And Version 1 Compatibility

`Darkwind.MapData2.Area` carries `{ area, rooms }` plus optional `version`,
`more`, `replace`, `areaGeneration`, and `mapEpoch` fields. Darkflow merges the
rooms immediately. A completed payload stores the area's version; `replace`
removes the area's prior membership before merging.

Version 1 `Update` pagination uses `version`, `since`, `offset`, and `more`.
Darkflow continues with:

```json
{
  "area": "Darkwind",
  "version": 40,
  "offset": 100
}
```

After a connection demonstrates protocol 2, Darkflow ignores unsolicited
protocol-less v1 updates so they cannot corrupt a staged v2 snapshot.

## Browse And Reset

`Darkwind.MapData2.Browse { "catalog": "area-id" }` requests a catalog area.
`Darkwind.MapData2.BrowseArea` returns its `catalog`, display `name`, optional
`center`, `rooms`, and version-1 `more`/`offset` pagination fields. Browse data
is stored separately from the live map.

An area-scoped Reset includes `scope: "area"`, `area`, and optionally the new
`areaGeneration`/`mapEpoch`; Darkflow clears and resyncs only that area. An
unscoped Reset invalidates all MapData2 baselines and requests a fresh current
context while keeping the last rendered snapshot visible until replacement
data commits.

## Speedwalk Safety

Canonical compass, diagonal, up/down, and in/out exits are safe by default.
Other exit verbs require the room's `query_map_speedwalk_safe(direction)` hook.
Every step is sent separately and verified against the next authoritative room
id. Disconnects, map epoch changes, missing live exits, closed doors, send
failures, timeouts, and unexpected rooms cancel the walk.

## How The Client Draws It

This section is client presentation, not protocol; nothing here asks more of
the server.

The player's marker is its own layer over the player's cell. When the current
room moves by up to two cells in the same area and level, the marker steps
there in 180 ms and the view glides after it in 380 ms, so the marker leads
and the view settles on it; a longer jump, a new area, or reduced motion cuts
instead. Both are CSS animations given a negative delay equal to the time
already spent, so the several renders a single move causes carry one glide
on rather than restarting it. A move made mid-glide starts from wherever the
glide had got to. An arrow on the marker points the way the player last
stepped; a jump, the stairs, or a new area keeps the old facing. Standing
still, the marker's ring breathes slowly; the marker is drawn afresh on each
move, and the breathing waits 1.2 s to start, so it does not run while the
player walks.

Empty cells beside known rooms are drawn as mist, the edge of the explored
map, and a cell that an unexplored exit leads into is brighter. A room with
`observed: false` is a grey silhouette. Rooms that appear while the player
is in an area clear out of the mist over 700 ms; arriving in an area, or more
than 40 rooms at once (a load or a resync), sets the baseline without that.

The `shop`, `bank`, `guild`, `pub`, and `post` details get drawn icons;
any other detail keeps its initial. The map's ? button opens a legend.

Hovering or focusing a room previews the route to it: dots through each room
on the way, the connectors between them lit, and the step count on the
destination, or a dashed red outline when there is no known route. The route
is `findPath`, the same search a speedwalk uses. Once a speedwalk starts, its
remaining route is drawn the same way in cyan until it ends.

With "Tint the map by time of day" on (Settings, Appearance), the live map
takes the Scene's time-of-day tint from `Darkwind.Sky`, spread from the
player's marker; at night a pool of light about two cells across surrounds
the player. Rooms with no sky, such as inside or underground, are left alone.

With "Paint the map's terrain" on (Settings, Appearance; on by default), the
land is painted on a canvas under the rooms instead of one square tile per
room. Rooms of one terrain join into a region: each room's box grows into
the gaps around it, rounded and feathered, so neighbouring regions meet
without a black seam and the explored land fades into the dark at its edge.
Regions are painted low ground first (water, beach, open land) and dense
cover and high ground last. Water is laid over a band of beach, which shows
as a shore. A road or path room stands on the commonest land around it
(never water) and roads are stroked along exits between road rooms only; a
road room's other exits keep their ordinary connector. The room boxes become
faint plates on the land, and unvisited rooms are left out of the paint for
the fog.

Textures are anchored to the world, so the land holds still as the view
glides over it. Each terrain uses the painted texture that
`/assets/terrain/index.json` lists, and the old 32px map tile until then;
`scripts/terrain-texture-build.cjs` builds the painted set from Gemini
sheets and writes that index. The planner (`map-terrain-core.js`) is pure
and unit-tested; the painter (`map-terrain-paint.js`) caches the last
painting, so the several renders one move causes paint once.

The map zooms with the mouse wheel or a trackpad pinch, one zoom step at a
time, keeping the world point under the pointer still (`anchoredZoomPan`)
and easing the step in around it; the + and - buttons do the same around the
middle. A wheel event of 40 pixels or more is one notch, since a notch's size
depends on the screen's scaling; smaller deltas are gathered, and steps are
at least 70 ms apart. A drag let go while still moving coasts on and slows to
a stop (`releaseVelocity`), and catching it stops it. Re-center and search
glide the view to where they land, over at most two cells, since the grid
only reaches that far past the edge.

The ▲ and ▼ buttons show other floors of the area: the next level up or down
that has rooms. The player's own floor shows beneath as dashed outlines, and
a ghost of the marker marks where the player is, with an arrow toward them.
Re-center returns to the player's floor, and taking the stairs follows the
player there.

Right-click a room (or press the menu key on it) to pin it as a note, quest,
danger, loot, or home, with a short note. Pins are kept per character in
`localStorage["darkflow-map-pins:<characterProfileId>"]`, at most 500, and
show as a badge on the room, on its card, and in the legend.

The search box (⌕) finds rooms in the area by name, by service (a shop is
also a store, a pub an inn or tavern), and by pin kind and note; every word
must match, and names that start with a word rank first. Empty, it lists the
area's pins. Enter flies to the room, on its floor, and rings it; Shift+Enter
or Walk also speedwalks there.

A road or path room is a bridge when its description names water (a
`river`, `lake`, or `sea` token in `env`) or when it has water on two
opposite sides; water on one side is a shore road. The water runs on under a
bridge, and its deck is painted with plank texture turned to the deck's
direction, between dark rails. Road links are drawn in two halves, from each
room to the midpoint, so a deck, a road, and a path each cover only their own
room's half.

With "Animate the map" on (Settings, Appearance; on by default), the painted
map's water shimmers, swamp mist drifts, and at night town rooms show
flickering torchlight above the night tint. Each kind is one layer over the
painted window, not one per room: water and mist are a patterned layer
masked to their regions, using small copies of the painter's own region
masks, whose pattern slides by transform; torches are painted once onto
three canvases that flicker by opacity, each at its own pace. All of it can
run on the compositor, and it is rebuilt only when the painted terrain is.
Reduced motion, the setting off, or the tile look leaves the map still.

Crossing into a new area shows its name as an "Entering ..." banner that
fades after about three seconds; the area the map opens in gets none.

Hovering or focusing a room shows its card beside it: the room's name, its
terrain, its pin and note, its services, each exit with the room it leads to
(and that room's area when it is another) and its door's state from
`exitDoors` (a door with no exit, closed behind it, is listed too), the other
rooms mapped to the same cell, and on the live map the steps there or "No
known route". The card is
built for the one room when it is hovered (`map-card-core.js`); the tiles
carry no `title`, which had been a string per room written on every render.

Below 50% zoom, where badges are left out, pinned rooms are labelled with
their note (or name) and rooms with services with their name, as many as fit
without overlapping (`map-labels-core.js`): pins first, then rooms in view,
at most 40. The labels sit in the grid, which is scaled down, so their text
is scaled up by as much to stay readable.

The map zooms to 300%, and from 200% (`RICH_DETAIL_ZOOM`) each tile is rich:
every service it offers in a row along its top (up to four), its name across
the middle in two lines, the pin's note under that, and its door ticks grown
into bars across the gap, an outline for an open door, a solid amber bar for
a closed one, and a red bar with a keyhole for a locked one. The player's
own tile, under the marker, has no name. The words, the pin badge, and the
route's step count keep their size on screen as the tile grows. Fewer tiles
fit at these zooms, so walking costs no more than at 150%.

A double-click on the map centres the view on that point, gliding. On the
live map a click on a room walks there, so only the ground between rooms
takes a double-click; on the area map, rooms do too.
