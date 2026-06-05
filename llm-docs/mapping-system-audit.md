# Mapping System Audit & Remediation Plan

_Scope: the collaborative map in the Darkflow web client (`play.darkwind.ai/`)
and its server-side companion in the Darkwind MUD (`darkwind-nextgen/`)._

_Status: **Phase 1 and Phase 2 complete** (1a/1b/1d + 2a/2b/2c/2d). The map is
server-authoritative MapData2 only; V1 is gone from the client and gated off the
server for MapData2 clients. Remaining: in-MUD validation of the live behavior._

## TL;DR

The map breaks for one structural reason: **two complete mapping systems are
running at the same time**, and the newer one blanks the entire panel whenever
the server cannot assign the player's current room an (x,y) coordinate. Moving
into any room the layout solver can't place -- a shop you `enter`, a tower you
climb with `up`, a room reached by a non-compass exit -- wipes the whole map to
"Map layout pending" even though every surrounding room is already known.

The fix is not a rewrite. It is: (1) stop blanking the map when the player's
room is unpositioned, (2) make the server solver actually place vertical and
non-compass rooms, (3) retire the legacy client-side coordinate-guessing system
so only the server-authoritative one remains, and (4) stop the version churn
that forces constant full resyncs.

---

## Current architecture (as built)

There are **two parallel stacks**, V1 (legacy) and V2 (current), live in both
repos simultaneously.

### Client (`play.darkwind.ai/public/js/`)

| File | Role |
|------|------|
| `map-data.js` (690 lines) | **V1.** Client *infers* coordinates from the movement command you typed. Tracks "movement intents", guesses x/y/z by direction offset, detects coordinate conflicts, seeds an origin, triggers resyncs. Very complex, very fragile. |
| `map-data-v2.js` (284 lines) | **V2.** Server-authoritative. Stores the room graph + coordinates the server sends. Does no inference. |
| `map-renderer.js` (285 lines) | Renders whichever source is "active". `activeMapSource()` returns V2 if `mapDataV2.isActive()`, else V1. |

`panel-manager.js` wires GMCP handlers for **both** stacks at once:
- `Room.Info` -> `processRoomInfo` (V1) **only if V2 is not yet active**
- `Darkwind.MapData.Area/Update/RoomCoords` -> V1 merge
- `Darkwind.MapData2.Current/Area/Update` -> V2 merge

V2 flips `active = true` on the first `Darkwind.MapData2.Current`. From then on
the renderer reads V2 and V1 goes dormant -- but V1's GMCP handlers and
`localStorage` writes keep running.

### Server (`darkwind-nextgen/codebase/secure/daemons/`)

| File | Role |
|------|------|
| `map_d.c` | **V1 daemon.** Client sends `RoomUpdate`; server BFS-resolves coordinates and pushes `Darkwind.MapData.Area`. |
| `map2_d.c` (660 lines) | **V2 daemon.** Owns the graph. `observe_room()` records the room, runs a layout solver (`resolve_area`), pushes `Darkwind.MapData2.Current`. |

`telopt_d.c::send_room_info()` (around line 2853) drives **both daemons on every
single room change**:
```c
if (query_gmcp_panel_subscription(who, GMCP_SUB_PANEL_MAP) && sMapKey)
    catch(MAP_D->receive_room_update(who, ...));      // V1
if (query_supports_mapdata2(who) && sMapKey)
    catch(MAP2_D->observe_room(who, oRoom, ...));     // V2
```

The Darkflow client advertises `Darkwind.MapData2 1`, so for every web player
**both daemons do full work and both protocols stream to the browser** on every
step. They compute different coordinates from different rules.

---

## Root causes (ranked by player impact)

### 1. The map blanks whenever the current room is unpositioned  -- THE big one

`map-renderer.js:62`:
```js
if (!currentRoom || currentRoom.x === null) {
  // renders "Map layout pending" / "No map data yet" and RETURNS
  return;
}
```

If the player's *current* room has no coordinate, the renderer throws away the
**entire** area -- every already-mapped neighbor -- and shows a placeholder.
This is the literal "you move rooms and the whole map disappears" report.

