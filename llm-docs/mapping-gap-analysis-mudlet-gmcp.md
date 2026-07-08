# Mapping Gap Analysis: MapData2 vs Industry GMCP Standards & Mudlet

Date: 2026-07-07. Companion to `mapping-system-audit.md` (the disappearing-map
rework, phases 1-4) and `gmcp-update-consistency-audit.md`.

Research inputs: the IRE GMCP spec (nexus.ironrealms.com/GMCP), the MMP map
XML standard (mudstandards.org), Mudlet wiki mapper docs, the MSDP spec
(tintin.mudhalla.net), Aardwolf's GMCP mapper conventions, BeipMU's
beip.tilemap spec, and a source-level read of Mudlet (github.com/mudlet/mudlet:
`TMap`/`TRoom`/`TArea`/`T2DMap`/`TRoomDB` C++ plus the bundled
`generic_mapper` Lua package).

---

## 1. Where MapData2 already matches or exceeds the industry

These are worth stating first because the big architectural calls in the
rework turn out to be the consensus-correct ones:

| Dimension | Industry consensus | MapData2 |
|---|---|---|
| Room identity | Single permanent scalar id per room, sent every move (IRE `num`, Aardwolf `num`, MSDP `VNUM`, MMP `room id`); sentinel for unmappable rooms | ✅ md5-of-path int ids via `get_room_id()`; stable across reboots; `no_room_id` attr → 0 = unmappable. **Correction (2026-07-08):** the original `crc_fast` id masked to 0x2FFFF (~196k values) and collided for ~1 in 6 of the game's 24,890 rooms (4,857 colliding pairs — the v_road1a/Segovia Desert "wrong area" bug). Replaced with 52-bit md5-slice ids (JS-safe, 0 collisions across all room paths) + an id-reuse guard in map2_d that resets identity-derived state when a stored path no longer matches, + stale-catalog_id resurrection fixed. Deploy required `map2d clearall` + client SCHEMA_VERSION 4. |
| Exit representation | Object of `direction -> destination room id`; bare direction lists are the degraded fallback | ✅ `exits: {dir: destId}` in every payload, plus `exitKinds` (spatial/vertical/special) which NO standard has — richer than IRE/Aardwolf |
| Coordinate authority | Server-supplied room-grid coords beat client inference everywhere; client inference is universally treated as lossy + needing manual repair (Mudlet's `shift`/`merge rooms` workflow exists purely to fix it) | ✅ fully server-authoritative since phase 1b. We skipped the entire failure class the generic_mapper's repair toolkit exists for |
| Bulk + incremental sync | Mature pattern = versioned bulk pull (Client.Map → MMP XML, replace on version change) + per-move `Room.Info` corrections | ✅ and finer-grained: chunked `Area`/`Update` with a since/offset cursor + per-room version stamps beats MMP's replace-the-whole-file model |
| Direction vocabulary | Fixed 12 (8 compass + up/down/in/out); everything else is a named special exit with no drawn geometry | ✅ 8 compass + up/down as geometry; named specials place beside the anchor and render an indicator (better than Mudlet, which draws nothing for specials unless the user hand-draws a polyline) |
| Collision handling | Mudlet renderer only *flags* same-cell rooms (collision border color); auto-resolution is left to the Lua `stretch_map` (shove every other room outward) or manual `shift`/`merge` | ✅ exceeded as of 2026-07-07: direction-aware cone nudge + sanctioned-nudge healing + `map2d repack` beats both flag-only and stretch-everything |
| Duplicate rooms | generic_mapper needs `merge rooms` because text-matched rooms duplicate | ✅ impossible by construction — path-keyed ids |
| Maze handling | Aardwolf *withholds* dest-ids in mazes so mapping deliberately fails | ✅ our mazes are distinct-path rooms and map truthfully; `no_room_id`/`custom_room_id` attrs cover rooms that shouldn't map |

Conclusion: the protocol core is sound and in a few places ahead of the
published state of the art. The gaps are in **rendering semantics**,
**integrity tooling**, and a few **payload enrichments**.

---

## 2. Gaps, ordered by value

### GAP 1 — One-way exits are indistinguishable from two-way (renderer)

Mudlet (`T2DMap.cpp:3312-3644`): an exit whose destination does NOT point
back is drawn as a **dotted line with a filled arrowhead** near the
destination (reddish `QColor(255,100,100)`). Ours draws the same solid
full-gap bar for both. In a world with asymmetric exits (and after healing
rebases), a player cannot tell "I can get back" from "I can't".

**Recommendation**: in `buildExitSpans()` we already have both rooms — check
the destination's reverse slot (`dest.exits[REVERSE[dir]] === room.id`).
When absent, add a `map-conn-oneway` modifier class: dashed/dimmer bar
(CSS `background: repeating-linear-gradient` or opacity) + a small arrowhead
(rotated triangle span at the far end). Small change, pure client.

### GAP 2 — Cross-area exits render like unexplored exits (renderer)

Mudlet (`T2DMap.cpp:3646-3741`) draws area-boundary exits as a **short arrow
stub colored with the destination room's environment color**, clickable to
speedwalk. Ours renders a cross-area exit as the same dim stub as an
unexplored one — "there's more to explore" and "this leads to another zone"
are different facts.

**Recommendation**: when the dest room exists but `dest.area !== room.area`,
emit `map-stub-area` (distinct color — e.g. the amber family — slightly
longer than an unexplored stub) and put the destination area's display name
in the tile tooltip. Optional follow-up: clicking it opens that area in the
areaMap browse pane (we already have `Darkwind.MapData2.Browse` + the
separate-pane rule).

### GAP 3 — No save-format version or load-time audit in map2_d (server)

The two "infallibility" mechanisms Mudlet leans on hardest:

1. **Format versioning** (`TMap.h:274-316`): min/default/max save-version
   window; new fields tucked into userdata for back-compat. Our
   `/secure/savedir/map2_d` has **no version field at all** — a future
   schema change would restore garbage silently.
2. **`TMap::audit()` on every load** (`TRoomDB::auditRooms`,
   `TRoomDB.cpp:629-648`): validate every room id; reconcile area
   membership BOTH ways (room's area claim vs area's member set); fix
   remapped ids in every exit; **downgrade dangling exits to stubs while
   remembering the intended destination in userdata** (`audit.*` keys);
   dedupe exits/locks; delete doors/weights orphaned from any real exit.
   Principle: *never delete on fault — downgrade and remember, log
   everything*.

**Recommendation** (medium, high value):
- Add `"format_version": 1` to the save mapping; on restore, log + refuse
  (or migrate) on mismatch instead of silently proceeding.
- Add `audit_map()` run from `reset()` after restore (chunked via public
  call_out if room count is large), checking: (a) every `mmEdges[id]` has a
  record in `mmRooms` and every edge `"to"` exists (else delete edge +
  LOGIT with the lost destination); (b) every `mmAreas[area]` member exists
  in `mmRooms` and has `["area"] == area` (else fix membership — this is
  the both-ways reconciliation); (c) `mmSeeds[area]` is a live member;
  (d) `mmAreaVersions` ≥ max room version in the area (else bump).
  Surface counts via `map2d audit` so drift is observable, not silent.

### GAP 4 — Door states exist in the game but not on the map

Industry: MSDP/Mudlet model doors as `0 none / 1 open / 2 closed / 3 locked`
per exit; Mudlet draws a small perpendicular "gate" mid-line with per-state
colors (`drawDoor`, `T2DMap.cpp:3085`) and colors the vertical glyphs by
door state. Our payload has `exitKinds` but no door channel, and the client
draws nothing — yet doors are real gameplay (closed/locked exits).

**Recommendation**: extend `classify_exit`/`record_room_exits` to also emit
`exitDoors: {dir: 1|2|3}` when the room reports a door (mudlib exit flags —
needs a small query hook in newroom.c). Client: tint the connector (or a
midpoint tick) by state. Ship server + client together; version-stamp only
rooms whose door state changed.

### GAP 5 — `in`/`out` are not first-class (both sides)

The 12-direction industry vocabulary includes `in`/`out` (Mudlet codes
11/12, zero displacement, rendered as inward/outward triangle pairs inside
the room box — `T2DMap.cpp:1613-1710`). Our `enter` exits classify as
`special` (dot indicator), and there is no "out" notion at all.

**Recommendation** (small): keep placement as-is (specials already sit
beside the anchor), but map exit names `in`/`enter` → an inward glyph and
`out`/`exit`/`leave` → an outward glyph on the client, falling back to the
generic dot for other specials. Pure presentation; no protocol change
(`exitKinds` + exit name already carry enough).

### GAP 6 — No room "details" channel (protocol nicety)

IRE `Room.Info.details` (`["shop","bank",...]`) drives per-room icons in
every IRE client. We have nothing equivalent, though the mudlib knows
(shops, banks, trainers, post offices).

**Recommendation** (small-medium, do opportunistically): optional
`details: [...]` in `room_payload()` sourced from a room hook
(`query_map_details()`), rendered as a tiny corner icon/tint. Bounded list;
only stamp when changed.

### GAP 7 — No client-side pathfinding / click-to-walk (future)

Mudlet's marquee mapper feature: A* over the room graph (Boost,
`TMap::findPath`) honoring locks and per-exit weights, driving speedwalk.
We already ship the full area graph to the client (ids + exits), so a
client-side BFS/A* + "click room → walk there" (send one step at a time,
verify each `Current` matches the expected next room, abort on mismatch) is
feasible with zero protocol changes. Larger feature; separate plan when
wanted. (Mudlet gotcha worth remembering: their A* chokes on huge sparse id
spaces — our crc ids would need index-mapping if we ever do server-side
pathfinding over an adjacency matrix.)

