# Darkwind.Room.Occupants GMCP Protocol

`Darkwind.Room.Occupants 1` is an opt-in, visibility-filtered view of living
things in the recipient's current room. Darkflow uses it for the isometric map
and the current-room card.

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

Until a server advertises this package, Darkflow shows the recipient from
`Char.Status` and other players from `Room.Players`; NPCs intentionally remain
absent rather than relying on the less-safe legacy room inventory list.
