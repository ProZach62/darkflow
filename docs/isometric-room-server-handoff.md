# Isometric Room Server Handoff

## Delivery status (2026-10-07)

Darkwind now implements recipient-filtered `Room.Info` and negotiated
`Darkwind.Room.Occupants 1` snapshots and revisioned deltas on `PZ-bonanza`. This
document distinguishes that contract from optional fields accepted by Darkflow.
Local follow-up adds scenery capability parity to both room inherits,
conditional discovery in the Qazaash vegetable plot, and exact scenery/anchor
ID matching in Darkflow, plus bounded event-driven refresh. Companion client
changes are included on `combat-canvas`; this branch delivery is not a
deployment. Live two-observer, transport, reconnect, character switch, and
daemon-reload acceptance remains pending; fixture checks are not production
verification.

## Goal

Darkflow now has a single-room isometric scene. To populate it with visible
players, NPCs, pets, buildings, scenery, and interactable objects, the game
server sends two authoritative, visibility-filtered GMCP payloads:

1. `Room.Info` describes the room, terrain, exits, buildings, and objects the
   player can examine.
2. `Darkwind.Room.Occupants 1` describes living things currently visible to
   that player.

```text
Room.Info                 Darkwind.Room.Occupants 1
terrain and objects       players, NPCs, and pets
          \                 /
           \               /
            Isometric Room
```

The server remains authoritative. The client must not discover hidden objects
or occupants by receiving data that the player cannot perceive.

## Room Scenery and Interactable Objects

Darkwind sends `looks` from explicit `add_scene_look()` registrations alongside
existing `add_look()` aliases in `inherits/room.c` and `inherits/newroom.c`.
It does not enumerate descriptions or evaluate legacy look closures. Content
owns labels, IDs, artwork hints, and optional viewer-aware discovery hooks.
Only registered, currently valid, unshadowed parser nouns are advertised.

The following example illustrates the wider client-supported schema. `verbs`,
`position`, authored exit kinds, and weather are not promised by the current
server delivery. It emits existing service tags, visible door states/kinds,
public time/light, and bounded authored scenery; loose loot is not serialized.

```json
{
  "num": 101,
  "name": "Temple Courtyard",
  "area": "Darkwind",
  "environment": "city",
  "details": ["temple"],
  "looks": [
    {
      "id": "marble-fountain",
      "name": "a marble fountain",
      "nouns": ["fountain", "water"],
      "kind": "fountain",
      "sprite": "fountain",
      "state": "active",
      "verbs": ["drink"],
      "cue": "quest",
      "position": { "x": 24, "y": 58 }
    },
    {
      "id": "ancient-oak",
      "name": "an ancient oak tree",
      "nouns": ["oak", "tree"],
      "kind": "tree",
      "sprite": "tree"
    }
  ],
  "exits": {
    "north": "102",
    "south": "closed"
  },
  "exit_states": {
    "south": "locked"
  },
  "exit_details": {
    "north": { "kind": "path" },
    "south": { "kind": "gate" }
  },
  "scene": { "time": "dusk", "weather": "rain", "lighting": "fire" }
}
```

### `looks` entry fields

| Field      | Required | Meaning                                                                             |
| ---------- | -------- | ----------------------------------------------------------------------------------- |
| `id`       | Yes      | Exact, stable room-local identifier; punctuation and case are significant.          |
| `name`     | Yes      | Player-facing display label, such as `a marble fountain`.                           |
| `nouns`    | Yes      | One or more valid command targets.                                                  |
| `kind`     | No       | Semantic category used to select suitable artwork.                                  |
| `sprite`   | No       | Explicit client artwork hint. Unknown values safely fall back to a generic hotspot. |
| `state`    | No       | Visible state such as `lit`, `locked`, `broken`, `empty`, or `active`.              |
| `category` | No       | Presentation category such as `item`, `workplace`, or `scenery`.                    |
| `cue`      | No       | `quest`, `objective`, `new`, `secret`, or `loot` marker.                            |
| `verbs`    | No       | Up to six single-word parser verbs; `look` is always available.                     |
| `position` | No       | `{x,y}` percentage position; accepted bounds are x 8-92 and y 24-82.                |