### GAP 8 — Third-party client story (optional)

`mudlet/src/scripts/21_dw_mapper.lua` still consumes the legacy V1
`Room.Info` flow. The industry on-ramp for Mudlet users is **MMP**: serve a
versioned XML map (`<areas>/<rooms>/<exits>`, full-word directions,
`coord x/y/z`, environments with colors) at a URL announced via GMCP
`Client.Map {url, version}`. Our shared server map exports to MMP almost
1:1 (rooms/areas/coords/exits all exist). Low priority unless Mudlet users
matter; would also let us retire the V1 lua script.

### Non-gaps (checked, deliberately not adopting)

- **`Room.WrongDir`** (IRE negative signal): only needed when the client
  infers exits from movement attempts. Ours are server-truth.
- **beip.tilemap / Discworld `room.map`** (server renders, client blits):
  simpler client but forecloses pathfinding, browse panes, and styling; we
  are past that point with a richer model.
- **generic_mapper `stretch_map`** (shove all other rooms outward on
  collision): version-storms every room in the area under our sync model;
  the cone-nudge + repack approach preserves incremental sync.
- **Mudlet exit locks/weights**: pathfinding inputs; adopt only with GAP 7.
- **`merge rooms`**: solves text-inference duplicates we cannot have.

---

## 3. Suggested order of work

