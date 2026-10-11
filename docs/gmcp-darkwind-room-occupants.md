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

`mode` is `snapshot` or `delta`. Snapshots normally have a strictly newer revision;
older snapshots and conflicting equal revisions are ignored. An identical
equal-revision snapshot may restore data cleared locally while its connection
watermark remains. A delta is accepted only after a
snapshot, must itself be strictly newer, and must include `base_revision` equal
to the client's current revision for the same room. A mismatch immediately
clears the stale roster and sends one `Darkwind.Client.Subscriptions` request
with `{ "full": true, "panels": { "room": true } }` for a replacement snapshot
(it does not resync MapData2). Repeated mismatches do not repeat this request.
`removed` contains stable
occupant ids and `upsert` replaces matching ids.
The server caps `upsert` at 24 and reports omitted entries in `more`.
Revisions are positive safe integers. `more` is a nonnegative integer counting
only perceived server omissions. Darkflow also counts received actors that do
not fit its actual stage layout.

Optional `unavailable: 1` is an authoritative empty view when a bounded scan
cannot finish, not a darkness claim or an invented overflow count. It carries
empty `upsert` and zero `more`; recovery replaces it with a normal snapshot.
Missing room identity uses `Room.Info.num: 0` followed by room `"0"` with an
unavailable empty roster. Neither state may fall back to stale legacy names.

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
| `appearance`      | Recipient-safe Combat actor appearance hints                            |
| `equipment`       | Recipient-safe Combat actor visible equipment hints                     |
| `public_state`    | Recipient-safe public hints, including optional `condition`              |

When `fighting` is set, Darkflow stages friendly and hostile occupants on
opposing sides and animates a lightweight combat beat. These fields remain
visibility-filtered and must not reveal hidden equipment, roles, or targets.

Until a server advertises this package, Darkflow shows the recipient from
`Char.Status` and other players from `Room.Players`; NPCs intentionally remain
absent rather than relying on the less-safe legacy room inventory list.

IDs are opaque per-recipient identities. The Scene keys figures and combat
bridges by these IDs, including when names are duplicated; clients must not
join occupants to combat actors by name. Unsubscribing drops displayed roster
data but retains the connection revision watermark. Connection, character, and
room-generation changes reset both. A dark snapshot removes occupant names
immediately and disables private `Char.Status` fallback rendering.
The idle Scene also clears party figures, auras, old combat labels and scenery
controls immediately. Until the connection is reset, receiving this package
marks the roster authoritative even while a replacement snapshot is pending.