It triggers constantly because the server frequently returns an unpositioned
current room (see #2). One bad room = total blank, not a missing tile.

### 2. The server solver can't place common room types -> unpositioned rooms

`map2_d.c::resolve_component()` only walks edges where `kind == "spatial"`:
```c
if (!mappingp(mEdge) || mEdge["kind"] != "spatial") continue;
```
But `classify_exit()` labels `up`/`down` as **`"vertical"`** and anything
non-compass (`enter`, `out`, `climb`, gates, portals) as **`"special"`**. The
solver skips both. So:

- A room reachable **only** by `up`/`down` (towers, stairs, cellars, multi-floor
  buildings) is **never positioned**. Climb stairs -> current room unpositioned
  -> map blanks (#1).
- A shop/guild/cave reached only via `enter`/special exit is **never
  positioned** -> blanks the same way.

`DIR_OFFSETS` in the daemon even *has* `up`/`down` z-offsets (`{0,0,1}` /
`{0,0,-1}`) -- they're just never used because the kind filter excludes them.

Areas over `MAP2_MAX_ARRAY_ROOMS` (4500) skip `resolve_area` entirely
(`map2_d.c:417`), leaving everything unpositioned -> permanent blank in big
domains.

### 3. Version churn defeats incremental sync -> constant full resyncs / flicker

`map2_d.c::mark_area_version()` bumps **every room in the area** to a new
incrementing version on **any** change:
```c
foreach (string sId, mixed xIgnored : mmAreas[sArea]) {
    iVersion++;
    mmRooms[sId]["version"] = iVersion;
}
```
Because `resolve_area()` runs on every observation and frequently reports
`layout_changed`, the whole area's versions advance almost every step. The
delta collector (`collect_area_delta_room`) skips rooms with
`version <= sinceVersion`, but since *all* versions just moved, **every sync
re-sends the whole area** in 50-room chunks. Combined with `replace:1` on full
syncs, the client periodically wipes and rebuilds the area, which reads as
flicker / momentary blank during normal play.

### 4. Solver coordinates are unstable between observations

`resolve_area()` resets every non-`room`/`grid` room to `positioned = 0` and
re-runs BFS from a seed each time. Coordinates depend on traversal/seed order,
so a room can legitimately move from (3,1) to (2,4) as the area grows. Each move
bumps versions (#3) and shifts tiles under the player. Layout should be
**sticky**: once placed, a room keeps its coordinate unless it actually
conflicts.

### 5. Two stacks fighting in one browser

Even when V2 is "active", V1 still ingests `Darkwind.MapData.Area`, writes its
own `localStorage` key (`darkwind-map-data-v3`), and the server still runs the
full V1 daemon per step. Risks and costs:
- Double GMCP traffic per step.
- On reload, V2 restores `active=true` from storage but if its room set was
  cleared by a migration, the renderer shows V2 (empty) while V1 still holds a
  good map -> blank.
- Two sources of truth make every bug twice as hard to reason about.

### 6. Smaller correctness issues

- `map-renderer.js:235` -- the "sparse graph" fallback
  (`connectedVisibleCount < 3`) papers over #1/#2 by dumping arbitrary bucket
  rooms onto tiles; it can render rooms at coordinates that don't reflect the
  graph.
- `getRoomsByArea()` filters to positioned rooms only, so connected-but-pending
  rooms are invisible even when we know the edge exists (the V2 protocol doc
  explicitly says clients *should* show pending rooms).
- No "you are here when position unknown" affordance exists -- the only states
  are "full map" or "nothing".

---

## What Mudlet does differently (and what to adopt)

Mudlet's mapper is the reference implementation for MUD auto-mapping. Its
auto-mapper logic lives in `src/mudlet-lua/lua/generic-mapper/generic_mapper.xml`
(functions `create_room`, `find_link`, `stretch_map`, `move_map`). The
architecture is the **opposite** of Darkwind's in the ways that matter:

**1. Coordinates are assigned once and are permanent. There is no global
re-solve.** When you move `dir`, `find_link()` looks for an existing room at
`current_coords + offset(dir)`. If found, it links and re-centers. If not, it
`create_room()`s the new room *at that coordinate* and never touches it again.
Darkwind's `resolve_area()` re-derives every room's coordinate from a BFS seed on
**every observation** -- that is the direct cause of tiles shifting under the
player (#4) and the version churn (#3). **Adopt: incremental, sticky placement
driven by the connecting edge. Never re-solve a positioned room.**

**2. Coordinate collisions stretch the map; they never un-place a room.** When a
new room lands on an occupied coordinate, `stretch_map()` pushes every room
beyond it in that direction out by one, opening a gap. The new room stays
positioned. Darkwind instead leaves the room *unpositioned* on conflict, which
blanks the map (#1/#2). **Adopt: on collision, displace neighbors (or accept a
benign overlap) -- never produce an unpositioned room.**

**3. Every room gets coordinates immediately -- including `up`/`down` and
special exits.** Mudlet's `coordmap` has z-offsets for up/down, and portal/`enter`
destinations are created at the parent's coordinate. So the *current* room always
has a coordinate, which is why `centerview(currentRoom)` can always draw and the
map never blanks. Darkwind excludes vertical/special exits from its solver (#2),
so those rooms have no coordinate and blank the panel. **Adopt: vertical = z
offset; special = place adjacent to / overlapping the parent. All rooms
positioned.**

**4. Known-but-unmapped exits render as stubs.** `setExitStub()` draws a short
line out of the room for an exit whose destination isn't mapped yet, so the
topology is always visible and the map grows visibly as you explore. Darkwind
hides pending rooms entirely. **Adopt: render stubs / pending tiles.**

**5. Darkwind already has the one thing Mudlet has to fake.** Mudlet identifies
rooms by a server hash *if available*, else falls back to fragile name+exits
matching within a search window. Darkwind's server sends **authoritative unique
room ids** on every `Room.Info`. That makes placement deterministic: we never
have to guess whether two rooms are "the same". This is a real advantage -- the
server-authoritative model is sound; only the *placement algorithm* is wrong.

**Net:** keep Darkwind's server-authoritative, collaborative design (one shared
map across all players -- better than Mudlet's per-client maps). Replace the
per-step global BFS re-solve with Mudlet-style **incremental sticky placement +
stretch-on-collision**, treating vertical and special exits as positionable.

## Remediation plan

Two phases. **Phase 1 is the 80/20** -- it stops the map from disappearing and
can ship on its own. Phase 2 removes the dual-stack debt so this stays fixed.

### Phase 1 -- Stop the disappearing map (high impact, low risk)

**1a. Client: never blank a known area.** (`map-renderer.js`) -- **DONE**
Decoupled the render center from the player's room:
- `renderMap()` now computes a `centerRoom` separately from `playerRoom`. If the
  player's room is unpositioned but the area has positioned rooms, it renders the
  area parked on the last-known center (tracked per area in `lastCenterByArea`,
  falling back to the centroid-nearest room) with a `map-pending` "Locating you"
  indicator and a dashed `map-tile-lastpos` marker -- instead of wiping the grid.
- The full-panel placeholder now only shows when the area has zero positioned
  rooms (genuinely no data).
- Player icon (`map-tile-player`) is drawn only when the player's room is
  positioned; the room name still names the room the player is actually in.
- CSS: added `.map-pending` and `.map-tile-lastpos` in `panels.css`.
- Tests: `test/map-renderer.test.mjs` drives the real MapData2 model + renderer
  (unpositioned-in-known-area, positioned-normal, empty-area). Full suite green
  (59 tests).

**1b. Server: replace the per-step global re-solve with incremental sticky
placement** (the Mudlet model). (`map2_d.c`) -- **DONE**
`observe_room()` no longer calls `resolve_area()`. Instead `place_current_room()`
positions the one room being observed:
- **Sticky:** if the room is already positioned (explicit room/grid coords or a
  prior solver placement), it is left untouched -- so existing rooms never move
  (kills the shifting #4) and only the new room changes (kills churn #3).
- **Seed:** the first positioned room of an area anchors at (0,0,0).
- **Anchor:** uses the room the player came from (tracked in the new
  `gmcp_map2_last_room` player attribute) *only when a real exit connects it to
  here* (`connecting_dir()`), then places at `prev + DIR_OFFSETS[dir]`.
  `DIR_OFFSETS` covers compass **and `up`/`down` (z +/- 1)**. Special exits like
  `enter` (no offset) are placed *beside* the previous room.
- **Fallback anchor:** if there is no usable previous room (login/teleport), it
  anchors off any already-positioned graph neighbour using the reverse offset.
- **Collision / non-spatial:** `find_free_cell()` nudges to the nearest free cell
  (expanding rings) instead of overwriting a room or leaving this one
  unpositioned. (Chose nudge-to-free over Mudlet's whole-area `stretch_map` to
  keep every existing room sticky and avoid version churn; collisions are rare
  and a nudged room simply won't draw a connected border.)
- **No anchor at all** (a room reachable only by a non-spatial exit with no
  positioned neighbour): left unpositioned -- the client's 1a keeps the map
  visible and the next spatial move positions it.
`resolve_area()`/`resolve_component()`/`mark_area_version()` are kept but no
longer on the live path (commented as legacy; note `resolve_component` still only
lays out spatial exits, so it is not a drop-in repair tool).

**1c. (folded into 1b.)** Stickiness is inherent to the incremental model.

**1d. Server: stop bumping every room's version.** (`map2_d.c`) -- **DONE**
New `stamp_room_version()` bumps the area version once and stamps **only the
observed room**, replacing the old `mark_area_version()` that re-stamped every
room in the area. Incremental `Sync` now returns real deltas, not the whole area.

Validation: `tools/lpc-check` clean on `map2_d.c` and `telopt_d.c`. Runtime
behavior still needs in-MUD testing (see checklist). Phase 1 is self-contained:
1a makes the panel usable, 1b/1d make it correct and quiet.

### Phase 2 -- Retire V1, single source of truth -- **DONE**

**2a. Server: gate V1 off for MapData2 clients.** (`telopt_d.c`) -- **DONE**
`send_room_info()` now runs MapData2 *or* V1, never both: if
`query_supports_mapdata2(who)` it calls only `MAP2_D->observe_room`; otherwise it
falls back to `MAP_D->receive_room_update`. The V1 area-change push is likewise
gated to `!query_supports_mapdata2(who)`. Legacy/non-MapData2 clients keep V1.

**2b. Client: remove V1 entirely.** -- **DONE**
- Deleted `public/js/map-data.js` (the 690-line client-side coordinate guesser).
- Removed the `Darkwind.MapData.Area/Update/RoomCoords` handlers and the
  `processRoomInfo` call from `panel-manager.js`; removed `trackCommand` from
  `input.js`/`output.js` (no more client movement inference); repointed
  `app.js`'s `flushPendingMapSave` import to `map-data-v2.js`.
- `map-renderer.js` reads `map-data-v2.js` directly; the `activeMapSource()`
  V1/V2 switch is gone. One stack, one `localStorage` key.

**2c. Client: spaced rooms + connectors + exit stubs.** (`map-renderer.js`) -- **DONE**
Rooms now render as separate boxes spaced by `TILE_GAP` (grid `gap`, with the
panel-fit math using the tile+gap pitch). `buildExitSpans()` draws child spans in
the gap *outside* each box: a `.map-conn-*` line bridging to an adjacent mapped
neighbour, or a shorter/dimmer `.map-stub-*` tick toward an exit whose
destination is not mapped yet (Mudlet-style "more to explore"). Replaced the old
`.map-tile-open-*` border-merging look. CSS `.map-conn-*` / `.map-stub-*` in
`panels.css`.

**2d. Diagnostics.** -- **DONE**
- Client: `window.mapDebug` rebuilt on the V2 model -- `summary()` (positioned /
  unpositioned / per-area / current room / pending names / area versions),
  `rooms(area)`, `clearData()`, `resync(area)`.
- Server: the existing implementor `map2d` command already covers
  `status | area <a> | room <id> | here | conflicts <a> | cleararea <a>`.

Tests: `test/map-renderer.test.mjs` extended with a stub case; full suite green
(60 tests). `tools/lpc-check` clean on `telopt_d.c` + `map2_d.c`.

### Out of scope / explicitly not doing
- No new map renderer, no canvas/WebGL rewrite, no tile-art changes.
- No change to area-keying (`map_area` / domain canonicalization already works).

---

## Suggested sequencing

1. **1a** (client no-blank) — biggest perceived win, ship first, low risk.
2. **1b** (server incremental sticky placement + stretch, vertical/special
   positionable) — removes the root cause behind 1a ever needing to fire, and
   inherently fixes the tiles-shifting (#4) and most version churn (#3).
3. **1d** (only version-stamp changed rooms) — finishes quieting sync/flicker.
4. **2a** (server V1 gate) — verify nothing regresses for telnet mappers.
5. **2b/2c/2d** (client cleanup + diagnostics) — pay down the debt.

Each step is independently shippable and independently testable in-game.

## Validation checklist (per change)
- Walk a multi-floor building (`up`/`down`): map stays visible, player tracks
  across z-levels.
- `enter` a shop and leave: map never blanks.
- Cross an area boundary: no full wipe/flicker; pending rooms show, then resolve.
- Reload the browser mid-area: map restores without going blank.
- `tools/lpc-check` clean on every touched `.c`; map panel renders in
  Chrome/Firefox/Safari.
```