New servers send `[]` when there are no visible targets. Darkflow also accepts
legacy `""` as explicitly empty. Only a missing `looks` field permits a legacy
`details` interaction fallback; service tags are not guaranteed parser nouns.
Entries are filtered for darkness, blindness, discovery, and recipient
perception. IDs are not slugified: `survey.stake` and `survey-stake` remain
different objects, and an `anchor_id` must match an advertised ID exactly.

The shared registration limit is 32 entries, eight nouns per entry, and 12
emitted targets. Shadow checks scan at most 64 carried objects and 64 total
room entries, including the viewer. Oversized scans fail closed. Removing an
alias stops advertising it. Discovery hook failure omits the target without
evaluating its textual description.

The current client renders at most 12 room targets. It has dedicated prop art
for these `sprite` values:

- `altar`
- `anvil`
- `barrels`
- `bed`
- `bench`
- `bookshelf`
- `brazier`
- `campfire`
- `cart`
- `chair`
- `chains`
- `chest`
- `crates`
- `dead-tree`
- `fountain`
- `gate`
- `gravestone`
- `loot`
- `market-stall`
- `mushrooms`
- `reeds`
- `rubble`
- `rug`
- `sign`
- `statue`
- `table`
- `tree`
- `well`

If `sprite` is omitted, Darkflow attempts to match familiar words from `kind`,
`name`, and `nouns`. Unknown scenery is still listed and remains clickable, but
it uses a generic interaction marker.

### Buildings and terrain

Existing `Room.Info` fields continue to provide the rest of the scene:

| Field                              | Client use                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `environment`, `terrain`, or `env` | Selects the room floor texture.                                                                       |
| `details`                          | Selects known service buildings and acts as a basic interaction fallback when `looks` is unavailable. |
| `exits`                            | Creates directional exit controls.                                                                    |
| `exit_states`                      | Selects open, closed, or locked door presentation.                                                    |
| `exit_details`                     | Selects `path`, `door`, `gate`, `stairs`, `cave`, or `portal` art and an optional label.              |
| `scene`                            | Selects time, weather, and lighting overlays.                                                         |

Known building tags currently include `bank`, `guild`, `house`, `post`,
`post-office`, `pub`, `ruins`, `shop`, `temple`, and `tower`.

## Visible Players, NPCs, and Pets

Darkwind sends `Darkwind.Room.Occupants 1` after room entry/subscription and
reconciles changed recipient-visible state through coalesced event hooks and
the existing shared ticker. First baselines and recovery use complete snapshots;
same-room changes use revisioned deltas where insertion order is preserved.
IDs are opaque, connection-local, and per-recipient; they must not encode true
names or paths.
The optional appearance/equipment fields below illustrate client support,
not a guarantee that each actor supplies every field.

```json
{
  "version": 1,
  "room": "101",
  "mode": "snapshot",
  "revision": 42,
  "dark": 0,
  "more": 0,
  "upsert": [
    {
      "id": "o1",
      "name": "Nacho",
      "kind": "self",
      "race": "human",
      "gender": "male",
      "size": "medium"
    },
    {
      "id": "o2",
      "name": "a scarred temple guard",
      "kind": "npc",
      "race": "human",
      "family": "human",
      "gender": "male",
      "size": "medium",
      "hostile": 0,
      "fighting": 0,
      "elite": 1,
      "role": "temple guard",
      "activity": "guard",
      "anchor_id": "marble-fountain",
      "weapon": "long sword",
      "shield": 1,
      "armor": "plate",
      "faction": "Temple Watch",
      "cue": "quest",
      "level": 40
    }
  ],
  "removed": []
}
```

### Occupant fields