1. **GAP 1 + GAP 2** (one-way arrows, area-boundary stubs) — small client-only
   changes, immediate information-density win, extend the diagonal work just
   shipped (`buildExitSpans` + panels.css + tests).
2. **GAP 3** (save version + audit pass + `map2d audit`) — the actual
   "infallible" hardening; server-only, chunked, observable.
3. **GAP 5** (in/out glyphs) — small client polish alongside 1.
4. **GAP 4** (doors) — first change needing a new mudlib hook; server+client.
5. **GAP 6** (details/icons) — opportunistic.
6. **GAP 7** (click-to-walk speedwalk) — own plan.
7. **GAP 8** (MMP export) — only if third-party clients become a goal.

### Implementation status (2026-07-07)

GAPs 1-7 implemented same day (GAP 8 deliberately skipped). Notes beyond the
recommendations above:

- GAP 4 door probing exposed and fixed a live topology bug: the door mixin
  removes an exit while its door is closed, so observing a room with a shut
  door ERASED the mapped edge until someone saw it open. `record_room_exits`
  now carries door-bearing edges forward across door flips. No new mudlib
  hook was needed — `query_door`/`query_door_closed`/`query_door_locked` on
  the room (via the door mixin every ROOM inherits) sufficed; doors are
  probed over the canonical direction list, never just current exits.
