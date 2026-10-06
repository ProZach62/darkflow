# Isometric Room Server Handoff

## Goal

Darkflow now has a single-room isometric scene. To populate it with visible
players, NPCs, pets, buildings, scenery, and interactable objects, the game
server should send two authoritative, visibility-filtered GMCP payloads:

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

Add an optional `looks` array to `Room.Info`. It should be derived from the
room's visible look definitions and valid parser nouns.

```json
{
  "num": "101",
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
      "sprite": "fountain"
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
  }
}
```

### `looks` entry fields

| Field    | Required | Meaning                                                                             |
| -------- | -------- | ----------------------------------------------------------------------------------- |
| `id`     | Yes      | Stable identifier within the room. It should remain stable between updates.         |
| `name`   | Yes      | Player-facing display label, such as `a marble fountain`.                           |
| `nouns`  | Yes      | One or more valid command targets. The client sends `look <first noun>`.            |
| `kind`   | No       | Semantic category used to select suitable artwork.                                  |
| `sprite` | No       | Explicit client artwork hint. Unknown values safely fall back to a generic hotspot. |

The array may be `""` when there are no visible targets, matching existing LPC
empty-value conventions. Entries should already be filtered for darkness,
concealment, discovery state, and player-specific perception.

The current client renders at most 12 room targets. It has dedicated prop art
for these `sprite` values:

- `altar`
- `barrels`
- `bookshelf`
- `chair`
- `chest`
- `fountain`
- `gate`
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

Known building tags currently include `bank`, `guild`, `house`, `post`,
`post-office`, `pub`, `ruins`, `shop`, `temple`, and `tower`.

## Visible Players, NPCs, and Pets

Send `Darkwind.Room.Occupants 1` after the player enters a room. Send either a
new snapshot or revisioned deltas whenever visible occupants change.

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
      "id": "self:nacho",
      "name": "Nacho",
      "kind": "self",
      "race": "human",
      "gender": "male",
      "size": "medium"
    },
    {
      "id": "guard-1874",
      "name": "a scarred temple guard",
      "kind": "npc",
      "race": "human",
      "family": "human",
      "gender": "male",
      "size": "medium",
      "hostile": 0,
      "fighting": 0,
      "elite": 1,
      "level": 40
    }
  ],
  "removed": []
}
```

### Occupant fields

| Field      | Required | Meaning                                                                 |
| ---------- | -------- | ----------------------------------------------------------------------- |
| `id`       | Yes      | Stable occupant identifier used by snapshots and deltas.                |
| `name`     | Yes      | Visible player-facing name.                                             |
| `kind`     | Yes      | One of `self`, `player`, `npc`, or `pet`.                               |
| `race`     | No       | Specific race used for sprite selection.                                |
| `family`   | No       | Broader creature family used when no exact race artwork exists.         |
| `gender`   | No       | Used when gender-specific character art exists.                         |
| `size`     | No       | Creature scale classification.                                          |
| `hostile`  | No       | Nonzero when aggressive toward or fighting the recipient.               |
| `fighting` | No       | Nonzero while actively fighting.                                        |
| `elite`    | No       | Marks an elite NPC.                                                     |
| `boss`     | No       | Marks a boss NPC.                                                       |
| `hazy`     | No       | Marks an occupant whose identity is only partially perceived.           |
| `owner`    | No       | Visible owner name for a pet.                                           |
| `level`    | No       | NPC level, only when the recipient has existing `npcdetail` permission. |

Wire booleans may be JSON booleans or LPC-compatible `0` and `1` values.

### Snapshot and delta lifecycle

- `mode: "snapshot"` replaces the visible occupant set for that room.
- `mode: "delta"` updates an existing set and must include `base_revision`
  equal to the client's current revision.
- `upsert` adds occupants or replaces occupants with matching IDs.
- `removed` contains stable occupant IDs to remove.
- `room` must match the current `Room.Info` room identity.
- `revision` must increase as the authoritative set changes.
- `dark: 1` means no occupants should be exposed.
- `more` reports how many visible occupants were omitted by the server cap.

The protocol accepts up to 24 occupants. The current room scene displays the
first eight sprites and summarizes overflow separately.

Example delta:

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
      "id": "guard-1874",
      "name": "a scarred temple guard",
      "kind": "npc",
      "race": "human",
      "gender": "male",
      "hostile": 1,
      "fighting": 1
    }
  ],
  "removed": ["rat-992"]
}
```

## Visibility and Security Requirements

Both payloads must be built separately for each recipient and use the same
rules as the textual `look` command.

- Do not expose invisible, hidden, concealed, or undiscovered entities.
- In darkness, send `looks: ""` and an occupant payload with `dark: 1` and an
  empty `upsert` list unless the player can perceive through that darkness.
- Do not expose NPC level without the existing `npcdetail` permission.
- Do not use object file paths, clone names, or other internal identifiers as
  player-facing names.
- Ensure every noun supplied in `looks` is a safe, valid target for the normal
  command parser.
- Keep IDs stable, but do not make them reveal hidden implementation details.

## Client Behavior

When the player selects a catalogue entry, Darkflow sends:

```text
look <first noun>
```

The server remains responsible for parsing the command and returning the
normal textual description. The client immediately animates the player's
sprite toward the matching item and returns it to its home position after a
short pause. Typing the same targeted look command manually produces the same
animation.

The current client assigns scene positions automatically. The server does not
need to send coordinates for this version.

## Recommended Implementation Order

1. Advertise and send `Darkwind.Room.Occupants 1` snapshots on room entry.
2. Include visible players, NPCs, and pets with stable IDs and appearance
   fields.
3. Add visibility-filtered `Room.Info.looks` entries from room look/noun data.
4. Send occupant deltas for enters, leaves, combat-state changes, and
   visibility changes.
5. Add richer optional scene metadata in a later protocol revision only if the
   client needs exact placement, equipment visuals, poses, or verbs beyond
   `look`.

## Possible Future Extensions

These are not required by the current client, but would support a more dynamic
room later:

- Server-directed scene position or placement zone
- Occupant sprite or equipment appearance hints
- Object state such as open, closed, lit, broken, or occupied
- Supported verbs such as `sit`, `open`, `read`, `drink`, or `search`
- Movement and pose events for NPCs
- Object add, update, and remove deltas independent of `Room.Info`

Any such additions should be optional and versioned so the present payloads
remain compatible.