| Field             | Required | Meaning                                                                 |
| ----------------- | -------- | ----------------------------------------------------------------------- |
| `id`              | Yes      | Stable occupant identifier used by snapshots and deltas.                |
| `name`            | Yes      | Visible player-facing name.                                             |
| `kind`            | Yes      | One of `self`, `player`, `npc`, or `pet`.                               |
| `race`            | No       | Specific race used for sprite selection.                                |
| `family`          | No       | Broader creature family used when no exact race artwork exists.         |
| `gender`          | No       | Used when gender-specific character art exists.                         |
| `size`            | No       | Creature scale classification.                                          |
| `hostile`         | No       | Nonzero when aggressive toward or fighting the recipient.               |
| `fighting`        | No       | Nonzero while actively fighting.                                        |
| `elite`           | No       | Marks an elite NPC.                                                     |
| `boss`            | No       | Marks a boss NPC.                                                       |
| `hazy`            | No       | Marks an occupant whose identity is only partially perceived.           |
| `owner`           | No       | Visible owner name for a pet.                                           |
| `level`           | No       | NPC level, only when the recipient has existing `npcdetail` permission. |
| `role`            | No       | Short player-visible role.                                              |
| `activity`        | No       | `patrol`, `wander`, `work`, `sit`, `sleep`, or another safe idle hint.  |
| `anchor_id`       | No       | Matching `looks[].id` used to place the occupant near an object.        |
| `weapon`          | No       | Weapon name used for a visible equipment overlay.                       |
| `shield`          | No       | Boolean or `0`/`1` shield visibility.                                   |
| `helmet`, `armor` | No       | Short visible equipment labels.                                         |
| `faction`         | No       | Player-visible faction label.                                           |
| `cue`             | No       | `quest` or `objective` marker.                                          |
| `engaged_with`    | No       | Stable ID of the occupant's current combat opponent.                    |

Wire booleans may be JSON booleans or LPC-compatible `0` and `1` values.

### Snapshot and delta lifecycle

- `mode: "snapshot"` replaces the visible occupant set for that room.
- `mode: "delta"` updates an existing set and must include `base_revision`
  equal to the client's current revision.
- `upsert` adds occupants or replaces occupants with matching IDs.
- Replacement is complete, not a field merge: omitted optional fields are
  removed. Delta records must include every field intended to remain.
- `removed` contains stable occupant IDs to remove.
- `room` must match the canonical string form of numeric `Room.Info.num`.
  An unavailable identity clears to zero; never invent a path-based ID.
- Positive `revision` increases after accepted changed state. Failed sends
  do not commit state/revisions. Identical forced snapshots can reuse the
  revision; lower revisions and conflicting equal revisions are rejected.
- `dark: 1` means no occupants should be exposed.
- `unavailable: 1` explicitly clears an incomplete/failed bounded scan, with
  empty `upsert` and zero `more`. Do not guess an overflow count.
- `more` reports how many visible occupants were omitted by the server cap.

The server sends at most 24 occupants, self first. The room scene displays the
first eight sprites; overflow equals received but undisplayed actors plus
`more` (24 received + five omitted - eight drawn = 21). Hidden actors never
contribute to this count. Connection-local IDs/revisions survive daemon reload;
unsubscribe clears rosters but retains the revision counter. Reconnect and
character change reset session state.

The client consumes server deltas. A same-room delta needs a ready snapshot,
the current `base_revision`, and a strictly newer revision. On a mismatch it
clears the stale set and requests one existing panel subscription refresh with
`full: true`, not a new resync package. A complete snapshot restores the set.

The server sends a full snapshot for explicit refresh, room instance/identity
changes, dark/unavailable clearing and recovery, or when a reappearing earlier
ID would change canonical order under insertion-preserving client upserts.
Delta `more` is the current total omitted count, not an increment. A send failure
retains the accepted baseline/revision for retry. Complete replacement records
can remove optional fields such as a previously permitted NPC level.

Example delta, deliberately retaining the guard's optional fields:

```json
{
  "version": 1,
  "room": "101",
  "mode": "delta",
  "base_revision": 42,
  "revision": 43,
  "dark": 0,
  "more": 0,
  "upsert": [
    {
      "id": "o2",
      "name": "a scarred temple guard",
      "kind": "npc",
      "race": "human",
      "family": "human",
      "gender": "male",
      "size": "medium",
      "hostile": 1,
      "fighting": 1,
      "elite": 1,
      "role": "temple guard",
      "activity": "guard",
      "anchor_id": "marble-fountain",
      "weapon": "long sword",
      "shield": 1,
      "armor": "plate",
      "faction": "Temple Watch",
      "cue": "quest",
      "level": 40
    }
  ],
  "removed": ["o3"]
}
```

## Visibility and Security Requirements