- GAP 6 ships with `function_exists` auto-probes (shop `is_buyable_stock`,
  bank `transfer_money`, guild `get_new_title`, pub `bartender_present`,
  post `query_mail`); the `query_map_details()` room hook overrides them.
- GAP 7 lives in `public/js/map-speedwalk.js`: same-area BFS (closed/locked
  doors unroutable), raw-command steps verified against every
  `MapData2.Current`, per-step timeout, manual input cancels via input.js.
- GAP 3's audit deviates from Mudlet on one point: dangling exits are
  deleted-and-logged rather than downgraded to stubs, because the live game
  re-derives edges on the next observation (Mudlet has no ground truth to
  re-derive from).

---

## Appendix A — Mudlet reference points (for implementation)

- Direction codes 1-12 + `DIR_OTHER 13` sentinel: `src/TMap.h:45-57`;
  unit vectors (screen-Y flipped): `TMap.h:233-242`; reverse-direction
  table: `TMap.h:245-256`.
- Exits = per-direction int dest-id slots (`-1` none) + `mSpecialExits
  (QMap<QString,int>)` + `exitStubs (QList<int>)`: `src/TRoom.h:155-220`.
  Stub rejected if a real exit exists in that direction; real exit + stub
  in same dir → audit removes the stub.
- One-way detection & rendering (dotted + arrowhead): `src/T2DMap.cpp:
  3312-3644`. Area-exit arrows (env-colored, clickable): `:3646-3741`.
  Stubs (half-line + dot): `:3535-3563`. Up/down/in/out triangle glyphs
  colored by door state: `:1524-1710`. Doors as perpendicular gates:
  `:3085-3145`. Collision border color: `:2093-2148`.
- Audit checklist: `src/TRoomDB.cpp:629-648` (docs) + `auditRooms`
  implementation; per-room exit validation `src/TRoom.cpp:1071-1695`
  (dangling exit → stub + `audit.*` userdata keys).
- Save versioning window (`mMinVersion/mDefaultVersion/mMaxVersion`):
  `src/TMap.h:274-316`.
- generic_mapper (Lua, `src/mudlet-lua/lua/generic-mapper/
  generic_mapper.xml`): coordmap incl. combined vertical-diagonals
  (`:2323-2364`), `create_room` (`:2830`), `find_link` reuse-before-create
  (`:2912`), `stretch_map` directional spread (`:2803`), repair aliases
  `shift`/`merge rooms`/`room coords` (`:3453/:3590/:688`).

## Appendix B — Protocol field cheat-sheet

- IRE `Room.Info`: `num, name, area, environment, coords
  ("areaID,X,Y,Z[,building]" string), map ("<url> <x> <y>"), exits
  ({"n": destId}), details (["shop","bank"])`. `Room.WrongDir` = attempted
  dir string. `Room.Players/AddPlayer/RemovePlayer` for the social layer.
- MMP XML: `<area id name>`, `<room id area title environment>` containing
  `<coord x y z>` + `<exit direction="north" target="8472">`,
  `<environment id name color [htmlcolor]>`. Announced via Mudlet GMCP
  `Client.Map {url[, version]}`; replace-on-version-change, no merge.
- MSDP `ROOM`: `VNUM, NAME, AREA, TERRAIN, COORDS{X,Y,Z},
  EXITS{dir: vnum}`.
- Aardwolf `room.info`: `num (-1 = unmappable), name, zone, terrain,
  details, exits {dir: destId}, coord {id, x, y, cont}`; maze rooms send
  directions without ids on purpose.
- beip.tilemap: `beip.tilemap.info {name: {tile-url, tile-size, map-size,
  encoding}}` + `beip.tilemap.data {name: "<hex_4|hex_8|base64_8|
  zbase64_8>"}` — server-rendered tile pushes, the fully
  server-authoritative extreme.
