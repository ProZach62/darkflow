# Darkwind.Room.Occupants GMCP Protocol

`Darkwind.Room.Occupants 1` is an opt-in, visibility-filtered view of living
things in the recipient's current room. Darkflow uses it for the Isometric Room
panel and the current-room card. The room panel is intentionally independent of
MapData2: it renders one current-room scene rather than a navigable world map.

```json
{
  "version": 1,
  "room": "450359962737049",
  "mode": "snapshot",
  "revision": 42,
  "dark": 0,
  "more": 0,
  "upsert": [
    {
      "id": "b26a4d1f",
      "name": "a frost giant",
      "kind": "npc",
      "race": "giant",
      "family": "giant",
      "gender": "male",
      "size": "huge",
      "hostile": 1,
      "fighting": 1,
      "weapon": "great axe",
      "role": "guardian",
      "activity": "guard",
      "anchor_id": "north-gate",
      "engaged_with": "self:nacho",
      "level": 182
    }
  ],
  "removed": []
}
```

`mode` is `snapshot` or `delta`. A delta must include `base_revision` equal to
the client's current revision for the same room; otherwise the client ignores
it. `removed` contains stable occupant ids and `upsert` replaces matching ids.
The server caps `upsert` at 24 and reports omitted entries in `more`.

The server must build this message per viewer with the same visibility rules as
`look`. A dark room sends `dark: 1` and no occupants. NPC level is optional and
must follow the existing `npcdetail` permission. `hostile` means aggressive to,
or fighting, the recipient.

Optional scene fields enrich the room without changing occupant identity:

| Field             | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `role`            | Short player-visible role such as `guard`, `merchant`, or `blacksmith` |
| `activity`        | Idle behavior such as `patrol`, `wander`, `work`, `sit`, or `sleep`    |
| `anchor_id`       | A `Room.Info.looks[].id` near which the occupant should stand          |
| `weapon`          | Weapon name used to choose a visible equipment overlay                 |
| `shield`          | Boolean or `0`/`1` shield visibility                                   |
| `helmet`, `armor` | Short visible equipment labels                                         |
| `faction`         | Player-visible faction label                                           |
| `cue`             | `quest` or `objective` marker                                          |
| `engaged_with`    | Stable occupant ID of the current combat opponent                      |

When `fighting` is set, Darkflow stages friendly and hostile occupants on
opposing sides and animates a lightweight combat beat. These fields remain
visibility-filtered and must not reveal hidden equipment, roles, or targets.

Until a server advertises this package, Darkflow shows the recipient from
`Char.Status` and other players from `Room.Players`; NPCs intentionally remain
absent rather than relying on the less-safe legacy room inventory list.