Both payloads must be built separately for each recipient and use the same
rules as the textual `look` command.

- Apply existing `environment_visible`, `visible_to`, and blindness rules;
  retain legitimate see-invisible perception. Hazy perception must not disclose
  concealed identity/appearance. Discovery is evaluated for each viewer.
- When the viewer cannot perceive the room, clear `looks`, `details`, `exits`,
  `exit_states`, and `exit_details`; send `dark: 1`, empty `upsert`, zero `more`,
  and clear legacy player rosters. Optional metadata must not restore names.
- Do not expose NPC level without the existing `npcdetail` permission.
- Do not use object file paths, clone names, or other internal identifiers as
  player-facing names.
- Ensure every noun supplied in `looks` is a safe, valid target for the normal
  command parser.
- Keep IDs stable, but do not make them reveal hidden implementation details.

## Client Behavior

When the player selects a catalogue action, Darkflow sends:

```text
<verb> <first noun>
```

The server remains responsible for parsing the command and returning the
normal textual description. The client immediately animates the player's
sprite toward the matching item and returns it to its home position after a
short pause. Typing the same targeted look command manually produces the same
animation.

`look` is always available. Server-provided verbs are validated as single
command words before display. Every action walks the player sprite to the
matching object. The client assigns safe positions automatically when
`position` is absent.

## Pilot and acceptance boundary

Blue Maw Landing supplies static scenery, aliases, and a multiword noun.
Qazaash's vegetable plot supplies unconditional plot/soil metadata and a woods
target gated by the existing `louie_secret_trail` knowledge flag. Knowing the
trail does not disclose or unlock its hidden north exit. No new quest
prerequisite or world-wide content migration is introduced.

Retained metadata/protocol LPC regressions cover both room inherits,
viewer-specific discovery and recovery, bounded shadowing, closed/locked/custom
and hidden doors, explicit clearing, failed-send retry, IDs/revisions, and caps.
Client tests cover exact IDs/anchors, multiword commands, empty catalogues,
overflow and snapshot/delta recovery. Desktop/narrow Chromium fixtures also
verify mixed removals/replacements/additions, removal of level/shield/fighting
metadata, and capped-roster promotion/overflow. Live observers, telnet/WebSocket
equivalence, character switch, reconnect and daemon reload still require
acceptance testing.

### Coalesced refresh contract

The existing event bus carries transient `world.room_changed` invalidations
from movement/destruction, combat and perception setters; `world.sky_changed`
marks all subscribed viewers dirty. Shared producers contain no client policy.
Transient publications dispatch and count without displacing gameplay history
or announcing every move to the wizard event channel.

TELOPT schedules one one-second flush, coalesces at most 256 dirty rooms, and
visits at most 16 registered players per callback with an evaluation reserve.
Notifications received during a batch remain queued for the next sweep. Each
eligible interactive viewer is rebuilt using its current environment, GMCP
subscription and perception; the event's actor is never a cached projection.
The existing ticker repairs missed notifications, dirty-room overflow and
event-bus reload subscriptions. Teardown removes subscriptions and callouts.

The retained refresh regression exercises real native move/destruct hooks,
combat, blindness and light/visibility setters, malformed payload rejection,
idempotent subscriptions, transient history behavior, the 256/257 dirty-room
boundary, 16/16/4 batching, teardown and subscription repair. Its synthetic
viewers are noninteractive: it verifies skipping them, not delivery through
live sockets. The combined LPC batch passes 21 loads; four desktop/narrow
Chromium fixture checks and 86 client regression tests pass. Lint, formatting,
Svelte checking and the production build pass. Full TypeScript checking retains
the unrelated committed map-test `HTMLElement | SVGElement.hidden` error.

New art, server coordinates, new verbs, loose-loot serialization, global
targeting and map/save migrations remain out of scope.

## Possible Later Extensions

These are not required by the current client, but would support a more dynamic
room later:

- Custom occupant sprite artwork beyond the current race/family selection
- Detailed equipment layers beyond weapon and shield overlays
- Timed movement paths and pose events for NPCs
- Object add, update, and remove deltas independent of `Room.Info`

Any such additions should be optional and versioned so the present payloads
remain compatible.
