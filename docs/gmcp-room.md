# Room GMCP Protocol Support

Darkflow advertises `Room 1`. Room messages feed the room panel, the generic
cross-MUD map, the Darkwind map fallback, speedwalk verification, room media,
and synchronized room features such as the shared jukebox.

## Messages

| Message             | Direction        | Client behavior                                  |
| ------------------- | ---------------- | ------------------------------------------------ |
| `Room.Info`         | Server -> Client | Merge current-room metadata and update map state |
| `Room.Players`      | Server -> Client | Replace the current room player list             |
| `Room.AddPlayer`    | Server -> Client | Append one player to the room list               |
| `Room.RemovePlayer` | Server -> Client | Remove one player by name                        |

## Room.Info

```json
{
  "num": "450359962737049",
  "name": "Temple Yard",
  "area": "Darkwind",
  "environment": "outside, city",
  "coords": { "x": 0, "y": 0, "z": 0 },
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
    }
  ],
  "scene": { "time": "dusk", "weather": "rain", "lighting": "fire" },
  "exits": {
    "north": "450359962737050",
    "south": "closed"
  },
  "exit_details": { "north": { "kind": "path" }, "south": { "kind": "gate" } }
}
```

| Field                              | Notes                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `num` or `id`                      | Stable room identity; `num` is used to detect room changes                         |
| `name`                             | Room panel title                                                                   |
| `area` or `zone`                   | Area identity for map grouping                                                     |
| `environment`, `terrain`, or `env` | Terrain label; aliases are normalized                                              |
| `coords`                           | Optional `{x,y,z}` object; copied to `coord_x`, `coord_y`, `coord_z`               |
| `exits`                            | Direction -> destination id or non-numeric state label                             |
| `exit_states`                      | Optional explicit direction -> unavailable-state label                             |
| `exit_details`                     | Optional exit presentation (`path`, `door`, `gate`, `stairs`, `cave`, or `portal`) |
| `details`                          | Optional room tags retained by mapping implementations                             |
| `looks`                            | Optional visibility-filtered catalogue of room scenery that accepts `look`         |
| `scene`                            | Optional time, weather, and lighting presentation                                  |

The Darkwind server uses an empty string as the LPC/JSON sentinel when
`coords`, `exits`, `details`, or `looks` has no value. `Room.Players` likewise sends an
empty string when no other players are present. Clients accept those wire
values as empty state without rewriting the received payload.

Each `looks` entry has a stable room-local `id`, player-facing `name`, and one
or more normalized command `nouns`. Optional fields add `kind`, `sprite`,
`state`, `category`, a `cue` (`quest`, `objective`, `new`, `secret`, or `loot`),
up to six safe command `verbs`, and a percentage `position` inside the room
stage. Darkflow recognizes its built-in prop names and otherwise falls back to
matching familiar nouns. Entries must already reflect what the player can
perceive. Selecting an action sends `<verb> <first noun>` and walks the player
sprite to the object. For older servers without `looks`, the panel uses
`details` as a basic catalogue.

`scene.time` accepts `dawn`, `day`, `dusk`, or `night`; `scene.weather` accepts
`clear`, `rain`, `snow`, `fog`, `ash`, or `sand`; and `scene.lighting` accepts
`normal`, `bright`, `dim`, `fire`, or `magic`. Unknown values safely use the
day, clear, and normal defaults.

When an `exits` value is a non-numeric string, Darkflow also treats it as an
exit state. The room panel displays that direction as unavailable with the
state in its tooltip. Numeric or otherwise usable destinations are rendered as
buttons that send the direction as a normal game command.

Each `Room.Info` is passed to the generic local map even while
`Darkwind.MapData2` is active. This keeps a ready fallback for servers or rooms
where MapData2 cannot provide an authoritative current-room payload.

## Player List Messages

`Room.Players` carries the complete array:

```json
[{ "name": "nacho", "fullname": "Nacho the Bold" }]
```

`Room.AddPlayer` carries one player object. `Room.RemovePlayer` accepts either
a player-name string or an object with `name`. The room panel displays
`fullname` when present and falls back to `name`.

## Update Semantics

`Room.Info` updates for the same room are merged so partial updates retain known
fields. A changed room identity replaces the previous metadata so optional
fields from the old room cannot leak into the new one. A changed `num` also
clears the current room-image panel until a new `Darkwind.Room.Image` arrives.
The player list is maintained separately by the three player messages above.
